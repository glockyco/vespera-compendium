/**
 * The mechanics approval lock records what a person reviewed and whether it still applies.
 *
 * For each document, the lock checks source bytes, shown model, bundle identities, and live evidence.
 * The lock is not a cache.
 * Publication always extracts again.
 * The embedded model only shows a reviewer what changed.
 *
 * Two decisions shape this design.
 *
 * A source change fails even when shown text stays identical.
 * The extractor can miss a semantic effect, so equal page text does not show that the explanation remains true.
 *
 * The lock approves one complete evidence object, not a document slice.
 * A changed runtime hash or normalized result invalidates every document.
 * Their shared report is no longer the approved report.
 */

import {
  BUNDLE_ROLES,
  bindingToken,
  bridgedBindingToken,
  canonicalJson,
  canonicalSha256,
  canonicalSourceSlice,
  MECHANIC_PROBE_CONTRACTS,
  mechanicsApprovalPreimage,
  normalizeRuntimeEvidenceForApproval,
  probeContract,
  publicProbeContract,
  sha256Hex,
  withoutMember,
  type BundleIdentity,
  type BundleRole,
  type CanonicalJson,
  type NormalizedProbeCase,
  type NormalizedProbeResult,
  type PublicProbeContract,
} from "@vespera/core";
import {
  claimToProbeMap,
  claimToTargetMap,
  documentTexts,
  MECHANIC_DOCUMENT_IDS,
  parseMechanicsContract,
  requiredProbes,
  resolveLocator,
  parseRoles,
  tryExtractMechanics,
  type MechanicDocument,
  type MechanicDocumentId,
  type MechanicLockedModel,
  type MechanicProbeRef,
  type MechanicText,
} from "./mechanics.ts";
import {
  deriveVerificationStatus,
  parseMechanicsReviewArtifact,
  type MechanicsProof,
  type MechanicsReviewArtifact,
  type MechanicsReviewBody,
  type ReviewDocument,
} from "./mechanics-artifacts.ts";
import type { PreparedMechanicsInputs } from "./inputs.ts";

/* Lock shape */

export type LockedBundle = { filename: string; bytes: number; sha256: string };

export type MechanicsLockSnapshot = {
  buildId: string;
  bundles: Record<BundleRole, LockedBundle>;
  evidenceRanAt: string;
  evidenceSha256: string;
  externalLeafEvidenceSha256: string;
  normalizedProbeResults: NormalizedProbeResult[];
  normalizedProbeResultsSha256: string;
  mechanicsSourceApprovalSha256: string;
  approvalGateSha256: string;
  derivationExecutorSha256: string;
  probeExecutorSha256: string;
  probeRuntimeSha256: string;
  inspectorSha256: string;
  contractFixtureSha256: string;
};

export type MechanicsLockDocument = {
  modelSha256: string;
  verifiedProbes: MechanicProbeRef[];
  model: MechanicLockedModel;
};

export type MechanicsLock = {
  version: 1;
  snapshot: MechanicsLockSnapshot;
  documents: Record<string, MechanicsLockDocument>;
};

function asRecord(value: unknown, detail: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`expected a JSON object: ${detail}`);
  }
  return value as Record<string, unknown>;
}

/** The canonical hash of one locked model over the complete reviewed projection. */
export function lockedModelSha256(model: MechanicLockedModel): string {
  return canonicalSha256(model as unknown as CanonicalJson);
}

/** Canonical lock bytes. Writer and reader then use the same bytes. */
export function serializeMechanicsLock(lock: MechanicsLock): Uint8Array {
  return new TextEncoder().encode(`${canonicalJson(lock as unknown as CanonicalJson)}\n`);
}

export class LockCorruptError extends Error {}

/**
 * Parse the lock and recompute every value that it claims about itself.
 *
 * Recompute every embedded model hash.
 * Each `verifiedProbes` array must equal the model's exact required union.
 * A lock that disagrees with itself is corruption, not disapproval.
 * Reject it before status comparison and print the concrete inconsistency.
 */
export function parseMechanicsLock(bytes: Uint8Array): MechanicsLock {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (cause) {
    throw new LockCorruptError("the mechanics lock is not parseable JSON", { cause });
  }
  const record = asRecord(parsed, "mechanics lock");
  if (record.version !== 1) throw new LockCorruptError("the mechanics lock must be version 1");
  const snapshot = asRecord(record.snapshot, "mechanics lock snapshot");
  for (const field of [
    "buildId",
    "evidenceRanAt",
    "evidenceSha256",
    "externalLeafEvidenceSha256",
    "normalizedProbeResultsSha256",
    "mechanicsSourceApprovalSha256",
    "approvalGateSha256",
    "derivationExecutorSha256",
    "probeExecutorSha256",
    "probeRuntimeSha256",
    "inspectorSha256",
    "contractFixtureSha256",
  ]) {
    if (typeof snapshot[field] !== "string") {
      throw new LockCorruptError(`the mechanics lock snapshot has no ${field}`);
    }
  }
  const bundles = asRecord(snapshot.bundles, "mechanics lock bundles");
  for (const role of BUNDLE_ROLES) {
    const entry = asRecord(bundles[role], `mechanics lock ${role} bundle`);
    if (typeof entry.sha256 !== "string" || typeof entry.bytes !== "number") {
      throw new LockCorruptError(`the mechanics lock ${role} bundle identity is malformed`);
    }
  }
  if (!Array.isArray(snapshot.normalizedProbeResults)) {
    throw new LockCorruptError("the mechanics lock has no normalized probe results");
  }
  const lock = record as unknown as MechanicsLock;
  const resultsHash = canonicalSha256(lock.snapshot.normalizedProbeResults as unknown as CanonicalJson);
  if (resultsHash !== lock.snapshot.normalizedProbeResultsSha256) {
    throw new LockCorruptError(
      `the mechanics lock records normalized results ${lock.snapshot.normalizedProbeResultsSha256} but they hash to ${resultsHash}`,
    );
  }
  const documents = asRecord(record.documents, "mechanics lock documents");
  for (const id of MECHANIC_DOCUMENT_IDS) {
    if (!(id in documents)) throw new LockCorruptError(`the mechanics lock has no document ${id}`);
  }
  for (const [id, value] of Object.entries(documents)) {
    const entry = asRecord(value, `mechanics lock document ${id}`);
    if (typeof entry.modelSha256 !== "string") {
      throw new LockCorruptError(`document ${id} has no modelSha256`);
    }
    const document = entry as unknown as MechanicsLockDocument;
    const recomputed = lockedModelSha256(document.model);
    if (recomputed !== document.modelSha256) {
      throw new LockCorruptError(
        `document ${id} records model ${document.modelSha256} but its embedded model hashes to ${recomputed}`,
      );
    }
    const expected = requiredProbes(document.model);
    if (probeKey(expected) !== probeKey(document.verifiedProbes)) {
      throw new LockCorruptError(
        `document ${id} records verifiedProbes [${probeKey(document.verifiedProbes)}] but its model requires [${probeKey(expected)}]`,
      );
    }
  }
  return lock;
}

