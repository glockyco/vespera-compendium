import { describe, expect, test } from "bun:test";
import {
  canonicalSha256,
  probeContract,
  type CanonicalJson,
  type NormalizedProbeResult,
  type PublicProbeContract,
} from "@vespera/core";
import {
  assertPreparedMechanicsInputs,
  assertPreparedPublishedInputs,
  type PreparedMechanicsInputs,
  type PreparedPublishedInputs,
} from "./inputs.ts";
import {
  canonicalMechanicsApproval,
  describeModelDifference,
  lockedModelSha256,
  mechanicsApprovalSha256,
  normalizeEvidence,
  parseMechanicsLock,
  publicProbeContracts,
  serializeMechanicsLock,
  verifiedProbesFor,
  type MechanicsLock,
  type MechanicsLockDocument,
  type MechanicsLockSnapshot,
  type NormalizedEvidence,
} from "./mechanics-lock.ts";
import {
  parseMechanicsProof,
  parseMechanicsReviewArtifact,
  serializeMechanicsProof,
  serializeMechanicsReviewArtifact,
  deriveVerificationStatus,
  type MechanicsProof,
  type MechanicsReviewArtifact,
} from "./mechanics-artifacts.ts";
import type {
  MechanicDocument,
  MechanicLockedModel,
  MechanicProbeRef,
  MechanicText,
  MechanicDocumentId,
} from "./mechanics.ts";
import { MECHANIC_DOCUMENT_IDS } from "./mechanics.ts";

const hex = (character: string): string => character.repeat(64);
const now = new Date("2026-08-01T18:30:00.000Z");

function editorial(id: string, value = id): MechanicText {
  return { id, text: value, evidence: { kind: "editorial", sourceTargetIds: [], requiredProbes: [] } };
}

function sourceText(id: string, refs: MechanicProbeRef[] = [], sourceTargetIds = ["target"]): MechanicText {
  return { id, text: id, evidence: { kind: "source-derived", sourceTargetIds, requiredProbes: refs } };
}

function model(id: MechanicDocumentId, refs: MechanicProbeRef[] = []): MechanicLockedModel {
  const document: MechanicDocument = {
    id,
    title: editorial(`${id}.title`),
    category: id === "endgame-systems" ? "progression" : "combat",
    summary: editorial(`${id}.summary`),
    sections: [{
      id: "section",
      title: editorial(`${id}.section.title`),
      paragraphs: [sourceText(`${id}.claim`, refs)],
      bullets: [],
      formulas: [],
      facts: [],
    }],
    related: [],
    sourceTargets: [{ id: "target", bundle: "index", locator: { kind: "named-declaration", name: "root" }, sha256: hex("a") }],
    derivations: [],
  };
  return { ...document, derivationExecutorSha256: hex("d"), mechanicsSourceApprovalSha256: hex("s") };
}

function bundle(role: "indexHtml" | "index" | "gameView", filename = `${role}.js`, character = "b"): { filename: string; bytes: number; sha256: string } {
  return { filename, bytes: 10, sha256: hex(character) };
}

function emptySnapshot(): MechanicsLockSnapshot {
  const normalizedProbeResults: NormalizedProbeResult[] = [];
  return {
    buildId: "build-1",
    bundles: { indexHtml: bundle("indexHtml"), index: bundle("index"), gameView: bundle("gameView") },
    evidenceRanAt: now.toISOString(),
    evidenceSha256: hex("e"),
    externalLeafEvidenceSha256: hex("l"),
    normalizedProbeResults,
    normalizedProbeResultsSha256: canonicalSha256(normalizedProbeResults as unknown as CanonicalJson),
    mechanicsSourceApprovalSha256: hex("s"),
    approvalGateSha256: hex("g"),
    derivationExecutorSha256: hex("d"),
    probeExecutorSha256: hex("p"),
    probeRuntimeSha256: hex("r"),
    inspectorSha256: hex("i"),
    contractFixtureSha256: hex("f"),
  };
}

