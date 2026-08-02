/**
 * The pipeline command surface.
 *
 * Every command that touches a protected input prepares once through `inputs.ts` and passes only that
 * prepared object onward. The six path overrides exist for the sequence gate, which runs these exact
 * commands against a scratch workspace; production defaults are unchanged, and a command never reopens an
 * override path itself.
 */

import path from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import {
  canonicalJson,
  SOURCE_CLOSURE_ORDER,
  checkProbeContractHashes,
  MECHANICS_APPROVAL_GATE_SHA256,
  MECHANIC_DERIVATION_EXECUTOR_SHA256,
  MECHANIC_PROBE_EXECUTOR_SHA256,
  PROBE_RUNTIME_SHA256,
  type CanonicalJson,
  type SourceClosureName,
} from "@vespera/core";
import {
  acquireLeases,
  commitAtomicFile,
  prepareMechanicsInputs,
  prepareMechanicsSourceReviewInputs,
  prepareReviewInputs,
  readStableFile,
  snapshotPublishedInputs,
  type PrepareOverrides,
} from "./inputs.ts";
import {
  bootstrapMechanicsSourceApproval,
  buildSourceReviewArtifact,
  computeSourceClosures,
  parseInspectAttestation,
  parseSourceReviewArtifact,
  readMechanicsSourceApproval,
  rotateGateApproval,
  rotateInspectorApproval,
  serializeReviewArtifact,
  syncMechanicsSourceApproval,
  type SourceReviewArtifact,
} from "./mechanics-source.ts";
import {
  inspectMechanicsReview,
  inspectMechanicsSourceReviews,
  writeInspectAttestation,
} from "./mechanics-inspect.ts";
import {
  buildMechanicsReviewArtifact,
  checkMechanics,
  parseMechanicsLock,
  recoverMechanicsLock,
  syncMechanicsLock,
  validateMechanicsProof,
} from "./mechanics-lock.ts";
import {
  parseMechanicsProof,
  serializeMechanicsProof,
  serializeMechanicsReviewArtifact,
} from "./mechanics-artifacts.ts";
import { extractMechanics } from "./mechanics.ts";
import { verifyExternalLeafEvidence } from "./external-leaf-evidence.ts";
import { publish } from "./publish.ts";
import { SCHEMA_VERSION } from "./schema.ts";
import { verify, verifyPublished } from "./verify.ts";
import { syncSiteData, verifySiteData } from "./site-data.ts";
import { InvariantError } from "./publish.ts";

type Options = {
  positional: string[];
  flags: Map<string, string>;
  switches: Set<string>;
};

const VALUE_FLAGS = new Set([
  "--workspace-root",
  "--evidence-root",
  "--fixture",
  "--lock",
  "--mechanics-source-lock",
  "--out",
  "--out-root",
  "--site-data",
  "--attest-out",
  "--attestation",
  "--proof",
  "--review",
  "--reviews",
  "--reviewed",
  "--node",
  "--harness",
  "--assert",
]);

