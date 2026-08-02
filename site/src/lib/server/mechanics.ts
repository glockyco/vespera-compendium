import {
  approvedProbeKeys,
  assertVerificationAgrees,
  canonicalSha256,
  mechanicsApprovalPreimage,
} from "../mechanics-verification";
import type {
  BundleRole,
  CanonicalJson,
  MechanicCategory,
  MechanicEvidence,
  MechanicProbeRef,
  MechanicVerificationStatus,
  PublishedMechanicDocument,
  PublishedMechanicFact,
  PublishedMechanicFormula,
  PublishedMechanicRelated,
  PublishedMechanicSection,
  PublishedMechanicText,
  PublishedMechanics,
  PublishedMechanicsApproval,
} from "../mechanics-verification";
import { manifest, readDataFile, type Row } from "./dataset";

/**
 * Parses the published mechanics artifact before any page shows it.
 *
 * `mechanics.json` is the site's only approval claim.
 * The parser rejects missing status, unknown category, empty section, or mismatched approval hash.
 * A guide with a broken approval is worse than a guide that fails to show.
 */

export type {
  MechanicCategory,
  MechanicEvidence,
  MechanicProbeRef,
  MechanicVerificationStatus,
  PublishedMechanicDocument,
  PublishedMechanicFact,
  PublishedMechanicFormula,
  PublishedMechanicRelated,
  PublishedMechanicSection,
  PublishedMechanicText,
  PublishedMechanics,
  PublishedMechanicsApproval,
};

/** The published artifact's filename inside a data directory. */
const MECHANICS_FILE = "mechanics.json";

const SHA256_HEX = /^[0-9a-f]{64}$/;

const EVIDENCE_KIND: Record<string, MechanicEvidence["kind"] | undefined> = {
  "game-authored": "game-authored",
  "source-derived": "source-derived",
  editorial: "editorial",
};

const VERIFICATION_STATUS: Record<string, MechanicVerificationStatus | undefined> = {
  editorial: "editorial",
  "source-verified": "source-verified",
  "live-verified": "live-verified",
};

const CATEGORY: Record<string, MechanicCategory | undefined> = {
  combat: "combat",
  skills: "skills",
  equipment: "equipment",
  progression: "progression",
};

const BUNDLE_ROLE: Record<string, BundleRole | undefined> = {
  indexHtml: "indexHtml",
  index: "index",
  gameView: "gameView",
};

const RESOLVER: Record<string, "function" | "method" | undefined> = {
  function: "function",
  method: "method",
};

/** The order the guide index lists categories in, and the heading each one prints. */
export const MECHANIC_CATEGORY_HEADINGS: readonly { category: MechanicCategory; heading: string }[] = [
  { category: "combat", heading: "Combat" },
  { category: "skills", heading: "Skills" },
  { category: "equipment", heading: "Equipment" },
  { category: "progression", heading: "Progression" },
];

function fail(detail: string): never {
  throw new Error(`${MECHANICS_FILE} is invalid: ${detail}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, at: string): Record<string, unknown> {
  if (!isRecord(value)) fail(`${at} must be an object`);
  return value;
}

function text(host: Record<string, unknown>, key: string, at: string): string {
  const value = host[key];
  if (typeof value !== "string" || value.length === 0) fail(`${at}.${key} must be a non-empty string`);
  return value;
}

/** A string that the site shows can be empty in the data, so this function checks it separately. */
function displayText(host: Record<string, unknown>, key: string, at: string): string {
  const value = host[key];
  if (typeof value !== "string") fail(`${at}.${key} must be a string`);
  return value;
}

function digest(host: Record<string, unknown>, key: string, at: string): string {
  const value = text(host, key, at);
  if (!SHA256_HEX.test(value)) fail(`${at}.${key} must be a lowercase SHA-256 hex digest`);
  return value;
}

function list(host: Record<string, unknown>, key: string, at: string): unknown[] {
  const value = host[key];
  if (!Array.isArray(value)) fail(`${at}.${key} must be an array`);
  return value;
}

function stringList(host: Record<string, unknown>, key: string, at: string): string[] {
  return list(host, key, at).map((entry, index) => {
    if (typeof entry !== "string") fail(`${at}.${key}[${index}] must be a string`);
    return entry;
  });
}

/** Probe inputs and expectations use arbitrary JSON, so this function checks only encodability. */
function canonical(value: unknown, at: string): CanonicalJson {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${at} is not a finite number`);
    return value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => canonical(entry, `${at}[${index}]`));
  if (isRecord(value)) {
    const out: Record<string, CanonicalJson> = {};
    for (const key of Object.keys(value)) out[key] = canonical(value[key], `${at}.${key}`);
    return out;
  }
  return fail(`${at} is not JSON`);
}

