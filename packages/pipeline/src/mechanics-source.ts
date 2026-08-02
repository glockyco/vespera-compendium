/**
 * The reviewed source-closure approval.
 *
 * `mechanics.lock.json` records the data that a person approved.
 * This file records the code used to approve that data.
 * Both are needed.
 * A changed extractor can produce equal-looking output by different reasoning.
 * A changed gate can approve data that the old gate rejected.
 *
 * Five closures are tracked.
 * Four have a constant in `packages/core/src/execution-source-hashes/`.
 * Sync requires the fresh candidate, that constant, and this approval to agree.
 * Editing a constant alone cannot pass the gate.
 * The inspector has no constant because it is the trust root for review artifacts.
 * Its approved value lives here and needs explicit rotation.
 *
 * Two narrow exceptions use operator trust, not proof.
 * Bootstrap creates the first approval after a full manual review because no earlier approval exists.
 * Gate rotation updates the gate field when the gate closure changes.
 * A gate cannot authorize its own change without a fixed point.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  canonicalJson,
  canonicalSha256,
  diffSourceClosures,
  EXECUTION_SOURCE_SELF_TOKENS,
  hashSourceClosure,
  sha256Hex,
  SOURCE_CLOSURE_DECLARED_LEAVES,
  SOURCE_CLOSURE_ORDER,
  SOURCE_CLOSURE_ROOTS,
  withoutMember,
  type CanonicalJson,
  type ClosureFieldDiff,
  type SourceClosure,
  type SourceClosureName,
} from "@vespera/core";

/** The five approved hashes in the fixed field order used by the approval file. */
export type SourceApprovalHashes = {
  inspector: string;
  approvalGate: string;
  derivation: string;
  probeExecutor: string;
  runtime: string;
};

/** One stored closure. The hash is beside the hashed content, not inside it. */
export type StoredClosure = {
  sha256: string;
  modules: SourceClosure["modules"];
  entries: SourceClosure["entries"];
  externalTokens: string[];
  selfTokens: string[];
  packageLeaves: SourceClosure["packageLeaves"];
};

export type MechanicsSourceApproval = {
  version: 1;
  inspector: StoredClosure;
  approvalGate: StoredClosure;
  derivation: StoredClosure;
  probeExecutor: StoredClosure;
  runtime: StoredClosure;
  approvalSha256: string;
};

export type ReadApproval = {
  bytes: Uint8Array;
  approval: MechanicsSourceApproval;
  approvalSha256: string;
  hashes: SourceApprovalHashes;
};

const APPROVAL_FIELDS = ["inspector", "approvalGate", "derivation", "probeExecutor", "runtime"] as const;

function storedClosure(closure: SourceClosure): StoredClosure {
  return {
    sha256: closure.sha256,
    modules: closure.modules,
    entries: closure.entries,
    externalTokens: closure.externalTokens,
    selfTokens: closure.selfTokens,
    packageLeaves: closure.packageLeaves,
  };
}

/**
 * The exact hash preimage of the approval file.
 *
 * Readers reject unknown structural fields and recompute this projection.
 * A future writer cannot add a field without hashing it.
 */
export function approvalPreimage(approval: MechanicsSourceApproval): CanonicalJson {
  return withoutMember(
    {
      version: approval.version,
      inspector: approval.inspector as unknown as CanonicalJson,
      approvalGate: approval.approvalGate as unknown as CanonicalJson,
      derivation: approval.derivation as unknown as CanonicalJson,
      probeExecutor: approval.probeExecutor as unknown as CanonicalJson,
      runtime: approval.runtime as unknown as CanonicalJson,
      approvalSha256: approval.approvalSha256,
    },
    "approvalSha256",
  );
}

function asRecord(value: unknown, detail: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`expected a JSON object: ${detail}`);
  }
  return value as Record<string, unknown>;
}

function parseStoredClosure(value: unknown, field: string): StoredClosure {
  const record = asRecord(value, `${field} closure`);
  const allowed = new Set(["sha256", "modules", "entries", "externalTokens", "selfTokens", "packageLeaves"]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new Error(`the ${field} closure has the unknown field ${key}`);
  }
  if (typeof record.sha256 !== "string") throw new Error(`the ${field} closure has no sha256`);
  return record as unknown as StoredClosure;
}

