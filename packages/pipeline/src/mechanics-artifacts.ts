/**
 * The review and proof artifacts, and their parsers.
 *
 * Kept apart from both the extractor and the lock so the inspector closure can render and validate an
 * artifact without reaching the TypeScript compiler. The inspector is the trust root of every other
 * approval, so a change to the extractor must not force it to rotate.
 *
 * Every parser here re-derives the hash the artifact records about itself, and refuses an unknown
 * structural field inside the hashed body. A field a future writer added would otherwise be invisible to
 * every reader that reconstructs the projection.
 */

import {
  canonicalJson,
  canonicalSha256,
  withoutMember,
  type BundleIdentity,
  type BundleRole,
  type CanonicalJson,
  type PublicProbeContract,
} from "@vespera/core";
import type { MechanicProbeRef, MechanicText } from "./mechanics.ts";
import type { EvidenceStatus } from "./mechanics-lock.ts";

function asRecord(value: unknown, detail: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`expected a JSON object: ${detail}`);
  }
  return value as Record<string, unknown>;
}


export type ReviewClaim = {
  id: string;
  kind: MechanicText["evidence"]["kind"];
  text: string;
  sourceTargetIds: string[];
  requiredProbes: MechanicProbeRef[];
  /** What the published page would say for this claim, given the evidence in this artifact. */
  verificationHint: "editorial" | "source-verified" | "live-verified";
};

export type ReviewTarget = {
  id: string;
  bundle: BundleRole;
  locator: CanonicalJson;
  sha256: string;
  canonicalSource: string;
};

export type ReviewDerivation = {
  id: string;
  evaluator: string;
  executionTraceSha256: string;
  resultSha256: string;
  derivationExecutorSha256: string;
  sourceTargetIds: string[];
  bindings: CanonicalJson;
  calls: { sourceTargetId: string; args: CanonicalJson }[];
  outputs: { id: string; textId: string; rawValue: CanonicalJson; format: string; formattedText: string }[];
};

export type ReviewDocument = {
  id: string;
  modelSha256: string;
  claims: ReviewClaim[];
  sourceTargets: ReviewTarget[];
  derivations: ReviewDerivation[];
  claimToTargets: Record<string, string[]>;
  claimToProbes: Record<string, { suite: string; id: string; category: string | null; promotionEligible: boolean }[]>;
  fieldDiffs: { field: string; approved: string | null; candidate: string | null }[];
};

export type MechanicsReviewBody = {
  buildId: string | null;
  semanticSourceManifest: BundleIdentity[];
  semanticSourceManifestSha256: string;
  evidenceStatus: EvidenceStatus;
  evidenceSha256: string | null;
  externalLeafEvidenceSha256: string | null;
  harnessArtifactSha256: string | null;
  fixtureSha256: string;
  closureHashes: {
    mechanicsSourceApprovalSha256: string;
    approvalGateSha256: string;
    derivationExecutorSha256: string;
    probeExecutorSha256: string;
    probeRuntimeSha256: string;
    inspectorSha256: string;
  };
  codexKeys: { key: string; label: string; expression: string | null }[];
  probeContracts: PublicProbeContract[];
  documents: ReviewDocument[];
  endgame: { sections: { id: string; title: string; bullets: string[] }[] };
};

export type MechanicsReviewArtifact = {
  version: 1;
  /** Diagnostic only: filenames and the full path manifest stay outside the hash preimage. */
  pathManifest: { path: string; bytes: number; sha256: string }[];
  bundleFilenames: Record<BundleRole, string>;
  review: MechanicsReviewBody;
  reviewSha256: string;
};

/**
 * Independently derives what a page would claim for one text.
 *
 * The published `verification` field is never consulted here or in the browser suite. Deriving it twice,
 * from the requirements and the results, is the only way the label can be checked rather than trusted.
 */