function parseArguments(argv: readonly string[]): Options {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  const switches = new Set<string>();
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!;
    if (!argument.startsWith("--")) {
      positional.push(argument);
      continue;
    }
    if (VALUE_FLAGS.has(argument)) {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${argument} requires a value`);
      flags.set(argument, value);
      index++;
      continue;
    }
    switches.add(argument);
  }
  return { positional, flags, switches };
}

function overridesOf(options: Options): PrepareOverrides {
  const overrides: PrepareOverrides = {};
  const map: [string, keyof PrepareOverrides][] = [
    ["--workspace-root", "workspaceRoot"],
    ["--evidence-root", "evidenceRoot"],
    ["--fixture", "fixturePath"],
    ["--lock", "lockPath"],
    ["--mechanics-source-lock", "mechanicsSourceLockPath"],
    ["--review", "reviewPath"],
    ["--proof", "proofPath"],
  ];
  for (const [flag, key] of map) {
    const value = options.flags.get(flag);
    if (value !== undefined) overrides[key] = value;
  }
  return overrides;
}

const constants = {
  approvalGate: MECHANICS_APPROVAL_GATE_SHA256,
  derivation: MECHANIC_DERIVATION_EXECUTOR_SHA256,
  probeExecutor: MECHANIC_PROBE_EXECUTOR_SHA256,
  runtime: PROBE_RUNTIME_SHA256,
} as const;

function requireFlag(options: Options, flag: string): string {
  const value = options.flags.get(flag);
  if (value === undefined) throw new Error(`${flag} is required`);
  return value;
}

function writeCanonical(file: string, value: CanonicalJson): void {
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  commitAtomicFile(path.resolve(file), new TextEncoder().encode(`${canonicalJson(value)}\n`));
}

/* source closure commands */

function closureDiff(name: SourceClosureName, options: Options): void {
  const overrides = overridesOf(options);
  const workspaceRoot = path.resolve(overrides.workspaceRoot ?? ".");
  const approvalPath = path.resolve(
    overrides.mechanicsSourceLockPath ?? path.join(workspaceRoot, "mechanics-source.lock.json"),
  );
  const candidates = computeSourceClosures(workspaceRoot);
  const approved = existsSync(approvalPath)
    ? readMechanicsSourceApproval(approvalPath).approval[name]
    : null;
  const artifact = buildSourceReviewArtifact(name, approved, candidates.closures[name]);
  const out = options.flags.get("--out");
  if (out) commitAtomicFile(path.resolve(out), serializeReviewArtifact(artifact));
  console.log(`${name} approved=${artifact.approvedSha256} candidate=${artifact.candidateSha256}`);
  console.log(`${name} reviewSha256=${artifact.reviewSha256} changes=${artifact.diff.length}`);
  if (!out) console.log("pass --out <json> to write the review artifact");
}

function closureCheck(name: Exclude<SourceClosureName, "inspector">, options: Options): void {
  const overrides = overridesOf(options);
  const workspaceRoot = path.resolve(overrides.workspaceRoot ?? ".");
  const approvalPath = path.resolve(
    overrides.mechanicsSourceLockPath ?? path.join(workspaceRoot, "mechanics-source.lock.json"),
  );
  const candidates = computeSourceClosures(workspaceRoot);
  const approval = readMechanicsSourceApproval(approvalPath);
  const candidate = candidates.hashes[name];
  const constant = constants[name];
  const approved = approval.hashes[name];
  const agree = candidate === constant && candidate === approved;
  console.log(`${name} candidate=${candidate}`);
  console.log(`${name} constant=${constant}`);
  console.log(`${name} approved=${approved}`);
  console.log(agree ? `PASS ${name}` : `FAIL ${name}`);
  if (!agree) process.exitCode = 1;
}

function closureInspect(name: SourceClosureName, options: Options): void {
  const reviewPath = options.positional[0];
  if (!reviewPath) throw new Error("a review artifact path is required");
  const artifact = parseSourceReviewArtifact(readStableFile(path.resolve(reviewPath)));
  if (artifact.closure !== name) {
    throw new Error(`the artifact is for the ${artifact.closure} closure, not ${name}`);
  }
  const rendered = inspectMechanicsSourceReviews({
    reviews: { [name]: artifact } as unknown as Record<SourceClosureName, SourceReviewArtifact>,
  });
  for (const line of rendered.lines) console.log(line);
}

function reviewPathMap(options: Options): Record<string, string> {
  const paths = requireFlag(options, "--reviews").split(",");
  if (paths.length !== SOURCE_CLOSURE_ORDER.length) {
    throw new Error(`--reviews needs ${SOURCE_CLOSURE_ORDER.length} comma-separated artifact paths`);
  }
  return Object.fromEntries(paths.map((file, index) => [`review${index}`, file.trim()]));
}

function readReviewSet(options: Options): Record<SourceClosureName, SourceReviewArtifact> {
  const paths = Object.values(reviewPathMap(options));
  const artifacts = paths.map((file) => parseSourceReviewArtifact(readStableFile(path.resolve(file))));
  const byName = new Map(artifacts.map((artifact) => [artifact.closure, artifact]));
  const reviews: Partial<Record<SourceClosureName, SourceReviewArtifact>> = {};
  for (const name of SOURCE_CLOSURE_ORDER) {
    const artifact = byName.get(name);
    if (!artifact) throw new Error(`--reviews is missing the ${name} closure artifact`);
    reviews[name] = artifact;
  }
  return reviews as Record<SourceClosureName, SourceReviewArtifact>;
}

function readReviewedHashes(options: Options): Record<SourceClosureName, string> {
  const values = requireFlag(options, "--reviewed").split(",").map((value) => value.trim());
  if (values.length !== SOURCE_CLOSURE_ORDER.length) {
    throw new Error(
      `--reviewed needs ${SOURCE_CLOSURE_ORDER.length} comma-separated hashes in the order ${SOURCE_CLOSURE_ORDER.join(",")}`,
    );
  }
  const reviewed: Partial<Record<SourceClosureName, string>> = {};
  for (const [index, name] of SOURCE_CLOSURE_ORDER.entries()) reviewed[name] = values[index]!;
  return reviewed as Record<SourceClosureName, string>;
}

/* mechanics commands */

function runMechanicsCheck(dir: string, options: Options): void {
  const prepared = prepareMechanicsInputs(dir, "check", overridesOf(options));
  try {
    if (prepared.usedLockBuildFallback) {
      console.log("Installed build unavailable; PASS scoped to approved extracted bytes");
    }
    const checks = checkMechanics(prepared);
    const corrupt = checks.find((check) => check.status === "LOCK_CORRUPT");
    if (corrupt) {
      console.log(`LOCK_CORRUPT ${corrupt.detail}`);
      console.log(
        `Repair with: bun run mechanics:sync ${dir} --recover-corrupt --proof mechanics-proof.json --reviewed <reviewSha256>`,
      );
      process.exitCode = 1;
      return;
    }
    for (const check of checks) console.log(`${check.status} ${check.id}: ${check.detail}`);
    if (checks.some((check) => check.status !== "PASS")) {
      process.exitCode = 1;
      return;
    }
    prepared.assertPreparedBuildCurrent();
  } finally {
    prepared.dispose();
  }
}

function runMechanicsDiff(dir: string, options: Options): void {
  const prepared = prepareMechanicsInputs(dir, "diff", overridesOf(options));
  try {
    const documents = extractMechanics(prepared);
    let lock = null;
    if (prepared.lockBytes) {
      try {
        lock = parseMechanicsLock(prepared.lockBytes);
      } catch (error) {
        console.log(`baselineStatus LOCK_CORRUPT: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      console.log("baselineStatus UNAPPROVED: all five documents are new");
    }
    const artifact = buildMechanicsReviewArtifact({ prepared, documents, lock, now: new Date() });
    const out = options.flags.get("--out");
    if (out) commitAtomicFile(path.resolve(out), serializeMechanicsReviewArtifact(artifact));
    console.log(`buildId ${artifact.review.buildId ?? "unresolved"}`);
    console.log(`evidence ${artifact.review.evidenceStatus} ${artifact.review.evidenceSha256 ?? "none"}`);
    for (const document of artifact.review.documents) {
      const changes = document.fieldDiffs.length;
      console.log(`${document.id} model=${document.modelSha256} changes=${changes}`);
      for (const diff of document.fieldDiffs) console.log(`  ${diff.field}`);
    }
    console.log(`reviewSha256 ${artifact.reviewSha256}`);
    prepared.assertPreparedBuildCurrent();
  } finally {
    prepared.dispose();
  }
}

