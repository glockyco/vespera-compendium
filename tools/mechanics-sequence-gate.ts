import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import nodePath from "node:path";
import { spawnSync } from "node:child_process";
import nodeProcess from "node:process";
import { sequenceGateInputBase } from "../packages/pipeline/src/inputs.ts";
import type { BundleRole } from "@vespera/core";

const ROOT = nodePath.resolve(import.meta.dirname, "..");
const PIPELINE_CLI = "packages/pipeline/src/cli.ts";
const ROLE_ORDER: readonly BundleRole[] = ["indexHtml", "index", "gameView"];

type UnknownRecord = Record<string, unknown>;
type GateBase = ReturnType<typeof sequenceGateInputBase>;
type CommandResult = { status: number | null; error: Error | null };

function usage(): string {
  return "usage: bun run tools/mechanics-sequence-gate.ts <extractedDir>";
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function stringMember(value: unknown, member: string): string {
  if (!isRecord(value) || typeof value[member] !== "string") throw new Error(`missing string member ${member}`);
  return value[member];
}

function safePath(root: string, relative: string): string {
  if (relative.startsWith("/") || relative.includes("\\") || relative.split("/").includes("..")) {
    throw new Error(`unsafe sequence-gate path ${relative}`);
  }
  const resolved = nodePath.resolve(root, relative);
  const prefix = nodePath.resolve(root) + nodePath.sep;
  if (!resolved.startsWith(prefix)) throw new Error(`sequence-gate path escapes workspace: ${relative}`);
  return resolved;
}

function writeBytes(root: string, relative: string, bytes: Uint8Array, mode?: number): void {
  const destination = safePath(root, relative);
  mkdirSync(nodePath.dirname(destination), { recursive: true });
  writeFileSync(destination, bytes);
  if (mode !== undefined) chmodSync(destination, mode);
}

function parseBuildId(bytes: Uint8Array): string {
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
  return stringMember(value, "buildId");
}

function parseReviewHash(file: string): string {
  const value: unknown = JSON.parse(readFileSync(file, "utf8"));
  return stringMember(value, "reviewSha256");
}

/**
 * Materializes the whole extracted tree, not only the three bundle roles.
 *
 * Publication reads the game's art as well as its code, so a scratch workspace holding only the roles would
 * let the gate pass a publish the real command could never perform.
 */
function writeBundleSnapshot(root: string, base: GateBase): void {
  cpSync(base.extractedTreePath, safePath(root, "extracted"), { recursive: true });
  for (const role of ROLE_ORDER) {
    const entry = base.bundleRoles[role];
    const filename = entry.filename.replaceAll("\\", "/");
    writeBytes(root, nodePath.join("extracted", filename), entry.bytes);
  }
}

function materializeBase(root: string, base: GateBase): void {
  mkdirSync(root, { recursive: true });
  for (const file of base.repositoryFiles) {
    if (file.path === "mechanics.lock.json" || file.path === "mechanics-source.lock.json") continue;
    writeBytes(root, file.path, file.bytes, file.mode);
  }
  writeBundleSnapshot(root, base);
  writeBytes(root, "packages/pipeline/testdata/mechanics-contract-v1.json", base.contractFixtureBytes);
  writeBytes(root, "mechanics-source.lock.json", base.mechanicsSourceApprovalBytes);
  if (base.lockBytes !== null) writeBytes(root, "mechanics.lock.json", base.lockBytes);
  if (base.evidenceBytes !== null) writeBytes(root, nodePath.join("evidence", parseBuildId(base.evidenceBytes), "runtime-evidence.json"), base.evidenceBytes);
  if (base.externalLeafEvidenceBytes !== null) writeBytes(root, nodePath.join("evidence", parseBuildId(base.evidenceBytes ?? base.externalLeafEvidenceBytes), "external-leaves-approved.json"), base.externalLeafEvidenceBytes);
  const nodeModules = nodePath.join(ROOT, "node_modules");
  if (existsSync(nodeModules)) {
    const link = safePath(root, "node_modules");
    const result = spawnSync("ln", ["-s", nodeModules, link], { stdio: "ignore" });
    if (result.status !== 0) throw new Error("could not link immutable node_modules");
  }
}

function commandArgs(root: string, args: readonly string[], outputs: { outRoot: string; siteData: string }): string[] {
  const common = [
    "--workspace-root", root,
    "--evidence-root", safePath(root, "evidence"),
    "--fixture", safePath(root, "packages/pipeline/testdata/mechanics-contract-v1.json"),
    "--lock", safePath(root, "mechanics.lock.json"),
    "--out-root", outputs.outRoot,
    "--site-data", outputs.siteData,
  ];
  return [PIPELINE_CLI, ...args, ...common];
}

function runCommand(root: string, args: readonly string[], outputs: { outRoot: string; siteData: string }): CommandResult {
  const result = spawnSync(nodeProcess.execPath, commandArgs(root, args, outputs), {
    cwd: root,
    env: { ...nodeProcess.env, NODE_ENV: "test" },
    stdio: "inherit",
  });
  return { status: result.status, error: result.error ?? null };
}

function expectSuccess(root: string, args: readonly string[], outputs: { outRoot: string; siteData: string }): void {
  const result = runCommand(root, args, outputs);
  if (result.error !== null || result.status !== 0) throw result.error ?? new Error(`sequence-gate command failed: ${args.join(" ")}`);
}

function expectFailure(root: string, args: readonly string[], outputs: { outRoot: string; siteData: string }): void {
  const result = runCommand(root, args, outputs);
  if (result.error === null && result.status === 0) throw new Error(`sequence-gate mutation unexpectedly passed: ${args.join(" ")}`);
}

function outputs(root: string): { outRoot: string; siteData: string } {
  return { outRoot: safePath(root, "output"), siteData: safePath(root, "site-data") };
}

function mutateByte(root: string, relative: string): void {
  const file = safePath(root, relative);
  const bytes = new Uint8Array(readFileSync(file));
  if (bytes.length === 0) throw new Error(`cannot mutate empty fixture ${relative}`);
  bytes[0] = bytes[0] ^ 0x01;
  writeFileSync(file, bytes);
}

function freshWorkspace(base: GateBase): string {
  const root = mkdtempSync(nodePath.join(nodeProcess.env.TMPDIR ?? "/tmp", "vespera-sequence-")).replaceAll("\\", "/");
  materializeBase(root, base);
  return root;
}

function positivePhase(base: GateBase): string {
  const root = freshWorkspace(base);
  const destination = outputs(root);
  rmSync(safePath(root, "mechanics.lock.json"), { force: true });
  expectSuccess(root, ["mechanics:diff", "extracted", "--out", safePath(root, "mechanics-review.json")], destination);
  expectSuccess(root, ["mechanics:inspect", "--assert", safePath(root, "mechanics-review.json"), "--attest-out", safePath(root, "mechanics-inspect-attestation.json")], destination);
  expectSuccess(root, ["mechanics:prove", "extracted", safePath(root, "mechanics-review.json"), "--attestation", safePath(root, "mechanics-inspect-attestation.json"), "--out", safePath(root, "mechanics-proof.json")], destination);
  const reviewSha = parseReviewHash(safePath(root, "mechanics-review.json"));
  expectSuccess(root, ["mechanics:sync", "extracted", "--proof", safePath(root, "mechanics-proof.json"), "--reviewed", reviewSha, "--bootstrap"], destination);
  expectSuccess(root, ["mechanics:check", "extracted"], destination);
  expectSuccess(root, ["publish", "extracted"], destination);
  expectSuccess(root, ["verify-published", safePath(root, "data/latest"), safePath(root, "mechanics.lock.json")], destination);
  return root;
}

function negativePhase(positive: string, base: GateBase): void {
  const cases: readonly { name: string; mutate: (root: string) => void; command: readonly string[] }[] = [
    { name: "extracted role bytes", mutate: (root) => mutateByte(root, "extracted/index.html"), command: ["mechanics:prove", "extracted", "mechanics-review.json", "--out", "negative-proof.json"] },
    { name: "fixture bytes", mutate: (root) => mutateByte(root, "packages/pipeline/testdata/mechanics-contract-v1.json"), command: ["mechanics:prove", "extracted", "mechanics-review.json", "--out", "negative-proof.json"] },
    { name: "proof from another review", mutate: (root) => mutateByte(root, "mechanics-proof.json"), command: ["mechanics:sync", "extracted", "--proof", "mechanics-proof.json"] },
    { name: "fixture after approval", mutate: (root) => mutateByte(root, "packages/pipeline/testdata/mechanics-contract-v1.json"), command: ["publish", "extracted"] },
    // Distinct from the "mechanics source approval" case below: that one moves the approved hashes, this one
    // moves the tracked constant the runtime closure is checked against.
    { name: "runtime closure constant", mutate: (root) => mutateByte(root, "packages/core/src/execution-source-hashes/probe-runtime.ts"), command: ["verify-published", "data/latest", "mechanics.lock.json"] },
    { name: "evidence bytes", mutate: (root) => mutateByte(root, `evidence/${parseBuildId(base.evidenceBytes ?? base.externalLeafEvidenceBytes ?? new Uint8Array())}/runtime-evidence.json`), command: ["mechanics:sync", "extracted", "--proof", "mechanics-proof.json"] },
    { name: "lock generation", mutate: (root) => mutateByte(root, "mechanics.lock.json"), command: ["mechanics:sync", "extracted", "--proof", "mechanics-proof.json"] },
    { name: "mechanics source approval", mutate: (root) => mutateByte(root, "mechanics-source.lock.json"), command: ["verify-published", "data/latest", "mechanics.lock.json"] },
  ];
  for (const mutation of cases) {
    const root = freshWorkspace(base);
    try {
      cpSync(positive, root, { recursive: true, force: true });
      mutation.mutate(root);
      expectFailure(root, mutation.command, outputs(root));
      console.log(`REFUSED ${mutation.name}: ${mutation.command[0]} failed closed as required`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

export function runMechanicsSequenceGate(extractedDir: string): void {
  const base = sequenceGateInputBase(extractedDir);
  try {
    if (base.evidenceBytes === null || base.externalLeafEvidenceBytes === null) throw new Error("sequence gate requires current evidence and external-leaf approval");
    const positive = positivePhase(base);
    try {
      negativePhase(positive, base);
    } finally {
      rmSync(positive, { recursive: true, force: true });
    }
    // A silent pass is indistinguishable from a gate that ran nothing, and this one is the reason the
    // approval order cannot be reordered, so it states what it proved.
    console.log("SEQUENCE GATE PASS: the ordered command chain succeeded and all 8 out-of-order mutations were refused");
  } finally {
    rmSync(base.extractedTreePath, { recursive: true, force: true });
  }
}

export function runSequenceGateCli(argv: readonly string[] = nodeProcess.argv.slice(2)): void {
  if (argv.includes("--help")) {
    console.log(usage());
    return;
  }
  if (argv.length !== 1) {
    console.log(usage());
    return;
  }
  runMechanicsSequenceGate(argv[0]!);
}

if (import.meta.main || nodeProcess.argv[1]?.endsWith("mechanics-sequence-gate.ts")) {
  try {
    runSequenceGateCli();
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    nodeProcess.exitCode = 1;
  }
}