const probeKey = (refs: readonly MechanicProbeRef[]): string =>
  [...refs]
    .map((ref) => `${ref.suite}/${ref.id}/${ref.category ?? ""}/${ref.contractSha256}/${ref.promotionEligible}`)
    .sort()
    .join("|");

/* Evidence normalization */

export type EvidenceStatus = "VERIFIED" | "MISSING" | "MALFORMED" | "BUILD_MISMATCH" | "BUILD_UNRESOLVED";

export type NormalizedEvidence = {
  status: EvidenceStatus;
  detail: string;
  ranAt: string | null;
  evidenceSha256: string | null;
  normalizedResults: NormalizedProbeResult[];
  probeRuntimeSha256: string | null;
  mechanicsSourceApprovalSha256: string | null;
  extractedBundles: BundleIdentity[] | null;
  runtimeBundles: BundleIdentity[] | null;
  harnessArtifactSha256: string | null;
};

const RFC3339_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Normalize one evidence report into the semantic projection that the lock approves.
 *
 * Replace resource URLs with canonical binding tokens before hashing.
 * A build can then rename a bundle without changing its approval when its bytes stay the same.
 * A byte identity, probe case, or observation change still invalidates the approval.
 */
export function normalizeEvidence(
  bytes: Uint8Array | null,
  expectedBuildId: string | null,
  now: Date,
): NormalizedEvidence {
  const absent: NormalizedEvidence = {
    status: "MISSING",
    detail: "no runtime evidence for the resolved build",
    ranAt: null,
    evidenceSha256: null,
    normalizedResults: [],
    probeRuntimeSha256: null,
    mechanicsSourceApprovalSha256: null,
    extractedBundles: null,
    runtimeBundles: null,
    harnessArtifactSha256: null,
  };
  if (expectedBuildId === null) {
    return { ...absent, status: "BUILD_UNRESOLVED", detail: "the installed build id is unavailable" };
  }
  if (!bytes) return absent;
  const malformed = (detail: string): NormalizedEvidence => ({ ...absent, status: "MALFORMED", detail });

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return malformed("the runtime evidence is not parseable JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return malformed("the runtime evidence is not a JSON object");
  }
  const report: Record<string, unknown> = parsed as Record<string, unknown>;
  if (report.schemaVersion !== 2) return malformed("the runtime evidence must be schema version 2");
  if (typeof report.buildId !== "string") return malformed("the runtime evidence has no build id");
  if (report.buildId !== expectedBuildId) {
    return {
      ...absent,
      status: "BUILD_MISMATCH",
      detail: `the runtime evidence names build ${report.buildId}, expected ${expectedBuildId}`,
    };
  }
  if (typeof report.ranAt !== "string" || !RFC3339_UTC_MS.test(report.ranAt)) {
    return malformed("ranAt must be RFC 3339 UTC with millisecond precision");
  }
  const ranAtMs = Date.parse(report.ranAt);
  if (Number.isNaN(ranAtMs)) return malformed("ranAt is not a valid instant");
  if (ranAtMs - now.getTime() > 5 * 60 * 1000) {
    return malformed("ranAt is more than five minutes in the future");
  }
  if (!report.runtimeBundles) {
    return malformed("the runtime evidence has no runtime bundle identities, so it cannot approve anything");
  }
  if (!Array.isArray(report.results)) return malformed("the runtime evidence has no results");

  let normalizedResults: NormalizedProbeResult[];
  try {
    normalizedResults = normalizeResults(report.results);
  } catch (error) {
    return malformed(error instanceof Error ? error.message : String(error));
  }

  let canonical: CanonicalJson;
  try {
    // The projection checks the bundle identity shape and rejects a null runtime side.
    canonical = normalizeRuntimeEvidenceForApproval(
      report as unknown as Parameters<typeof normalizeRuntimeEvidenceForApproval>[0],
      normalizedResults,
    );
  } catch (error) {
    return malformed(error instanceof Error ? error.message : String(error));
  }

  return {
    status: "VERIFIED",
    detail: `${normalizedResults.length} normalized results for build ${report.buildId}`,
    ranAt: report.ranAt,
    evidenceSha256: canonicalSha256(canonical),
    normalizedResults,
    probeRuntimeSha256: typeof report.probeRuntimeSha256 === "string" ? report.probeRuntimeSha256 : null,
    mechanicsSourceApprovalSha256:
      typeof report.mechanicsSourceApprovalSha256 === "string" ? report.mechanicsSourceApprovalSha256 : null,
    extractedBundles: identitiesOf(report.extractedBundles),
    runtimeBundles: identitiesOf(report.runtimeBundles),
    harnessArtifactSha256: sha256Hex(bytes),
  };
}

function identitiesOf(value: unknown): BundleIdentity[] | null {
  if (!value || typeof value !== "object") return null;
  const record: Record<string, unknown> = value as Record<string, unknown>;
  const identities: BundleIdentity[] = [];
  for (const role of BUNDLE_ROLES) {
    const entry = record[role];
    if (!entry || typeof entry !== "object") return null;
    if (!("bytes" in entry) || !("sha256" in entry)) return null;
    if (typeof entry.bytes !== "number" || typeof entry.sha256 !== "string") return null;
    identities.push({ role, bytes: entry.bytes, sha256: entry.sha256 });
  }
  return identities;
}

