/**
 * Rendering review artifacts, and the receipts that record which inspector rendered them.
 *
 * This is the trust root of the whole approval chain, which is why it is the one closure with no source
 * constant: a constant here would need the inspector to authorize a change to itself. Instead its
 * approved hash lives in `mechanics-source.lock.json`, and every attestation is accepted only when the
 * inspector that produced it matches that value.
 *
 * An attestation is a public-data integrity receipt. It records which approved inspector rendered which
 * review, and nothing more. It is not a signature, and it does not evidence that a human read anything.
 * The commands say so where they print it, because a receipt that implies more than it proves is worse
 * than no receipt.
 */

import {
  canonicalJson,
  canonicalSha256,
  withoutMember,
  type CanonicalJson,
  type ClosureFieldDiff,
  type SourceClosureName,
} from "@vespera/core";
import { SOURCE_CLOSURE_ORDER } from "@vespera/core";
import type { InspectAttestation, SourceReviewArtifact } from "./mechanics-source.ts";
import {
  parseMechanicsReviewArtifact,
  reconstructReviewHashes,
  type MechanicsReviewArtifact,
} from "./mechanics-artifacts.ts";
import { parseMechanicsContract } from "./mechanics-contract.ts";

export type InspectLine = string;

/**
 * Renders one mechanics review artifact and asserts it against the tracked contract.
 *
 * The assertion runs before any rendering: printing 231 claims and then reporting that the contract
 * disagreed would bury the one fact that matters. Everything printed comes from inside the artifact's own
 * hash preimage, never from a reopened bundle or workspace file, so what a reviewer reads is exactly what
 * the proof will bind.
 */
export function inspectMechanicsReview(input: {
  reviewBytes: Uint8Array;
  contractFixtureBytes: Uint8Array;
}): { lines: InspectLine[]; reviewSha256: string } {
  const artifact = parseMechanicsReviewArtifact(input.reviewBytes);
  const contract = parseMechanicsContract(input.contractFixtureBytes);
  const actual = reconstructReviewHashes(artifact);

  const failures: string[] = [];
  if (artifact.review.fixtureSha256 !== actual.fixtureSha256) {
    failures.push(
      `the artifact records fixture ${artifact.review.fixtureSha256} but its own contents hash to ${actual.fixtureSha256}`,
    );
  }
  const expectedDocumentIds = contract.documentIds.join(",");
  const artifactDocumentIds = artifact.review.documents.map((document) => document.id).join(",");
  if (expectedDocumentIds !== artifactDocumentIds) {
    failures.push(`the artifact documents are [${artifactDocumentIds}], the contract expects [${expectedDocumentIds}]`);
  }
  const expectedCodex = contract.codexKeys.map((entry) => `${entry.key}=${entry.expression ?? ""}`).join("\n");
  const artifactCodex = artifact.review.codexKeys.map((entry) => `${entry.key}=${entry.expression ?? ""}`).join("\n");
  if (expectedCodex !== artifactCodex) failures.push("the artifact codex inventory differs from the contract");
  if (failures.length > 0) {
    throw new Error(`the review artifact does not satisfy the reviewed contract\n${failures.join("\n")}`);
  }

  const lines: InspectLine[] = [];
  lines.push(`Review ${artifact.reviewSha256}`);
  lines.push(`Build ${artifact.review.buildId ?? "unresolved"}`);
  lines.push(`Evidence ${artifact.review.evidenceStatus} ${artifact.review.evidenceSha256 ?? "none"}`);
  lines.push(`External leaf aggregate ${artifact.review.externalLeafEvidenceSha256 ?? "absent"}`);
  lines.push("");
  lines.push("Bundle role identities");
  for (const identity of artifact.review.semanticSourceManifest) {
    lines.push(`  ${identity.role} ${identity.bytes} bytes ${identity.sha256}`);
  }
  lines.push("");
  lines.push(`Codex inventory (${artifact.review.codexKeys.length} keys, in source order)`);
  for (const entry of artifact.review.codexKeys) {
    lines.push(`  ${entry.key}`);
    lines.push(`    label      ${entry.label}`);
    lines.push(`    expression ${entry.expression ?? "(prose only)"}`);
  }

  for (const document of artifact.review.documents) {
    lines.push("");
    lines.push(`Document ${document.id} — model ${document.modelSha256}`);
    for (const claim of document.claims) {
      lines.push(`  ${claim.id} [${claim.kind}] ${claim.verificationHint}`);
      lines.push(`    text ${JSON.stringify(claim.text)}`);
      if (claim.sourceTargetIds.length > 0) lines.push(`    cites ${claim.sourceTargetIds.join(", ")}`);
      for (const probe of claim.requiredProbes) {
        lines.push(
          `    requires ${probe.suite}/${probe.id} category=${probe.category ?? "none"} contract=${probe.contractSha256} promotes=${probe.promotionEligible}`,
        );
      }
    }
    for (const target of document.sourceTargets) {
      lines.push(`  target ${target.id} in ${target.bundle} ${target.sha256}`);
      lines.push(`    locator ${canonicalJson(target.locator)}`);
      for (const slice of target.canonicalSource.split("\n")) lines.push(`    | ${slice}`);
    }
    for (const derivation of document.derivations) {
      lines.push(`  derivation ${derivation.id} via ${derivation.evaluator}`);
      lines.push(`    trace ${derivation.executionTraceSha256} result ${derivation.resultSha256}`);
      for (const call of derivation.calls) {
        lines.push(`    calls ${call.sourceTargetId}(${canonicalJson(call.args)})`);
      }
      for (const output of derivation.outputs) {
        lines.push(
          `    output ${output.id} -> ${output.textId} raw=${canonicalJson(output.rawValue)} shows ${JSON.stringify(output.formattedText)}`,
        );
      }
    }
    for (const diff of document.fieldDiffs) {
      lines.push(`  changed ${diff.field}`);
      lines.push(`    was ${diff.approved ?? "(absent)"}`);
      lines.push(`    now ${diff.candidate ?? "(absent)"}`);
    }
  }

  for (const section of artifact.review.endgame.sections) {
    lines.push("");
    lines.push(`Endgame ${section.id} — ${section.title}`);
    for (const [index, bullet] of section.bullets.entries()) lines.push(`  ${index}. ${bullet}`);
  }

  lines.push("");
  lines.push(`reviewSha256 ${artifact.reviewSha256}`);
  return { lines, reviewSha256: artifact.reviewSha256 };
}

