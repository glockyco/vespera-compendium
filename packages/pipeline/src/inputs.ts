/**
 * Immutable command inputs, exclusive leases, and atomic writes.
 *
 * Every approval decision in this repository rests on the claim "these exact bytes". A command that
 * reads its inputs twice cannot make that claim: the game can be updated, the harness can rewrite
 * evidence, and a sibling command can replace a lock between two reads. So each command prepares once,
 * and everything downstream sees only the prepared object.
 *
 * Three mechanisms do the work.
 *
 * `readStableFile` records the file's identity and size before and after a complete read and refuses
 * anything that moved. Combined with the atomic writer below, a reader observes one whole generation or
 * an error, never a torn file.
 *
 * Directory snapshots are inventoried, copied, and inventoried again, and all three manifests must
 * agree. A command can then publish the snapshot even if the source changes afterward, and the next
 * command notices the new manifest.
 *
 * Leases are exclusive `mkdir` directories acquired in a fixed rank order, so a compare-then-write gap
 * cannot let an older publication race a newer sync.
 *
 * The prepared types carry private brands and are additionally checked against a module-private
 * `WeakSet`, because a structural cast is exactly the shortcut that would quietly reintroduce all of the
 * above.
 */

import { createHash } from "node:crypto";
import {
  closeSync,
  cpSync,
  existsSync,
  fstatSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BUNDLE_ROLES,
  GameUnavailableError,
  MECHANICS_APPROVAL_GATE_SHA256,
  MECHANIC_DERIVATION_EXECUTOR_SHA256,
  MECHANIC_PROBE_EXECUTOR_SHA256,
  PROBE_RUNTIME_SHA256,
  readBundleRoles,
  readInstalledBuildId,
  sameBundleIdentities,
  sha256Hex,
  type BundleFingerprints,
  type BundleRole,
} from "@vespera/core";
import {
  computeSourceClosures,
  readMechanicsSourceApproval,
  type SourceApprovalHashes,
} from "./mechanics-source.ts";

/* stable reads */

/** Identity of an open file, used to prove nothing swapped underneath a read. */
type FileIdentity = { dev: number; ino: number; size: number; mtimeMs: number };

function identityOf(descriptor: number): FileIdentity {
  const stats = fstatSync(descriptor);
  return { dev: stats.dev, ino: stats.ino, size: stats.size, mtimeMs: stats.mtimeMs };
}

const sameIdentity = (left: FileIdentity, right: FileIdentity): boolean =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.size === right.size &&
  left.mtimeMs === right.mtimeMs;

/**
 * Reads a file through one descriptor and proves it did not move.
 *
 * A short read is treated the same as a swap: both mean the bytes in hand are not a whole generation of
 * anything.
 */