function normalizeResults(results: readonly unknown[]): NormalizedProbeResult[] {
  const normalized: NormalizedProbeResult[] = [];
  for (const raw of results) {
    if (!raw || typeof raw !== "object") throw new Error("a probe result is not an object");
    const result: Record<string, unknown> = raw as Record<string, unknown>;
    const suite = typeof result.suite === "string" ? result.suite : null;
    const id = typeof result.id === "string" ? result.id : null;
    if (!suite || !id) throw new Error("a probe result has no suite or id");
    const status = result.status;
    if (status !== "PASS" && status !== "FAIL" && status !== "SKIPPED" && status !== "UNRESOLVED") {
      throw new Error(`probe ${suite}/${id} has the unknown status ${String(status)}`);
    }
    // A missing category becomes null on both sides of each tuple comparison. A copy change cannot weaken an obligation by dropping the field.
    const category = typeof result.category === "string" ? result.category : null;
    const contract = probeContract(suite, id);
    const cases = normalizeCases(result.cases);
    normalized.push({
      suite,
      id,
      category,
      status,
      contractSha256: typeof result.contractSha256 === "string" ? result.contractSha256 : null,
      resolver: result.resolver === "function" || result.resolver === "method" ? result.resolver : null,
      bundle: isBundleRole(result.bundle) ? result.bundle : null,
      boundModuleSha256: typeof result.boundModuleSha256 === "string" ? result.boundModuleSha256 : null,
      invocationBinding: canonicalBinding(result, contract?.bundle ?? null),
      cleanBinding:
        typeof result.cleanResourceUrl === "string" && isBundleRole(result.bundle)
          ? bindingToken(result.bundle)
          : null,
      cleanModuleSha256: typeof result.cleanModuleSha256 === "string" ? result.cleanModuleSha256 : null,
      servedResourceSha256:
        typeof result.servedResourceSha256 === "string" ? result.servedResourceSha256 : null,
      bridgeSuffixSha256: typeof result.bridgeSuffixSha256 === "string" ? result.bridgeSuffixSha256 : null,
      cases,
    });
  }
  return normalized.sort((left, right) =>
    `${left.suite}\u0000${left.id}\u0000${left.category ?? ""}` <
    `${right.suite}\u0000${right.id}\u0000${right.category ?? ""}`
      ? -1
      : 1,
  );
}

function isBundleRole(value: unknown): value is BundleRole {
  return value === "indexHtml" || value === "index" || value === "gameView";
}

/**
 * The canonical stand-in for the response that produced the invoked function.
 *
 * A clean session uses its semantic role as the binding.
 * The instrumented Defense session uses the suffix and served bytes.
 * Approval then records modified source instead of hiding the modification.
 */
function canonicalBinding(result: Record<string, unknown>, fallbackRole: BundleRole | null): string | null {
  if (typeof result.servedResourceSha256 === "string" && typeof result.bridgeSuffixSha256 === "string") {
    return bridgedBindingToken(result.bridgeSuffixSha256, result.servedResourceSha256);
  }
  if (typeof result.invocationResourceUrl === "string") {
    const role = isBundleRole(result.bundle) ? result.bundle : fallbackRole;
    return role ? bindingToken(role) : null;
  }
  return null;
}

function normalizeCases(value: unknown): NormalizedProbeCase[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("a probe case is not an object");
    const record: Record<string, unknown> = entry as Record<string, unknown>;
    if (typeof record.id !== "string") throw new Error("a probe case has no id");
    return {
      id: record.id,
      input: (record.input ?? null) as CanonicalJson,
      expected: (record.expected ?? null) as CanonicalJson,
      firstObserved: (record.firstObserved ?? null) as CanonicalJson,
      secondObserved: (record.secondObserved ?? null) as CanonicalJson,
    };
  });
}

/**
 * The exact PASS set that one model's obligations resolve to.
 *
 * Each tuple must occur once with `PASS`, and its cases must match the reviewed contract deeply.
 * One passing execution can satisfy several claim bindings in one contract hash.
 * The union therefore removes duplicate execution tuples, not claims.
 */
export function verifiedProbesFor(
  model: MechanicLockedModel,
  normalizedResults: readonly NormalizedProbeResult[],
): MechanicProbeRef[] {
  const passed: MechanicProbeRef[] = [];
  for (const ref of requiredProbes(model)) {
    const matches = normalizedResults.filter(
      (result) =>
        result.suite === ref.suite &&
        result.id === ref.id &&
        (result.category ?? null) === (ref.category ?? null),
    );
    if (matches.length !== 1) continue;
    const result = matches[0]!;
    if (result.status !== "PASS" || result.contractSha256 !== ref.contractSha256) continue;
    const contract = probeContract(ref.suite, ref.id);
    if (!contract || !sameCaseGrid(contract.cases, result.cases)) continue;
    passed.push({ ...ref });
  }
  return passed;
}

function sameCaseGrid(
  declared: readonly { id: string; input: CanonicalJson; expected: CanonicalJson }[],
  observed: readonly NormalizedProbeCase[],
): boolean {
  if (declared.length !== observed.length) return false;
  for (const [index, expected] of declared.entries()) {
    const actual = observed[index]!;
    if (actual.id !== expected.id) return false;
    if (canonicalJson(actual.input) !== canonicalJson(expected.input)) return false;
    if (canonicalJson(actual.expected) !== canonicalJson(expected.expected)) return false;
    if (canonicalJson(actual.firstObserved) !== canonicalJson(actual.secondObserved)) return false;
    if (canonicalJson(actual.firstObserved) !== canonicalJson(expected.expected)) return false;
  }
  return true;
}

/* Approval preimage */

/** The canonical `approval` object that the published artifact carries and the site checks again. */
export function canonicalMechanicsApproval(
  lock: MechanicsLock,
  publicContracts: readonly PublicProbeContract[],
): CanonicalJson {
  return mechanicsApprovalPreimage({
    buildId: lock.snapshot.buildId,
    bundles: BUNDLE_ROLES.map((role) => ({
      role,
      bytes: lock.snapshot.bundles[role].bytes,
      sha256: lock.snapshot.bundles[role].sha256,
    })),
    evidenceRanAt: lock.snapshot.evidenceRanAt,
    evidenceSha256: lock.snapshot.evidenceSha256,
    externalLeafEvidenceSha256: lock.snapshot.externalLeafEvidenceSha256,
    contractFixtureSha256: lock.snapshot.contractFixtureSha256,
    mechanicsSourceApprovalSha256: lock.snapshot.mechanicsSourceApprovalSha256,
    approvalGateSha256: lock.snapshot.approvalGateSha256,
    derivationExecutorSha256: lock.snapshot.derivationExecutorSha256,
    probeExecutorSha256: lock.snapshot.probeExecutorSha256,
    probeRuntimeSha256: lock.snapshot.probeRuntimeSha256,
    inspectorSha256: lock.snapshot.inspectorSha256,
    probeContracts: [...publicContracts],
    documents: MECHANIC_DOCUMENT_IDS.map((id) => ({
      id,
      modelSha256: lock.documents[id]!.modelSha256,
      verifiedProbes: lock.documents[id]!.verifiedProbes as unknown as CanonicalJson,
    })),
  });
}

