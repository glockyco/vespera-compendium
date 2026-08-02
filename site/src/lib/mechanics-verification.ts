/**
 * Defines what the site can claim about a mechanic and how it checks each claim.
 *
 * Published pages place a provenance label beside each game-supplied sentence.
 * A label is valid only when the page can derive it independently.
 * This module ignores the published `verification` field and derives status from probe requirements.
 * It rejects a document when the published status disagrees.
 *
 * Hashing uses the same canonical bytes as the pipeline.
 * The imported module has no Node dependencies, so the browser bundle gets no build tooling.
 */
import {
  bindingToken,
  bridgedBindingToken,
  canonicalJson,
  canonicalJsonBytes,
  mechanicsApprovalPreimage,
  normalizeRuntimeEvidenceForApproval,
  toHex,
  withoutMember,
} from "../../../packages/core/src/canonical-public-evidence";
import type {
  BundleIdentity,
  BundleRole,
  CanonicalJson,
  MechanicsApprovalInput,
  NormalizedProbeCase,
  NormalizedProbeResult,
  PublicProbeCase,
  PublicProbeContract,
  RuntimeEvidenceInput,
} from "../../../packages/core/src/canonical-public-evidence";

export {
  bindingToken,
  bridgedBindingToken,
  canonicalJson,
  canonicalJsonBytes,
  mechanicsApprovalPreimage,
  normalizeRuntimeEvidenceForApproval,
  toHex,
  withoutMember,
};
export type {
  BundleIdentity,
  BundleRole,
  CanonicalJson,
  MechanicsApprovalInput,
  NormalizedProbeCase,
  NormalizedProbeResult,
  PublicProbeCase,
  PublicProbeContract,
  RuntimeEvidenceInput,
};

/** One live check a claim depends on, identified by the contract that was executed. */
export type MechanicProbeRef = {
  suite: string;
  id: string;
  category: string | null;
  contractSha256: string;
  promotionEligible: boolean;
};

export type MechanicEvidenceKind = "game-authored" | "source-derived" | "editorial";

export type MechanicEvidence = {
  kind: MechanicEvidenceKind;
  sourceTargetIds: string[];
  requiredProbes: MechanicProbeRef[];
};

export type MechanicVerificationStatus = "editorial" | "source-verified" | "live-verified";

export type MechanicVerification = {
  status: MechanicVerificationStatus;
  buildId: string;
  ranAt: string;
};

/**
 * Stores one string that the site shows, with its provenance.
 * Provenance stays per string because a game formula can sit under an editorial label.
 * Merging them lets the label inherit a claim that the game never made.
 */
export type PublishedMechanicText = {
  id: string;
  text: string;
  evidence: MechanicEvidence;
  verification: MechanicVerification;
};

export type PublishedMechanicFormula = {
  id: string;
  label: PublishedMechanicText;
  expression: PublishedMechanicText;
  note: PublishedMechanicText | null;
};

export type PublishedMechanicFact = {
  label: PublishedMechanicText;
  value: PublishedMechanicText;
};

export type PublishedMechanicSection = {
  id: string;
  title: PublishedMechanicText;
  paragraphs: PublishedMechanicText[];
  bullets: PublishedMechanicText[];
  formulas: PublishedMechanicFormula[];
  facts: PublishedMechanicFact[];
};

export type PublishedMechanicRelated = {
  label: PublishedMechanicText;
  href: PublishedMechanicText;
};

export type MechanicCategory = "combat" | "skills" | "equipment" | "progression";

/**
 * Defines a guide as the site shows it.
 *
 * `mechanics.json` also carries source targets and derivation traces.
 * This type omits them so locators, minified names, and bundle offsets never reach a reader.
 */
export type PublishedMechanicDocument = {
  id: string;
  title: PublishedMechanicText;
  category: MechanicCategory;
  summary: PublishedMechanicText;
  sections: PublishedMechanicSection[];
  related: PublishedMechanicRelated[];
};

export type PublishedMechanicsApprovalDocument = {
  id: string;
  modelSha256: string;
  verifiedProbes: MechanicProbeRef[];
};

export type PublishedMechanicsApproval = {
  buildId: string;
  bundles: BundleIdentity[];
  evidenceRanAt: string;
  evidenceSha256: string;
  externalLeafEvidenceSha256: string;
  contractFixtureSha256: string;
  mechanicsSourceApprovalSha256: string;
  approvalGateSha256: string;
  derivationExecutorSha256: string;
  probeExecutorSha256: string;
  probeRuntimeSha256: string;
  inspectorSha256: string;
  probeContracts: PublicProbeContract[];
  documents: PublishedMechanicsApprovalDocument[];
};

export type PublishedMechanics = {
  buildId: string;
  contractFixtureSha256: string;
  mechanicsSourceApprovalSha256: string;
  derivationExecutorSha256: string;
  probeExecutorSha256: string;
  probeRuntimeSha256: string;
  inspectorSha256: string;
  approvalGateSha256: string;
  probeContracts: PublicProbeContract[];
  approval: PublishedMechanicsApproval;
  approvalSha256: string;
  documents: PublishedMechanicDocument[];
};

/** The exact words each status prints. The browser suite compares them literally. */
export const VERIFICATION_LABEL: Record<MechanicVerificationStatus, string> = {
  editorial: "Compendium wording",
  "source-verified": "Source checked",
  "live-verified": "Live checked",
};