export function deriveVerificationStatus(
  text: MechanicText,
  passed: readonly MechanicProbeRef[],
): "editorial" | "source-verified" | "live-verified" {
  if (text.evidence.kind === "editorial") return "editorial";
  const required = text.evidence.requiredProbes;
  if (!required.some((ref) => ref.promotionEligible)) return "source-verified";
  const satisfied = required.every((ref) =>
    passed.some(
      (candidate) =>
        candidate.suite === ref.suite &&
        candidate.id === ref.id &&
        (candidate.category ?? null) === (ref.category ?? null) &&
        candidate.contractSha256 === ref.contractSha256,
    ),
  );
  return satisfied ? "live-verified" : "source-verified";
}

/** Canonical bytes of a review artifact. */
export function serializeMechanicsReviewArtifact(artifact: MechanicsReviewArtifact): Uint8Array {
  return new TextEncoder().encode(`${canonicalJson(artifact as unknown as CanonicalJson)}\n`);
}

/**
 * Parses a review artifact and re-derives its own hash.
 *
 * Unknown structural fields inside `review` are refused, because a field a future writer added would
 * otherwise be invisible to every reader that reconstructs the projection.
 */
export function parseMechanicsReviewArtifact(bytes: Uint8Array): MechanicsReviewArtifact {
  const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  const record = asRecord(parsed, "mechanics review artifact");
  if (record.version !== 1) throw new Error("a mechanics review artifact must be version 1");
  if (typeof record.reviewSha256 !== "string") throw new Error("a mechanics review artifact has no reviewSha256");
  const review = asRecord(record.review, "mechanics review body");
  const allowed = new Set<string>([
    "buildId",
    "semanticSourceManifest",
    "semanticSourceManifestSha256",
    "evidenceStatus",
    "evidenceSha256",
    "externalLeafEvidenceSha256",
    "harnessArtifactSha256",
    "fixtureSha256",
    "closureHashes",
    "codexKeys",
    "probeContracts",
    "documents",
    "endgame",
  ]);
  for (const key of Object.keys(review)) {
    if (!allowed.has(key)) throw new Error(`the review body has the unknown field ${key}`);
  }
  const artifact = record as unknown as MechanicsReviewArtifact;
  const recomputed = canonicalSha256(review as unknown as CanonicalJson);
  if (recomputed !== artifact.reviewSha256) {
    throw new Error(
      `the review artifact records reviewSha256 ${artifact.reviewSha256} but its body hashes to ${recomputed}`,
    );
  }
  return artifact;
}

/** Hashes an artifact reconstructed from its own contents, for the assertion inspect performs. */
export function reconstructReviewHashes(artifact: MechanicsReviewArtifact): {
  reviewSha256: string;
  fixtureSha256: string;
} {
  return {
    reviewSha256: canonicalSha256(artifact.review as unknown as CanonicalJson),
    fixtureSha256: artifact.review.fixtureSha256,
  };
}


export type MechanicsProof = {
  version: 1;
  reviewSha256: string;
  semanticSourceManifestSha256: string;
  evidenceSha256: string;
  contractFixtureSha256: string;
  inspectAttestationSha256: string;
  executionTraceSha256s: string[];
  proofSha256: string;
};

/** Parses a proof and re-derives its own hash from exactly the same preimage. */
export function parseMechanicsProof(bytes: Uint8Array): MechanicsProof {
  const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  const record = asRecord(parsed, "mechanics proof");
  if (record.version !== 1) throw new Error("a mechanics proof must be version 1");
  if (typeof record.proofSha256 !== "string") throw new Error("a mechanics proof has no proofSha256");
  const proof = record as unknown as MechanicsProof;
  const recomputed = canonicalSha256(withoutMember(record, "proofSha256"));
  if (recomputed !== proof.proofSha256) {
    throw new Error(`the proof records ${proof.proofSha256} but hashes to ${recomputed}`);
  }
  return proof;
}

/** Canonical bytes of a proof. */
export function serializeMechanicsProof(proof: MechanicsProof): Uint8Array {
  return new TextEncoder().encode(`${canonicalJson(proof as unknown as CanonicalJson)}\n`);
}