/** The published `approvalSha256`, recomputed by the producer, checker, and browser. */
export function mechanicsApprovalSha256(
  lock: MechanicsLock,
  publicContracts: readonly PublicProbeContract[],
): string {
  return canonicalSha256(canonicalMechanicsApproval(lock, publicContracts));
}

/** Every contract that the site can see, in registry order. */
export function publicProbeContracts(): PublicProbeContract[] {
  return MECHANIC_PROBE_CONTRACTS.map(publicProbeContract);
}

/* Check */

export type MechanicStatus =
  | "PASS"
  | "UNAPPROVED"
  | "UNRESOLVED"
  | "SOURCE_CHANGED"
  | "MODEL_CHANGED"
  | "BUILD_UNVERIFIED"
  | "LOCK_CORRUPT";

export type MechanicCheck = { id: MechanicDocumentId; status: MechanicStatus; detail: string };

const STATUS_ORDER: MechanicStatus[] = [
  "LOCK_CORRUPT",
  "UNAPPROVED",
  "UNRESOLVED",
  "SOURCE_CHANGED",
  "MODEL_CHANGED",
  "BUILD_UNVERIFIED",
  "PASS",
];

function worst(findings: { status: MechanicStatus; detail: string }[]): { status: MechanicStatus; detail: string } {
  for (const status of STATUS_ORDER) {
    const found = findings.find((finding) => finding.status === status);
    if (found) return found;
  }
  return { status: "PASS", detail: "source targets, model, and bundle identities match the lock" };
}

/**
 * One status per document with only its highest-priority finding.
 *
 * Source and model changes have higher priority than build state.
 * A reviewer must know that the explanation changed before seeing that evidence is stale.
 * Stale evidence is a consequence of the source or model change.
 */
export function checkMechanics(prepared: PreparedMechanicsInputs): MechanicCheck[] {
  const findings = new Map<MechanicDocumentId, { status: MechanicStatus; detail: string }[]>();
  for (const id of MECHANIC_DOCUMENT_IDS) findings.set(id, []);
  const addAll = (status: MechanicStatus, detail: string): void => {
    for (const id of MECHANIC_DOCUMENT_IDS) findings.get(id)!.push({ status, detail });
  };

  let lock: MechanicsLock | null = null;
  if (!prepared.lockBytes) {
    addAll("UNAPPROVED", `no reviewed lock at ${prepared.paths.lockPath}`);
  } else {
    try {
      lock = parseMechanicsLock(prepared.lockBytes);
    } catch (error) {
      addAll("LOCK_CORRUPT", error instanceof Error ? error.message : String(error));
    }
  }

  const outcomes = tryExtractMechanics(prepared);
  const extracted = new Map<MechanicDocumentId, MechanicDocument>();
  for (const id of MECHANIC_DOCUMENT_IDS) {
    const outcome = outcomes[id];
    if (outcome.status === "OK") extracted.set(id, outcome.document);
    else {
      const status = outcome.status === "UNRESOLVED" ? "UNRESOLVED" : "MODEL_CHANGED";
      findings.get(id)!.push({ status, detail: outcome.diagnostics.join("; ") });
      if (outcome.status === "MODEL_CHANGED" && outcome.candidate) extracted.set(id, outcome.candidate);
    }
  }

  if (lock) {
    if (lock.snapshot.contractFixtureSha256 !== prepared.contractFixtureSha256) {
      addAll(
        "MODEL_CHANGED",
        `the reviewed contract fixture is ${prepared.contractFixtureSha256}, the lock approved ${lock.snapshot.contractFixtureSha256}`,
      );
    }
    for (const [field, current] of [
      ["probeRuntimeSha256", prepared.probeRuntimeSha256],
      ["probeExecutorSha256", prepared.probeExecutorSha256],
      ["derivationExecutorSha256", prepared.derivationExecutorSha256],
      ["approvalGateSha256", prepared.approvalGateSha256],
      ["inspectorSha256", prepared.inspectorSha256],
      ["mechanicsSourceApprovalSha256", prepared.mechanicsSourceApprovalSha256],
    ] as const) {
      const approved = lock.snapshot[field];
      if (approved !== current) {
        addAll("MODEL_CHANGED", `${field} is ${current}, the lock approved ${approved}`);
      }
    }

    const roles = parseRoles(prepared);
    for (const id of MECHANIC_DOCUMENT_IDS) {
      const locked = lock.documents[id];
      const fresh = extracted.get(id);
      if (!locked || !fresh) continue;
      const changed: string[] = [];
      const lockedTargets = new Map(locked.model.sourceTargets.map((target) => [target.id, target]));
      for (const target of fresh.sourceTargets) {
        const approved = lockedTargets.get(target.id);
        if (!approved) continue;
        // Compare canonical data, not `JSON.stringify`. The lock has sorted keys, while a new locator has declaration order.
        // Treating this order difference as a change skips the byte comparison.
        if (canonicalJson(approved.locator as unknown as CanonicalJson) !== canonicalJson(target.locator as unknown as CanonicalJson)) continue;
        if (approved.sha256 !== target.sha256) changed.push(target.id);
      }
      if (changed.length > 0) {
        findings.get(id)!.push({
          status: "SOURCE_CHANGED",
          detail: `source target bytes changed: ${changed.join(", ")}`,
        });
        continue;
      }
      const lockedModel = locked.model;
      const candidate: MechanicLockedModel = {
        ...fresh,
        derivationExecutorSha256: prepared.derivationExecutorSha256,
        mechanicsSourceApprovalSha256: prepared.mechanicsSourceApprovalSha256,
      };
      if (lockedModelSha256(candidate) !== locked.modelSha256) {
        findings.get(id)!.push({
          status: "MODEL_CHANGED",
          detail: describeModelDifference(lockedModel, candidate),
        });
      }
      void roles;
    }

    const evidence = normalizeEvidence(prepared.evidenceBytes, prepared.resolvedBuildId, new Date());
    if (evidence.status !== "VERIFIED") {
      addAll("BUILD_UNVERIFIED", `${evidence.status}: ${evidence.detail}`);
    } else {
      if (evidence.evidenceSha256 !== lock.snapshot.evidenceSha256) {
        addAll(
          "BUILD_UNVERIFIED",
          `the evidence hashes to ${evidence.evidenceSha256}, the lock approved ${lock.snapshot.evidenceSha256}`,
        );
      }
      if (evidence.ranAt !== lock.snapshot.evidenceRanAt) {
        addAll(
          "BUILD_UNVERIFIED",
          `the evidence ran at ${String(evidence.ranAt)}, the lock approved ${lock.snapshot.evidenceRanAt}`,
        );
      }
      for (const role of BUNDLE_ROLES) {
        const current = prepared.bundleFingerprints[role];
        const approved = lock.snapshot.bundles[role];
        if (current.sha256 !== approved.sha256 || current.bytes !== approved.bytes) {
          addAll(
            "BUILD_UNVERIFIED",
            `the ${role} bundle is ${current.bytes} bytes ${current.sha256}, the lock approved ${approved.bytes} bytes ${approved.sha256}`,
          );
        }
      }
      const runtime = evidence.runtimeBundles ?? [];
      for (const identity of runtime) {
        const current = prepared.bundleFingerprints[identity.role];
        if (identity.sha256 !== current.sha256 || identity.bytes !== current.bytes) {
          addAll(
            "BUILD_UNVERIFIED",
            `the runtime ${identity.role} bytes do not match the extracted bytes`,
          );
        }
      }
      if (prepared.externalLeafEvidenceSha256 !== lock.snapshot.externalLeafEvidenceSha256) {
        addAll(
          "BUILD_UNVERIFIED",
          `the external leaf aggregate is ${String(prepared.externalLeafEvidenceSha256)}, the lock approved ${lock.snapshot.externalLeafEvidenceSha256}`,
        );
      }
    }
  }

  return MECHANIC_DOCUMENT_IDS.map((id) => {
    const resolved = worst(findings.get(id)!);
    return { id, status: resolved.status, detail: resolved.detail };
  });
}