export function readStableFile(file: string): Uint8Array {
  const descriptor = openSync(file, "r");
  try {
    const before = identityOf(descriptor);
    const bytes = new Uint8Array(before.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const read = readSync(descriptor, bytes, offset, bytes.byteLength - offset, offset);
      if (read <= 0) throw new Error(`INPUT_MUTATED: short read of ${file} at byte ${offset}`);
      offset += read;
    }
    const after = identityOf(descriptor);
    if (!sameIdentity(before, after)) {
      throw new Error(`INPUT_MUTATED: ${file} changed identity during the read`);
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

/** A file's generation, or the explicit absent marker. Absence is a state, not an error. */
export function fileGeneration(file: string): string {
  if (!existsSync(file)) return "ABSENT";
  return sha256Hex(readStableFile(file));
}

/**
 * Writes through a same-directory temporary file, `fsync`, and rename.
 *
 * The rename is what makes a concurrent reader see either the old file or the new one. Writing in place
 * would let `readStableFile` observe a half-written approval and, worse, let it look valid.
 */
export function commitAtomicFile(file: string, bytes: Uint8Array): void {
  const directory = path.dirname(file);
  mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  const descriptor = openSync(temporary, "w");
  try {
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, file);
}

/* directory snapshots */

export type FileManifestEntry = { path: string; bytes: number; sha256: string };
export type FileManifest = FileManifestEntry[];

/** Sorted path, size, and content hash for every file under a root. */
export function inventoryDirectory(root: string): FileManifest {
  const entries: FileManifest = [];
  const walk = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(absolute, relative);
      else if (entry.isFile()) {
        const bytes = readFileSync(absolute);
        entries.push({
          path: relative,
          bytes: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
      }
    }
  };
  walk(root, "");
  return entries.sort((left, right) => (left.path < right.path ? -1 : 1));
}

const manifestKey = (manifest: FileManifest): string =>
  manifest.map((entry) => `${entry.path}\u0000${entry.bytes}\u0000${entry.sha256}`).join("\n");

type Snapshot = { path: string; manifest: FileManifest; dispose(): void };

/**
 * Copies a directory and proves the copy is one coherent generation.
 *
 * The source is inventoried, copied, and inventoried again, and the copy is inventoried too. All three
 * must agree, which rules out a write that landed between the first inventory and the copy.
 */
function snapshotDirectory(source: string, label: string): Snapshot {
  const before = inventoryDirectory(source);
  const destination = mkdtempSync(path.join(os.tmpdir(), `vespera-${label}-`));
  cpSync(source, destination, { recursive: true });
  const after = inventoryDirectory(source);
  const copied = inventoryDirectory(destination);
  if (manifestKey(before) !== manifestKey(after) || manifestKey(before) !== manifestKey(copied)) {
    rmSync(destination, { recursive: true, force: true });
    throw new Error(`INPUT_MUTATED: ${source} changed while it was being snapshotted`);
  }
  return {
    path: destination,
    manifest: before,
    dispose: () => rmSync(destination, { recursive: true, force: true }),
  };
}

/* leases */

export type LeaseKind = "mechanics-source" | "mechanics" | "site-data";

/** Rank order. A path that takes a lower or equal rank while holding a higher one can deadlock. */
export const LEASE_RANK: Readonly<Record<LeaseKind, number>> = Object.freeze({
  "mechanics-source": 1,
  mechanics: 2,
  "site-data": 3,
});

export type Lease = {
  kind: LeaseKind;
  generation: string;
  release(): void;
  assertLive(): void;
};

const LEASE_PATHS: Readonly<Record<LeaseKind, string>> = Object.freeze({
  "mechanics-source": "mechanics-source.lock.d",
  mechanics: "mechanics.lock.d",
  "site-data": path.join("site", "static", ".site-data.lock.d"),
});

/**
 * Acquires one exclusive lease.
 *
 * A lease that already exists is never removed automatically: it may belong to a live process, and
 * deleting it would replace a wait with silent corruption. The recovery path is printed instead.
 */
export function acquireLease(kind: LeaseKind, detail: string): Lease {
  const directory = path.resolve(LEASE_PATHS[kind]);
  mkdirSync(path.dirname(directory), { recursive: true });
  try {
    mkdirSync(directory);
  } catch (cause) {
    let owner = "an unknown process";
    try {
      owner = readFileSync(path.join(directory, "owner"), "utf8").trim();
    } catch {
      // A lease directory without its metadata is still a lease.
    }
    throw new Error(
      `the ${kind} lease is held by ${owner}. If no such process is running, remove ${directory} and retry.`,
      { cause },
    );
  }
  const generation = createHash("sha256")
    .update(`${directory}:${process.pid}:${Date.now()}:${Math.random()}`)
    .digest("hex")
    .slice(0, 32);
  writeFileSync(
    path.join(directory, "owner"),
    `${detail} pid=${process.pid} generation=${generation} at=${new Date().toISOString()}\n`,
  );
  let live = true;
  return {
    kind,
    generation,
    release(): void {
      if (!live) return;
      live = false;
      rmSync(directory, { recursive: true, force: true });
    },
    assertLive(): void {
      if (!live) throw new Error(`the ${kind} lease was already released`);
      if (!existsSync(directory)) throw new Error(`the ${kind} lease directory disappeared`);
    },
  };
}

export type LeaseSet = {
  mechanicsSource: Lease;
  /** Absent for the approval-domain commands, which never consume or update mechanics approval. */
  mechanics: Lease | null;
  siteData: Lease | null;
  assertLive(): void;
  releaseAll(): void;
};

/** Acquires several leases in rank order, so no caller can invert it by accident. */
export function acquireLeases(kinds: readonly LeaseKind[], detail: string): LeaseSet {
  const ordered = [...new Set(kinds)].sort((left, right) => LEASE_RANK[left] - LEASE_RANK[right]);
  const acquired: Lease[] = [];
  try {
    for (const kind of ordered) acquired.push(acquireLease(kind, detail));
    const find = (kind: LeaseKind): Lease | null => acquired.find((lease) => lease.kind === kind) ?? null;
    const mechanicsSource = find("mechanics-source");
    // The mechanics-source lease is the global first lock, so every set holds it. The mechanics lease is
    // optional because the approval-domain commands neither consume nor update mechanics approval.
    if (!mechanicsSource) throw new Error("a lease set must include the mechanics-source lease");
    return {
      mechanicsSource,
      mechanics: find("mechanics"),
      siteData: find("site-data"),
      assertLive(): void {
        for (const lease of acquired) lease.assertLive();
      },
      releaseAll(): void {
        for (const lease of [...acquired].reverse()) lease.release();
      },
    };
  } catch (error) {
    for (const lease of [...acquired].reverse()) lease.release();
    throw error;
  }
}

/* prepared inputs */

const preparedMechanicsBrand: unique symbol = Symbol("PreparedMechanicsInputs");
const preparedPublishedBrand: unique symbol = Symbol("PreparedPublishedInputs");
const preparedMechanicsMembers = new WeakSet<object>();
const preparedPublishedMembers = new WeakSet<object>();

export type PrepareMode =
  | "check"
  | "diff"
  | "prove"
  | "sync"
  | "publish"
  | "verify"
  | "harness"
  | "sequence-gate";

export type PreflightIssue = "UNAPPROVED" | "BUILD_UNVERIFIED";
export type FatalIssue = { code: "LOCK_CORRUPT" | "INPUT_MUTATED"; detail: string };

export type PrepareOverrides = {
  workspaceRoot?: string;
  evidenceRoot?: string;
  fixturePath?: string;
  lockPath?: string;
  mechanicsSourceLockPath?: string;
  reviewPath?: string;
  proofPath?: string;
};

export type PreparedPaths = {
  workspaceRoot: string;
  evidenceRoot: string;
  fixturePath: string;
  lockPath: string;
  mechanicsSourceLockPath: string;
  reviewPath: string | null;
  proofPath: string | null;
};

export type PreparedMechanicsInputs = {
  readonly [preparedMechanicsBrand]: true;
  readonly mode: PrepareMode;
  readonly resolvedBuildId: string | null;
  readonly usedLockBuildFallback: boolean;
  readonly installedManifestGeneration: string | null;
  readonly extractedSnapshotPath: string;
  readonly bundleFingerprints: BundleFingerprints;
  readonly bundleText: Record<BundleRole, string>;
  readonly lockBytes: Uint8Array | null;
  readonly lockGeneration: string;
  readonly evidenceBytes: Uint8Array | null;
  readonly evidenceGeneration: string;
  readonly externalLeafEvidenceBytes: Uint8Array | null;
  readonly externalLeafEvidenceSha256: string | null;
  readonly externalLeafEvidenceGeneration: string;
  readonly contractFixtureBytes: Uint8Array;
  readonly contractFixtureSha256: string;
  readonly reviewBytes: Uint8Array | null;
  readonly reviewGeneration: string | null;
  readonly proofBytes: Uint8Array | null;
  readonly proofGeneration: string | null;
  readonly workspaceSourceSnapshotPath: string;
  readonly workspaceSourceManifest: FileManifest;
  readonly mechanicsSourceApprovalBytes: Uint8Array;
  readonly mechanicsSourceApprovalSha256: string;
  readonly approvalGateSha256: string;
  readonly derivationExecutorSha256: string;
  readonly probeExecutorSha256: string;
  readonly probeRuntimeSha256: string;
  readonly inspectorSha256: string;
  readonly preflightIssues: PreflightIssue[];
  readonly fatalIssues: FatalIssue[];
  readonly paths: PreparedPaths;
  assertPreparedBuildCurrent(): void;
  dispose(): void;
};

/** The one-use token the site build passes to its child so a raw environment path cannot de-taint. */
export type PublishedSnapshotCapability = {
  buildToken: string;
  manifestSha256: string;
  root: string;
  version: 1;
};

export type PreparedPublishedInputs = {
  readonly [preparedPublishedBrand]: true;
  readonly snapshotPath: string;
  readonly manifestBytesBefore: Uint8Array;
  readonly manifestBytesStaged: Uint8Array;
  readonly manifestBytesAfter: Uint8Array;
  readonly fileManifest: FileManifest;
  readonly lockBytes: Uint8Array;
  readonly lockSha256: string;
  readonly contractFixtureBytes: Uint8Array;
  readonly contractFixtureSha256: string;
  readonly mechanicsSourceApprovalBytes: Uint8Array;
  readonly mechanicsSourceApprovalSha256: string;
  readonly approvalGateSha256: string;
  readonly derivationExecutorSha256: string;
  readonly probeExecutorSha256: string;
  readonly probeRuntimeSha256: string;
  readonly inspectorSha256: string;
  readonly capability: PublishedSnapshotCapability;
  readonly leaseGenerations: { mechanicsSource: string; mechanics: string; siteData: string | null };
  assertLeasesLive(): void;
  dispose(): void;
};

/** Membership check that a structural cast cannot satisfy. */
export function assertPreparedMechanicsInputs(value: PreparedMechanicsInputs): void {
  if (!preparedMechanicsMembers.has(value)) {
    throw new Error("this value was not produced by prepareMechanicsInputs");
  }
}

export function assertPreparedPublishedInputs(value: PreparedPublishedInputs): void {
  if (!preparedPublishedMembers.has(value)) {
    throw new Error("this value was not produced by snapshotPublishedInputs");
  }
}

const DEFAULT_PATHS = {
  evidenceRoot: "evidence",
  fixturePath: path.join("packages", "pipeline", "testdata", "mechanics-contract-v1.json"),
  lockPath: "mechanics.lock.json",
  mechanicsSourceLockPath: "mechanics-source.lock.json",
} as const;

function resolvePaths(overrides: PrepareOverrides): PreparedPaths {
  const workspaceRoot = path.resolve(overrides.workspaceRoot ?? ".");
  const within = (value: string | undefined, fallback: string): string =>
    path.resolve(workspaceRoot, value ?? fallback);
  return {
    workspaceRoot,
    evidenceRoot: within(overrides.evidenceRoot, DEFAULT_PATHS.evidenceRoot),
    fixturePath: within(overrides.fixturePath, DEFAULT_PATHS.fixturePath),
    lockPath: within(overrides.lockPath, DEFAULT_PATHS.lockPath),
    mechanicsSourceLockPath: within(
      overrides.mechanicsSourceLockPath,
      DEFAULT_PATHS.mechanicsSourceLockPath,
    ),
    reviewPath: overrides.reviewPath ? path.resolve(overrides.reviewPath) : null,
    proofPath: overrides.proofPath ? path.resolve(overrides.proofPath) : null,
  };
}

/** The Steam manifest's own generation, so a build swap between preparation and output is visible. */
function installedBuild(): { generation: string | null; buildId: string | null } {
  try {
    const buildId = readInstalledBuildId();
    return { generation: `build:${buildId}`, buildId };
  } catch (error) {
    if (error instanceof GameUnavailableError) return { generation: null, buildId: null };
    throw error;
  }
}

/** Source trees whose bytes decide a closure hash, snapshotted so a concurrent edit is detectable. */
const WORKSPACE_SOURCE_DIRECTORIES = ["packages", "tools"] as const;
const WORKSPACE_SOURCE_FILES = ["package.json", "bun.lock", "tsconfig.json"] as const;

function workspaceSourceSnapshot(workspaceRoot: string): Snapshot {
  const staging = mkdtempSync(path.join(os.tmpdir(), "vespera-workspace-"));
  try {
    for (const directory of WORKSPACE_SOURCE_DIRECTORIES) {
      const source = path.join(workspaceRoot, directory);
      if (existsSync(source)) cpSync(source, path.join(staging, directory), { recursive: true });
    }
    for (const file of WORKSPACE_SOURCE_FILES) {
      const source = path.join(workspaceRoot, file);
      if (existsSync(source)) cpSync(source, path.join(staging, file));
    }
    return {
      path: staging,
      manifest: inventoryDirectory(staging),
      dispose: () => rmSync(staging, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Chooses which build's evidence a command may read.
 *
 * In read-only check mode a missing Steam manifest is not fatal: if the extracted bytes exactly match a
 * valid lock, the locked build id names the right report. The caller announces that fallback rather than
 * presenting it as knowledge of the current installation.
 */
function resolveBuildForEvidence(
  mode: PrepareMode,
  installedBuildId: string | null,
  lockBytes: Uint8Array | null,
  fingerprints: BundleFingerprints,
): { buildId: string | null; usedLockFallback: boolean } {
  if (installedBuildId !== null) return { buildId: installedBuildId, usedLockFallback: false };
  const none = { buildId: null, usedLockFallback: false };
  if (mode !== "check" || !lockBytes) return none;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(lockBytes));
    if (!parsed || typeof parsed !== "object" || !("snapshot" in parsed)) return none;
    const snapshot = parsed.snapshot;
    if (!snapshot || typeof snapshot !== "object") return none;
    if (!("buildId" in snapshot) || typeof snapshot.buildId !== "string") return none;
    if (!("bundles" in snapshot) || !snapshot.bundles || typeof snapshot.bundles !== "object") return none;
    const bundles: Record<string, unknown> = snapshot.bundles as Record<string, unknown>;
    for (const role of BUNDLE_ROLES) {
      const entry = bundles[role];
      if (!entry || typeof entry !== "object") return none;
      if (!("bytes" in entry) || !("sha256" in entry)) return none;
      if (entry.bytes !== fingerprints[role].bytes || entry.sha256 !== fingerprints[role].sha256) return none;
    }
    return { buildId: snapshot.buildId, usedLockFallback: true };
  } catch {
    return none;
  }
}

function assertSourceApprovalAgrees(
  approvedHashes: SourceApprovalHashes,
  candidates: SourceApprovalHashes,
): void {
  const constants = {
    approvalGate: MECHANICS_APPROVAL_GATE_SHA256,
    derivation: MECHANIC_DERIVATION_EXECUTOR_SHA256,
    probeExecutor: MECHANIC_PROBE_EXECUTOR_SHA256,
    runtime: PROBE_RUNTIME_SHA256,
  } as const;
  const mismatches: string[] = [];
  for (const key of ["inspector", "approvalGate", "derivation", "probeExecutor", "runtime"] as const) {
    if (approvedHashes[key] !== candidates[key]) {
      mismatches.push(`${key}: approved ${approvedHashes[key]}, candidate ${candidates[key]}`);
    }
    if (key !== "inspector" && constants[key] !== candidates[key]) {
      mismatches.push(`${key}: tracked constant ${constants[key]}, candidate ${candidates[key]}`);
    }
  }
  if (mismatches.length > 0) {
    throw new Error(
      `the reviewed source closures do not agree with this working tree:\n${mismatches.join("\n")}\n` +
        "Run the source diff commands, review every changed slice, then mechanics-sources:sync.",
    );
  }
}

/**
 * Prepares every protected input a source-domain command may read.
 *
 * Absence is never an error here. A missing lock is `UNAPPROVED` and a missing or malformed report is
 * `BUILD_UNVERIFIED`, because turning either into a tool failure would make the first run of a new build
 * indistinguishable from a broken installation.
 */
export function prepareMechanicsInputs(
  extractedDir: string,
  mode: PrepareMode,
  overrides: PrepareOverrides = {},
): PreparedMechanicsInputs {
  const paths = resolvePaths(overrides);
  const preflightIssues: PreflightIssue[] = [];
  const fatalIssues: FatalIssue[] = [];
  const disposers: (() => void)[] = [];

  try {
    const installedBefore = installedBuild();
    if (mode === "harness" && installedBefore.buildId === null) {
      throw new GameUnavailableError("the harness requires an installed build id");
    }

    const extracted = snapshotDirectory(path.resolve(extractedDir), "extracted");
    disposers.push(extracted.dispose);
    const roles = readBundleRoles(extracted.path);

    const workspace = workspaceSourceSnapshot(paths.workspaceRoot);
    disposers.push(workspace.dispose);

    const approval = readMechanicsSourceApproval(paths.mechanicsSourceLockPath);
    const candidates = computeSourceClosures(paths.workspaceRoot);
    assertSourceApprovalAgrees(approval.hashes, candidates.hashes);
    if (manifestKey(workspace.manifest) !== manifestKey(inventoryDirectory(workspace.path))) {
      throw new Error("INPUT_MUTATED: workspace source changed while closures were computed");
    }

    const fixtureBytes = readStableFile(paths.fixturePath);
    const lockBytes = existsSync(paths.lockPath) ? readStableFile(paths.lockPath) : null;
    if (!lockBytes) preflightIssues.push("UNAPPROVED");

    const resolved = resolveBuildForEvidence(mode, installedBefore.buildId, lockBytes, roles.fingerprints);
    const evidencePath =
      resolved.buildId === null
        ? null
        : path.join(paths.evidenceRoot, resolved.buildId, "runtime-evidence.json");
    const evidenceBytes = evidencePath && existsSync(evidencePath) ? readStableFile(evidencePath) : null;
    if (!evidenceBytes) preflightIssues.push("BUILD_UNVERIFIED");

    const aggregatePath =
      resolved.buildId === null
        ? null
        : path.join(paths.evidenceRoot, resolved.buildId, "external-leaves-approved.json");
    const aggregateBytes = aggregatePath && existsSync(aggregatePath) ? readStableFile(aggregatePath) : null;

    const reviewBytes = paths.reviewPath ? readStableFile(paths.reviewPath) : null;
    const proofBytes = paths.proofPath ? readStableFile(paths.proofPath) : null;

    const prepared: PreparedMechanicsInputs = {
      [preparedMechanicsBrand]: true,
      mode,
      resolvedBuildId: resolved.buildId,
      usedLockBuildFallback: resolved.usedLockFallback,
      installedManifestGeneration: installedBefore.generation,
      extractedSnapshotPath: extracted.path,
      bundleFingerprints: roles.fingerprints,
      bundleText: roles.text,
      lockBytes,
      lockGeneration: lockBytes ? sha256Hex(lockBytes) : "ABSENT",
      evidenceBytes,
      evidenceGeneration: evidenceBytes ? sha256Hex(evidenceBytes) : "ABSENT",
      externalLeafEvidenceBytes: aggregateBytes,
      externalLeafEvidenceSha256: aggregateBytes ? sha256Hex(aggregateBytes) : null,
      externalLeafEvidenceGeneration: aggregateBytes ? sha256Hex(aggregateBytes) : "ABSENT",
      contractFixtureBytes: fixtureBytes,
      contractFixtureSha256: sha256Hex(fixtureBytes),
      reviewBytes,
      reviewGeneration: reviewBytes ? sha256Hex(reviewBytes) : null,
      proofBytes,
      proofGeneration: proofBytes ? sha256Hex(proofBytes) : null,
      workspaceSourceSnapshotPath: workspace.path,
      workspaceSourceManifest: workspace.manifest,
      mechanicsSourceApprovalBytes: approval.bytes,
      mechanicsSourceApprovalSha256: approval.approvalSha256,
      approvalGateSha256: MECHANICS_APPROVAL_GATE_SHA256,
      derivationExecutorSha256: MECHANIC_DERIVATION_EXECUTOR_SHA256,
      probeExecutorSha256: MECHANIC_PROBE_EXECUTOR_SHA256,
      probeRuntimeSha256: PROBE_RUNTIME_SHA256,
      inspectorSha256: approval.hashes.inspector,
      preflightIssues,
      fatalIssues,
      paths,
      assertPreparedBuildCurrent(): void {
        if (resolved.usedLockFallback) {
          // Steam was unavailable at preparation, so the only claim available is that the approved
          // extracted bytes have not moved. Requiring Steam to reappear would fail a legitimate
          // read-only check for a reason that has nothing to do with the data.
          if (!sameBundleIdentities(readBundleRoles(extracted.path).fingerprints, roles.fingerprints)) {
            throw new Error("BUILD_ADVANCED: the prepared extracted bytes changed");
          }
          return;
        }
        const now = installedBuild();
        if (now.generation !== installedBefore.generation) {
          throw new Error(
            `BUILD_ADVANCED: the installed build changed from ${String(installedBefore.buildId)} to ${String(now.buildId)}`,
          );
        }
      },
      dispose(): void {
        for (const dispose of [...disposers].reverse()) dispose();
      },
    };
    preparedMechanicsMembers.add(prepared);
    return prepared;
  } catch (error) {
    for (const dispose of [...disposers].reverse()) dispose();
    throw error;
  }
}

/* emitted artifacts */

function randomBuildToken(): string {
  return createHash("sha256").update(`${process.pid}:${Date.now()}:${Math.random()}`).digest("hex");
}

type FinalizeInput = {
  snapshotPath: string;
  dispose(): void;
  manifestBytesBefore: Uint8Array;
  manifestBytesStaged: Uint8Array;
  manifestBytesAfter: Uint8Array;
  fileManifest: FileManifest;
  lockBytes: Uint8Array;
  fixtureBytes: Uint8Array;
  approvalBytes: Uint8Array;
  approvalSha256: string;
  inspectorSha256: string;
  leases: LeaseSet;
};

/**
 * The mechanics lease an emitted-artifact caller must already hold.
 *
 * Verifying or replacing published data reads the mechanics approval, so a caller that did not take that
 * lease could be verifying against an approval another process is mid-way through replacing.
 */
function mechanicsLeaseGeneration(leases: LeaseSet): string {
  if (!leases.mechanics) {
    throw new Error("an emitted-artifact caller must hold the mechanics lease as well as mechanics-source");
  }
  return leases.mechanics.generation;
}

function finalizePublishedInputs(input: FinalizeInput): PreparedPublishedInputs {
  const root = realpathSync(input.snapshotPath);
  const prepared: PreparedPublishedInputs = {
    [preparedPublishedBrand]: true,
    snapshotPath: root,
    manifestBytesBefore: input.manifestBytesBefore,
    manifestBytesStaged: input.manifestBytesStaged,
    manifestBytesAfter: input.manifestBytesAfter,
    fileManifest: input.fileManifest,
    lockBytes: input.lockBytes,
    lockSha256: sha256Hex(input.lockBytes),
    contractFixtureBytes: input.fixtureBytes,
    contractFixtureSha256: sha256Hex(input.fixtureBytes),
    mechanicsSourceApprovalBytes: input.approvalBytes,
    mechanicsSourceApprovalSha256: input.approvalSha256,
    approvalGateSha256: MECHANICS_APPROVAL_GATE_SHA256,
    derivationExecutorSha256: MECHANIC_DERIVATION_EXECUTOR_SHA256,
    probeExecutorSha256: MECHANIC_PROBE_EXECUTOR_SHA256,
    probeRuntimeSha256: PROBE_RUNTIME_SHA256,
    inspectorSha256: input.inspectorSha256,
    capability: {
      buildToken: randomBuildToken(),
      manifestSha256: sha256Hex(input.manifestBytesStaged),
      root,
      version: 1,
    },
    leaseGenerations: {
      mechanicsSource: input.leases.mechanicsSource.generation,
      mechanics: mechanicsLeaseGeneration(input.leases),
      siteData: input.leases.siteData?.generation ?? null,
    },
    assertLeasesLive(): void {
      input.leases.assertLive();
    },
    dispose: input.dispose,
  };
  preparedPublishedMembers.add(prepared);
  return prepared;
}

/**
 * Snapshots an emitted publication tree for read-only verification.
 *
 * The verifier never reopens source data, the lock, the fixture, or the source approval. Everything it
 * compares comes from this one coherent snapshot, so a tree that changed after publication cannot be
 * verified as though it were the tree that was approved. It acquires no lease of its own: the caller
 * already holds them, and reacquiring an exclusive directory lock inside nested verification would
 * deadlock against the caller.
 */
export function snapshotPublishedInputs(
  dataDir: string,
  lockPath: string,
  fixturePath: string,
  mechanicsSourceLockPath: string,
  leases: LeaseSet,
): PreparedPublishedInputs {
  leases.assertLive();
  const manifestBytesBefore = readStableFile(path.join(dataDir, "index.json"));
  const snapshot = snapshotDirectory(path.resolve(dataDir), "published");
  try {
    const manifestBytesStaged = readStableFile(path.join(snapshot.path, "index.json"));
    const manifestBytesAfter = readStableFile(path.join(dataDir, "index.json"));
    const lockBytes = readStableFile(lockPath);
    const fixtureBytes = readStableFile(fixturePath);
    const approval = readMechanicsSourceApproval(mechanicsSourceLockPath);
    const candidates = computeSourceClosures(path.resolve(path.dirname(mechanicsSourceLockPath)));
    assertSourceApprovalAgrees(approval.hashes, candidates.hashes);
    return finalizePublishedInputs({
      snapshotPath: snapshot.path,
      dispose: snapshot.dispose,
      manifestBytesBefore,
      manifestBytesStaged,
      manifestBytesAfter,
      fileManifest: snapshot.manifest,
      lockBytes,
      fixtureBytes,
      approvalBytes: approval.bytes,
      approvalSha256: approval.approvalSha256,
      inspectorSha256: approval.hashes.inspector,
      leases,
    });
  } catch (error) {
    snapshot.dispose();
    throw error;
  }
}

/**
 * The same branded value for a staging tree the publisher is about to swap into place.
 *
 * Publication already holds coherent lock, fixture, and approval bytes from its own preparation, so it
 * passes them in rather than reading them a second time.
 */
export function prepareStagedPublishedInputs(
  stagingDir: string,
  preparedLockBytes: Uint8Array,
  preparedFixtureBytes: Uint8Array,
  preparedMechanicsSourceApprovalBytes: Uint8Array,
  preparedClosureHashes: SourceApprovalHashes & { approvalSha256: string },
  leases: LeaseSet,
): PreparedPublishedInputs {
  leases.assertLive();
  const manifestBytes = readStableFile(path.join(stagingDir, "index.json"));
  return finalizePublishedInputs({
    snapshotPath: path.resolve(stagingDir),
    // The staging tree belongs to the publisher, which renames or removes it itself.
    dispose: () => undefined,
    manifestBytesBefore: manifestBytes,
    manifestBytesStaged: manifestBytes,
    manifestBytesAfter: manifestBytes,
    fileManifest: inventoryDirectory(stagingDir),
    lockBytes: preparedLockBytes,
    fixtureBytes: preparedFixtureBytes,
    approvalBytes: preparedMechanicsSourceApprovalBytes,
    approvalSha256: preparedClosureHashes.approvalSha256,
    inspectorSha256: preparedClosureHashes.inspector,
    leases,
  });
}

/* review artifacts */

export type PreparedReviewInputs = {
  readonly reviewBytes: Uint8Array;
  readonly reviewSha256: string;
  readonly contractFixtureBytes: Uint8Array;
  readonly contractFixtureSha256: string;
  readonly mechanicsSourceApprovalBytes: Uint8Array;
  readonly inspectorSha256: string;
  readonly candidateInspectorSha256: string;
};

/**
 * Artifact-only inputs for inspection.
 *
 * "Artifact-only" means it never opens an extracted bundle or a runtime report, not that it skips
 * inspector trust: the current inspector closure is computed and compared with the approved value before
 * an attestation may be written.
 */
export function prepareReviewInputs(
  reviewPath: string,
  fixturePath: string,
  mechanicsSourceLockPath: string,
  workspaceRoot: string,
): PreparedReviewInputs {
  const fixtureBytes = readStableFile(fixturePath);
  const reviewBytes = readStableFile(reviewPath);
  const approval = readMechanicsSourceApproval(mechanicsSourceLockPath);
  const candidates = computeSourceClosures(workspaceRoot);
  return {
    reviewBytes,
    reviewSha256: sha256Hex(reviewBytes),
    contractFixtureBytes: fixtureBytes,
    contractFixtureSha256: sha256Hex(fixtureBytes),
    mechanicsSourceApprovalBytes: approval.bytes,
    inspectorSha256: approval.hashes.inspector,
    candidateInspectorSha256: candidates.hashes.inspector,
  };
}

/* sequence gate input */

export type SequenceGateInputBase = {
  /**
   * A caller-owned copy of the prepared extracted tree.
   *
   * The gate spawns real production commands, and publication reads the whole art tree rather than the three
   * bundle roles, so handing over only the role bytes would make the gate exercise a directory the real
   * commands never see. The caller removes this directory in its own `finally`.
   */
  extractedTreePath: string;
  bundleRoles: Record<BundleRole, { filename: string; bytes: Uint8Array }>;
  evidenceBytes: Uint8Array | null;
  externalLeafEvidenceBytes: Uint8Array | null;
  contractFixtureBytes: Uint8Array;
  lockBytes: Uint8Array | null;
  mechanicsSourceApprovalBytes: Uint8Array;
  repositoryFiles: { path: string; bytes: Uint8Array; mode: number }[];
};

const SEQUENCE_GATE_ROOTS = [
  "packages",
  "tools",
  path.join("site", "src"),
  path.join("site", "package.json"),
];

/**
 * The gate's only legitimate input source.
 *
 * The gate spawns real production commands, so it must not open caller-supplied protected paths itself:
 * that would make the gate the one path in the repository which bypasses the rule it exists to test.
 */
export function sequenceGateInputBase(
  extractedDir: string,
  overrides: PrepareOverrides = {},
): SequenceGateInputBase {
  const prepared = prepareMechanicsInputs(extractedDir, "sequence-gate", overrides);
  const extractedTreePath = mkdtempSync(path.join(os.tmpdir(), "vespera-gate-extracted-"));
  try {
    cpSync(prepared.extractedSnapshotPath, extractedTreePath, { recursive: true });
    const roles = prepared.bundleFingerprints;
    const roleBytes = (role: BundleRole): { filename: string; bytes: Uint8Array } => ({
      filename: roles[role].filename,
      bytes: readStableFile(path.join(prepared.extractedSnapshotPath, roles[role].filename)),
    });
    const repositoryFiles: SequenceGateInputBase["repositoryFiles"] = [];
    const addFile = (relative: string, absolute: string): void => {
      repositoryFiles.push({
        path: relative.split(path.sep).join("/"),
        bytes: readStableFile(absolute),
        mode: statSync(absolute).mode,
      });
    };
    for (const root of [...SEQUENCE_GATE_ROOTS, ...WORKSPACE_SOURCE_FILES]) {
      const absolute = path.join(prepared.paths.workspaceRoot, root);
      if (!existsSync(absolute)) continue;
      if (statSync(absolute).isFile()) {
        addFile(root, absolute);
        continue;
      }
      for (const entry of inventoryDirectory(absolute)) {
        addFile(path.join(root, entry.path), path.join(absolute, entry.path));
      }
    }
    return {
      extractedTreePath,
      bundleRoles: {
        indexHtml: roleBytes("indexHtml"),
        index: roleBytes("index"),
        gameView: roleBytes("gameView"),
      },
      evidenceBytes: prepared.evidenceBytes,
      externalLeafEvidenceBytes: prepared.externalLeafEvidenceBytes,
      contractFixtureBytes: prepared.contractFixtureBytes,
      lockBytes: prepared.lockBytes,
      mechanicsSourceApprovalBytes: prepared.mechanicsSourceApprovalBytes,
      repositoryFiles,
    };
  } catch (error) {
    rmSync(extractedTreePath, { recursive: true, force: true });
    throw error;
  } finally {
    prepared.dispose();
  }
}

/* approval-domain inputs */

export type PreparedMechanicsSourceReviewInputs = {
  readonly workspaceRoot: string;
  readonly approvalPath: string;
  readonly approvalBytes: Uint8Array | null;
  readonly approvalGeneration: string;
  readonly reviewBytes: Record<string, Uint8Array>;
  readonly reviewGenerations: Record<string, string>;
  readonly attestationBytes: Uint8Array | null;
  readonly attestationGeneration: string;
  readonly closureSourceManifest: FileManifest;
  readonly constants: {
    approvalGate: string;
    derivation: string;
    probeExecutor: string;
    runtime: string;
  };
  /** Rechecks everything that could have moved while the lease was being taken. */
  assertUnchanged(): void;
  dispose(): void;
};

/**
 * The single approval-domain preparation.
 *
 * Every command that reads or writes the source approval goes through here. It snapshots the old approval,
 * the review artifacts, and the attestation with stable reads, inventories every closure source before and
 * after the candidates are computed, and records the constant values it saw. `assertUnchanged` is called
 * again while the exclusive lease is held, so a concurrent edit between preparation and commit aborts
 * instead of being approved.
 */
export function prepareMechanicsSourceReviewInputs(input: {
  workspaceRoot: string;
  approvalPath: string;
  reviewPaths: Record<string, string>;
  attestationPath?: string;
}): PreparedMechanicsSourceReviewInputs {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const approvalPath = path.resolve(input.approvalPath);
  const snapshot = workspaceSourceSnapshot(workspaceRoot);
  try {
    const approvalBytes = existsSync(approvalPath) ? readStableFile(approvalPath) : null;
    const approvalGeneration = approvalBytes ? sha256Hex(approvalBytes) : "ABSENT";
    const reviewBytes: Record<string, Uint8Array> = {};
    const reviewGenerations: Record<string, string> = {};
    for (const [name, file] of Object.entries(input.reviewPaths)) {
      const bytes = readStableFile(path.resolve(file));
      reviewBytes[name] = bytes;
      reviewGenerations[name] = sha256Hex(bytes);
    }
    const attestationBytes = input.attestationPath
      ? readStableFile(path.resolve(input.attestationPath))
      : null;
    const before = manifestKey(snapshot.manifest);
    const constants = {
      approvalGate: MECHANICS_APPROVAL_GATE_SHA256,
      derivation: MECHANIC_DERIVATION_EXECUTOR_SHA256,
      probeExecutor: MECHANIC_PROBE_EXECUTOR_SHA256,
      runtime: PROBE_RUNTIME_SHA256,
    };
    const assertUnchanged = (): void => {
      if (manifestKey(inventoryDirectory(snapshot.path)) !== before) {
        throw new Error("INPUT_MUTATED: the snapshotted closure source changed");
      }
      const currentApproval = existsSync(approvalPath) ? sha256Hex(readStableFile(approvalPath)) : "ABSENT";
      if (currentApproval !== approvalGeneration) {
        throw new Error("APPROVAL_ADVANCED: the source approval changed after preparation");
      }
      for (const [name, file] of Object.entries(input.reviewPaths)) {
        if (sha256Hex(readStableFile(path.resolve(file))) !== reviewGenerations[name]) {
          throw new Error(`REVIEW_ADVANCED: the ${name} review artifact changed after preparation`);
        }
      }
      for (const [key, value] of Object.entries(constants)) {
        const current = {
          approvalGate: MECHANICS_APPROVAL_GATE_SHA256,
          derivation: MECHANIC_DERIVATION_EXECUTOR_SHA256,
          probeExecutor: MECHANIC_PROBE_EXECUTOR_SHA256,
          runtime: PROBE_RUNTIME_SHA256,
        }[key as keyof typeof constants];
        if (current !== value) throw new Error(`CONSTANT_ADVANCED: the ${key} constant changed`);
      }
    };
    return {
      workspaceRoot,
      approvalPath,
      approvalBytes,
      approvalGeneration,
      reviewBytes,
      reviewGenerations,
      attestationBytes,
      attestationGeneration: attestationBytes ? sha256Hex(attestationBytes) : "ABSENT",
      closureSourceManifest: snapshot.manifest,
      constants,
      assertUnchanged,
      dispose: snapshot.dispose,
    };
  } catch (error) {
    snapshot.dispose();
    throw error;
  }
}