function runMechanicsInspect(options: Options): void {
  const reviewPath = requireFlag(options, "--assert");
  const overrides = overridesOf(options);
  const workspaceRoot = path.resolve(overrides.workspaceRoot ?? ".");
  const fixturePath = path.resolve(
    overrides.fixturePath ?? path.join(workspaceRoot, "packages", "pipeline", "testdata", "mechanics-contract-v1.json"),
  );
  const approvalPath = path.resolve(
    overrides.mechanicsSourceLockPath ?? path.join(workspaceRoot, "mechanics-source.lock.json"),
  );
  const leases = acquireLeases(["mechanics-source"], "mechanics:inspect");
  try {
    const inputs = prepareReviewInputs(path.resolve(reviewPath), fixturePath, approvalPath, workspaceRoot);
    if (inputs.candidateInspectorSha256 !== inputs.inspectorSha256) {
      throw new Error(
        `the inspector closure is ${inputs.candidateInspectorSha256}, the approved inspector is ${inputs.inspectorSha256}. ` +
          "Run inspector-source:diff, review it, then mechanics-sources:rotate-inspector.",
      );
    }
    const rendered = inspectMechanicsReview({
      reviewBytes: inputs.reviewBytes,
      contractFixtureBytes: inputs.contractFixtureBytes,
    });
    for (const line of rendered.lines) console.log(line);
    const attestOut = options.flags.get("--attest-out");
    if (attestOut) {
      const attestation = writeInspectAttestation({
        kind: "mechanics-review",
        reviewSha256s: [rendered.reviewSha256],
        fixtureSha256: inputs.contractFixtureSha256,
        inspectToolSha256: inputs.inspectorSha256,
        now: new Date(),
        commit: (bytes) => commitAtomicFile(path.resolve(attestOut), bytes),
      });
      console.log(`attestationSha256 ${attestation.attestationSha256}`);
      console.log("This receipt records which approved inspector rendered this review. It is not a signature.");
    }
  } finally {
    leases.releaseAll();
  }
}