/** A field-level description of why two models differ, not only two hashes. */
export function describeModelDifference(approved: MechanicLockedModel, candidate: MechanicLockedModel): string {
  const differences: string[] = [];
  const approvedTexts = new Map(documentTexts(approved).map((text) => [text.id, text]));
  const candidateTexts = new Map(documentTexts(candidate).map((text) => [text.id, text]));
  for (const [id, text] of candidateTexts) {
    const before = approvedTexts.get(id);
    if (!before) {
      differences.push(`added claim ${id}`);
      continue;
    }
    if (before.text !== text.text) differences.push(`claim ${id} text changed`);
    if (before.evidence.kind !== text.evidence.kind) differences.push(`claim ${id} provenance changed`);
    if (before.evidence.sourceTargetIds.join(",") !== text.evidence.sourceTargetIds.join(",")) {
      differences.push(`claim ${id} citations changed`);
    }
    if (probeKey(before.evidence.requiredProbes) !== probeKey(text.evidence.requiredProbes)) {
      differences.push(`claim ${id} probe obligations changed`);
    }
  }
  for (const id of approvedTexts.keys()) {
    if (!candidateTexts.has(id)) differences.push(`removed claim ${id}`);
  }
  const approvedTargets = new Map(approved.sourceTargets.map((target) => [target.id, target]));
  for (const target of candidate.sourceTargets) {
    const before = approvedTargets.get(target.id);
    if (!before) {
      differences.push(`added source target ${target.id}`);
      continue;
    }
    if (before.bundle !== target.bundle) differences.push(`target ${target.id} bundle role changed`);
    if (canonicalJson(before.locator as unknown as CanonicalJson) !== canonicalJson(target.locator as unknown as CanonicalJson)) {
      differences.push(`target ${target.id} locator changed`);
    }
  }
  for (const id of approvedTargets.keys()) {
    if (!candidate.sourceTargets.some((target) => target.id === id)) {
      differences.push(`removed source target ${id}`);
    }
  }
  if (approved.derivationExecutorSha256 !== candidate.derivationExecutorSha256) {
    differences.push("the derivation executor hash changed");
  }
  if (approved.mechanicsSourceApprovalSha256 !== candidate.mechanicsSourceApprovalSha256) {
    differences.push("the mechanics source approval changed");
  }
  return differences.length > 0 ? differences.join("; ") : "the canonical model hash changed";
}

export type { MechanicText };

/* review artifact construction */

/**
 * Build the bounded review artifact.
 *
 * It carries every shown claim, provenance, obligation, resolved target, and target or closure byte.
 * The diagnostic path manifest and artifact hash stay outside the preimage.
 * A filename-only relocation with identical role bytes is invisible to review.
 * This is correct because it changes nothing that a reviewer can assess.
 */