/** The scoped label a guide card carries when nothing inside it has live evidence. */
export const GUIDE_LABEL_SOURCE = "Game claims: Source checked";

/**
 * The scoped label for a guide with live-checked content.
 *
 * It says "selected content" because a guide is never live-verified as a whole.
 * Probes cover four formulas. A card that implies more claims evidence that does not exist.
 */
export const GUIDE_LABEL_SELECTED_LIVE = "Game claims: Source checked \u00b7 selected content live checked";

/**
 * Names one executed contract.
 *
 * Normalize the category before comparison.
 * A report can omit the category or set it to null, but both mean the same requirement.
 */
export function probeTupleKey(ref: {
  suite: string;
  id: string;
  category: string | null | undefined;
  contractSha256: string;
}): string {
  return `${ref.suite}\u0000${ref.id}\u0000${ref.category ?? ""}\u0000${ref.contractSha256}`;
}

/** The approved pass set for one document, as comparable tuple keys. */
export function approvedProbeKeys(verifiedProbes: readonly MechanicProbeRef[]): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const ref of verifiedProbes) keys.add(probeTupleKey(ref));
  return keys;
}

/**
 * Returns the status that a claim has earned.
 *
 * A nonempty requirement list alone cannot promote a claim.
 * The Defense probes support an instrumented module and are not promotion-eligible.
 * Every requirement must pass for the approved build.
 */
export function deriveVerificationStatus(
  evidence: MechanicEvidence,
  approved: ReadonlySet<string>,
): MechanicVerificationStatus {
  if (evidence.kind === "editorial") return "editorial";
  const promotable = evidence.requiredProbes.some((ref) => ref.promotionEligible);
  if (!promotable) return "source-verified";
  const allPassed = evidence.requiredProbes.every((ref) => approved.has(probeTupleKey(ref)));
  return allPassed ? "live-verified" : "source-verified";
}

/** Returns every string that a document shows, in page order. */
export function documentTexts(document: PublishedMechanicDocument): PublishedMechanicText[] {
  const texts: PublishedMechanicText[] = [document.title, document.summary];
  for (const section of document.sections) {
    texts.push(section.title, ...section.paragraphs, ...section.bullets);
    for (const formula of section.formulas) {
      texts.push(formula.label, formula.expression);
      if (formula.note) texts.push(formula.note);
    }
    for (const fact of section.facts) texts.push(fact.label, fact.value);
  }
  for (const related of document.related) texts.push(related.label);
  return texts;
}

/** The formula and fact strings only, which are the ones a probe can promote. */
export function documentClaimTexts(document: PublishedMechanicDocument): PublishedMechanicText[] {
  const texts: PublishedMechanicText[] = [];
  for (const section of document.sections) {
    for (const formula of section.formulas) {
      texts.push(formula.label, formula.expression);
      if (formula.note) texts.push(formula.note);
    }
    for (const fact of section.facts) texts.push(fact.label, fact.value);
  }
  return texts;
}

/** Whether any formula or fact in the guide carries approved live evidence. */
export function hasLiveCheckedContent(document: PublishedMechanicDocument): boolean {
  return documentClaimTexts(document).some((text) => text.verification.status === "live-verified");
}

/** The one scoped content label a guide card is allowed to print. */
export function guideContentLabel(document: PublishedMechanicDocument): string {
  return hasLiveCheckedContent(document) ? GUIDE_LABEL_SELECTED_LIVE : GUIDE_LABEL_SOURCE;
}

/** Rechecks every published status against the approved pass set.
 *
 * This runs during prerender and throws instead of downgrading.
 * A disagreement means that the artifact and approval describe different builds.
 */
export function assertVerificationAgrees(
  document: PublishedMechanicDocument,
  approved: ReadonlySet<string>,
  buildId: string,
): void {
  for (const text of documentTexts(document)) {
    const expected = deriveVerificationStatus(text.evidence, approved);
    if (text.verification.status !== expected) {
      throw new Error(
        `mechanics.json claims ${text.verification.status} for ${text.id}, but its evidence derives ${expected}`,
      );
    }
    if (text.verification.buildId !== buildId) {
      throw new Error(
        `mechanics.json stamps ${text.id} with build ${text.verification.buildId}, approved build is ${buildId}`,
      );
    }
  }
}

/** Lowercase hex SHA-256, computed with the platform digest both runtimes agree on. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // `Uint8Array` can use a `SharedArrayBuffer`, which `crypto.subtle` rejects.
  // The normal case reuses the same memory instead of copying it.
  const buffer = bytes.buffer;
  const input =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer, bytes.byteOffset, bytes.byteLength)
      : Uint8Array.from(bytes);
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", input)));
}

/** SHA-256 of the canonical serialization of a value. */
export async function canonicalSha256(value: CanonicalJson): Promise<string> {
  return sha256Hex(canonicalJsonBytes(value));
}

/** The semantic evidence hash the approval names, recomputed from a raw report. */
export async function evidenceApprovalSha256(
  evidence: RuntimeEvidenceInput,
  normalizedResults: NormalizedProbeResult[],
): Promise<string> {
  return canonicalSha256(normalizeRuntimeEvidenceForApproval(evidence, normalizedResults));
}

/** The approval hash, recomputed from the complete approval preimage. */
export async function mechanicsApprovalSha256(input: MechanicsApprovalInput): Promise<string> {
  return canonicalSha256(mechanicsApprovalPreimage(input));
}