function runMechanicsProve(dir: string, options: Options): void {
  const reviewPath = options.positional[1];
  if (!reviewPath) throw new Error("a review artifact path is required");
  const attestationPath = requireFlag(options, "--attestation");
  const overrides = { ...overridesOf(options), reviewPath };
  const prepared = prepareMechanicsInputs(dir, "prove", overrides);
  try {
    const attestation = parseInspectAttestation(readStableFile(path.resolve(attestationPath)));
    if (attestation.kind !== "mechanics-review") {
      throw new Error(`the attestation is a ${attestation.kind} receipt, not a mechanics review receipt`);
    }
    if (attestation.inspectToolSha256 !== prepared.inspectorSha256) {
      throw new Error("the attestation was produced by an inspector that is not the approved one");
    }
    const documents = extractMechanics(prepared);
    const lock = prepared.lockBytes ? tryParseLock(prepared.lockBytes) : null;
    const proof = validateMechanicsProof({
      prepared,
      documents,
      reviewBytes: prepared.reviewBytes!,
      attestationSha256: attestation.attestationSha256,
      now: new Date(),
      lock,
    });
    const out = options.flags.get("--out");
    if (out) commitAtomicFile(path.resolve(out), serializeMechanicsProof(proof));
    console.log(`proofSha256 ${proof.proofSha256}`);
    console.log(`reviewSha256 ${proof.reviewSha256}`);
    prepared.assertPreparedBuildCurrent();
  } finally {
    prepared.dispose();
  }
}

function tryParseLock(bytes: Uint8Array): ReturnType<typeof parseMechanicsLock> | null {
  try {
    return parseMechanicsLock(bytes);
  } catch {
    return null;
  }
}