function lockWith(models: Record<string, MechanicLockedModel> = {}): MechanicsLock {
  const documents: Record<string, MechanicsLockDocument> = {};
  for (const id of MECHANIC_DOCUMENT_IDS) {
    const document = models[id] ?? model(id);
    documents[id] = { modelSha256: lockedModelSha256(document), verifiedProbes: [], model: document };
  }
  return { version: 1, snapshot: emptySnapshot(), documents };
}

function report(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 2,
    buildId: "build-1",
    ranAt: now.toISOString(),
    extractedBundles: { indexHtml: bundle("indexHtml"), index: bundle("index"), gameView: bundle("gameView") },
    runtimeBundles: { indexHtml: bundle("indexHtml"), index: bundle("index"), gameView: bundle("gameView") },
    probeRuntimeSha256: hex("r"),
    mechanicsSourceApprovalSha256: hex("s"),
    runtimeVersions: { bun: "1", node: "22", chrome: "1" },
    platformArtifacts: [],
    externalLeafCoverage: [],
    mechanics: [],
    results: [],
    ...overrides,
  };
}

function bytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function probeResult(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const contract = probeContract("formulas", id);
  if (!contract) throw new Error(`missing contract ${id}`);
  const cases = contract.cases.map((entry) => ({
    id: entry.id,
    input: entry.input,
    expected: entry.expected,
    firstObserved: entry.expected,
    secondObserved: entry.expected,
  }));
  return {
    suite: contract.suite,
    id: contract.id,
    category: contract.category,
    status: "PASS",
    resolver: contract.resolver,
    bundle: contract.bundle,
    contractSha256: contract.contractSha256,
    invocationResourceUrl: `https://game.test/assets/${id}.js`,
    boundModuleSha256: hex("b"),
    cases,
    ...overrides,
  };
}

function normalizedFor(id: string, overrides: Record<string, unknown> = {}): NormalizedEvidence {
  return normalizeEvidence(bytes(report({ results: [probeResult(id, overrides)] })), "build-1", now);
}

function ref(id: string, promotionEligible: boolean, contractSha256?: string): MechanicProbeRef {
  const contract = probeContract("formulas", id);
  if (!contract) throw new Error(`missing contract ${id}`);
  return { suite: contract.suite, id, category: contract.category, contractSha256: contractSha256 ?? contract.contractSha256, promotionEligible };
}

describe("mechanics lock parsing", () => {
  test("rejects malformed lock generations as LockCorruptError", () => {
    const lock = lockWith();
    expect(() => parseMechanicsLock(serializeMechanicsLock({ ...lock, version: 2 as 1 }))).toThrow(/version 1/);
    const missingSnapshot = { ...lock, snapshot: undefined };
    expect(() => parseMechanicsLock(bytes(missingSnapshot))).toThrow(/snapshot/);
    const malformedBundle = { ...lock, snapshot: { ...lock.snapshot, bundles: { ...lock.snapshot.bundles, index: { bytes: "10", sha256: hex("b") } } } };
    expect(() => parseMechanicsLock(bytes(malformedBundle))).toThrow(/bundle identity/);
    const edited = { ...lock, documents: { ...lock.documents, "combat-mathematics": { ...lock.documents["combat-mathematics"], model: { ...lock.documents["combat-mathematics"].model, title: editorial("changed", "changed") } } } };
    expect(() => parseMechanicsLock(bytes(edited))).toThrow(/model/);
    const nonExactProbes = { ...lock, documents: { ...lock.documents, "combat-mathematics": { ...lock.documents["combat-mathematics"], verifiedProbes: [ref("xpGainMultiplier", true)] } } };
    expect(() => parseMechanicsLock(bytes(nonExactProbes))).toThrow(/verifiedProbes/);
    const staleResults = { ...lock, snapshot: { ...lock.snapshot, normalizedProbeResultsSha256: hex("x") } };
    expect(() => parseMechanicsLock(bytes(staleResults))).toThrow(/normalized results/);
    const missingDocument = { ...lock, documents: Object.fromEntries(Object.entries(lock.documents).filter(([id]) => id !== "endgame-systems")) };
    expect(() => parseMechanicsLock(bytes(missingDocument))).toThrow(/no document endgame-systems/);
  });

  test("round trips canonical lock bytes", () => {
    const lock = lockWith();
    expect(parseMechanicsLock(serializeMechanicsLock(lock))).toEqual(lock);
  });
});

