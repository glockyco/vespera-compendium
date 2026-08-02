import { describe, expect, test } from "bun:test";
import {
  bindingToken,
  bridgedBindingToken,
  canonicalJson,
  canonicalJsonBytes,
  mechanicsApprovalPreimage,
  normalizeRuntimeEvidenceForApproval,
  toHex,
} from "./canonical-public-evidence.ts";
import type {
  CanonicalJson,
  MechanicsApprovalInput,
  NormalizedProbeResult,
  PublicProbeContract,
  RuntimeEvidenceInput,
} from "./canonical-public-evidence.ts";
import { canonicalSha256 } from "./source-hash.ts";

/** The browser-side site test must agree with these cross-runtime vectors. */
const hex = (character: string): string => character.repeat(64);

const CONTRACT: PublicProbeContract = {
  suite: "formulas",
  id: "sellValueRarityMultipliers",
  category: null,
  resolver: "function",
  bundle: "index",
  methodName: null,
  bridgeSuffix: null,
  expression: "floor(base * ratio[rarity]) * floor(quantity)",
  argumentTemplate: [{ value: "$.base" }, "$.rarity", "$.quantity"],
  cases: [
    { id: "rarity-common", input: { base: 100, quantity: 1, rarity: "common" }, expected: 100 },
    { id: "quantity-zero", input: { base: 100, quantity: 0, rarity: "common" }, expected: 0 },
    { id: "unknown-rarity", input: { base: 100, quantity: 1, rarity: "unknown" }, expected: 100 },
  ],
  claimBindings: [
    {
      textId: "equipment.sell.expression",
      expectedRawValue: null,
      derivationOutputId: null,
      promotionEligible: true,
    },
    {
      textId: "equipment.sell.rarity.rare.value",
      expectedRawValue: 122,
      derivationOutputId: "equipment.sell.rarity.rare",
      promotionEligible: true,
    },
  ],
  executorSha256: hex("a"),
  contractSha256: hex("b"),
};

const SELL_REF = {
  suite: "formulas",
  id: "sellValueRarityMultipliers",
  category: null,
  contractSha256: hex("b"),
  promotionEligible: true,
};

const SELL_RESULT: NormalizedProbeResult = {
  suite: "formulas",
  id: "sellValueRarityMultipliers",
  category: null,
  status: "PASS",
  contractSha256: hex("b"),
  resolver: "function",
  bundle: "index",
  boundModuleSha256: hex("c"),
  invocationBinding: bindingToken("index"),
  cleanBinding: null,
  cleanModuleSha256: null,
  servedResourceSha256: null,
  bridgeSuffixSha256: null,
  cases: [
    {
      id: "rarity-common",
      input: { base: 100, quantity: 1, rarity: "common" },
      expected: 100,
      firstObserved: 100,
      secondObserved: 100,
    },
  ],
};

const DEFENSE_RESULT: NormalizedProbeResult = {
  suite: "formulas",
  id: "mitigationCap",
  category: null,
  status: "PASS",
  contractSha256: hex("d"),
  resolver: "function",
  bundle: "index",
  boundModuleSha256: hex("e"),
  invocationBinding: bridgedBindingToken(hex("f"), hex("0")),
  cleanBinding: bindingToken("index"),
  cleanModuleSha256: hex("c"),
  servedResourceSha256: hex("0"),
  bridgeSuffixSha256: hex("f"),
  cases: [
    {
      id: "d1000-l256",
      input: { defense: 1000, level: 256 },
      expected: 0.13333333333333333,
      firstObserved: 0.13333333333333333,
      secondObserved: 0.13333333333333333,
    },
  ],
};

const fingerprint = (filename: string, bytes: number, character: string) => ({
  filename,
  bytes,
  sha256: hex(character),
});

const BUNDLES = {
  indexHtml: fingerprint("index.html", 1024, "1"),
  index: fingerprint("index-XYZ.js", 2048, "2"),
  gameView: fingerprint("GameView-XYZ.js", 4096, "3"),
};

const EVIDENCE: RuntimeEvidenceInput = {
  schemaVersion: 2,
  buildId: "24503450",
  ranAt: "2026-08-01T18:30:00.000Z",
  extractedBundles: BUNDLES,
  runtimeBundles: BUNDLES,
  probeRuntimeSha256: hex("4"),
  mechanicsSourceApprovalSha256: hex("5"),
  runtimeVersions: { bun: "1.3.14", node: "24.4.0", chrome: "141.0.0.0" },
  platformArtifacts: [
    { role: "node", sha256: hex("7") },
    { role: "bun", sha256: hex("6") },
  ],
  externalLeafCoverage: [
    { id: "node/text-encoder", status: "PASS", detail: "byte vector" },
    { id: "harness/cdp-evaluate", status: "PASS", detail: "browser realm" },
  ],
  mechanics: [{ id: "equipment-and-value", requiredProbes: [SELL_REF], passedProbes: [SELL_REF] }],
  results: [],
};

const EVIDENCE_SHA256 = "c70adb8be04ecbd586af5b2216956c24a1dfd2664f63b50fe83c214d7211e373";

const APPROVAL: MechanicsApprovalInput = {
  buildId: "24503450",
  bundles: [
    { role: "indexHtml", bytes: 1024, sha256: hex("1") },
    { role: "index", bytes: 2048, sha256: hex("2") },
    { role: "gameView", bytes: 4096, sha256: hex("3") },
  ],
  evidenceRanAt: "2026-08-01T18:30:00.000Z",
  evidenceSha256: EVIDENCE_SHA256,
  externalLeafEvidenceSha256: hex("8"),
  contractFixtureSha256: hex("9"),
  mechanicsSourceApprovalSha256: hex("5"),
  approvalGateSha256: hex("a"),
  derivationExecutorSha256: hex("b"),
  probeExecutorSha256: hex("c"),
  probeRuntimeSha256: hex("4"),
  inspectorSha256: hex("d"),
  probeContracts: [CONTRACT],
  documents: [{ id: "equipment-and-value", modelSha256: hex("e"), verifiedProbes: [SELL_REF] }],
};