function runMechanicsSync(dir: string, options: Options): void {
  const proofPath = requireFlag(options, "--proof");
  const overrides = { ...overridesOf(options), proofPath };
  const leases = acquireLeases(["mechanics-source", "mechanics"], "mechanics:sync");
  const prepared = prepareMechanicsInputs(dir, "sync", overrides);
  try {
    const proof = parseMechanicsProof(prepared.proofBytes!);
    const documents = extractMechanics(prepared);
    const reviewed = options.flags.get("--reviewed") ?? null;
    const commit = (bytes: Uint8Array): void => {
      prepared.assertPreparedBuildCurrent();
      leases.assertLive();
      commitAtomicFile(prepared.paths.lockPath, bytes);
    };
    if (options.switches.has("--recover-corrupt")) {
      const { outcome, priorSha256 } = recoverMechanicsLock({
        prepared,
        documents,
        proof,
        reviewedSha256: requireFlag(options, "--reviewed"),
        now: new Date(),
        commit,
      });
      console.log(`RECOVERED prior lock sha256 ${priorSha256}`);
      console.log(`reviewSha256 ${outcome.reviewSha256}`);
      return;
    }
    const outcome = syncMechanicsLock({
      prepared,
      documents,
      proof,
      reviewedSha256: reviewed,
      bootstrap: options.switches.has("--bootstrap"),
      recoverCorrupt: false,
      now: new Date(),
      commit,
    });
    console.log(`SYNCED ${prepared.paths.lockPath}`);
    console.log(`reviewSha256 ${outcome.reviewSha256}`);
  } finally {
    prepared.dispose();
    leases.releaseAll();
  }
}

/* source approval commands */

function runSourcesInspect(options: Options): void {
  const reviews = readReviewSet({ ...options, flags: options.flags });
  const overrides = overridesOf(options);
  const workspaceRoot = path.resolve(overrides.workspaceRoot ?? ".");
  const approvalPath = path.resolve(
    overrides.mechanicsSourceLockPath ?? path.join(workspaceRoot, "mechanics-source.lock.json"),
  );
  const approval = readMechanicsSourceApproval(approvalPath);
  const candidates = computeSourceClosures(workspaceRoot);
  if (candidates.hashes.inspector !== approval.hashes.inspector) {
    throw new Error(
      `the inspector closure is ${candidates.hashes.inspector}, the approved inspector is ${approval.hashes.inspector}. ` +
        "Run inspector-source:diff, review it, then mechanics-sources:rotate-inspector.",
    );
  }
  const rendered = inspectMechanicsSourceReviews({ reviews });
  for (const line of rendered.lines) console.log(line);
  const attestOut = options.flags.get("--attest-out");
  if (attestOut) {
    const attestation = writeInspectAttestation({
      kind: "mechanics-source-reviews",
      reviewSha256s: rendered.reviewSha256s,
      fixtureSha256: null,
      inspectToolSha256: approval.hashes.inspector,
      now: new Date(),
      commit: (bytes) => commitAtomicFile(path.resolve(attestOut), bytes),
    });
    console.log(`attestationSha256 ${attestation.attestationSha256}`);
    console.log("This receipt records which approved inspector rendered these reviews. It is not a signature.");
  }
}

function sourceApprovalPath(options: Options): { workspaceRoot: string; approvalPath: string } {
  const overrides = overridesOf(options);
  const workspaceRoot = path.resolve(overrides.workspaceRoot ?? ".");
  return {
    workspaceRoot,
    approvalPath: path.resolve(
      overrides.mechanicsSourceLockPath ?? path.join(workspaceRoot, "mechanics-source.lock.json"),
    ),
  };
}