describe("runtime evidence normalization", () => {
  test("classifies malformed, mismatched, unresolved, and future evidence", () => {
    expect(normalizeEvidence(null, "build-1", now).status).toBe("MISSING");
    expect(normalizeEvidence(bytes(report({ schemaVersion: 1 })), "build-1", now).status).toBe("MALFORMED");
    expect(normalizeEvidence(bytes(report({ buildId: "other" })), "build-1", now).status).toBe("BUILD_MISMATCH");
    expect(normalizeEvidence(bytes(report({ runtimeBundles: null })), "build-1", now).status).toBe("MALFORMED");
    expect(normalizeEvidence(bytes(report({ ranAt: "2026-08-01T18:30:00Z" })), "build-1", now).status).toBe("MALFORMED");
    expect(normalizeEvidence(bytes(report({ ranAt: "2026-08-01T18:36:00.000Z" })), "build-1", now).status).toBe("MALFORMED");
    expect(normalizeEvidence(bytes(report({ results: [{ suite: "formulas", id: "mitigationCap", status: "UNKNOWN" }] })), "build-1", now).status).toBe("MALFORMED");
    expect(normalizeEvidence(bytes(report()), null, now).status).toBe("BUILD_UNRESOLVED");
  });

  test("normalizes URL diagnostics but binds semantic bytes and cases", () => {
    const first = normalizedFor("xpGainMultiplier");
    const renamed = normalizedFor("xpGainMultiplier", { invocationResourceUrl: "https://game.test/assets/renamed.js?cache=2" });
    if (first.status !== "VERIFIED" || renamed.status !== "VERIFIED") throw new Error("expected verified evidence");
    expect(renamed.evidenceSha256).toBe(first.evidenceSha256);
    expect(normalizedFor("xpGainMultiplier", { boundModuleSha256: hex("c") }).evidenceSha256).not.toBe(first.evidenceSha256);
    const changedInput = probeResult("xpGainMultiplier");
    const firstCase = changedInput.cases;
    if (!Array.isArray(firstCase)) throw new Error("missing cases");
    const changed = { ...changedInput, cases: firstCase.map((entry, index) => index === 0 && entry && typeof entry === "object" ? { ...entry, input: { changed: true } } : entry) };
    expect(normalizeEvidence(bytes(report({ results: [changed] })), "build-1", now).evidenceSha256).not.toBe(first.evidenceSha256);
    const changedExpected = probeResult("xpGainMultiplier");
    const expectedCases = changedExpected.cases;
    if (!Array.isArray(expectedCases)) throw new Error("missing cases");
    const expectedChanged = { ...changedExpected, cases: expectedCases.map((entry, index) => index === 0 && entry && typeof entry === "object" ? { ...entry, expected: 99 } : entry) };
    expect(normalizeEvidence(bytes(report({ results: [expectedChanged] })), "build-1", now).evidenceSha256).not.toBe(first.evidenceSha256);
    const changedObservation = probeResult("xpGainMultiplier");
    const observationCases = changedObservation.cases;
    if (!Array.isArray(observationCases)) throw new Error("missing cases");
    const observationChanged = { ...changedObservation, cases: observationCases.map((entry, index) => index === 0 && entry && typeof entry === "object" ? { ...entry, firstObserved: 99 } : entry) };
    expect(normalizeEvidence(bytes(report({ results: [observationChanged] })), "build-1", now).evidenceSha256).not.toBe(first.evidenceSha256);
  });
});

