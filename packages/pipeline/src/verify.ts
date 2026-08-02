import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  canonicalJson,
  normalizeRuntimeEvidenceForApproval,
  readInstalledBuildId,
  sha256Hex,
  MECHANIC_PROBE_CONTRACTS,
  publicProbeContract,
  type CanonicalJson,
  type NormalizedProbeResult,
} from "@vespera/core";
import { composeAll } from "./compose.ts";
import type { PreparedMechanicsInputs, PreparedPublishedInputs } from "./inputs.ts";
import {
  checkMechanics,
  canonicalMechanicsApproval,
  lockedModelSha256,
  mechanicsApprovalSha256,
  parseMechanicsLock,
  type MechanicsLock,
} from "./mechanics-lock.ts";
import {
  CODEX_FORMULA_KEYS,
  requiredProbes,
  type MechanicDocument,
  type MechanicText,
} from "./mechanics.ts";
import { SCHEMA_VERSION } from "./schema.ts";
import { VARIANTS_BY_KIND, type ImageVariant, type VariantFile, type VariantIndex } from "./images.ts";
import type { Manifest, PublishedMechanicDocument, PublishedMechanics } from "./publish.ts";

export type VerificationCheck = {
  id: string;
  status: "PASS" | "FAIL" | "SKIPPED";
  detail: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readJson(file: string): unknown {
  return JSON.parse(new TextDecoder().decode(readFileSync(file)));
}
function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
function canonicalValue(value: unknown): CanonicalJson | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    const output: CanonicalJson[] = [];
    for (const entry of value) {
      const canonical = canonicalValue(entry);
      if (canonical === undefined) return undefined;
      output.push(canonical);
    }
    return output;
  }
  if (!isRecord(value)) return undefined;
  const output: Record<string, CanonicalJson> = {};
  for (const [key, entry] of Object.entries(value)) {
    const canonical = canonicalValue(entry);
    if (canonical === undefined) return undefined;
    output[key] = canonical;
  }
  return output;
}

function equalCanonical(left: unknown, right: unknown): boolean {
  const leftValue = canonicalValue(left);
  const rightValue = canonicalValue(right);
  if (leftValue === undefined || rightValue === undefined) return false;
  return canonicalJson(leftValue) === canonicalJson(rightValue);
}
function probeKey(value: { suite: string; id: string; category: string | null; contractSha256: string }): string {
  return `${value.suite}\u0000${value.id}\u0000${value.category ?? ""}\u0000${value.contractSha256}`;
}
function allText(document: PublishedMechanicDocument): PublishedMechanicTextLike[] {
  const values: PublishedMechanicTextLike[] = [document.title, document.summary];
  for (const section of document.sections) {
    values.push(section.title, ...section.paragraphs, ...section.bullets);
    for (const formula of section.formulas) values.push(formula.label, formula.expression, ...(formula.note ? [formula.note] : []));
    for (const fact of section.facts) values.push(fact.label, fact.value);
  }
  for (const related of document.related) values.push(related.label, related.href);
  return values;
}
type PublishedMechanicTextLike = MechanicText & { verification: { status: "editorial" | "source-verified" | "live-verified"; buildId: string; ranAt: string } };

function evidenceHash(bytes: Uint8Array, results: NormalizedProbeResult[]): string {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!isRecord(parsed)) throw new Error("runtime evidence is not an object");
  const value = parsed as unknown as Parameters<typeof normalizeRuntimeEvidenceForApproval>[0];
  return sha256Hex(canonicalJson(normalizeRuntimeEvidenceForApproval(value, results)));
}

