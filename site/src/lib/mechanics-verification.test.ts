import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  approvedProbeKeys,
  assertVerificationAgrees,
  bindingToken,
  bridgedBindingToken,
  canonicalJson,
  canonicalJsonBytes,
  canonicalSha256,
  deriveVerificationStatus,
  documentClaimTexts,
  documentTexts,
  evidenceApprovalSha256,
  GUIDE_LABEL_SELECTED_LIVE,
  GUIDE_LABEL_SOURCE,
  guideContentLabel,
  hasLiveCheckedContent,
  mechanicsApprovalPreimage,
  mechanicsApprovalSha256,
  normalizeRuntimeEvidenceForApproval,
  probeTupleKey,
  sha256Hex,
  VERIFICATION_LABEL,
} from "./mechanics-verification";
import type {
  MechanicEvidence,
  MechanicProbeRef,
  MechanicsApprovalInput,
  NormalizedProbeResult,
  PublicProbeContract,
  PublishedMechanicDocument,
  PublishedMechanicText,
  RuntimeEvidenceInput,
} from "./mechanics-verification";

/**
 * The published pages recompute the approval in the browser. That is only a check if the browser
 * and the pipeline hash identical bytes, so these vectors are fixed here and the same expected hex
 * values are pinned by `packages/core/src/canonical-public-evidence.test.ts`. A change to either
 * serializer breaks one side of the pair loudly rather than quietly relabelling the site.
 */

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

/** The bridged Defense session, which is where URL normalization actually earns its keep. */
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