function runSourcesBootstrap(options: Options): void {
  const { workspaceRoot, approvalPath } = sourceApprovalPath(options);
  const leases = acquireLeases(["mechanics-source"], "mechanics-sources:bootstrap");
  try {
    const result = bootstrapMechanicsSourceApproval({
      approvalPath,
      reviews: readReviewSet(options),
      reviewed: readReviewedHashes(options),
      candidates: computeSourceClosures(workspaceRoot),
      constants,
      commit: (bytes) => {
        leases.assertLive();
        commitAtomicFile(approvalPath, bytes);
      },
    });
    console.log(`BOOTSTRAPPED ${approvalPath}`);
    console.log(`approvalSha256 ${result.approvalSha256}`);
    console.log("This first approval rests on the operator's full manual review, not on a prior approval.");
  } finally {
    leases.releaseAll();
  }
}

function runSourcesSync(options: Options): void {
  const { workspaceRoot, approvalPath } = sourceApprovalPath(options);
  const leases = acquireLeases(["mechanics-source"], "mechanics-sources:sync");
  try {
    const approval = readMechanicsSourceApproval(approvalPath);
    const attestation = parseInspectAttestation(
      readStableFile(path.resolve(requireFlag(options, "--attestation"))),
    );
    const result = syncMechanicsSourceApproval({
      approvalPath,
      reviews: readReviewSet(options),
      reviewed: readReviewedHashes(options),
      attestation,
      candidates: computeSourceClosures(workspaceRoot),
      constants,
      approvedHashes: approval.hashes,
      commit: (bytes) => {
        leases.assertLive();
        commitAtomicFile(approvalPath, bytes);
      },
    });
    console.log(`SYNCED ${approvalPath}`);
    console.log(`approvalSha256 ${result.approvalSha256}`);
  } finally {
    leases.releaseAll();
  }
}

function runRotate(field: "inspector" | "approvalGate", options: Options): void {
  const { workspaceRoot, approvalPath } = sourceApprovalPath(options);
  const leases = acquireLeases(["mechanics-source"], `mechanics-sources:rotate-${field}`);
  try {
    const approval = readMechanicsSourceApproval(approvalPath);
    const artifact = parseSourceReviewArtifact(
      readStableFile(path.resolve(requireFlag(options, "--review"))),
    );
    const reviews = { [field]: artifact } as unknown as Record<SourceClosureName, SourceReviewArtifact>;
    const candidates = computeSourceClosures(workspaceRoot);
    const reviewed = requireFlag(options, "--reviewed");
    const commit = (bytes: Uint8Array): void => {
      leases.assertLive();
      commitAtomicFile(approvalPath, bytes);
    };
    const result =
      field === "inspector"
        ? rotateInspectorApproval({
            reviews,
            reviewedInspectorSha256: reviewed,
            candidates,
            approval: approval.approval,
            commit,
          })
        : rotateGateApproval({
            reviews,
            reviewedGateSha256: reviewed,
            candidates,
            approval: approval.approval,
            commit,
          });
    console.log(`ROTATED ${field} in ${approvalPath}`);
    console.log(`approvalSha256 ${result.approvalSha256}`);
    console.log("This rotation is stated as operator trust: it breaks a self-approval cycle rather than proving one.");
  } finally {
    leases.releaseAll();
  }
}

function runProbeContractsCheck(): void {
  let failures = 0;
  for (const row of checkProbeContractHashes()) {
    const ok = row.expected === row.actual;
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"} ${row.id} ${row.actual}`);
  }
  if (failures > 0) process.exitCode = 1;
}

function runExternalLeavesVerify(options: Options): void {
  const nodePath = path.resolve(requireFlag(options, "--node"));
  const harnessPath = path.resolve(requireFlag(options, "--harness"));
  const outPath = path.resolve(requireFlag(options, "--out"));
  const { approvalPath } = sourceApprovalPath(options);
  const leases = acquireLeases(["mechanics-source"], "external-leaves:verify");
  try {
    const approval = readMechanicsSourceApproval(approvalPath);
    const result = verifyExternalLeafEvidence({
      nodeBytes: readStableFile(nodePath),
      harnessBytes: readStableFile(harnessPath),
      mechanicsSourceApprovalSha256: approval.approvalSha256,
      commit: (bytes) => {
        leases.assertLive();
        commitAtomicFile(outPath, bytes);
      },
    });
    console.log(`VERIFIED ${outPath}`);
    console.log(`approvalSha256 ${result.approvalSha256}`);
    console.log(`coverage ${result.coverage.length} ids, all PASS`);
  } finally {
    leases.releaseAll();
  }
}