/** Parse and check the approval file, or throw with the exact recovery path. */
export function readMechanicsSourceApproval(file: string): ReadApproval {
  const resolved = path.resolve(file);
  if (!existsSync(resolved)) {
    throw new Error(
      `no reviewed source approval at ${resolved}. Produce the five review artifacts, review every slice, ` +
        "then run mechanics-sources:bootstrap.",
    );
  }
  const bytes = readApprovalBytes(resolved);
  const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  const record = asRecord(parsed, resolved);
  const allowed = new Set<string>([...APPROVAL_FIELDS, "version", "approvalSha256"]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new Error(`${resolved} has the unknown field ${key}`);
  }
  if (record.version !== 1) throw new Error(`${resolved} must be version 1`);
  if (typeof record.approvalSha256 !== "string") throw new Error(`${resolved} has no approvalSha256`);
  const approval: MechanicsSourceApproval = {
    version: 1,
    inspector: parseStoredClosure(record.inspector, "inspector"),
    approvalGate: parseStoredClosure(record.approvalGate, "approvalGate"),
    derivation: parseStoredClosure(record.derivation, "derivation"),
    probeExecutor: parseStoredClosure(record.probeExecutor, "probeExecutor"),
    runtime: parseStoredClosure(record.runtime, "runtime"),
    approvalSha256: record.approvalSha256,
  };
  const recomputed = canonicalSha256(approvalPreimage(approval));
  if (recomputed !== approval.approvalSha256) {
    throw new Error(
      `${resolved} is corrupt: it records approvalSha256 ${approval.approvalSha256} but hashes to ${recomputed}`,
    );
  }
  return {
    bytes,
    approval,
    approvalSha256: approval.approvalSha256,
    hashes: {
      inspector: approval.inspector.sha256,
      approvalGate: approval.approvalGate.sha256,
      derivation: approval.derivation.sha256,
      probeExecutor: approval.probeExecutor.sha256,
      runtime: approval.runtime.sha256,
    },
  };
}

/**
 * Read approval bytes directly, not through the stable-file helper.
 *
 * `inputs.ts` imports this module, so importing it here creates a cycle.
 * Each caller hashes the bytes it received and compares that hash.
 * A concurrent write then appears as a mismatch, not a silent partial read.
 */
function readApprovalBytes(file: string): Uint8Array {
  return new Uint8Array(readFileSync(file));
}

export type ComputedClosures = {
  closures: Record<SourceClosureName, SourceClosure>;
  hashes: SourceApprovalHashes;
};

const closureCache = new Map<string, ComputedClosures>();

/**
 * Compute all five candidate closures for a working tree.
 *
 * Cache results by workspace root.
 * One command prepares once, and several checks compare the same candidates.
 * Each closure builds its own TypeScript program.
 */
export function computeSourceClosures(workspaceRoot: string): ComputedClosures {
  const root = path.resolve(workspaceRoot);
  const cached = closureCache.get(root);
  if (cached) return cached;
  const closures = {} as Record<SourceClosureName, SourceClosure>;
  for (const name of SOURCE_CLOSURE_ORDER) {
    closures[name] = hashSourceClosure(root, SOURCE_CLOSURE_ROOTS[name], {
      closure: name,
      selfTokens: EXECUTION_SOURCE_SELF_TOKENS,
      declaredLeafTokens: SOURCE_CLOSURE_DECLARED_LEAVES[name],
    });
  }
  const computed: ComputedClosures = {
    closures,
    hashes: {
      inspector: closures.inspector.sha256,
      approvalGate: closures.approvalGate.sha256,
      derivation: closures.derivation.sha256,
      probeExecutor: closures.probeExecutor.sha256,
      runtime: closures.runtime.sha256,
    },
  };
  closureCache.set(root, computed);
  return computed;
}

/* Review artifacts */

export type SourceReviewArtifact = {
  version: 1;
  closure: SourceClosureName;
  approvedSha256: string;
  candidateSha256: string;
  approved: StoredClosure | null;
  candidate: StoredClosure;
  diff: ClosureFieldDiff[];
  reviewSha256: string;
};

/**
 * Build one closure's review artifact.
 *
 * The hash covers the prior approval, fresh candidate, and field diff.
 * It excludes tracked constant values and its own hash.
 * This is deliberate.
 * A reviewer approves a change in code.
 * Editing the constant to the reviewed candidate must not invalidate that review.
 */