function parseProbeRef(value: unknown, at: string): MechanicProbeRef {
  const ref = record(value, at);
  const category = ref.category;
  if (category !== null && typeof category !== "string") fail(`${at}.category must be a string or null`);
  if (typeof ref.promotionEligible !== "boolean") fail(`${at}.promotionEligible must be a boolean`);
  return {
    suite: text(ref, "suite", at),
    id: text(ref, "id", at),
    category,
    contractSha256: digest(ref, "contractSha256", at),
    promotionEligible: ref.promotionEligible,
  };
}

function parseProbeRefs(host: Record<string, unknown>, key: string, at: string): MechanicProbeRef[] {
  return list(host, key, at).map((entry, index) => parseProbeRef(entry, `${at}.${key}[${index}]`));
}

function parseText(value: unknown, at: string): PublishedMechanicText {
  const node = record(value, at);
  const evidence = record(node.evidence, `${at}.evidence`);
  const kind = typeof evidence.kind === "string" ? EVIDENCE_KIND[evidence.kind] : undefined;
  if (!kind) fail(`${at}.evidence.kind must be game-authored, source-derived or editorial`);

  const sourceTargetIds = stringList(evidence, "sourceTargetIds", `${at}.evidence`);
  if (kind !== "editorial" && sourceTargetIds.length === 0) {
    fail(`${at}.evidence.sourceTargetIds must be nonempty for ${kind} text`);
  }

  const verification = record(node.verification, `${at}.verification`);
  const status =
    typeof verification.status === "string" ? VERIFICATION_STATUS[verification.status] : undefined;
  if (!status) fail(`${at}.verification.status must be editorial, source-verified or live-verified`);
  if ((kind === "editorial") !== (status === "editorial")) {
    fail(`${at} is ${kind} text but claims ${status}`);
  }

  return {
    id: text(node, "id", at),
    text: displayText(node, "text", at),
    evidence: {
      kind,
      sourceTargetIds,
      requiredProbes: parseProbeRefs(evidence, "requiredProbes", `${at}.evidence`),
    },
    verification: {
      status,
      buildId: text(verification, "buildId", `${at}.verification`),
      ranAt: text(verification, "ranAt", `${at}.verification`),
    },
  };
}

function parseFormula(value: unknown, at: string): PublishedMechanicFormula {
  const formula = record(value, at);
  return {
    id: text(formula, "id", at),
    label: parseText(formula.label, `${at}.label`),
    expression: parseText(formula.expression, `${at}.expression`),
    note: formula.note === null ? null : parseText(formula.note, `${at}.note`),
  };
}

function parseFact(value: unknown, at: string): PublishedMechanicFact {
  const fact = record(value, at);
  return { label: parseText(fact.label, `${at}.label`), value: parseText(fact.value, `${at}.value`) };
}

function parseSection(value: unknown, at: string): PublishedMechanicSection {
  const section = record(value, at);
  const parsed: PublishedMechanicSection = {
    id: text(section, "id", at),
    title: parseText(section.title, `${at}.title`),
    paragraphs: list(section, "paragraphs", at).map((entry, index) =>
      parseText(entry, `${at}.paragraphs[${index}]`),
    ),
    bullets: list(section, "bullets", at).map((entry, index) => parseText(entry, `${at}.bullets[${index}]`)),
    formulas: list(section, "formulas", at).map((entry, index) => parseFormula(entry, `${at}.formulas[${index}]`)),
    facts: list(section, "facts", at).map((entry, index) => parseFact(entry, `${at}.facts[${index}]`)),
  };
  const body =
    parsed.paragraphs.length + parsed.bullets.length + parsed.formulas.length + parsed.facts.length;
  if (body === 0) fail(`${at} has a title and no content`);
  return parsed;
}