/* publication commands */

function runVerify(dir: string): void {
  const checks = verify(dir);
  for (const check of checks) console.log(`${check.status} ${check.id}: ${check.detail}`);
  if (checks.some((check) => check.status === "FAIL")) process.exitCode = 1;
}

async function runPublish(dir: string, options: Options): Promise<void> {
  const leases = acquireLeases(["mechanics-source", "mechanics"], "publish");
  const prepared = prepareMechanicsInputs(dir, "publish", overridesOf(options));
  try {
    if (!prepared.lockBytes) throw new Error("publication requires a reviewed mechanics lock");
    const checks = checkMechanics(prepared);
    const failing = checks.filter((check) => check.status !== "PASS");
    if (failing.length > 0) {
      for (const check of failing) console.log(`FAIL ${check.id}: ${check.status} ${check.detail}`);
      console.log("PUBLISH ABORTED — no files written");
      process.exitCode = 1;
      return;
    }
    prepared.assertPreparedBuildCurrent();
    leases.assertLive();
    const result = await publish(prepared, prepared.lockBytes, leases);
    for (const table of result.tables) console.log(`WROTE ${table.name} (${table.rows} rows)`);
    console.log(`WROTE ${result.images} images`);
    for (const missing of result.missingImages.slice(0, 6)) console.log(`MISSING ART ${missing}`);
    if (result.missingImages.length > 6) {
      console.log(`MISSING ART +${result.missingImages.length - 6} more`);
    }
    console.log(`PUBLISHED build ${result.buildId} schema ${SCHEMA_VERSION} -> ${result.outDirs.join(", ")}`);
  } catch (error) {
    if (!(error instanceof InvariantError)) throw error;
    for (const line of error.message.split("\n")) console.log(`FAIL ${line}`);
    console.log("PUBLISH ABORTED — no files written");
    process.exitCode = 1;
  } finally {
    prepared.dispose();
    leases.releaseAll();
  }
}

function runVerifyPublished(dataDir: string, lockPath: string, options: Options): void {
  const overrides = overridesOf(options);
  const workspaceRoot = path.resolve(overrides.workspaceRoot ?? ".");
  const leases = acquireLeases(["mechanics-source", "mechanics"], "verify-published");
  let prepared: ReturnType<typeof snapshotPublishedInputs> | null = null;
  try {
    prepared = snapshotPublishedInputs(
      path.resolve(dataDir),
      path.resolve(lockPath),
      path.resolve(
        overrides.fixturePath ??
          path.join(workspaceRoot, "packages", "pipeline", "testdata", "mechanics-contract-v1.json"),
      ),
      path.resolve(overrides.mechanicsSourceLockPath ?? path.join(workspaceRoot, "mechanics-source.lock.json")),
      leases,
    );
    const checks = verifyPublished(prepared);
    for (const check of checks) console.log(`${check.status} ${check.id}: ${check.detail}`);
    if (checks.some((check) => check.status === "FAIL")) process.exitCode = 1;
  } finally {
    prepared?.dispose();
    leases.releaseAll();
  }
}