describe("probe promotion", () => {
  test("promotes only complete promoting obligations", () => {
    const noRequirements = sourceText("none");
    expect(deriveVerificationStatus(noRequirements, [])).toBe("source-verified");
    const defense = sourceText("defense", [ref("mitigationCap", false)]);
    expect(deriveVerificationStatus(defense, [ref("mitigationCap", false)])).toBe("source-verified");
    const xp = sourceText("xp", [ref("xpGainMultiplier", true)]);
    expect(deriveVerificationStatus(xp, [ref("xpGainMultiplier", true)])).toBe("live-verified");
    expect(deriveVerificationStatus(sourceText("two", [ref("xpGainMultiplier", true), ref("sellValueRarityMultipliers", true)]), [ref("xpGainMultiplier", true)])).toBe("source-verified");
    expect(deriveVerificationStatus(editorial("editorial"), [ref("xpGainMultiplier", true)])).toBe("editorial");
  });

  test("withholds a probe when any result, tuple, or case is not exact", () => {
    const contractId = "xpGainMultiplier";
    const document = model("combat-mathematics", [ref(contractId, true)]);
    const valid = normalizedFor(contractId);
    expect(valid.status).toBe("VERIFIED");
    const results = valid.normalizedResults;
    expect(verifiedProbesFor(document, results)).toHaveLength(1);
    for (const status of ["FAIL", "SKIPPED", "UNRESOLVED"] as const) {
      const evidence = normalizedFor(contractId, { status });
      expect(verifiedProbesFor(document, evidence.normalizedResults)).toHaveLength(0);
    }
    expect(verifiedProbesFor(document, normalizedFor(contractId, { contractSha256: hex("z") }).normalizedResults)).toHaveLength(0);
    expect(verifiedProbesFor(document, normalizedFor(contractId, { category: "wrong" }).normalizedResults)).toHaveLength(0);
    const duplicate = normalizeEvidence(bytes(report({ results: [probeResult(contractId), probeResult(contractId)] })), "build-1", now);
    expect(verifiedProbesFor(document, duplicate.normalizedResults)).toHaveLength(0);
    const altered = probeResult(contractId);
    const cases = altered.cases;
    if (!Array.isArray(cases)) throw new Error("missing cases");
    const alteredCases = { ...altered, cases: cases.map((entry, index) => index === 0 && entry && typeof entry === "object" ? { ...entry, firstObserved: 0 } : entry) };
    const alteredEvidence = normalizeEvidence(bytes(report({ results: [alteredCases] })), "build-1", now);
    expect(verifiedProbesFor(document, alteredEvidence.normalizedResults)).toHaveLength(0);
  });
});