export function buildMechanicsReviewArtifact(input: {
  prepared: PreparedMechanicsInputs;
  documents: readonly MechanicDocument[];
  lock: MechanicsLock | null;
  now: Date;
}): MechanicsReviewArtifact {
  const { prepared } = input;
  const roles = parseRoles(prepared);
  const evidence = normalizeEvidence(prepared.evidenceBytes, prepared.resolvedBuildId, input.now);
  const aggregatePresent = prepared.externalLeafEvidenceSha256 !== null;
  const evidenceStatus: EvidenceStatus =
    evidence.status === "VERIFIED" && !aggregatePresent ? "MISSING" : evidence.status;

  const identities: BundleIdentity[] = BUNDLE_ROLES.map((role) => ({
    role,
    bytes: prepared.bundleFingerprints[role].bytes,
    sha256: prepared.bundleFingerprints[role].sha256,
  }));

  const contract = parseMechanicsContract(prepared.contractFixtureBytes);
  const endgame = input.documents.find((document) => document.id === "endgame-systems");

  const reviewDocuments: ReviewDocument[] = input.documents.map((document) => {
    const model: MechanicLockedModel = {
      ...document,
      derivationExecutorSha256: prepared.derivationExecutorSha256,
      mechanicsSourceApprovalSha256: prepared.mechanicsSourceApprovalSha256,
    };
    const passed = evidenceStatus === "VERIFIED" ? verifiedProbesFor(model, evidence.normalizedResults) : [];
    const approvedModel = input.lock?.documents[document.id]?.model ?? null;
    return {
      id: document.id,
      modelSha256: lockedModelSha256(model),
      claims: documentTexts(document).map((text) => ({
        id: text.id,
        kind: text.evidence.kind,
        text: text.text,
        sourceTargetIds: [...text.evidence.sourceTargetIds],
        requiredProbes: text.evidence.requiredProbes.map((ref) => ({ ...ref })),
        verificationHint: deriveVerificationStatus(text, passed),
      })),
      sourceTargets: document.sourceTargets.map((target) => {
        const range = resolveLocator(roles, target.bundle, target.locator);
        return {
          id: target.id,
          bundle: target.bundle,
          locator: target.locator as unknown as CanonicalJson,
          sha256: target.sha256,
          canonicalSource: new TextDecoder("utf-8", { fatal: true }).decode(
            canonicalSourceSlice(range.sourceText, range.start, range.end),
          ),
        };
      }),
      derivations: document.derivations.map((derivation) => ({
        id: derivation.id,
        evaluator: derivation.evaluator,
        executionTraceSha256: derivation.executionTraceSha256,
        resultSha256: derivation.resultSha256,
        derivationExecutorSha256: derivation.derivationExecutorSha256,
        sourceTargetIds: [...derivation.sourceTargetIds],
        bindings: derivation.bindings as unknown as CanonicalJson,
        calls: derivation.calls.map((call) => ({
          sourceTargetId: call.sourceTargetId,
          args: call.args as unknown as CanonicalJson,
        })),
        outputs: derivation.outputs.map((output) => ({
          id: output.id,
          textId: output.textId,
          rawValue: output.rawValue as unknown as CanonicalJson,
          format: output.format,
          formattedText: output.formattedText,
        })),
      })),
      claimToTargets: claimToTargetMap([document]),
      claimToProbes: claimToProbeMap([document]),
      fieldDiffs: approvedModel
        ? describeModelDifference(approvedModel, model)
            .split("; ")
            .filter((entry) => entry.length > 0 && entry !== "the canonical model hash changed")
            .map((entry) => ({ field: entry, approved: null, candidate: null }))
        : [],
    };
  });

  const review: MechanicsReviewBody = {
    buildId: prepared.resolvedBuildId,
    semanticSourceManifest: identities,
    semanticSourceManifestSha256: canonicalSha256(identities as unknown as CanonicalJson),
    evidenceStatus,
    evidenceSha256: evidenceStatus === "VERIFIED" ? evidence.evidenceSha256 : null,
    externalLeafEvidenceSha256: prepared.externalLeafEvidenceSha256,
    harnessArtifactSha256: evidence.harnessArtifactSha256,
    fixtureSha256: prepared.contractFixtureSha256,
    closureHashes: {
      mechanicsSourceApprovalSha256: prepared.mechanicsSourceApprovalSha256,
      approvalGateSha256: prepared.approvalGateSha256,
      derivationExecutorSha256: prepared.derivationExecutorSha256,
      probeExecutorSha256: prepared.probeExecutorSha256,
      probeRuntimeSha256: prepared.probeRuntimeSha256,
      inspectorSha256: prepared.inspectorSha256,
    },
    codexKeys: contract.codexKeys.map((entry) => ({ ...entry })),
    probeContracts: publicProbeContracts(),
    documents: reviewDocuments,
    endgame: {
      sections: (endgame?.sections ?? []).map((section) => ({
        id: section.id,
        title: section.title.text,
        bullets: section.bullets.map((bullet) => bullet.text),
      })),
    },
  };

  return {
    version: 1,
    pathManifest: prepared.workspaceSourceManifest.slice(0, 0),
    bundleFilenames: {
      indexHtml: prepared.bundleFingerprints.indexHtml.filename,
      index: prepared.bundleFingerprints.index.filename,
      gameView: prepared.bundleFingerprints.gameView.filename,
    },
    review,
    reviewSha256: canonicalSha256(review as unknown as CanonicalJson),
  };
}

/**
 * Rerun every locator, slice, closure, derivation, formatter, and map through production APIs.
 * Compare the result with the review artifact and reviewed fixture.
 *
 * This automated provenance gate checks byte binding, repeatability, and contract agreement.
 * It does not claim a separate implementation.
 * It cannot rule out a defect shared by contract and extractor.
 * Manual inspection remains the semantic review.
 */
export function validateMechanicsProof(input: {
  prepared: PreparedMechanicsInputs;
  documents: readonly MechanicDocument[];
  reviewBytes: Uint8Array;
  attestationSha256: string;
  now: Date;
  lock: MechanicsLock | null;
}): MechanicsProof {
  const artifact = parseMechanicsReviewArtifact(input.reviewBytes);
  const rebuilt = buildMechanicsReviewArtifact({
    prepared: input.prepared,
    documents: input.documents,
    lock: input.lock,
    now: input.now,
  });

  const failures: string[] = [];
  if (rebuilt.review.semanticSourceManifestSha256 !== artifact.review.semanticSourceManifestSha256) {
    failures.push("the semantic source manifest differs from the review artifact");
  }
  if (rebuilt.review.fixtureSha256 !== artifact.review.fixtureSha256) {
    failures.push("the contract fixture differs from the review artifact");
  }
  if (rebuilt.review.evidenceSha256 !== artifact.review.evidenceSha256) {
    failures.push("the evidence hash differs from the review artifact");
  }
  if (rebuilt.reviewSha256 !== artifact.reviewSha256) {
    failures.push(
      `the reconstructed review hashes to ${rebuilt.reviewSha256}, the artifact records ${artifact.reviewSha256}`,
    );
  }
  if (artifact.review.evidenceStatus !== "VERIFIED") {
    failures.push(`the review artifact records evidence ${artifact.review.evidenceStatus}, which cannot authorize a proof`);
  }
  if (artifact.review.buildId === null) {
    failures.push("the review artifact has no resolved build id");
  }
  if (failures.length > 0) {
    throw new Error(`the mechanics proof gate failed\n${failures.join("\n")}`);
  }

  const traces = input.documents
    .flatMap((document) => document.derivations.map((derivation) => derivation.executionTraceSha256))
    .sort();
  const body = {
    version: 1 as const,
    reviewSha256: artifact.reviewSha256,
    semanticSourceManifestSha256: rebuilt.review.semanticSourceManifestSha256,
    evidenceSha256: rebuilt.review.evidenceSha256!,
    contractFixtureSha256: rebuilt.review.fixtureSha256,
    inspectAttestationSha256: input.attestationSha256,
    executionTraceSha256s: traces,
  };
  return { ...body, proofSha256: canonicalSha256(body as unknown as CanonicalJson) };
}


/* Sync */

export type SyncOutcome = { lock: MechanicsLock; bytes: Uint8Array; reviewSha256: string };

/**
 * Replace the lock after a reviewed change, or refresh it for exact-equivalent input.
 *
 * Two exact-equivalent cases need no review hash.
 * A new build keeps the same semantic inputs.
 * A regenerated report keeps the same normalized results.
 * Any other change needs `--reviewed`.
 * The argument must equal the artifact hash rebuilt from the caller's prepared inputs.
 */
