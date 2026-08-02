import { cpSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  canonicalJson,
  normalizeRuntimeEvidenceForApproval,
  sha256Hex,
  MECHANIC_PROBE_CONTRACTS,
  publicProbeContract,
  type CanonicalJson,
  type NormalizedProbeResult,
  type PublicProbeContract,
} from "@vespera/core";
import { composeAll } from "./compose.ts";
import { toCsv } from "./csv.ts";
import { collectImages, writeImages, type ImageRef, type VariantIndex } from "./images.ts";
import { checkInvariants } from "./invariants.ts";
import { appendMechanicSearchRows, projectAll, type Dataset } from "./project.ts";
import {
  extractMechanics,
  type MechanicDocument,
  type MechanicFact,
  type MechanicFormula,
  type MechanicLockedModel,
  type MechanicProbeRef,
  type MechanicSection,
  type MechanicText,
} from "./mechanics.ts";
import {
  canonicalMechanicsApproval,
  checkMechanics,
  lockedModelSha256,
  mechanicsApprovalSha256,
  parseMechanicsLock,
  type MechanicsLock,
} from "./mechanics-lock.ts";
import { prepareStagedPublishedInputs, type LeaseSet, type PreparedMechanicsInputs } from "./inputs.ts";
import { verifyPublished } from "./verify.ts";
import { SCHEMA_VERSION, TABLES } from "./schema.ts";
import { writeSqlite } from "./sqlite.ts";

export const SQLITE_FILENAME = "vespera.sqlite";
const LATEST_DIR = "latest";
const SEARCH_INDEX_TABLE = "search_index";

export type PublishResult = {
  buildId: string;
  outDirs: string[];
  tables: { name: string; rows: number }[];
  images: number;
  variants: number;
  missingImages: string[];
};

export class InvariantError extends Error {}

export type ManifestTable = {
  name: string;
  slug: string;
  kind: "entity" | "join" | "meta";
  rows: number;
  primaryKey: string[];
  columns: { name: string; type: string }[];
  json: string;
  csv: string;
  jsonKeys?: Record<string, string>;
};

export type Manifest = {
  schemaVersion: 3;
  buildId: string;
  generatedAt: string;
  sqlite: string;
  mechanics: "mechanics.json";
  mechanicCount: number;
  mechanicsApprovalSha256: string;
  images: {
    canonicalRoot: "images";
    canonicalCount: number;
    variantIndex: "images/variants.json";
    variantCount: number;
    configSha256: string;
    variants: { thumb: 64; card: 192; portrait: 384; wide: 640; hero: 1280 };
  };
  tables: ManifestTable[];
};

export type PublishedMechanicText = MechanicText & {
  verification: { status: "editorial" | "source-verified" | "live-verified"; buildId: string; ranAt: string };
};
export type PublishedMechanicDocument = Omit<MechanicDocument, "title" | "summary" | "sections" | "related"> & {
  title: PublishedMechanicText;
  summary: PublishedMechanicText;
  sections: {
    id: string;
    title: PublishedMechanicText;
    paragraphs: PublishedMechanicText[];
    bullets: PublishedMechanicText[];
    formulas: { id: string; label: PublishedMechanicText; expression: PublishedMechanicText; note: PublishedMechanicText | null }[];
    facts: { label: PublishedMechanicText; value: PublishedMechanicText }[];
  }[];
  related: { label: PublishedMechanicText; href: PublishedMechanicText }[];
  derivationExecutorSha256: string;
  mechanicsSourceApprovalSha256: string;
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
  approval: CanonicalJson;
  approvalSha256: string;
  documents: PublishedMechanicDocument[];
};

/** Filesystem operations are injectable so swap and rollback errors stay deterministic. */
export type PublishFilesystemAdapter = {
  exists(pathname: string): boolean;
  mkdir(pathname: string): void;
  remove(pathname: string): void;
  rename(from: string, to: string): void;
};