export function runtimeEvidenceCheck(buildId: string): VerificationCheck {
  const file = path.join("evidence", buildId, "runtime-evidence.json");
  if (!existsSync(file)) return { id: "runtimeEvidence", status: "SKIPPED", detail: `no runtime evidence for build ${buildId}` };
  try {
    const value = readJson(file);
    if (!isRecord(value)) return { id: "runtimeEvidence", status: "FAIL", detail: `invalid runtime evidence for build ${buildId}` };
    const findings = Array.isArray(value.results) ? value.results.filter((result) => isRecord(result) && (result.status === "FAIL" || result.status === "UNRESOLVED")) : [];
    const valid = value.buildId === buildId && Array.isArray(value.results) && value.schemaVersion === 2;
    return { id: "runtimeEvidence", status: valid && findings.length === 0 ? "PASS" : "FAIL", detail: valid ? `${findings.length} FAIL/UNRESOLVED runtime findings for build ${buildId}` : `invalid runtime evidence for build ${buildId}` };
  } catch (error) {
    return { id: "runtimeEvidence", status: "FAIL", detail: `runtime evidence unreadable: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function verify(extractedDir = "extracted"): VerificationCheck[] {
  const tables = composeAll(extractedDir);
  const checks: VerificationCheck[] = Object.entries(tables).map(([id, table]) => ({ id, status: table.live > 0 ? "PASS" : "FAIL", detail: `base=${table.base} live=${table.live}` }));
  const buildId = (() => {
    try {
      return readInstalledBuildId();
    } catch (error) {
      checks.push({ id: "runtimeEvidence", status: "SKIPPED", detail: `build id unavailable: ${error instanceof Error ? error.message : String(error)}` });
      return null;
    }
  })();
  if (buildId) checks.push(runtimeEvidenceCheck(buildId));
  return checks;
}

function publicContracts() {
  return MECHANIC_PROBE_CONTRACTS.map((contract) => publicProbeContract(contract));
}

function statusForText(textValue: MechanicText, passed: readonly { suite: string; id: string; category: string | null; contractSha256: string; promotionEligible: boolean }[]): "editorial" | "source-verified" | "live-verified" {
  if (textValue.evidence.kind === "editorial") return "editorial";
  const passedKeys = new Set(passed.map(probeKey));
  const live = textValue.evidence.requiredProbes.length > 0 && textValue.evidence.requiredProbes.some((probe) => probe.promotionEligible) && textValue.evidence.requiredProbes.every((probe) => passedKeys.has(probeKey(probe)));
  return live ? "live-verified" : "source-verified";
}

function verifyMechanicsDocuments(artifact: PublishedMechanics, lock: MechanicsLock): string[] {
  const problems: string[] = [];
  if (artifact.documents.length !== 5) problems.push(`expected five mechanic documents, found ${artifact.documents.length}`);
  const ids = new Set<string>();
  for (const document of artifact.documents) {
    if (ids.has(document.id)) problems.push(`duplicate mechanic document ${document.id}`);
    ids.add(document.id);
    const baseline = lock.documents[document.id];
    if (!baseline) { problems.push(`mechanics lock missing ${document.id}`); continue; }
    const stripped = stripPublishedVerification(document);
    if (lockedModelSha256(stripped) !== baseline.modelSha256) problems.push(`model hash mismatch for ${document.id}`);
    const required = requiredProbes(stripPublishedVerification(document));
    const expectedProbeKeys = required.map(probeKey);
    const actualProbeKeys = baseline.verifiedProbes.map(probeKey);
    if (expectedProbeKeys.length !== new Set(expectedProbeKeys).size) problems.push(`${document.id} has duplicate required probes`);
    if (expectedProbeKeys.length !== actualProbeKeys.length || expectedProbeKeys.some((key, index) => actualProbeKeys[index] !== key)) problems.push(`${document.id} verified probe union differs from model`);
    const requiredKeys = new Set(required.map(probeKey));
    const approvedKeys = new Set(baseline.verifiedProbes.map(probeKey));
    for (const key of requiredKeys) if (!approvedKeys.has(key)) problems.push(`${document.id} required probe is not approved`);
    const targetHashes = new Map(document.sourceTargets.map((target) => [target.id, target.sha256]));
    for (const claim of allText(document)) {
      if (claim.evidence.kind === "editorial") continue;
      if (claim.evidence.sourceTargetIds.length === 0) problems.push(`${document.id}.${claim.id} has no source target`);
      for (const targetId of claim.evidence.sourceTargetIds) {
        const hash = targetHashes.get(targetId);
        if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) problems.push(`${document.id}.${claim.id} has missing source hash ${targetId}`);
      }
    }
    const texts = allText(document);
    for (const claim of texts) {
      const expectedStatus = statusForText(claim, baseline.verifiedProbes);
      if (claim.verification.status !== expectedStatus) problems.push(`${document.id}.${claim.id} has incorrect verification status`);
      if (claim.verification.buildId !== artifact.buildId) problems.push(`${document.id}.${claim.id} has incorrect verification build`);
    }
  }
  return problems;
}

function stripPublishedVerification(document: PublishedMechanicDocument): MechanicDocument & { derivationExecutorSha256: string; mechanicsSourceApprovalSha256: string } {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (!isRecord(value)) return value;
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) if (key !== "verification") output[key] = strip(entry);
    return output;
  };
  const result = strip(document);
  if (!isRecord(result)) throw new Error("published mechanic document is not an object");
  return result as unknown as MechanicDocument & { derivationExecutorSha256: string; mechanicsSourceApprovalSha256: string };
}

function verifyVariants(root: string, manifest: Manifest): string[] {
  const problems: string[] = [];
  const indexFile = path.join(root, manifest.images.variantIndex);
  if (!existsSync(indexFile)) return ["variant index is absent"];
  const value = readJson(indexFile);
  if (!isRecord(value) || value.version !== 1 || value.configSha256 !== manifest.images.configSha256 || !isRecord(value.entries)) return ["variant index structure or config hash is invalid"];
  const index = value as unknown as VariantIndex;
  const tableKinds = new Map<string, "general" | "class" | "zone">([["classes", "class"], ["zones_dungeons", "zone"]]);
  for (const table of manifest.tables) {
    const tableFile = path.join(root, table.json);
    if (!existsSync(tableFile)) continue;
    const rows: unknown = readJson(tableFile);
    if (!Array.isArray(rows)) continue;
    const kind = tableKinds.get(table.name) ?? "general";
    for (const row of rows) {
      if (!isRecord(row) || typeof row.image !== "string") continue;
      const entry = index.entries[row.image];
      if (!entry) { problems.push(`variant index is missing ${row.image}`); continue; }
      for (const variant of VARIANTS_BY_KIND[kind]) if (!entry.variants[variant]) problems.push(`${row.image} is missing ${kind} variant ${variant}`);
    }
  }
  let variantCount = 0;
  for (const [canonical, entry] of Object.entries(index.entries)) {
    const canonicalFile = path.join(root, canonical);
    if (!existsSync(canonicalFile)) problems.push(`canonical image is absent: ${canonical}`);
    if (existsSync(canonicalFile)) {
      const canonicalBytes = readFileSync(canonicalFile);
      if (canonicalBytes.byteLength !== entry.source.bytes || sha256Hex(canonicalBytes) !== entry.source.sha256) problems.push(`canonical image metadata differs: ${canonical}`);
    }
    for (const [variantName, variant] of Object.entries(entry.variants) as [ImageVariant, VariantFile | undefined][]) {
      if (!variant) continue;
      variantCount += 1;
      if (!existsSync(path.join(root, variant.path))) problems.push(`variant file is absent: ${variant.path}`);
      else {
        const variantFile = path.join(root, variant.path);
        const variantBytes = readFileSync(variantFile);
        if (variantBytes.byteLength !== variant.bytes || sha256Hex(variantBytes) !== variant.sha256) problems.push(`variant metadata differs: ${variant.path}`);
        const limit = manifest.images.variants[variantName];
        if (variant.width > limit || variant.height > limit) problems.push(`variant dimensions differ: ${variant.path}`);
      }
      if (!Object.prototype.hasOwnProperty.call(manifest.images.variants, variantName)) problems.push(`unknown variant ${variantName}`);
    }
  }
  if (variantCount !== manifest.images.variantCount) problems.push(`variantCount is ${manifest.images.variantCount}, emitted ${variantCount}`);
  if (Object.keys(index.entries).length !== manifest.images.canonicalCount) problems.push(`canonicalCount is ${manifest.images.canonicalCount}, emitted ${Object.keys(index.entries).length}`);
  return problems;
}

export function verifyPublishedMechanics(prepared: PreparedPublishedInputs): VerificationCheck[] {
  prepared.assertLeasesLive();
  const lock = parseMechanicsLock(prepared.lockBytes);
  const root = prepared.snapshotPath;
  const artifactPath = path.join(root, "mechanics.json");
  const manifestPath = path.join(root, "index.json");
  if (!existsSync(artifactPath) || !existsSync(manifestPath)) return [{ id: "mechanicsArtifact", status: "FAIL", detail: "published mechanics or manifest is absent" }];
  const artifactValue = readJson(artifactPath);
  const manifestValue = readJson(manifestPath);
  if (!isRecord(artifactValue) || !isRecord(manifestValue)) return [{ id: "mechanicsArtifact", status: "FAIL", detail: "published mechanics or manifest is malformed" }];
  const artifact = artifactValue as unknown as PublishedMechanics;
  const manifest = manifestValue as unknown as Manifest;
  const problems: string[] = [];
  if (manifest.schemaVersion !== SCHEMA_VERSION || manifest.schemaVersion !== 3) problems.push("manifest schema version is not 3");
  if (artifact.buildId !== lock.snapshot.buildId || manifest.buildId !== lock.snapshot.buildId) problems.push("build IDs do not match approved lock");
  const contracts = publicContracts();
  const approval = canonicalMechanicsApproval(lock, contracts);
  if (!equalCanonical(artifact.approval, approval)) problems.push("mechanics approval preimage differs from lock");
  if (artifact.approvalSha256 !== mechanicsApprovalSha256(lock, contracts) || manifest.mechanicsApprovalSha256 !== artifact.approvalSha256) problems.push("mechanics approval hash differs from lock");
  if (artifact.contractFixtureSha256 !== prepared.contractFixtureSha256) problems.push("contract fixture hash differs from prepared input");
  if (artifact.mechanicsSourceApprovalSha256 !== prepared.mechanicsSourceApprovalSha256) problems.push("mechanics source approval differs from prepared input");
  if (artifact.derivationExecutorSha256 !== prepared.derivationExecutorSha256 || artifact.probeExecutorSha256 !== prepared.probeExecutorSha256 || artifact.probeRuntimeSha256 !== prepared.probeRuntimeSha256 || artifact.inspectorSha256 !== prepared.inspectorSha256 || artifact.approvalGateSha256 !== prepared.approvalGateSha256) problems.push("execution closure hash differs from prepared input");
  if (manifest.mechanics !== "mechanics.json" || manifest.mechanicCount !== artifact.documents.length) problems.push("manifest mechanics fields do not match artifact");
  problems.push(...verifyMechanicsDocuments(artifact, lock));
  problems.push(...verifyVariants(root, manifest));
  const searchPath = path.join(root, "search_index.json");
  if (!existsSync(searchPath)) problems.push("search index is absent");
  else {
    const searchValue = readJson(searchPath);
    if (!Array.isArray(searchValue)) problems.push("search index is malformed");
    else {
      const mechanicsRows = searchValue.filter((row): row is Record<string, unknown> => isRecord(row) && row.t === "mechanics");
      const expectedIds = artifact.documents.map((document) => document.id);
      const actualIds = mechanicsRows.map((row) => String(row.i ?? ""));
      if (actualIds.length !== expectedIds.length || expectedIds.some((id, index) => actualIds[index] !== id)) problems.push("mechanics search rows do not match documents");
    }
  }
  // The two combat guides must consume each codex entry exactly once between them. Other documents may cite
  // a codex literal as well — the Endgame guide quotes the Defense expression — so the inventory is checked
  // over those two documents rather than over every citation, and as a multiset rather than in list order,
  // because a document's targets are stored sorted by id.
  const codexOwners = new Set(["combat-mathematics", "ability-calculations"]);
  const codexTargetKeys = artifact.documents
    .filter((document) => codexOwners.has(document.id))
    .flatMap((document) =>
      document.sourceTargets
        .map((target) => /^codex\.([A-Za-z0-9_]+)\.expression$/.exec(target.id)?.[1])
        .filter((key): key is string => key !== undefined),
    )
    .sort();
  const expectedCodexKeys: string[] = [...CODEX_FORMULA_KEYS].sort();
  if (codexTargetKeys.join("|") !== expectedCodexKeys.join("|")) {
    const missing = expectedCodexKeys.filter((key) => !codexTargetKeys.includes(key));
    const extra = codexTargetKeys.filter((key) => !expectedCodexKeys.includes(key));
    const duplicated = codexTargetKeys.filter((key, index) => codexTargetKeys.indexOf(key) !== index);
    problems.push(
      `codex formula source target inventory is wrong (missing=${missing.join(",") || "none"} extra=${extra.join(",") || "none"} duplicated=${duplicated.join(",") || "none"})`,
    );
  }
  const endgame = artifact.documents.find((document) => document.id === "endgame-systems");
  if (!endgame || endgame.sections.length !== 11 || endgame.sections.reduce((count, section) => count + section.bullets.length, 0) !== 63) problems.push("Endgame section or bullet count is not exact");
  const externalPath = path.join(root, "external-leaf-evidence.json");
  if (!existsSync(externalPath)) problems.push("external leaf evidence is absent");
  else if (sha256Hex(readFileSync(externalPath)) !== lock.snapshot.externalLeafEvidenceSha256) {
    // The copied aggregate is compared against the lock rather than against a source-domain field: the
    // emitted verifier reads only its snapshot, and the lock is the approval baseline it is checking.
    problems.push("external leaf evidence hash differs from the approved lock");
  }
  const evidencePath = path.join(root, "runtime-evidence.json");
  if (!existsSync(evidencePath)) problems.push("runtime evidence is absent");
  else {
    try {
      const bytes = readFileSync(evidencePath);
      if (evidenceHash(bytes, lock.snapshot.normalizedProbeResults) !== lock.snapshot.evidenceSha256) problems.push("runtime evidence semantic hash differs from lock");
    } catch (error) { problems.push(`runtime evidence is invalid: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return [{ id: "mechanicsArtifact", status: problems.length === 0 ? "PASS" : "FAIL", detail: problems.length === 0 ? "published mechanics and variants are approved" : problems.join("; ") }];
}

export function verifyPublished(prepared: PreparedPublishedInputs): VerificationCheck[] {
  prepared.assertLeasesLive();
  const checks = verifyPublishedMechanics(prepared);
  const root = prepared.snapshotPath;
  const manifestPath = path.join(root, "index.json");
  if (!existsSync(manifestPath)) return [...checks, { id: "manifest", status: "FAIL", detail: "manifest is absent" }];
  const manifest = readJson(manifestPath);
  if (!isRecord(manifest) || manifest.schemaVersion !== 3) return [...checks, { id: "manifest", status: "FAIL", detail: "manifest schema version is not 3" }];
  return [...checks, { id: "manifest", status: "PASS", detail: "manifest schema 3 is valid" }];
}