export function syncMechanicsLock(input: {
  prepared: PreparedMechanicsInputs;
  documents: readonly MechanicDocument[];
  proof: MechanicsProof;
  reviewedSha256: string | null;
  bootstrap: boolean;
  recoverCorrupt: boolean;
  now: Date;
  commit: (bytes: Uint8Array) => void;
}): SyncOutcome {
  const { prepared } = input;
  const existingBytes = prepared.lockBytes;
  if (input.bootstrap && existingBytes) {
    throw new Error("--bootstrap creates the first lock only; a lock already exists");
  }
  if (!input.bootstrap && !existingBytes && !input.recoverCorrupt) {
    throw new Error("no lock exists. Use --bootstrap to create the first one.");
  }

  let approved: MechanicsLock | null = null;
  let corrupt = false;
  if (existingBytes) {
    try {
      approved = parseMechanicsLock(existingBytes);
    } catch (error) {
      corrupt = true;
      if (!input.recoverCorrupt) throw error;
      void error;
    }
  }
  if (input.recoverCorrupt) {
    if (!existingBytes) throw new Error("--recover-corrupt requires an existing lock");
    if (!corrupt) throw new Error("--recover-corrupt refuses a valid lock");
  }

  if (prepared.resolvedBuildId === null) {
    throw new Error("sync requires the installed build id, and the Steam manifest is unavailable");
  }
  const evidence = normalizeEvidence(prepared.evidenceBytes, prepared.resolvedBuildId, input.now);
  if (evidence.status !== "VERIFIED") {
    throw new Error(`sync requires verified evidence, found ${evidence.status}: ${evidence.detail}`);
  }
  if (prepared.externalLeafEvidenceSha256 === null) {
    throw new Error("sync requires the external leaf aggregate beside the runtime evidence");
  }
  if (evidence.probeRuntimeSha256 !== prepared.probeRuntimeSha256) {
    throw new Error(
      `the evidence records probeRuntimeSha256 ${String(evidence.probeRuntimeSha256)}, this tree has ${prepared.probeRuntimeSha256}`,
    );
  }
  if (evidence.mechanicsSourceApprovalSha256 !== prepared.mechanicsSourceApprovalSha256) {
    throw new Error("the evidence was produced against a different source approval");
  }
  assertEvidenceBindsBundles(evidence, prepared);
  assertRequiredProbesPass(input.documents, evidence.normalizedResults, prepared);

  const rebuilt = buildMechanicsReviewArtifact({
    prepared,
    documents: input.documents,
    lock: approved,
    now: input.now,
  });
  const proofFailures: string[] = [];
  if (input.proof.reviewSha256 !== rebuilt.reviewSha256) {
    proofFailures.push(`the proof names review ${input.proof.reviewSha256}, this tree reconstructs ${rebuilt.reviewSha256}`);
  }
  if (input.proof.semanticSourceManifestSha256 !== rebuilt.review.semanticSourceManifestSha256) {
    proofFailures.push("the proof names a different semantic source manifest");
  }
  if (input.proof.evidenceSha256 !== rebuilt.review.evidenceSha256) {
    proofFailures.push("the proof names a different evidence hash");
  }
  if (input.proof.contractFixtureSha256 !== prepared.contractFixtureSha256) {
    proofFailures.push("the proof names a different contract fixture");
  }
  const traces = input.documents
    .flatMap((document) => document.derivations.map((derivation) => derivation.executionTraceSha256))
    .sort();
  if (input.proof.executionTraceSha256s.join("|") !== traces.join("|")) {
    proofFailures.push("the proof names different execution traces");
  }
  if (proofFailures.length > 0) throw new Error(`the proof does not describe this tree\n${proofFailures.join("\n")}`);

  const documents: Record<string, MechanicsLockDocument> = {};
  for (const document of input.documents) {
    const model: MechanicLockedModel = {
      ...document,
      derivationExecutorSha256: prepared.derivationExecutorSha256,
      mechanicsSourceApprovalSha256: prepared.mechanicsSourceApprovalSha256,
    };
    documents[document.id] = {
      modelSha256: lockedModelSha256(model),
      verifiedProbes: verifiedProbesFor(model, evidence.normalizedResults),
      model,
    };
  }

  const snapshot: MechanicsLockSnapshot = {
    buildId: prepared.resolvedBuildId,
    bundles: {
      indexHtml: { ...prepared.bundleFingerprints.indexHtml },
      index: { ...prepared.bundleFingerprints.index },
      gameView: { ...prepared.bundleFingerprints.gameView },
    },
    evidenceRanAt: evidence.ranAt!,
    evidenceSha256: evidence.evidenceSha256!,
    externalLeafEvidenceSha256: prepared.externalLeafEvidenceSha256,
    normalizedProbeResults: evidence.normalizedResults,
    normalizedProbeResultsSha256: canonicalSha256(evidence.normalizedResults as unknown as CanonicalJson),
    mechanicsSourceApprovalSha256: prepared.mechanicsSourceApprovalSha256,
    approvalGateSha256: prepared.approvalGateSha256,
    derivationExecutorSha256: prepared.derivationExecutorSha256,
    probeExecutorSha256: prepared.probeExecutorSha256,
    probeRuntimeSha256: prepared.probeRuntimeSha256,
    inspectorSha256: prepared.inspectorSha256,
    contractFixtureSha256: prepared.contractFixtureSha256,
  };
  const lock: MechanicsLock = { version: 1, snapshot, documents };

  const exception = approved ? classifyRefresh(approved, lock) : null;
  if (input.reviewedSha256 === null) {
    if (!approved) {
      throw new Error("creating the first lock requires --reviewed <reviewSha256> and --bootstrap");
    }
    if (exception === null) {
      throw new Error(
        "this change alters a model, target, locator, dependency, contract, or normalized result, so it requires --reviewed <reviewSha256>",
      );
    }
  } else if (input.reviewedSha256 !== rebuilt.reviewSha256) {
    throw new Error(
      `--reviewed names ${input.reviewedSha256}, but this tree reconstructs review ${rebuilt.reviewSha256}`,
    );
  }

  const bytes = serializeMechanicsLock(lock);
  input.commit(bytes);
  return { lock, bytes, reviewSha256: rebuilt.reviewSha256 };
}

/**
 * State whether a sync is an exact-equivalent refresh that needs no new review.
 *
 * A build-only refresh keeps every model, target, locator, dependency, and contract identical.
 * An evidence-time refresh also keeps every bundle identity and normalized result identical.
 * Only the report timestamp changes in that case.
 * Any other change needs review.
 */