export function buildSourceReviewArtifact(
  closureName: SourceClosureName,
  approved: StoredClosure | null,
  candidate: SourceClosure,
): SourceReviewArtifact {
  const stored = storedClosure(candidate);
  const artifact = {
    version: 1 as const,
    closure: closureName,
    approvedSha256: approved?.sha256 ?? "ABSENT",
    candidateSha256: candidate.sha256,
    approved,
    candidate: stored,
    diff: diffSourceClosures(approved, candidate),
  };
  return { ...artifact, reviewSha256: canonicalSha256(artifact as unknown as CanonicalJson) };
}

/** Parse and check one review artifact. */
export function parseSourceReviewArtifact(bytes: Uint8Array): SourceReviewArtifact {
  const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  const record = asRecord(parsed, "source review artifact");
  if (record.version !== 1) throw new Error("a source review artifact must be version 1");
  if (typeof record.reviewSha256 !== "string") throw new Error("a source review artifact has no reviewSha256");
  const artifact = record as unknown as SourceReviewArtifact;
  const recomputed = canonicalSha256(withoutMember(record, "reviewSha256"));
  if (recomputed !== artifact.reviewSha256) {
    throw new Error(
      `the ${artifact.closure} review artifact records reviewSha256 ${artifact.reviewSha256} but hashes to ${recomputed}`,
    );
  }
  return artifact;
}

/** Canonical bytes of a review artifact. Writer and reader use the same bytes. */
export function serializeReviewArtifact(artifact: SourceReviewArtifact): Uint8Array {
  return new TextEncoder().encode(`${canonicalJson(artifact as unknown as CanonicalJson)}\n`);
}

export type InspectAttestation = {
  version: 1;
  kind: "mechanics-review" | "mechanics-source-reviews";
  reviewSha256s: string[];
  fixtureSha256: string | null;
  inspectToolSha256: string;
  inspectedAt: string;
  attestationSha256: string;
};

/** Parse and check an attestation receipt. */
export function parseInspectAttestation(bytes: Uint8Array): InspectAttestation {
  const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  const record = asRecord(parsed, "inspect attestation");
  if (record.version !== 1) throw new Error("an inspect attestation must be version 1");
  if (typeof record.attestationSha256 !== "string") {
    throw new Error("an inspect attestation has no attestationSha256");
  }
  const attestation = record as unknown as InspectAttestation;
  const recomputed = canonicalSha256(withoutMember(record, "attestationSha256"));
  if (recomputed !== attestation.attestationSha256) {
    throw new Error(
      `the inspect attestation records ${attestation.attestationSha256} but hashes to ${recomputed}`,
    );
  }
  return attestation;
}

/* Writers */

export type SourceApprovalWriteResult = {
  approvalSha256: string;
  hashes: SourceApprovalHashes;
  bytes: Uint8Array;
};

function buildApproval(
  closures: Record<SourceClosureName, SourceClosure>,
  overrides: Partial<Record<SourceClosureName, StoredClosure>> = {},
): MechanicsSourceApproval {
  const pick = (name: SourceClosureName): StoredClosure => overrides[name] ?? storedClosure(closures[name]);
  const approval: MechanicsSourceApproval = {
    version: 1,
    inspector: pick("inspector"),
    approvalGate: pick("approvalGate"),
    derivation: pick("derivation"),
    probeExecutor: pick("probeExecutor"),
    runtime: pick("runtime"),
    approvalSha256: "",
  };
  approval.approvalSha256 = canonicalSha256(approvalPreimage(approval));
  return approval;
}

/** Canonical bytes of the approval file. */
export function serializeApproval(approval: MechanicsSourceApproval): Uint8Array {
  return new TextEncoder().encode(`${canonicalJson(approval as unknown as CanonicalJson)}\n`);
}

export type ReviewedHashes = Record<SourceClosureName, string>;

/**
 * Check that each prepared review artifact matches fresh candidates and the operator's `--reviewed` hashes.
 *
 * Reviewed hashes alone prove nothing.
 * The same command prints the hashes and creates the artifact.
 * They show that the operator read this diff, not another diff.
 * The artifact bytes are therefore also required.
 */