function runSiteDataCommand(command: "sync-site" | "verify-site-data", options: Options): void {
  const overrides = overridesOf(options);
  const workspaceRoot = path.resolve(overrides.workspaceRoot ?? ".");
  const outRoot = path.resolve(options.flags.get("--out-root") ?? path.join(workspaceRoot, "data"));
  const dataDir = path.join(outRoot, "latest");
  if (!existsSync(dataDir)) {
    throw new Error(`${dataDir} not found — run "bun run publish" first`);
  }
  const kinds =
    command === "sync-site"
      ? (["mechanics-source", "mechanics", "site-data"] as const)
      : (["mechanics-source", "mechanics"] as const);
  const leases = acquireLeases(kinds, command);
  let prepared: ReturnType<typeof snapshotPublishedInputs> | null = null;
  try {
    prepared = snapshotPublishedInputs(
      dataDir,
      path.resolve(overrides.lockPath ?? path.join(workspaceRoot, "mechanics.lock.json")),
      path.resolve(
        overrides.fixturePath ??
          path.join(workspaceRoot, "packages", "pipeline", "testdata", "mechanics-contract-v1.json"),
      ),
      path.resolve(overrides.mechanicsSourceLockPath ?? path.join(workspaceRoot, "mechanics-source.lock.json")),
      leases,
    );
    const result = command === "sync-site" ? syncSiteData(prepared, leases) : verifySiteData(prepared, leases);
    console.log(`${command === "sync-site" ? "SYNCED" : "VERIFIED"} ${result.dataDirectory}`);
    console.log(`${result.imageCount} images -> ${result.gameDirectory}`);
    console.log(`SQLite wasm: ${result.wasmPath}`);
  } finally {
    prepared?.dispose();
    leases.releaseAll();
  }
}

/* dispatch */

const argv = process.argv.slice(2);
const command = argv[0] ?? "verify";
const options = parseArguments(argv.slice(1));
const dir = options.positional[0] ?? "extracted";

try {
  switch (command) {
    case "verify":
      runVerify(dir);
      break;
    case "publish":
      await runPublish(dir, options);
      break;
    case "verify-published":
      runVerifyPublished(options.positional[0] ?? path.join("data", "latest"), options.positional[1] ?? "mechanics.lock.json", options);
      break;
    case "sync-site":
    case "verify-site-data":
      runSiteDataCommand(command, options);
      break;
    case "mechanics:check":
      runMechanicsCheck(dir, options);
      break;
    case "mechanics:diff":
      runMechanicsDiff(dir, options);
      break;
    case "mechanics:inspect":
      runMechanicsInspect(options);
      break;
    case "mechanics:prove":
      runMechanicsProve(dir, options);
      break;
    case "mechanics:sync":
      runMechanicsSync(dir, options);
      break;
    case "mechanics-sources:inspect":
      runSourcesInspect(options);
      break;
    case "mechanics-sources:bootstrap":
      runSourcesBootstrap(options);
      break;
    case "mechanics-sources:sync":
      runSourcesSync(options);
      break;
    case "mechanics-sources:rotate-inspector":
      runRotate("inspector", options);
      break;
    case "mechanics-sources:rotate-gate":
      runRotate("approvalGate", options);
      break;
    case "inspector-source:diff":
      closureDiff("inspector", options);
      break;
    case "inspector-source:inspect":
      closureInspect("inspector", options);
      break;
    case "approval-gate:diff":
      closureDiff("approvalGate", options);
      break;
    case "approval-gate:inspect":
      closureInspect("approvalGate", options);
      break;
    case "approval-gate:check":
      closureCheck("approvalGate", options);
      break;
    case "derivation-source:diff":
      closureDiff("derivation", options);
      break;
    case "derivation-source:check":
      closureCheck("derivation", options);
      break;
    case "probe-executor:diff":
      closureDiff("probeExecutor", options);
      break;
    case "probe-executor:check":
      closureCheck("probeExecutor", options);
      break;
    case "probe-runtime:diff":
      closureDiff("runtime", options);
      break;
    case "probe-runtime:check":
      closureCheck("runtime", options);
      break;
    case "probe-contracts:check":
      runProbeContractsCheck();
      break;
    case "external-leaves:verify":
      runExternalLeavesVerify(options);
      break;
    default:
      throw new Error(`unsupported pipeline command: ${command}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