function classifyRefresh(approved: MechanicsLock, candidate: MechanicsLock): "build" | "evidence-time" | null {
  for (const id of MECHANIC_DOCUMENT_IDS) {
    const before = approved.documents[id];
    const after = candidate.documents[id];
    if (!before || !after) return null;
    if (before.modelSha256 !== after.modelSha256) return null;
  }
  for (const field of [
    "mechanicsSourceApprovalSha256",
    "approvalGateSha256",
    "derivationExecutorSha256",
    "probeExecutorSha256",
    "probeRuntimeSha256",
    "inspectorSha256",
    "contractFixtureSha256",
  ] as const) {
    if (approved.snapshot[field] !== candidate.snapshot[field]) return null;
  }
  const sameBundles = BUNDLE_ROLES.every(
    (role) =>
      approved.snapshot.bundles[role].sha256 === candidate.snapshot.bundles[role].sha256 &&
      approved.snapshot.bundles[role].bytes === candidate.snapshot.bundles[role].bytes,
  );
  const sameResults =
    approved.snapshot.normalizedProbeResultsSha256 === candidate.snapshot.normalizedProbeResultsSha256;
  if (sameBundles && sameResults) return "evidence-time";
  if (!sameBundles && sameResults) return "build";
  return null;
}

function assertEvidenceBindsBundles(evidence: NormalizedEvidence, prepared: PreparedMechanicsInputs): void {
  const failures: string[] = [];
  for (const side of ["extractedBundles", "runtimeBundles"] as const) {
    const identities = evidence[side];
    if (!identities) {
      failures.push(`the evidence has no ${side}`);
      continue;
    }
    for (const identity of identities) {
      const current = prepared.bundleFingerprints[identity.role];
      if (identity.sha256 !== current.sha256 || identity.bytes !== current.bytes) {
        failures.push(`the evidence ${side} ${identity.role} does not match the prepared bytes`);
      }
    }
  }
  if (failures.length > 0) throw new Error(failures.join("\n"));
}

/**
 * Each required tuple occurs once with PASS from the correct resolver, role, and module.
 *
 * Defense uses a different path on purpose.
 * Its clean response participates in bundle parity.
 * Its bound module is the served bytes.
 * Those bytes must equal the clean extracted index plus the canonical bridge suffix.
 * This distinction prevents promotion of its claims.
 */
function assertRequiredProbesPass(
  documents: readonly MechanicDocument[],
  results: readonly NormalizedProbeResult[],
  prepared: PreparedMechanicsInputs,
): void {
  const failures: string[] = [];
  const required = new Map<string, MechanicProbeRef>();
  for (const document of documents) {
    for (const ref of requiredProbes(document)) {
      required.set(`${ref.suite}\u0000${ref.id}\u0000${ref.category ?? ""}\u0000${ref.contractSha256}`, ref);
    }
  }
  for (const ref of required.values()) {
    const matches = results.filter(
      (result) =>
        result.suite === ref.suite &&
        result.id === ref.id &&
        (result.category ?? null) === (ref.category ?? null),
    );
    if (matches.length !== 1) {
      failures.push(`probe ${ref.suite}/${ref.id} occurs ${matches.length} times, expected exactly once`);
      continue;
    }
    const result = matches[0]!;
    if (result.status !== "PASS") {
      failures.push(`probe ${ref.suite}/${ref.id} is ${result.status}`);
      continue;
    }
    if (result.contractSha256 !== ref.contractSha256) {
      failures.push(`probe ${ref.suite}/${ref.id} records a different contract hash`);
      continue;
    }
    const contract = probeContract(ref.suite, ref.id);
    if (!contract) {
      failures.push(`probe ${ref.suite}/${ref.id} names no reviewed contract`);
      continue;
    }
    if (result.resolver !== contract.resolver) {
      failures.push(`probe ${ref.id} used the ${String(result.resolver)} resolver, expected ${contract.resolver}`);
    }
    if (result.bundle !== contract.bundle) {
      failures.push(`probe ${ref.id} bound the ${String(result.bundle)} role, expected ${contract.bundle}`);
    }
    if (!sameCaseGrid(contract.cases, result.cases)) {
      failures.push(`probe ${ref.id} case grid does not match the reviewed contract`);
    }
    if (contract.bridgeSuffix === null) {
      if (result.invocationBinding !== bindingToken(contract.bundle)) {
        failures.push(`probe ${ref.id} has no captured invocation binding for the ${contract.bundle} role`);
      }
      if (result.boundModuleSha256 !== prepared.bundleFingerprints[contract.bundle].sha256) {
        failures.push(`probe ${ref.id} bound a module that is not the extracted ${contract.bundle} bytes`);
      }
      continue;
    }
    const suffixBytes = new TextEncoder().encode(contract.bridgeSuffix);
    if (result.bridgeSuffixSha256 !== sha256Hex(suffixBytes)) {
      failures.push(`probe ${ref.id} records a bridge suffix that is not the canonical one`);
    }
    if (result.cleanModuleSha256 !== prepared.bundleFingerprints[contract.bundle].sha256) {
      failures.push(`probe ${ref.id} clean module is not the extracted ${contract.bundle} bytes`);
    }
    if (result.boundModuleSha256 !== result.servedResourceSha256) {
      failures.push(`probe ${ref.id} bound module does not equal the served response`);
    }
  }
  if (failures.length > 0) throw new Error(`live evidence does not satisfy the obligations\n${failures.join("\n")}`);
}

/**
 * Replace a corrupt lock, and only a corrupt lock.
 *
 * Show the prior hash so version control can recover the previous file.
 * Never publish in the same invocation.
 * Repair and release are different decisions.
 */
export function recoverMechanicsLock(input: {
  prepared: PreparedMechanicsInputs;
  documents: readonly MechanicDocument[];
  proof: MechanicsProof;
  reviewedSha256: string;
  now: Date;
  commit: (bytes: Uint8Array) => void;
}): { outcome: SyncOutcome; priorSha256: string } {
  if (!input.prepared.lockBytes) throw new Error("--recover-corrupt requires an existing lock");
  const priorSha256 = sha256Hex(input.prepared.lockBytes);
  const outcome = syncMechanicsLock({
    prepared: input.prepared,
    documents: input.documents,
    proof: input.proof,
    reviewedSha256: input.reviewedSha256,
    bootstrap: false,
    recoverCorrupt: true,
    now: input.now,
    commit: input.commit,
  });
  return { outcome, priorSha256 };
}