const defaultFilesystem: PublishFilesystemAdapter = {
  exists: existsSync,
  mkdir: (pathname) => mkdirSync(pathname, { recursive: true }),
  remove: (pathname) => rmSync(pathname, { recursive: true, force: true }),
  rename: (from, to) => {
    mkdirSync(path.dirname(to), { recursive: true });
    rmSync(to, { recursive: true, force: true });
    renameSync(from, to);
  },
};

const SEARCH_INDEX_KEYS: Record<string, string> = {
  t: "table", i: "id", s: "slug", n: "name", k: "kind", b: "subtitle", l: "level", r: "rarity", g: "image",
};

function ordered(dataset: Dataset, tableName: string, columns: readonly string[]): unknown[] {
  return (dataset[tableName] ?? []).map((row) => Object.fromEntries(columns.map((column) => [column, row[column] ?? null])));
}

function copyEvidence(bytes: Uint8Array | null, destination: string, label: string, expectedSha256?: string | null): void {
  if (!bytes) throw new Error(`${label} is absent from prepared inputs`);
  if (expectedSha256 && sha256Hex(bytes) !== expectedSha256) throw new Error(`${label} semantic hash differs from prepared input`);
  writeFileSync(destination, bytes);
}

function safeBuildId(prepared: PreparedMechanicsInputs, lock: MechanicsLock): string {
  if (typeof prepared.resolvedBuildId !== "string" || prepared.resolvedBuildId.length === 0) throw new Error("prepared publish inputs have no resolved build id");
  if (prepared.resolvedBuildId !== lock.snapshot.buildId) throw new Error(`BUILD_UNVERIFIED: prepared build ${prepared.resolvedBuildId} differs from lock ${lock.snapshot.buildId}`);
  return prepared.resolvedBuildId;
}

function probeKey(probe: MechanicProbeRef): string {
  return `${probe.suite}\u0000${probe.id}\u0000${probe.category ?? ""}\u0000${probe.contractSha256}`;
}
function hasPassedProbe(required: MechanicProbeRef, passed: readonly MechanicProbeRef[]): boolean {
  return passed.some((probe) => probeKey(probe) === probeKey(required));
}

function verificationFor(text: MechanicText, buildId: string, ranAt: string, passed: readonly MechanicProbeRef[]): PublishedMechanicText["verification"] {
  if (text.evidence.kind === "editorial") return { status: "editorial", buildId, ranAt };
  const live = text.evidence.requiredProbes.length > 0 && text.evidence.requiredProbes.some((probe) => probe.promotionEligible) && text.evidence.requiredProbes.every((probe) => hasPassedProbe(probe, passed));
  return { status: live ? "live-verified" : "source-verified", buildId, ranAt };
}

function publishedText(text: MechanicText, buildId: string, ranAt: string, passed: readonly MechanicProbeRef[]): PublishedMechanicText {
  return { ...text, verification: verificationFor(text, buildId, ranAt, passed) };
}