describe("lock approval projections and model diagnostics", () => {
  test("names claims, citations, obligations, locators, and bundle roles", () => {
    const contract = probeContract("formulas", "xpGainMultiplier");
    if (!contract) throw new Error("missing contract");
    const approved = model("combat-mathematics", [ref(contract.id, true)]);
    const candidate: MechanicLockedModel = {
      ...approved,
      title: editorial("combat-mathematics.title", "changed"),
      sections: [{ ...approved.sections[0]!, paragraphs: [{ ...approved.sections[0]!.paragraphs[0]!, evidence: { ...approved.sections[0]!.paragraphs[0]!.evidence, sourceTargetIds: ["other"], requiredProbes: [ref(contract.id, false)] } }] }],
      sourceTargets: [{ ...approved.sourceTargets[0]!, bundle: "gameView", locator: { kind: "bounded-region", start: "start", end: "end", containsAll: [] } }],
    };
    const detail = describeModelDifference(approved, candidate);
    expect(detail).toContain("claim combat-mathematics.title text changed");
    expect(detail).toContain("claim combat-mathematics.claim citations changed");
    expect(detail).toContain("claim combat-mathematics.claim probe obligations changed");
    expect(detail).toContain("target bundle role changed");
    expect(detail).toContain("target locator changed");
  });

  test("rejects tampered review and proof hashes and unknown review fields", () => {
    const review = { version: 1, pathManifest: [], bundleFilenames: {}, review: { buildId: null }, reviewSha256: canonicalSha256({ buildId: null }) } as unknown as MechanicsReviewArtifact;
    expect(parseMechanicsReviewArtifact(serializeMechanicsReviewArtifact(review))).toEqual(review);
    expect(() => parseMechanicsReviewArtifact(bytes({ ...review, reviewSha256: hex("x") }))).toThrow(/reviewSha256/);
    const unknownReview = { ...review, review: { buildId: null, unknown: true }, reviewSha256: canonicalSha256({ buildId: null, unknown: true }) };
    expect(() => parseMechanicsReviewArtifact(bytes(unknownReview))).toThrow(/unknown field/);
    const proof = { version: 1, reviewSha256: hex("a"), semanticSourceManifestSha256: hex("b"), evidenceSha256: hex("c"), contractFixtureSha256: hex("d"), inspectAttestationSha256: hex("e"), executionTraceSha256s: [], proofSha256: canonicalSha256({ version: 1, reviewSha256: hex("a"), semanticSourceManifestSha256: hex("b"), evidenceSha256: hex("c"), contractFixtureSha256: hex("d"), inspectAttestationSha256: hex("e"), executionTraceSha256s: [] }) } satisfies MechanicsProof;
    expect(parseMechanicsProof(serializeMechanicsProof(proof))).toEqual(proof);
    expect(() => parseMechanicsProof(bytes({ ...proof, proofSha256: hex("x") }))).toThrow(/proof/);
  });

  test("changes the approval hash for every approved input domain", () => {
    const lock = lockWith();
    const contracts: PublicProbeContract[] = publicProbeContracts();
    const base = mechanicsApprovalSha256(lock, contracts);
    const changes: MechanicsLock[] = [];
    changes.push({ ...lock, documents: { ...lock.documents, "combat-mathematics": { ...lock.documents["combat-mathematics"], modelSha256: hex("x") } } });
    changes.push({ ...lock, documents: { ...lock.documents, "combat-mathematics": { ...lock.documents["combat-mathematics"], verifiedProbes: [ref("xpGainMultiplier", true)] } } });
    changes.push({ ...lock, snapshot: { ...lock.snapshot, bundles: { ...lock.snapshot.bundles, index: bundle("index", "renamed.js", "c") } } });
    changes.push({ ...lock, snapshot: { ...lock.snapshot, evidenceSha256: hex("x") } });
    changes.push({ ...lock, snapshot: { ...lock.snapshot, externalLeafEvidenceSha256: hex("x") } });
    changes.push({ ...lock, snapshot: { ...lock.snapshot, contractFixtureSha256: hex("x") } });
    changes.push({ ...lock, snapshot: { ...lock.snapshot, probeRuntimeSha256: hex("x") } });
    for (const changed of changes) expect(mechanicsApprovalSha256(changed, contracts)).not.toBe(base);
    expect(canonicalMechanicsApproval(lock, contracts)).toEqual(canonicalMechanicsApproval(lock, contracts));
  });

  test("membership guards reject forged prepared inputs", () => {
    const mechanics = {} as PreparedMechanicsInputs;
    const published = {} as PreparedPublishedInputs;
    expect(() => assertPreparedMechanicsInputs(mechanics)).toThrow(/not produced by prepareMechanicsInputs/);
    expect(() => assertPreparedPublishedInputs(published)).toThrow(/not produced by snapshotPublishedInputs|not produced by prepareStagedPublishedInputs/);
  });
});