export function validateSourceReviews(
  reviews: Record<SourceClosureName, SourceReviewArtifact>,
  reviewed: ReviewedHashes,
  candidates: ComputedClosures,
  approvedHashes: SourceApprovalHashes | null,
  options: { allowCandidateMismatch?: SourceClosureName[] } = {},
): void {
  const allowMismatch = new Set(options.allowCandidateMismatch ?? []);
  const failures: string[] = [];
  for (const name of SOURCE_CLOSURE_ORDER) {
    const review = reviews[name];
    if (review.closure !== name) {
      failures.push(`the ${name} review artifact is for the ${review.closure} closure`);
      continue;
    }
    if (review.reviewSha256 !== reviewed[name]) {
      failures.push(
        `the ${name} review hash is ${review.reviewSha256}, but --reviewed names ${reviewed[name]}`,
      );
    }
    if (!allowMismatch.has(name) && review.candidateSha256 !== candidates.hashes[name]) {
      failures.push(
        `the ${name} review describes candidate ${review.candidateSha256}, but this tree hashes to ${candidates.hashes[name]}`,
      );
    }
    const expectedApproved = approvedHashes ? approvedHashes[name] : "ABSENT";
    if (review.approvedSha256 !== expectedApproved) {
      failures.push(
        `the ${name} review was produced against approval ${review.approvedSha256}, but the current approval is ${expectedApproved}`,
      );
    }
  }
  if (failures.length > 0) throw new Error(`source review validation failed\n${failures.join("\n")}`);
}

export type ApprovalCommit = (bytes: Uint8Array) => void;

/**
 * Create the first approval.
 *
 * This command can write without an earlier approval.
 * All five diffs must be against `ABSENT`.
 * The four constants must equal the candidates.
 * The command must hold the exclusive mechanics-source lease.
 * No attestation can precede the inspector trust root, so none is required here.
 * This is operator trust, not proof.
 */
export function bootstrapMechanicsSourceApproval(input: {
  approvalPath: string;
  reviews: Record<SourceClosureName, SourceReviewArtifact>;
  reviewed: ReviewedHashes;
  candidates: ComputedClosures;
  constants: Omit<SourceApprovalHashes, "inspector">;
  commit: ApprovalCommit;
}): SourceApprovalWriteResult {
  if (existsSync(path.resolve(input.approvalPath))) {
    throw new Error(
      `${input.approvalPath} already exists. Bootstrap creates the first approval only; use mechanics-sources:sync.`,
    );
  }
  validateSourceReviews(input.reviews, input.reviewed, input.candidates, null);
  assertConstantsMatchCandidates(input.constants, input.candidates.hashes);
  const approval = buildApproval(input.candidates.closures);
  const bytes = serializeApproval(approval);
  input.commit(bytes);
  return { approvalSha256: approval.approvalSha256, hashes: candidateHashes(input.candidates), bytes };
}

/**
 * Replace the approval after a reviewed change.
 *
 * This is the only sync path.
 * It reruns every assertion on prepared review artifacts and the attestation.
 * Skipping the inspect command cannot bypass machine checks.
 * It rejects a missing or malformed receipt.
 * It does not authenticate operator attention.
 * Semantic review remains a human responsibility.
 */
export function syncMechanicsSourceApproval(input: {
  approvalPath: string;
  reviews: Record<SourceClosureName, SourceReviewArtifact>;
  reviewed: ReviewedHashes;
  attestation: InspectAttestation;
  candidates: ComputedClosures;
  constants: Omit<SourceApprovalHashes, "inspector">;
  approvedHashes: SourceApprovalHashes;
  commit: ApprovalCommit;
}): SourceApprovalWriteResult {
  if (input.attestation.kind !== "mechanics-source-reviews") {
    throw new Error(`the attestation is a ${input.attestation.kind} receipt, not a source-review receipt`);
  }
  if (input.attestation.inspectToolSha256 !== input.approvedHashes.inspector) {
    throw new Error(
      `the attestation was produced by inspector ${input.attestation.inspectToolSha256}, but the approved inspector is ${input.approvedHashes.inspector}`,
    );
  }
  const expected = SOURCE_CLOSURE_ORDER.map((name) => input.reviews[name].reviewSha256).sort();
  const attested = [...input.attestation.reviewSha256s].sort();
  if (expected.join("|") !== attested.join("|")) {
    throw new Error("the attestation does not cover exactly these five review artifacts");
  }
  validateSourceReviews(input.reviews, input.reviewed, input.candidates, input.approvedHashes);
  assertConstantsMatchCandidates(input.constants, input.candidates.hashes);
  const approval = buildApproval(input.candidates.closures);
  const bytes = serializeApproval(approval);
  input.commit(bytes);
  return { approvalSha256: approval.approvalSha256, hashes: candidateHashes(input.candidates), bytes };
}