function parseRelated(value: unknown, at: string): PublishedMechanicRelated {
  const related = record(value, at);
  const href = parseText(related.href, `${at}.href`);
  if (href.evidence.kind !== "editorial") fail(`${at}.href must be editorial navigation`);
  if (!href.text.startsWith("/")) fail(`${at}.href.text must be a site-relative path`);
  return { label: parseText(related.label, `${at}.label`), href };
}

function parseDocument(value: unknown, index: number): PublishedMechanicDocument {
  const at = `documents[${index}]`;
  const document = record(value, at);
  const category = typeof document.category === "string" ? CATEGORY[document.category] : undefined;
  if (!category) fail(`${at}.category must be combat, skills, equipment or progression`);

  const sections = list(document, "sections", at).map((entry, sectionIndex) =>
    parseSection(entry, `${at}.sections[${sectionIndex}]`),
  );
  if (sections.length === 0) fail(`${at} has no sections`);

  return {
    id: text(document, "id", at),
    title: parseText(document.title, `${at}.title`),
    category,
    summary: parseText(document.summary, `${at}.summary`),
    sections,
    related: list(document, "related", at).map((entry, relatedIndex) =>
      parseRelated(entry, `${at}.related[${relatedIndex}]`),
    ),
  };
}

/**
 * Reads public probe contracts without building a second model.
 *
 * The site does not run a contract. It needs the exact fields covered by the approval hash.
 * It also needs an identity for each requirement. The parser checks each shape and carries the rest unchanged.
 */
function parseProbeContracts(value: unknown[], where: string): PublishedMechanicsApproval["probeContracts"] {
  return value.map((entry, index) => {
    const at = `${where}[${index}]`;
    const contract = record(entry, at);
    const category = contract.category;
    if (category !== null && typeof category !== "string") fail(`${at}.category must be a string or null`);
    const resolver = typeof contract.resolver === "string" ? RESOLVER[contract.resolver] : undefined;
    if (!resolver) fail(`${at}.resolver must be function or method`);
    const argumentTemplate = contract.argumentTemplate;
    if (!Array.isArray(argumentTemplate)) fail(`${at}.argumentTemplate must be an array`);
    const bundle = typeof contract.bundle === "string" ? BUNDLE_ROLE[contract.bundle] : undefined;
    if (!bundle) fail(`${at}.bundle must be a bundle role`);
    const methodName = contract.methodName;
    if (methodName !== null && typeof methodName !== "string") fail(`${at}.methodName must be a string or null`);
    const bridgeSuffix = contract.bridgeSuffix;
    if (bridgeSuffix !== null && typeof bridgeSuffix !== "string") {
      fail(`${at}.bridgeSuffix must be a string or null`);
    }

    return {
      suite: text(contract, "suite", at),
      id: text(contract, "id", at),
      category,
      resolver,
      bundle,
      methodName,
      bridgeSuffix,
      expression: text(contract, "expression", at),
      argumentTemplate: argumentTemplate.map((entry, argumentIndex) =>
        canonical(entry, `${at}.argumentTemplate[${argumentIndex}]`),
      ),
      cases: list(contract, "cases", at).map((caseEntry, caseIndex) => {
        const probeCase = record(caseEntry, `${at}.cases[${caseIndex}]`);
        return {
          id: text(probeCase, "id", `${at}.cases[${caseIndex}]`),
          input: canonical(probeCase.input, `${at}.cases[${caseIndex}].input`),
          expected: canonical(probeCase.expected, `${at}.cases[${caseIndex}].expected`),
        };
      }),
      claimBindings: list(contract, "claimBindings", at).map((bindingEntry, bindingIndex) => {
        const bindingAt = `${at}.claimBindings[${bindingIndex}]`;
        const binding = record(bindingEntry, bindingAt);
        const derivationOutputId = binding.derivationOutputId;
        if (derivationOutputId !== null && typeof derivationOutputId !== "string") {
          fail(`${bindingAt}.derivationOutputId must be a string or null`);
        }
        if (typeof binding.promotionEligible !== "boolean") {
          fail(`${bindingAt}.promotionEligible must be a boolean`);
        }
        return {
          textId: text(binding, "textId", bindingAt),
          expectedRawValue: canonical(binding.expectedRawValue, `${bindingAt}.expectedRawValue`),
          derivationOutputId,
          promotionEligible: binding.promotionEligible,
        };
      }),
      executorSha256: digest(contract, "executorSha256", at),
      contractSha256: digest(contract, "contractSha256", at),
    };
  });
}