const SELL_REF: MechanicProbeRef = {
  suite: "formulas",
  id: "sellValueRarityMultipliers",
  category: null,
  contractSha256: hex("b"),
  promotionEligible: true,
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

/** Pinned in `canonical-public-evidence.test.ts` too. Both runtimes must produce this. */
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

describe("canonical serialization", () => {
  test("sorts object keys at every depth", () => {
    const value = { zulu: 1, alpha: { nested: true, Alpha: false }, "": null };
    expect(canonicalJson(value)).toBe('{"":null,"alpha":{"Alpha":false,"nested":true},"zulu":1}');
  });

  test("key order does not change the hash", async () => {
    const forwards = { zulu: 1, alpha: { nested: true, Alpha: false }, "": null };
    const backwards = { "": null, alpha: { Alpha: false, nested: true }, zulu: 1 };
    expect(await canonicalSha256(forwards)).toBe(
      "2f7855956e266762745aabe72097dd9d2908f79e46c2a6ad38adc1e92e441b74",
    );
    expect(await canonicalSha256(backwards)).toBe(await canonicalSha256(forwards));
  });

  test("keeps nulls distinct from absence", async () => {
    const value = { a: null, b: [null, null], c: { d: null } };
    expect(canonicalJson(value)).toBe('{"a":null,"b":[null,null],"c":{"d":null}}');
    expect(await canonicalSha256(value)).toBe(
      "2713b3b615d7e09eccadee72c891418568839c137830c8975435b94da7375bf1",
    );
  });

  test("preserves array order and nesting", async () => {
    const value = [[], [1, [2, [3]]], [{ b: 1, a: 2 }]];
    expect(canonicalJson(value)).toBe('[[],[1,[2,[3]]],[{"a":2,"b":1}]]');
    expect(await canonicalSha256(value)).toBe(
      "0f065830e52e341b0cafbd137cac6f56eb65c773973cbe40209c9ac450ab2942",
    );
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  test("carries Unicode through as UTF-8, including astral planes and separators", async () => {
    const value = { "\u00e9": "Gr\u00fc\u00dfe", "\u2028": "\u{1f525}", note: "middle \u00b7 dot" };
    expect(canonicalJson(value)).toBe(
      `{"note":"middle \u00b7 dot","\u00e9":"Gr\u00fc\u00dfe","\u2028":"\u{1f525}"}`,
    );
    expect(await canonicalSha256(value)).toBe(
      "c10c54e3177bfe0050e76d73f458253ec60764428052385cdb010d85d5b40fe4",
    );
  });

  test("collapses negative zero, because a reader cannot tell two preimages apart", async () => {
    expect(canonicalJson({ zero: 0, negZero: -0 })).toBe('{"negZero":0,"zero":0}');
    expect(await canonicalSha256({ zero: 0, negZero: -0 })).toBe(
      "8ab2a5dd52a6dc86437748c64983c3d573e0840b259f96ac4599df383eb4bea7",
    );
  });

  test("refuses values JSON cannot round-trip", () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(/non-finite/);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(/non-finite/);
  });
});

describe("cross-runtime hashing", () => {
  test("crypto.subtle agrees with the pipeline's node digest on the same bytes", async () => {
    for (const value of [APPROVAL_SHA256, EVIDENCE, APPROVAL, CONTRACT]) {
      const bytes = canonicalJsonBytes(value as never);
      const node = createHash("sha256").update(bytes).digest("hex");
      expect(await sha256Hex(bytes)).toBe(node);
    }
  });

  test("hashes the empty byte string to the published SHA-256 identity", async () => {
    expect(await sha256Hex(new Uint8Array())).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("resource URL normalization", () => {
  test("a clean response is named by its semantic role", () => {
    expect(bindingToken("index")).toBe("index");
    expect(bindingToken("gameView")).toBe("gameView");
    expect(bindingToken("indexHtml")).toBe("indexHtml");
  });

  test("the bridged Defense response names its suffix and served bytes", () => {
    expect(bridgedBindingToken(hex("f"), hex("0"))).toBe(`index-bridged:${hex("f")}:${hex("0")}`);
  });

  test("a renamed bundle leaves the evidence hash unchanged", async () => {
    const renamed: RuntimeEvidenceInput = {
      ...EVIDENCE,
      extractedBundles: {
        ...BUNDLES,
        index: { ...BUNDLES.index, filename: "index-RENAMED.js" },
      },
    };
    expect(await evidenceApprovalSha256(renamed, [SELL_RESULT, DEFENSE_RESULT])).toBe(EVIDENCE_SHA256);
  });

  test("changed bytes do change the evidence hash", async () => {
    const rebuilt: RuntimeEvidenceInput = {
      ...EVIDENCE,
      extractedBundles: { ...BUNDLES, index: { ...BUNDLES.index, sha256: hex("9") } },
    };
    expect(await evidenceApprovalSha256(rebuilt, [SELL_RESULT, DEFENSE_RESULT])).not.toBe(EVIDENCE_SHA256);
  });
});

describe("evidence projection", () => {
  test("hashes to the pinned value", async () => {
    expect(await evidenceApprovalSha256(EVIDENCE, [SELL_RESULT, DEFENSE_RESULT])).toBe(EVIDENCE_SHA256);
  });

  test("drops filenames, sorts platform rows, and keeps role order", () => {
    const projection = normalizeRuntimeEvidenceForApproval(EVIDENCE, [SELL_RESULT, DEFENSE_RESULT]);
    const text = canonicalJson(projection);
    expect(text).not.toContain("index-XYZ.js");
    expect(text).not.toContain("filename");
    expect(text).toContain('"externalLeafCoverage":[{"id":"harness/cdp-evaluate"');
    expect(text).toContain('"platformArtifacts":[{"role":"bun"');
    expect(canonicalJson(projection).indexOf('"role":"indexHtml"')).toBeLessThan(
      canonicalJson(projection).indexOf('"role":"gameView"'),
    );
  });

  test("refuses a report that has no runtime bundle identities", () => {
    expect(() => normalizeRuntimeEvidenceForApproval({ ...EVIDENCE, runtimeBundles: null }, [])).toThrow(
      /runtime bundle identities/,
    );
  });

  test("refuses a schema-1 report", () => {
    expect(() => normalizeRuntimeEvidenceForApproval({ ...EVIDENCE, schemaVersion: 1 }, [])).toThrow(
      /schema version 2/,
    );
  });

  test("an observation change moves the hash", async () => {
    const drifted: NormalizedProbeResult = {
      ...SELL_RESULT,
      cases: [{ ...SELL_RESULT.cases[0]!, secondObserved: 101 }],
    };
    expect(await evidenceApprovalSha256(EVIDENCE, [drifted, DEFENSE_RESULT])).not.toBe(EVIDENCE_SHA256);
  });
});

describe("probe contract preimage", () => {
  test("hashes to the pinned value", async () => {
    expect(await canonicalSha256(CONTRACT)).toBe(
      "6619d3c31b519fa7068c1ed67e51035476eb31c94b5651db1bcefa5f18c4577d",
    );
  });

  test("every field is inside the preimage", async () => {
    const baseline = await canonicalSha256(CONTRACT);
    const mutations: PublicProbeContract[] = [
      { ...CONTRACT, suite: "other" },
      { ...CONTRACT, id: "other" },
      { ...CONTRACT, category: "combat" },
      { ...CONTRACT, resolver: "method" },
      { ...CONTRACT, bundle: "gameView" },
      { ...CONTRACT, methodName: "calculateXpGain" },
      { ...CONTRACT, bridgeSuffix: "\n;globalThis.x = y;\n" },
      { ...CONTRACT, expression: "floor(base)" },
      { ...CONTRACT, cases: [...CONTRACT.cases].reverse() },
      { ...CONTRACT, cases: [{ ...CONTRACT.cases[0]!, expected: 101 }, ...CONTRACT.cases.slice(1)] },
      { ...CONTRACT, cases: [{ ...CONTRACT.cases[0]!, input: { base: 101, quantity: 1, rarity: "common" } }, ...CONTRACT.cases.slice(1)] },
      { ...CONTRACT, claimBindings: [{ ...CONTRACT.claimBindings[0]!, promotionEligible: false }, ...CONTRACT.claimBindings.slice(1)] },
      { ...CONTRACT, claimBindings: [{ ...CONTRACT.claimBindings[0]!, textId: "elsewhere" }, ...CONTRACT.claimBindings.slice(1)] },
      { ...CONTRACT, claimBindings: [{ ...CONTRACT.claimBindings[0]!, derivationOutputId: "x" }, ...CONTRACT.claimBindings.slice(1)] },
      { ...CONTRACT, claimBindings: [{ ...CONTRACT.claimBindings[0]!, expectedRawValue: 0 }, ...CONTRACT.claimBindings.slice(1)] },
      { ...CONTRACT, executorSha256: hex("0") },
      { ...CONTRACT, contractSha256: hex("0") },
    ];
    for (const mutation of mutations) {
      expect(await canonicalSha256(mutation)).not.toBe(baseline);
    }
  });
});

describe("approval preimage", () => {
  test("hashes to the pinned value", async () => {
    expect(await mechanicsApprovalSha256(APPROVAL)).toBe(APPROVAL_SHA256);
  });

  test("keeps every declared member and nothing else", () => {
    const preimage = mechanicsApprovalPreimage(APPROVAL);
    if (typeof preimage !== "object" || preimage === null || Array.isArray(preimage)) {
      throw new Error("the approval preimage must be an object");
    }
    expect(Object.keys(preimage).sort()).toEqual(
      [
      "approvalGateSha256",
      "buildId",
      "bundles",
      "contractFixtureSha256",
      "derivationExecutorSha256",
      "evidenceRanAt",
      "evidenceSha256",
      "externalLeafEvidenceSha256",
      "inspectorSha256",
      "mechanicsSourceApprovalSha256",
      "probeContracts",
      "probeExecutorSha256",
        "probeRuntimeSha256",
        "documents",
      ].sort(),
    );
  });

  test("every closure hash and document model is inside the preimage", async () => {
    const mutations: MechanicsApprovalInput[] = [
      { ...APPROVAL, buildId: "24503451" },
      { ...APPROVAL, bundles: [...APPROVAL.bundles].reverse() },
      { ...APPROVAL, evidenceRanAt: "2026-08-01T18:31:00.000Z" },
      { ...APPROVAL, evidenceSha256: hex("0") },
      { ...APPROVAL, externalLeafEvidenceSha256: hex("0") },
      { ...APPROVAL, contractFixtureSha256: hex("0") },
      { ...APPROVAL, mechanicsSourceApprovalSha256: hex("0") },
      { ...APPROVAL, approvalGateSha256: hex("0") },
      { ...APPROVAL, derivationExecutorSha256: hex("0") },
      { ...APPROVAL, probeExecutorSha256: hex("0") },
      { ...APPROVAL, probeRuntimeSha256: hex("0") },
      { ...APPROVAL, inspectorSha256: hex("0") },
      { ...APPROVAL, probeContracts: [{ ...CONTRACT, contractSha256: hex("0") }] },
      { ...APPROVAL, documents: [{ id: "equipment-and-value", modelSha256: hex("0"), verifiedProbes: [SELL_REF] }] },
      { ...APPROVAL, documents: [{ id: "equipment-and-value", modelSha256: hex("e"), verifiedProbes: [] }] },
    ];
    for (const mutation of mutations) {
      expect(await mechanicsApprovalSha256(mutation)).not.toBe(APPROVAL_SHA256);
    }
  });
});

const evidence = (kind: MechanicEvidence["kind"], refs: MechanicProbeRef[]): MechanicEvidence => ({
  kind,
  sourceTargetIds: kind === "editorial" ? [] : ["target-1"],
  requiredProbes: refs,
});

const DEFENSE_REF: MechanicProbeRef = {
  suite: "formulas",
  id: "mitigationCap",
  category: null,
  contractSha256: hex("d"),
  promotionEligible: false,
};

describe("status derivation", () => {
  const approved = approvedProbeKeys([SELL_REF, DEFENSE_REF]);

  test("editorial wording is never promoted", () => {
    expect(deriveVerificationStatus(evidence("editorial", []), approved)).toBe("editorial");
    expect(deriveVerificationStatus(evidence("editorial", [SELL_REF]), approved)).toBe("editorial");
  });

  test("a claim with no requirements is source-verified", () => {
    expect(deriveVerificationStatus(evidence("game-authored", []), approved)).toBe("source-verified");
    expect(deriveVerificationStatus(evidence("source-derived", []), approved)).toBe("source-verified");
  });

  test("a passing promotion-eligible requirement is live-verified", () => {
    expect(deriveVerificationStatus(evidence("source-derived", [SELL_REF]), approved)).toBe("live-verified");
  });

  test("passing corroboration alone never promotes", () => {
    expect(deriveVerificationStatus(evidence("game-authored", [DEFENSE_REF]), approved)).toBe(
      "source-verified",
    );
  });

  test("one unmet requirement blocks promotion even when another passed", () => {
    const missing: MechanicProbeRef = { ...SELL_REF, id: "xpGainMultiplier", contractSha256: hex("7") };
    expect(deriveVerificationStatus(evidence("source-derived", [SELL_REF, missing]), approved)).toBe(
      "source-verified",
    );
  });

  test("a requirement whose contract hash moved no longer matches", () => {
    const rehashed: MechanicProbeRef = { ...SELL_REF, contractSha256: hex("0") };
    expect(deriveVerificationStatus(evidence("source-derived", [rehashed]), approved)).toBe(
      "source-verified",
    );
  });

  test("an absent category and a null category are the same requirement", () => {
    expect(probeTupleKey({ ...SELL_REF, category: undefined })).toBe(probeTupleKey(SELL_REF));
    expect(probeTupleKey({ ...SELL_REF, category: "combat" })).not.toBe(probeTupleKey(SELL_REF));
  });

  test("labels are the exact published words", () => {
    expect(VERIFICATION_LABEL.editorial).toBe("Compendium wording");
    expect(VERIFICATION_LABEL["source-verified"]).toBe("Source checked");
    expect(VERIFICATION_LABEL["live-verified"]).toBe("Live checked");
  });
});

const published = (
  id: string,
  text: string,
  kind: MechanicEvidence["kind"],
  refs: MechanicProbeRef[],
  status: PublishedMechanicText["verification"]["status"],
): PublishedMechanicText => ({
  id,
  text,
  evidence: evidence(kind, refs),
  verification: { status, buildId: "24503450", ranAt: "2026-08-01T18:30:00.000Z" },
});

function documentFixture(liveExpression: boolean): PublishedMechanicDocument {
  return {
    id: "equipment-and-value",
    title: published("equipment-and-value.title", "Equipment and Item Value", "editorial", [], "editorial"),
    category: "equipment",
    summary: published("equipment-and-value.summary", "Item level and sell value.", "editorial", [], "editorial"),
    sections: [
      {
        id: "equipment.sell",
        title: published("equipment.sell.title", "Sell value", "editorial", [], "editorial"),
        paragraphs: [published("equipment.sell.p0", "Vendors pay a fraction.", "game-authored", [], "source-verified")],
        bullets: [],
        formulas: [
          {
            id: "equipment.sell",
            label: published("equipment.sell.label", "Sell value", "editorial", [], "editorial"),
            expression: published(
              "equipment.sell.expression",
              "floor(base * ratio) * quantity",
              "game-authored",
              liveExpression ? [SELL_REF] : [],
              liveExpression ? "live-verified" : "source-verified",
            ),
            note: published("equipment.sell.note", "Quantity floors first.", "game-authored", [], "source-verified"),
          },
        ],
        facts: [
          {
            label: published("equipment.sell.rarity.rare.label", "Rare", "editorial", [], "editorial"),
            value: published("equipment.sell.rarity.rare.value", "122", "source-derived", [], "source-verified"),
          },
        ],
      },
    ],
    related: [
      {
        label: published("equipment-and-value.related.items.label", "Items", "editorial", [], "editorial"),
        href: published("equipment-and-value.related.items.href", "/items/", "editorial", [], "editorial"),
      },
    ],
  };
}

describe("document projections", () => {
  test("texts come out in the order the pages render them", () => {
    expect(documentTexts(documentFixture(true)).map((entry) => entry.id)).toEqual([
      "equipment-and-value.title",
      "equipment-and-value.summary",
      "equipment.sell.title",
      "equipment.sell.p0",
      "equipment.sell.label",
      "equipment.sell.expression",
      "equipment.sell.note",
      "equipment.sell.rarity.rare.label",
      "equipment.sell.rarity.rare.value",
      "equipment-and-value.related.items.label",
    ]);
  });

  test("claim texts are the formula and fact strings only", () => {
    expect(documentClaimTexts(documentFixture(true)).map((entry) => entry.id)).toEqual([
      "equipment.sell.label",
      "equipment.sell.expression",
      "equipment.sell.note",
      "equipment.sell.rarity.rare.label",
      "equipment.sell.rarity.rare.value",
    ]);
  });

  test("the card label is scoped to selected content", () => {
    expect(guideContentLabel(documentFixture(false))).toBe(GUIDE_LABEL_SOURCE);
    expect(guideContentLabel(documentFixture(true))).toBe(GUIDE_LABEL_SELECTED_LIVE);
    expect(GUIDE_LABEL_SOURCE).toBe("Game claims: Source checked");
    expect(GUIDE_LABEL_SELECTED_LIVE).toBe("Game claims: Source checked \u00b7 selected content live checked");
    expect(GUIDE_LABEL_SELECTED_LIVE).not.toContain("guide is live");
  });

  test("one live expression does not make the guide live", () => {
    const document = documentFixture(true);
    expect(hasLiveCheckedContent(document)).toBe(true);
    expect(document.title.verification.status).toBe("editorial");
    expect(document.sections[0]!.formulas[0]!.label.verification.status).toBe("editorial");
    expect(document.sections[0]!.formulas[0]!.note!.verification.status).toBe("source-verified");
  });
});

describe("published status agreement", () => {
  const approved = approvedProbeKeys([SELL_REF]);

  test("accepts an artifact whose statuses derive from its own evidence", () => {
    expect(() => assertVerificationAgrees(documentFixture(true), approved, "24503450")).not.toThrow();
    expect(() => assertVerificationAgrees(documentFixture(false), approved, "24503450")).not.toThrow();
  });

  test("rejects a claim promoted without the passing requirement", () => {
    const document = documentFixture(true);
    document.sections[0]!.formulas[0]!.expression.evidence.requiredProbes = [];
    expect(() => assertVerificationAgrees(document, approved, "24503450")).toThrow(
      /claims live-verified for equipment.sell.expression/,
    );
  });

  test("rejects a claim demoted while its requirement passed", () => {
    const document = documentFixture(true);
    document.sections[0]!.formulas[0]!.expression.verification.status = "source-verified";
    expect(() => assertVerificationAgrees(document, approved, "24503450")).toThrow(
      /derives live-verified/,
    );
  });

  test("rejects a text stamped with another build", () => {
    const document = documentFixture(false);
    document.summary.verification.buildId = "24503449";
    expect(() => assertVerificationAgrees(document, approved, "24503450")).toThrow(/approved build/);
  });
});