/**
 * Update only the inspector field.
 *
 * The inspector shows artifacts that every other review uses.
 * A change to it first fails normal inspect and sync commands.
 * This command is the explicit path through that change.
 * It can write only the inspector closure and the new top-level hash.
 */
export function rotateInspectorApproval(input: {
  reviews: Record<SourceClosureName, SourceReviewArtifact>;
  reviewedInspectorSha256: string;
  candidates: ComputedClosures;
  approval: MechanicsSourceApproval;
  commit: ApprovalCommit;
}): SourceApprovalWriteResult {
  return rotateOneField("inspector", {
    review: input.reviews.inspector,
    reviewedSha256: input.reviewedInspectorSha256,
    candidates: input.candidates,
    approval: input.approval,
    commit: input.commit,
  });
}

/**
 * Update only the approval-gate field.
 *
 * When the gate closure changes, the old gate cannot authorize the new one.
 * No fixed point exists for that change.
 * This command bypasses only that equality check while holding the source lease.
 * Generic source hashing still checks candidate and review hashes.
 * The writer can touch only `approvalGate` and the top-level hash.
 */
export function rotateGateApproval(input: {
  reviews: Record<SourceClosureName, SourceReviewArtifact>;
  reviewedGateSha256: string;
  candidates: ComputedClosures;
  approval: MechanicsSourceApproval;
  commit: ApprovalCommit;
}): SourceApprovalWriteResult {
  return rotateOneField("approvalGate", {
    review: input.reviews.approvalGate,
    reviewedSha256: input.reviewedGateSha256,
    candidates: input.candidates,
    approval: input.approval,
    commit: input.commit,
  });
}

function rotateOneField(
  field: "inspector" | "approvalGate",
  input: {
    review: SourceReviewArtifact;
    reviewedSha256: string;
    candidates: ComputedClosures;
    approval: MechanicsSourceApproval;
    commit: ApprovalCommit;
  },
): SourceApprovalWriteResult {
  const review = input.review;
  if (review.closure !== field) {
    throw new Error(`the review artifact is for the ${review.closure} closure, not ${field}`);
  }
  if (review.reviewSha256 !== input.reviewedSha256) {
    throw new Error(`the review hash is ${review.reviewSha256}, but --reviewed names ${input.reviewedSha256}`);
  }
  if (review.candidateSha256 !== input.candidates.hashes[field]) {
    throw new Error(
      `the review describes candidate ${review.candidateSha256}, but this tree hashes to ${input.candidates.hashes[field]}`,
    );
  }
  if (review.approvedSha256 !== input.approval[field].sha256) {
    throw new Error(
      `the review was produced against ${field} approval ${review.approvedSha256}, but the current approval is ${input.approval[field].sha256}`,
    );
  }
  const rotated: MechanicsSourceApproval = {
    ...input.approval,
    [field]: storedClosure(input.candidates.closures[field]),
    approvalSha256: "",
  };
  rotated.approvalSha256 = canonicalSha256(approvalPreimage(rotated));
  const bytes = serializeApproval(rotated);
  input.commit(bytes);
  return {
    approvalSha256: rotated.approvalSha256,
    hashes: {
      inspector: rotated.inspector.sha256,
      approvalGate: rotated.approvalGate.sha256,
      derivation: rotated.derivation.sha256,
      probeExecutor: rotated.probeExecutor.sha256,
      runtime: rotated.runtime.sha256,
    },
    bytes,
  };
}

function candidateHashes(candidates: ComputedClosures): SourceApprovalHashes {
  return { ...candidates.hashes };
}

function assertConstantsMatchCandidates(
  constants: Omit<SourceApprovalHashes, "inspector">,
  candidates: SourceApprovalHashes,
): void {
  const failures: string[] = [];
  for (const key of ["approvalGate", "derivation", "probeExecutor", "runtime"] as const) {
    if (constants[key] !== candidates[key]) {
      failures.push(
        `the tracked ${key} constant is ${constants[key]}, but this tree hashes to ${candidates[key]}. ` +
          `Set it to the candidate in packages/core/src/execution-source-hashes/.`,
      );
    }
  }
  if (failures.length > 0) throw new Error(failures.join("\n"));
}

/** Hex of canonical review-artifact bytes for a caller that has only the file. */
export function reviewArtifactSha256(bytes: Uint8Array): string {
  return sha256Hex(bytes);
}