function parseApproval(value: unknown): PublishedMechanicsApproval {
  const at = "approval";
  const approval = record(value, at);

  const bundles = list(approval, "bundles", at).map((entry, index) => {
    const bundleAt = `${at}.bundles[${index}]`;
    const bundle = record(entry, bundleAt);
    const role = typeof bundle.role === "string" ? BUNDLE_ROLE[bundle.role] : undefined;
    if (!role) fail(`${bundleAt}.role must be a bundle role`);
    const bytes = bundle.bytes;
    if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes < 0) {
      fail(`${bundleAt}.bytes must be a non-negative integer`);
    }
    return { role, bytes, sha256: digest(bundle, "sha256", bundleAt) };
  });

  return {
    buildId: text(approval, "buildId", at),
    bundles,
    evidenceRanAt: text(approval, "evidenceRanAt", at),
    evidenceSha256: digest(approval, "evidenceSha256", at),
    externalLeafEvidenceSha256: digest(approval, "externalLeafEvidenceSha256", at),
    contractFixtureSha256: digest(approval, "contractFixtureSha256", at),
    mechanicsSourceApprovalSha256: digest(approval, "mechanicsSourceApprovalSha256", at),
    approvalGateSha256: digest(approval, "approvalGateSha256", at),
    derivationExecutorSha256: digest(approval, "derivationExecutorSha256", at),
    probeExecutorSha256: digest(approval, "probeExecutorSha256", at),
    probeRuntimeSha256: digest(approval, "probeRuntimeSha256", at),
    inspectorSha256: digest(approval, "inspectorSha256", at),
    probeContracts: parseProbeContracts(list(approval, "probeContracts", at), `${at}.probeContracts`),
    documents: list(approval, "documents", at).map((entry, index) => {
      const documentAt = `${at}.documents[${index}]`;
      const document = record(entry, documentAt);
      return {
        id: text(document, "id", documentAt),
        modelSha256: digest(document, "modelSha256", documentAt),
        verifiedProbes: parseProbeRefs(document, "verifiedProbes", documentAt),
      };
    }),
  };
}

/**
 * Parses and cross-checks the artifact.
 *
 * The approval hash must match the approval object.
 * The manifest must name that hash.
 * Each published status must follow from its requirements and the approved pass set.
 * A disagreement means that the approval describes another build.
 */