/**
 * Renders all five source-closure review artifacts.
 *
 * Every changed slice is printed in full. A summary would let a one-character change to a hashing helper
 * pass as "the derivation closure moved", which is precisely the kind of change this whole mechanism
 * exists to surface.
 */
export function inspectMechanicsSourceReviews(input: {
  reviews: Record<SourceClosureName, SourceReviewArtifact>;
}): { lines: InspectLine[]; reviewSha256s: string[] } {
  const lines: InspectLine[] = [];
  const reviewSha256s: string[] = [];
  for (const name of SOURCE_CLOSURE_ORDER) {
    const review = input.reviews[name];
    reviewSha256s.push(review.reviewSha256);
    lines.push(`Closure ${name}`);
    lines.push(`  approved  ${review.approvedSha256}`);
    lines.push(`  candidate ${review.candidateSha256}`);
    lines.push(`  review    ${review.reviewSha256}`);
    lines.push(`  roots     ${review.candidate.entries.map((entry) => `${entry.module}#${entry.symbol}`).join(", ")}`);
    lines.push(`  modules   ${Object.keys(review.candidate.modules).length}`);
    lines.push(`  external  ${review.candidate.externalTokens.join(", ") || "none"}`);
    lines.push(`  self      ${review.candidate.selfTokens.join(", ") || "none"}`);
    for (const leaf of review.candidate.packageLeaves) {
      lines.push(
        `  package   ${leaf.name}@${leaf.version} ${leaf.lockResolution} ${leaf.lockIntegrity} inventory=${leaf.inventorySha256} files=${leaf.files.length}`,
      );
    }
    if (review.diff.length === 0) lines.push("  unchanged");
    for (const diff of review.diff) lines.push(...renderDiff(diff));
    lines.push("");
  }
  return { lines, reviewSha256s };
}

function renderDiff(diff: ClosureFieldDiff): InspectLine[] {
  const lines: InspectLine[] = [`  ${diff.kind} ${diff.field}`];
  if (diff.approved !== null) for (const line of diff.approved.split("\n")) lines.push(`    - ${line}`);
  if (diff.candidate !== null) for (const line of diff.candidate.split("\n")) lines.push(`    + ${line}`);
  return lines;
}

/**
 * Writes the attestation receipt for a completed inspection.
 *
 * The hash omits itself, and the receipt records the inspector's own approved hash so a later sync can
 * tell whether the renderer it trusts is the renderer that ran.
 */
export function writeInspectAttestation(input: {
  kind: InspectAttestation["kind"];
  reviewSha256s: readonly string[];
  fixtureSha256: string | null;
  inspectToolSha256: string;
  now: Date;
  commit: (bytes: Uint8Array) => void;
}): InspectAttestation {
  const body = {
    version: 1 as const,
    kind: input.kind,
    reviewSha256s: [...input.reviewSha256s],
    fixtureSha256: input.fixtureSha256,
    inspectToolSha256: input.inspectToolSha256,
    inspectedAt: input.now.toISOString(),
  };
  const attestation: InspectAttestation = {
    ...body,
    attestationSha256: canonicalSha256(body as unknown as CanonicalJson),
  };
  input.commit(new TextEncoder().encode(`${canonicalJson(attestation as unknown as CanonicalJson)}\n`));
  return attestation;
}

/** Recomputes an attestation hash from a parsed receipt, for callers that only hold the object. */
export function attestationSha256(attestation: InspectAttestation): string {
  return canonicalSha256(withoutMember(attestation, "attestationSha256"));
}

export type { InspectAttestation, MechanicsReviewArtifact };