export function publishMechanicDocument(document: MechanicLockedModel, buildId: string, ranAt: string, passed: readonly MechanicProbeRef[]): PublishedMechanicDocument {
  const text = (value: MechanicText): PublishedMechanicText => publishedText(value, buildId, ranAt, passed);
  const section = (value: MechanicSection) => ({
    id: value.id,
    title: text(value.title),
    paragraphs: value.paragraphs.map(text),
    bullets: value.bullets.map(text),
    formulas: value.formulas.map((formula: MechanicFormula) => ({ id: formula.id, label: text(formula.label), expression: text(formula.expression), note: formula.note ? text(formula.note) : null })),
    facts: value.facts.map((fact: MechanicFact) => ({ label: text(fact.label), value: text(fact.value) })),
  });
  return {
    id: document.id,
    title: text(document.title),
    category: document.category,
    summary: text(document.summary),
    sections: document.sections.map(section),
    related: document.related.map((related) => ({ label: text(related.label), href: text(related.href) })),
    sourceTargets: document.sourceTargets,
    derivations: document.derivations,
    derivationExecutorSha256: document.derivationExecutorSha256,
    mechanicsSourceApprovalSha256: document.mechanicsSourceApprovalSha256,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Remove only check fields. Preserve the locked model for canonical hash comparison. */
export function lockedModelFromPublished(document: PublishedMechanicDocument): MechanicLockedModel {
  const allowedDocumentKeys = new Set(["id", "title", "category", "summary", "sections", "related", "sourceTargets", "derivations", "derivationExecutorSha256", "mechanicsSourceApprovalSha256"]);
  if (Object.keys(document).some((key) => !allowedDocumentKeys.has(key))) throw new Error("published mechanic document has unexpected structure");
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (!isRecord(value)) return value;
    const keys = Object.keys(value);
    if ("verification" in value) {
      const allowed = new Set(["id", "text", "evidence", "verification"]);
      if (!("id" in value) || !("text" in value) || !("evidence" in value) || keys.some((key) => !allowed.has(key))) throw new Error("published mechanic text has unexpected structure");
      return Object.fromEntries(keys.filter((key) => key !== "verification").map((key) => [key, strip(value[key])]));
    }
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, strip(entry)]));
  };
  const stripped = strip(document);
  if (!isRecord(stripped)) throw new Error("published mechanic document is not an object");
  return stripped as unknown as MechanicLockedModel;
}

function readEvidenceSha(bytes: Uint8Array, normalizedResults: NormalizedProbeResult[]): string {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!isRecord(parsed)) throw new Error("runtime evidence is not an object");
  const evidence = parsed as unknown as Parameters<typeof normalizeRuntimeEvidenceForApproval>[0];
  return sha256Hex(canonicalJson(normalizeRuntimeEvidenceForApproval(evidence, normalizedResults)));
}

function validatePreparedGate(prepared: PreparedMechanicsInputs, lock: MechanicsLock): void {
  const checks = checkMechanics(prepared);
  const failures = checks.filter((check) => check.status !== "PASS");
  if (failures.length > 0) throw new Error(failures.map((check) => `${check.id}: ${check.detail}`).join("\n"));
  if (prepared.evidenceBytes) {
    const evidence: unknown = JSON.parse(new TextDecoder().decode(prepared.evidenceBytes));
    if (!isRecord(evidence) || evidence.ranAt !== lock.snapshot.evidenceRanAt) throw new Error("BUILD_UNVERIFIED: runtime evidence ranAt differs from approved lock");
    if (readEvidenceSha(prepared.evidenceBytes, lock.snapshot.normalizedProbeResults) !== lock.snapshot.evidenceSha256) throw new Error("BUILD_UNVERIFIED: runtime evidence semantic hash differs from approved lock");
  }
}

function publicContracts(): PublicProbeContract[] {
  return MECHANIC_PROBE_CONTRACTS.map((contract) => publicProbeContract(contract));
}

function mechanicsArtifact(prepared: PreparedMechanicsInputs, lock: MechanicsLock, documents: readonly MechanicDocument[]): PublishedMechanics {
  const buildId = safeBuildId(prepared, lock);
  const publishedDocuments = documents.map((document) => {
    const locked = lock.documents[document.id];
    if (!locked) throw new Error(`mechanics lock is missing ${document.id}`);
    const candidate: MechanicLockedModel = { ...document, derivationExecutorSha256: lock.snapshot.derivationExecutorSha256, mechanicsSourceApprovalSha256: lock.snapshot.mechanicsSourceApprovalSha256 };
    if (lockedModelSha256(candidate) !== locked.modelSha256) throw new Error(`MODEL_CHANGED: ${document.id}`);
    return publishMechanicDocument(candidate, buildId, lock.snapshot.evidenceRanAt, locked.verifiedProbes);
  });
  const contracts = publicContracts();
  const approval = canonicalMechanicsApproval(lock, contracts);
  return {
    buildId,
    contractFixtureSha256: lock.snapshot.contractFixtureSha256,
    mechanicsSourceApprovalSha256: lock.snapshot.mechanicsSourceApprovalSha256,
    derivationExecutorSha256: lock.snapshot.derivationExecutorSha256,
    probeExecutorSha256: lock.snapshot.probeExecutorSha256,
    probeRuntimeSha256: lock.snapshot.probeRuntimeSha256,
    inspectorSha256: lock.snapshot.inspectorSha256,
    approvalGateSha256: lock.snapshot.approvalGateSha256,
    probeContracts: contracts,
    approval,
    approvalSha256: mechanicsApprovalSha256(lock, contracts),
    documents: publishedDocuments,
  };
}