export async function parsePublishedMechanics(
  value: unknown,
  expectedApprovalSha256: string | null,
): Promise<PublishedMechanics> {
  const artifact = record(value, "mechanics");
  const approval = parseApproval(artifact.approval);
  const approvalSha256 = digest(artifact, "approvalSha256", "mechanics");

  const recomputed = await canonicalSha256(mechanicsApprovalPreimage(approval));
  if (recomputed !== approvalSha256) {
    fail(`approvalSha256 is ${approvalSha256}, but the approval object hashes to ${recomputed}`);
  }
  if (expectedApprovalSha256 !== null && expectedApprovalSha256 !== approvalSha256) {
    fail(`the manifest names approval ${expectedApprovalSha256}, the artifact carries ${approvalSha256}`);
  }

  const buildId = text(artifact, "buildId", "mechanics");
  if (buildId !== approval.buildId) {
    fail(`buildId ${buildId} does not match approval build ${approval.buildId}`);
  }

  const documents = list(artifact, "documents", "mechanics").map((entry, index) => parseDocument(entry, index));
  if (documents.length === 0) fail("no documents were published");
  if (approval.documents.length !== documents.length) {
    fail(`the approval covers ${approval.documents.length} documents, ${documents.length} were published`);
  }

  const approvedById: Record<string, PublishedMechanicsApproval["documents"][number] | undefined> = {};
  for (const entry of approval.documents) approvedById[entry.id] = entry;

  const seen: Record<string, true | undefined> = {};
  for (const document of documents) {
    if (seen[document.id]) fail(`document ${document.id} is published twice`);
    seen[document.id] = true;
    const approved = approvedById[document.id];
    if (!approved) fail(`document ${document.id} is not in the approval`);
    assertVerificationAgrees(document, approvedProbeKeys(approved.verifiedProbes), buildId);
  }

  return {
    buildId,
    contractFixtureSha256: digest(artifact, "contractFixtureSha256", "mechanics"),
    mechanicsSourceApprovalSha256: digest(artifact, "mechanicsSourceApprovalSha256", "mechanics"),
    derivationExecutorSha256: digest(artifact, "derivationExecutorSha256", "mechanics"),
    probeExecutorSha256: digest(artifact, "probeExecutorSha256", "mechanics"),
    probeRuntimeSha256: digest(artifact, "probeRuntimeSha256", "mechanics"),
    inspectorSha256: digest(artifact, "inspectorSha256", "mechanics"),
    approvalGateSha256: digest(artifact, "approvalGateSha256", "mechanics"),
    probeContracts: parseProbeContracts(list(artifact, "probeContracts", "mechanics"), "probeContracts"),
    approval,
    approvalSha256,
    documents,
  };
}

let loaded: PublishedMechanics | undefined;

/** Returns the checked artifact for this build. Parse it once because every guide page reads it. */
export async function publishedMechanics(): Promise<PublishedMechanics> {
  loaded ??= await parsePublishedMechanics(
    readDataFile<unknown>(MECHANICS_FILE),
    manifest().mechanicsApprovalSha256,
  );
  return loaded;
}

export async function mechanicDocuments(): Promise<PublishedMechanicDocument[]> {
  return (await publishedMechanics()).documents;
}

export async function mechanicDocument(id: string): Promise<PublishedMechanicDocument> {
  const document = (await mechanicDocuments()).find((entry) => entry.id === id);
  if (!document) throw new Error(`no published mechanic guide has the id ${id}`);
  return document;
}

/**
 * Returns the guide that explains a record.
 *
 * The map is exhaustive and static. Each entry must match guide text that covers its record type.
 * Zones, quests, and world bosses have no canonical record link because Endgame names no record.
 */
const GUIDE_BY_TABLE: Record<string, string | undefined> = {
  classes: "combat-mathematics",
  enemies: "combat-mathematics",
  abilities: "ability-calculations",
  recipes: "skills-and-crafting",
  gathering_nodes: "skills-and-crafting",
  items: "equipment-and-value",
  gems: "equipment-and-value",
  affixes: "equipment-and-value",
  // The published table is `shop_listings`. The contract names it `shops`.
  // Both names resolve, so callers can use either name.
  shop_listings: "equipment-and-value",
  shops: "equipment-and-value",
};

export type MechanicLink = { id: string; title: string; summary: string; href: string };

/**
 * Returns guide links for a record page.
 *
 * `row` remains in the signature but is unused in this release.
 * The mapping is per table. A future row-dependent link can use the existing call shape.
 */
export function mechanicLinksFor(
  tableName: string,
  row: Row,
  documents: readonly PublishedMechanicDocument[],
): MechanicLink[] {
  const id = GUIDE_BY_TABLE[tableName];
  if (!id) return [];
  const document = documents.find((entry) => entry.id === id);
  if (!document) throw new Error(`the ${tableName} guide link names ${id}, which is not published`);
  return [
    {
      id: document.id,
      title: document.title.text,
      summary: document.summary.text,
      href: `/mechanics/${document.id}/`,
    },
  ];
}