const APPROVAL_SHA256 = "4ee081ac1a45cafaca95564c70ab6a35126833ecc36ba3a2a19a28a553ef8011";

describe("canonical public evidence vectors", () => {
  test("sorts nested objects, preserves arrays, and carries null and Unicode", () => {
    const value = {
      zulu: 1,
      alpha: { nested: true, Alpha: false },
      "": null,
      array: [{ value: "Grüße" }, ["🔥", -3]],
    };
    expect(canonicalJson(value)).toBe(
      '{"":null,"alpha":{"Alpha":false,"nested":true},"array":[{"value":"Grüße"},["🔥",-3]],"zulu":1}',
    );
  });

  test("pins key ordering and byte encoding", () => {
    const value = { zulu: 1, alpha: { nested: true, Alpha: false }, "": null };
    expect(canonicalJson(value)).toBe('{"":null,"alpha":{"Alpha":false,"nested":true},"zulu":1}');
    expect(canonicalSha256(value)).toBe(
      "2f7855956e266762745aabe72097dd9d2908f79e46c2a6ad38adc1e92e441b74",
    );
    expect(toHex(canonicalJsonBytes({ ok: true }))).toBe("7b226f6b223a747275657d");
  });

  test("collapses negative zero and keeps null distinct from absence", () => {
    expect(canonicalJson({ zero: 0, negZero: -0 })).toBe('{"negZero":0,"zero":0}');
    expect(canonicalSha256({ zero: 0, negZero: -0 })).toBe(
      "8ab2a5dd52a6dc86437748c64983c3d573e0840b259f96ac4599df383eb4bea7",
    );
    expect(canonicalJson({ a: null, b: [null, null], c: { d: null } })).toBe(
      '{"a":null,"b":[null,null],"c":{"d":null}}',
    );
    expect(canonicalSha256({ a: null, b: [null, null], c: { d: null } })).toBe(
      "2713b3b615d7e09eccadee72c891418568839c137830c8975435b94da7375bf1",
    );
  });

  test("rejects undefined members and non-finite numbers", () => {
    const invalidUndefined: unknown = { bad: undefined };
    expect(() => canonicalJson(invalidUndefined as CanonicalJson)).toThrow(/undefined member/);
    expect(() => canonicalJson(Number.NaN as unknown as CanonicalJson)).toThrow(/non-finite/);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY as unknown as CanonicalJson)).toThrow(/non-finite/);
  });
});

describe("runtime evidence approval projection", () => {
  test("pins the filename-free, sorted projection digest", () => {
    const projection = normalizeRuntimeEvidenceForApproval(EVIDENCE, [SELL_RESULT, DEFENSE_RESULT]);
    expect(canonicalSha256(projection)).toBe(EVIDENCE_SHA256);
    const text = canonicalJson(projection);
    expect(text).not.toContain("index-XYZ.js");
    expect(text).not.toContain("filename");
    expect(text).toContain('"externalLeafCoverage":[{"id":"harness/cdp-evaluate"');
    expect(text).toContain('"platformArtifacts":[{"role":"bun"');
    expect(bindingToken("index")).toBe("index");
    expect(bridgedBindingToken(hex("f"), hex("0"))).toBe(`index-bridged:${hex("f")}:${hex("0")}`);
  });

  test("requires schema 2 and runtime bundle identities", () => {
    expect(() => normalizeRuntimeEvidenceForApproval({ ...EVIDENCE, runtimeBundles: null }, [])).toThrow(
      /runtime bundle identities/,
    );
    expect(() => normalizeRuntimeEvidenceForApproval({ ...EVIDENCE, schemaVersion: 1 }, [])).toThrow(
      /schema version 2/,
    );
  });
});

describe("mechanics approval preimage", () => {
  test("includes every approval field in a stable canonical projection", () => {
    const preimage = mechanicsApprovalPreimage(APPROVAL);
    if (preimage === null || typeof preimage !== "object" || Array.isArray(preimage)) throw new Error("approval preimage must be an object");
    expect(canonicalJson(preimage)).toContain('"buildId":"24503450"');
    expect(Object.keys(preimage)).toEqual([
      "buildId",
      "bundles",
      "evidenceRanAt",
      "evidenceSha256",
      "externalLeafEvidenceSha256",
      "contractFixtureSha256",
      "mechanicsSourceApprovalSha256",
      "approvalGateSha256",
      "derivationExecutorSha256",
      "probeExecutorSha256",
      "probeRuntimeSha256",
      "inspectorSha256",
      "probeContracts",
      "documents",
    ]);
    expect(preimage).toMatchObject({
      buildId: "24503450",
      bundles: APPROVAL.bundles,
      evidenceRanAt: "2026-08-01T18:30:00.000Z",
      evidenceSha256: EVIDENCE_SHA256,
      externalLeafEvidenceSha256: hex("8"),
      contractFixtureSha256: hex("9"),
      mechanicsSourceApprovalSha256: hex("5"),
      approvalGateSha256: hex("a"),
      derivationExecutorSha256: hex("b"),
      probeExecutorSha256: hex("c"),
      probeRuntimeSha256: hex("4"),
      inspectorSha256: hex("d"),
      probeContracts: [CONTRACT],
      documents: [{ id: "equipment-and-value", modelSha256: hex("e"), verifiedProbes: [SELL_REF] }],
    });
    expect(canonicalSha256(preimage)).toBe(APPROVAL_SHA256);
  });
});