function writeDatasetFiles(dataset: Dataset, dir: string): void {
  for (const table of TABLES) {
    const columns = table.columns.map((column) => column.name);
    const rows = ordered(dataset, table.name, columns);
    const json = table.name === SEARCH_INDEX_TABLE ? JSON.stringify((rows as Record<string, unknown>[]).map((row) => Object.fromEntries(Object.entries(SEARCH_INDEX_KEYS).map(([short, column]) => [short, row[column]])))) : `${JSON.stringify(rows, null, 2)}\n`;
    writeFileSync(path.join(dir, `${table.name}.json`), json);
    writeFileSync(path.join(dir, `${table.name}.csv`), toCsv(columns, dataset[table.name] ?? []));
  }
}

function copyTree(source: string, destination: string): void {
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true });
}

function atomicReplace(staging: string, destination: string, filesystem: PublishFilesystemAdapter): void {
  const backup = `${destination}.backup-${process.pid}-${Date.now()}`;
  const hadDestination = filesystem.exists(destination);
  try {
    if (hadDestination) filesystem.rename(destination, backup);
    filesystem.rename(staging, destination);
    if (hadDestination) filesystem.remove(backup);
  } catch (error) {
    if (hadDestination && filesystem.exists(backup) && !filesystem.exists(destination)) {
      try { filesystem.rename(backup, destination); } catch { /* Keep the original swap error. */ }
    }
    if (filesystem.exists(staging)) filesystem.remove(staging);
    if (filesystem.exists(backup) && filesystem.exists(destination)) filesystem.remove(backup);
    throw error;
  }
}

/**
 * Run the emitted-artifact checker over one staging tree.
 *
 * Publication prepared the lock, fixture, and approval bytes in this staging tree.
 * Pass those bytes to the checker instead of reopening them.
 * Reading them twice creates the gap that prepared inputs prevent.
 */
function assertStagingVerifies(
  stagingDir: string,
  prepared: PreparedMechanicsInputs,
  leases: LeaseSet,
  describe: string,
): void {
  {
    const staged = prepareStagedPublishedInputs(
      stagingDir,
      prepared.lockBytes!,
      prepared.contractFixtureBytes,
      prepared.mechanicsSourceApprovalBytes,
      {
        inspector: prepared.inspectorSha256,
        approvalGate: prepared.approvalGateSha256,
        derivation: prepared.derivationExecutorSha256,
        probeExecutor: prepared.probeExecutorSha256,
        runtime: prepared.probeRuntimeSha256,
        approvalSha256: prepared.mechanicsSourceApprovalSha256,
      },
      leases,
    );
    const failures = verifyPublished(staged).filter((check) => check.status === "FAIL");
    if (failures.length > 0) {
      throw new InvariantError(
        `${describe} failed emitted verification before any swap\n${failures.map((check) => `${check.id}: ${check.detail}`).join("\n")}`,
      );
    }
  }
}

