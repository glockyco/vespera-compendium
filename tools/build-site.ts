import { existsSync, realpathSync, rmSync } from "node:fs";
import nodePath from "node:path";
import { spawnSync } from "node:child_process";
import nodeProcess from "node:process";
import { canonicalJson } from "@vespera/core";
import {
  acquireLeases,
  snapshotPublishedInputs,
  type PreparedPublishedInputs,
  type LeaseSet,
} from "../packages/pipeline/src/inputs.ts";
import { verifyPublishedMechanics } from "../packages/pipeline/src/verify.ts";
import { verifySiteData } from "../packages/pipeline/src/site-data.ts";
import { checkInputCallers } from "./check-input-callers.ts";
import { checkManifestCallers } from "./check-manifest-callers.ts";
import { checkArtCallers } from "./check-art-callers.ts";

const ROOT = nodePath.resolve(import.meta.dirname, "..");
const SITE_DIR = nodePath.join(ROOT, "site");
const DATA_DIR = nodePath.join(ROOT, "data", "latest");
const LOCK_PATH = nodePath.join(ROOT, "mechanics.lock.json");
const FIXTURE_PATH = nodePath.join(ROOT, "packages", "pipeline", "testdata", "mechanics-contract-v1.json");
const MECHANICS_SOURCE_LOCK_PATH = nodePath.join(ROOT, "mechanics-source.lock.json");

function usage(): string {
  return "usage: bun run tools/build-site.ts [--data <dir>] [--lock <file>] [--fixture <file>] [--mechanics-source-lock <file>]";
}

function option(argv: readonly string[], name: string, fallback: string): string {
  const index = argv.indexOf(name);
  if (index < 0) return fallback;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function assertNoFindings(label: string, findings: readonly { message: string; file: string; line: number }[]): void {
  if (findings.length === 0) return;
  const detail = findings.map((finding) => `${finding.file}:${finding.line} ${finding.message}`).join("\n");
  throw new Error(`${label} failed:\n${detail}`);
}

function assertVerification(label: string, checks: readonly { status: string; detail: string }[]): void {
  const failures = checks.filter((check) => check.status !== "PASS");
  if (failures.length > 0) throw new Error(`${label} failed:\n${failures.map((check) => check.detail).join("\n")}`);
}

function removeSnapshot(prepared: PreparedPublishedInputs): void {
  const snapshot = nodePath.resolve(prepared.snapshotPath);
  if (snapshot === nodePath.parse(snapshot).root) throw new Error("refusing to remove filesystem root snapshot");
  rmSync(snapshot, { recursive: true, force: true });
}

function runVite(prepared: PreparedPublishedInputs): void {
  prepared.assertLeasesLive();
  const snapshotRoot = realpathSync(prepared.snapshotPath);
  const capability = canonicalJson(prepared.capability);
  const environment: NodeJS.ProcessEnv = {
    ...nodeProcess.env,
    VESPERA_DATA_SNAPSHOT: snapshotRoot,
    VESPERA_DATA_SNAPSHOT_CAPABILITY: capability,
  };
  const result = spawnSync("vite", ["build"], { cwd: SITE_DIR, env: environment, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`vite build exited with status ${String(result.status)}`);
}

export type BuildSiteOptions = {
  dataDir?: string;
  lockPath?: string;
  fixturePath?: string;
  mechanicsSourceLockPath?: string;
};

export function buildSite(options: BuildSiteOptions = {}): void {
  const dataDir = nodePath.resolve(options.dataDir ?? DATA_DIR);
  const lockPath = nodePath.resolve(options.lockPath ?? LOCK_PATH);
  const fixturePath = nodePath.resolve(options.fixturePath ?? FIXTURE_PATH);
  const mechanicsSourceLockPath = nodePath.resolve(options.mechanicsSourceLockPath ?? MECHANICS_SOURCE_LOCK_PATH);
  if (!existsSync(dataDir)) throw new Error(`published data directory is missing: ${dataDir}`);
  const leases: LeaseSet = acquireLeases(["mechanics-source", "mechanics", "site-data"], "site build");
  let prepared: PreparedPublishedInputs | null = null;
  try {
    prepared = snapshotPublishedInputs(dataDir, lockPath, fixturePath, mechanicsSourceLockPath, leases);
    prepared.assertLeasesLive();
    assertNoFindings("input caller check", checkInputCallers(ROOT));
    assertNoFindings("manifest caller check", checkManifestCallers(ROOT));
    assertNoFindings("Art caller check", checkArtCallers(ROOT, prepared.snapshotPath));
    assertVerification("published mechanics verification", verifyPublishedMechanics(prepared));
    verifySiteData(prepared, leases);
    runVite(prepared);
  } finally {
    if (prepared !== null) removeSnapshot(prepared);
    leases.releaseAll();
  }
}

export function runBuildSiteCli(argv: readonly string[] = nodeProcess.argv.slice(2)): void {
  if (argv.includes("--help")) {
    console.log(usage());
    return;
  }
  buildSite({
    dataDir: option(argv, "--data", DATA_DIR),
    lockPath: option(argv, "--lock", LOCK_PATH),
    fixturePath: option(argv, "--fixture", FIXTURE_PATH),
    mechanicsSourceLockPath: option(argv, "--mechanics-source-lock", MECHANICS_SOURCE_LOCK_PATH),
  });
}

if (import.meta.main || nodeProcess.argv[1]?.endsWith("build-site.ts")) {
  try {
    runBuildSiteCli();
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    nodeProcess.exitCode = 1;
  }
}