export async function publish(prepared: PreparedMechanicsInputs, reviewedLock: MechanicsLock | Uint8Array, leases: LeaseSet, filesystem: PublishFilesystemAdapter = defaultFilesystem): Promise<PublishResult> {
  const lock = reviewedLock instanceof Uint8Array ? parseMechanicsLock(reviewedLock) : reviewedLock;
  validatePreparedGate(prepared, lock);
  const buildId = safeBuildId(prepared, lock);
  const composed = composeAll(prepared.extractedSnapshotPath);
  const documents = extractMechanics(prepared);
  const dataset = projectAll(composed, buildId, prepared.extractedSnapshotPath);
  appendMechanicSearchRows(dataset, documents);
  const failures = checkInvariants(dataset, composed, documents, { mechanicCount: documents.length }).filter((result) => result.status === "FAIL");
  if (failures.length > 0) throw new InvariantError(failures.map((result) => `${result.id}: ${result.detail}`).join("\n"));
  const mechanics = mechanicsArtifact(prepared, lock, documents);
  const missingImages: string[] = [];
  const imageRefs: ImageRef[] = collectImages(composed, prepared.extractedSnapshotPath, missingImages);
  const buildDestination = path.join("data", buildId);
  const latestDestination = path.join("data", LATEST_DIR);
  const buildStaging = `${buildDestination}.staging-${process.pid}-${Date.now()}`;
  const latestStaging = `${latestDestination}.staging-${process.pid}-${Date.now()}`;
  filesystem.mkdir(buildStaging);
  filesystem.mkdir(latestStaging);
  try {
    const variants = await writeImages(imageRefs, prepared.extractedSnapshotPath, buildStaging);
    writeDatasetFiles(dataset, buildStaging);
    writeFileSync(path.join(buildStaging, "index.json"), `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, buildId, generatedAt: String(dataset.meta?.find((row) => row.key === "generated_at")?.value ?? new Date().toISOString()), sqlite: SQLITE_FILENAME, mechanics: "mechanics.json", mechanicCount: documents.length, mechanicsApprovalSha256: mechanics.approvalSha256, images: { canonicalRoot: "images", canonicalCount: Object.keys(variants.entries).length, variantIndex: "images/variants.json", variantCount: Object.values(variants.entries).reduce((count, entry) => count + Object.keys(entry.variants).length, 0), configSha256: variants.configSha256, variants: { thumb: 64, card: 192, portrait: 384, wide: 640, hero: 1280 } }, tables: TABLES.map((table) => ({ name: table.name, slug: table.slug, kind: table.kind, rows: dataset[table.name]?.length ?? 0, primaryKey: [...table.primaryKey], columns: table.columns.map((column) => ({ name: column.name, type: column.type })), json: `${table.name}.json`, csv: `${table.name}.csv`, ...(table.name === SEARCH_INDEX_TABLE ? { jsonKeys: SEARCH_INDEX_KEYS } : {}) })) } satisfies Manifest, null, 2)}\n`);
    writeFileSync(path.join(buildStaging, "mechanics.json"), `${JSON.stringify(mechanics, null, 2)}\n`);
    writeSqlite(dataset, path.join(buildStaging, SQLITE_FILENAME));
    copyEvidence(prepared.evidenceBytes, path.join(buildStaging, "runtime-evidence.json"), "runtime evidence");
    copyEvidence(prepared.externalLeafEvidenceBytes, path.join(buildStaging, "external-leaf-evidence.json"), "external leaf evidence", prepared.externalLeafEvidenceSha256);
    // Check both staging trees completely before either swap. Publication is the last point to catch a malformed artifact before a reader sees it. Use the same checker as the standalone post-publication gate, not a lighter approximation.
    assertStagingVerifies(buildStaging, prepared, leases, "the build-stamped output");
    copyTree(buildStaging, latestStaging);
    assertStagingVerifies(latestStaging, prepared, leases, "the latest output");
    prepared.assertPreparedBuildCurrent();
    atomicReplace(buildStaging, buildDestination, filesystem);
    atomicReplace(latestStaging, latestDestination, filesystem);
    return { buildId, outDirs: [buildDestination, latestDestination], tables: TABLES.map((table) => ({ name: table.name, rows: dataset[table.name]?.length ?? 0 })), images: Object.keys(variants.entries).length, variants: Object.values(variants.entries).reduce((count, entry) => count + Object.keys(entry.variants).length, 0), missingImages };
  } catch (error) {
    if (filesystem.exists(buildStaging)) filesystem.remove(buildStaging);
    if (filesystem.exists(latestStaging)) filesystem.remove(latestStaging);
    throw error;
  }
}
