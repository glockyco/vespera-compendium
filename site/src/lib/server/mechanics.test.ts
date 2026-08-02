import { describe, expect, test } from "bun:test";
import { mechanicsApprovalSha256 } from "../mechanics-verification";
import type { BundleIdentity, MechanicProbeRef, PublicProbeContract } from "../mechanics-verification";
import type { Row } from "./dataset";
import {
  MECHANIC_CATEGORY_HEADINGS,
  mechanicLinksFor,
  parsePublishedMechanics,
} from "./mechanics";

/**
 * Tests the record-to-guide map and artifact parser with synthetic documents.
 *
 * No test reads a published data directory.
 * The map must work before records exist, and the parser must reject impossible artifacts.
 */

const hex = (character: string): string => character.repeat(64);

const BUILD_ID = "24503450";
const RAN_AT = "2026-08-01T18:30:00.000Z";

const SELL_REF: MechanicProbeRef = {
  suite: "formulas",
  id: "sellValueRarityMultipliers",
  category: null,
  contractSha256: hex("b"),
  promotionEligible: true,
};

type TextSpec = {
  id: string;
  text: string;
  kind: "game-authored" | "source-derived" | "editorial";
  probes?: MechanicProbeRef[];
  status?: "editorial" | "source-verified" | "live-verified";
};

function text(spec: TextSpec) {
  const kind = spec.kind;
  return {
    id: spec.id,
    text: spec.text,
    evidence: {
      kind,
      sourceTargetIds: kind === "editorial" ? [] : ["equipment.sell.fn"],
      requiredProbes: spec.probes ?? [],
    },
    verification: {
      status: spec.status ?? (kind === "editorial" ? "editorial" : "source-verified"),
      buildId: BUILD_ID,
      ranAt: RAN_AT,
    },
  };
}

const DOCUMENT_META: readonly { id: string; category: string; title: string }[] = [
  { id: "combat-mathematics", category: "combat", title: "Combat Mathematics" },
  { id: "ability-calculations", category: "combat", title: "Ability Calculations" },
  { id: "skills-and-crafting", category: "skills", title: "Skills and Crafting" },
  { id: "equipment-and-value", category: "equipment", title: "Equipment and Item Value" },
  { id: "endgame-systems", category: "progression", title: "Endgame Systems" },
];

function documentJson(meta: { id: string; category: string; title: string }, live: boolean): unknown {
  return {
    id: meta.id,
    category: meta.category,
    title: text({ id: `${meta.id}.title`, text: meta.title, kind: "editorial" }),
    summary: text({ id: `${meta.id}.summary`, text: `${meta.title} in one line.`, kind: "editorial" }),
    sections: [
      {
        id: `${meta.id}.core`,
        title: text({ id: `${meta.id}.core.title`, text: "Core rules", kind: "editorial" }),
        paragraphs: [text({ id: `${meta.id}.core.p0`, text: "The game states the rule.", kind: "game-authored" })],
        bullets: [text({ id: `${meta.id}.core.b0`, text: "A game-authored bullet.", kind: "game-authored" })],
        formulas: [
          {
            id: `${meta.id}.core.formula`,
            label: text({ id: `${meta.id}.core.formula.label`, text: "Sell value", kind: "editorial" }),
            expression: text({
              id: `${meta.id}.core.formula.expression`,
              text: "floor(base * ratio) * quantity",
              kind: "game-authored",
              probes: live ? [SELL_REF] : [],
              status: live ? "live-verified" : "source-verified",
            }),
            note: text({ id: `${meta.id}.core.formula.note`, text: "Quantity floors first.", kind: "game-authored" }),
          },
        ],
        facts: [
          {
            label: text({ id: `${meta.id}.core.fact.label`, text: "Cap", kind: "editorial" }),
            value: text({ id: `${meta.id}.core.fact.value`, text: "0.75", kind: "source-derived" }),
          },
        ],
      },
    ],
    related: [
      {
        label: text({ id: `${meta.id}.related.items.label`, text: "Items", kind: "editorial" }),
        href: text({ id: `${meta.id}.related.items.href`, text: "/items/", kind: "editorial" }),
      },
    ],
  };
}

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
  cases: [{ id: "rarity-common", input: { base: 100, quantity: 1, rarity: "common" }, expected: 100 }],
  claimBindings: [
    {
      textId: "equipment-and-value.core.formula.expression",
      expectedRawValue: null,
      derivationOutputId: null,
      promotionEligible: true,
    },
  ],
  executorSha256: hex("a"),
  contractSha256: hex("b"),
};

const BUNDLES: BundleIdentity[] = [
  { role: "indexHtml", bytes: 1024, sha256: hex("1") },
  { role: "index", bytes: 2048, sha256: hex("2") },
  { role: "gameView", bytes: 4096, sha256: hex("3") },
];

/** Creates a complete artifact with a recomputed approval hash, so a fixture edit cannot agree with itself. */
async function artifact(
  mutate: (draft: Record<string, unknown>) => void = () => {},
): Promise<Record<string, unknown>> {
  const liveDocument = "equipment-and-value";
  const approval = {
    buildId: BUILD_ID,
    bundles: BUNDLES,
    evidenceRanAt: RAN_AT,
    evidenceSha256: hex("4"),
    externalLeafEvidenceSha256: hex("5"),
    contractFixtureSha256: hex("6"),
    mechanicsSourceApprovalSha256: hex("7"),
    approvalGateSha256: hex("8"),
    derivationExecutorSha256: hex("9"),
    probeExecutorSha256: hex("a"),
    probeRuntimeSha256: hex("b"),
    inspectorSha256: hex("c"),
    probeContracts: [CONTRACT],
    documents: DOCUMENT_META.map((meta) => ({
      id: meta.id,
      modelSha256: hex("d"),
      verifiedProbes: meta.id === liveDocument ? [SELL_REF] : [],
    })),
  };

  const draft: Record<string, unknown> = {
    buildId: BUILD_ID,
    contractFixtureSha256: hex("6"),
    mechanicsSourceApprovalSha256: hex("7"),
    derivationExecutorSha256: hex("9"),
    probeExecutorSha256: hex("a"),
    probeRuntimeSha256: hex("b"),
    inspectorSha256: hex("c"),
    approvalGateSha256: hex("8"),
    probeContracts: [CONTRACT],
    approval,
    approvalSha256: await mechanicsApprovalSha256(approval),
    documents: DOCUMENT_META.map((meta) => documentJson(meta, meta.id === liveDocument)),
  };
  mutate(draft);
  return draft;
}

/** Reaches one nested member of the plain fixture object without a cast. */
function at(value: unknown, ...path: (string | number)[]): Record<string, unknown> {
  let current: unknown = value;
  for (const step of path) {
    if (typeof step === "number") {
      if (!Array.isArray(current)) throw new Error(`fixture path ${path.join(".")} is not an array`);
      current = current[step];
    } else {
      if (!isRecord(current)) throw new Error(`fixture path ${path.join(".")} is not an object`);
      current = current[step];
    }
  }
  if (!isRecord(current)) throw new Error(`fixture path ${path.join(".")} is not an object`);
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("parsePublishedMechanics", () => {
  test("accepts a complete artifact and keeps document order", async () => {
    const parsed = await parsePublishedMechanics(await artifact(), null);
    expect(parsed.documents.map((entry) => entry.id)).toEqual(DOCUMENT_META.map((meta) => meta.id));
    expect(parsed.buildId).toBe(BUILD_ID);
    expect(parsed.approval.documents).toHaveLength(5);
  });

  test("accepts the manifest's approval hash when it agrees", async () => {
    const draft = await artifact();
    const approvalSha256 = draft.approvalSha256;
    if (typeof approvalSha256 !== "string") throw new Error("fixture lost its approval hash");
    await expect(parsePublishedMechanics(draft, approvalSha256)).resolves.toBeDefined();
  });

  test("rejects an artifact the manifest does not name", async () => {
    await expect(parsePublishedMechanics(await artifact(), hex("0"))).rejects.toThrow(
      /the manifest names approval/,
    );
  });

  test("rejects an approval hash that does not recompute", async () => {
    const draft = await artifact((value) => {
      value.approvalSha256 = hex("0");
    });
    await expect(parsePublishedMechanics(draft, null)).rejects.toThrow(/hashes to/);
  });

  test("rejects an edited approval, because the published hash no longer matches", async () => {
    const draft = await artifact((value) => {
      at(value, "approval").probeRuntimeSha256 = hex("0");
    });
    await expect(parsePublishedMechanics(draft, null)).rejects.toThrow(/hashes to/);
  });

  test("rejects a build stamp that disagrees with the approval", async () => {
    const draft = await artifact((value) => {
      value.buildId = "24503451";
    });
    await expect(parsePublishedMechanics(draft, null)).rejects.toThrow(/does not match approval build/);
  });

  test("rejects a document the approval does not cover", async () => {
    const draft = await artifact((value) => {
      at(value, "documents", 0).id = "unapproved-guide";
    });
    await expect(parsePublishedMechanics(draft, null)).rejects.toThrow(/not in the approval/);
  });

  test("rejects a duplicate document id", async () => {
    const draft = await artifact((value) => {
      at(value, "documents", 1).id = "combat-mathematics";
    });
    await expect(parsePublishedMechanics(draft, null)).rejects.toThrow(/published twice/);
  });

  test("rejects editorial wording that claims a source check", async () => {
    const draft = await artifact((value) => {
      at(value, "documents", 0, "title", "verification").status = "source-verified";
    });
    await expect(parsePublishedMechanics(draft, null)).rejects.toThrow(/editorial text but claims/);
  });

  test("rejects a game-authored claim with no source target", async () => {
    const draft = await artifact((value) => {
      at(value, "documents", 0, "sections", 0, "paragraphs", 0, "evidence").sourceTargetIds = [];
    });
    await expect(parsePublishedMechanics(draft, null)).rejects.toThrow(/must be nonempty/);
  });

  test("rejects a promotion the approved pass set does not support", async () => {
    const draft = await artifact((value) => {
      at(value, "documents", 0, "sections", 0, "formulas", 0, "expression", "verification").status =
        "live-verified";
    });
    await expect(parsePublishedMechanics(draft, null)).rejects.toThrow(/derives source-verified/);
  });

  test("rejects a section with a title and no content", async () => {
    const draft = await artifact((value) => {
      const section = at(value, "documents", 0, "sections", 0);
      section.paragraphs = [];
      section.bullets = [];
      section.formulas = [];
      section.facts = [];
    });
    await expect(parsePublishedMechanics(draft, null)).rejects.toThrow(/title and no content/);
  });

  test("rejects a related link that is not site-relative navigation", async () => {
    const draft = await artifact((value) => {
      at(value, "documents", 0, "related", 0, "href").text = "https://example.com/";
    });
    await expect(parsePublishedMechanics(draft, null)).rejects.toThrow(/site-relative path/);
  });

  test("rejects a related link that claims game provenance", async () => {
    const draft = await artifact((value) => {
      const href = at(value, "documents", 0, "related", 0, "href");
      at(href, "evidence").kind = "game-authored";
      at(href, "evidence").sourceTargetIds = ["x"];
      at(href, "verification").status = "source-verified";
    });
    await expect(parsePublishedMechanics(draft, null)).rejects.toThrow(/editorial navigation/);
  });

  test("rejects an unknown category", async () => {
    const draft = await artifact((value) => {
      at(value, "documents", 0).category = "lore";
    });
    await expect(parsePublishedMechanics(draft, null)).rejects.toThrow(/category must be/);
  });

  test("rejects a truncated document list", async () => {
    const draft = await artifact((value) => {
      const documents = value.documents;
      if (!Array.isArray(documents)) throw new Error("fixture lost its documents");
      value.documents = documents.slice(0, 4);
    });
    await expect(parsePublishedMechanics(draft, null)).rejects.toThrow(/the approval covers 5 documents/);
  });
});

const ROW: Row = { id: "ember_shard", name: "Ember Shard" };

/** Every table the contract maps, and the guide each one must reach. */
const MAPPED: readonly [string, string][] = [
  ["classes", "combat-mathematics"],
  ["enemies", "combat-mathematics"],
  ["abilities", "ability-calculations"],
  ["recipes", "skills-and-crafting"],
  ["gathering_nodes", "skills-and-crafting"],
  ["items", "equipment-and-value"],
  ["gems", "equipment-and-value"],
  ["affixes", "equipment-and-value"],
  // The publisher emits `shop_listings`. The contract names the same table `shops`.
  ["shop_listings", "equipment-and-value"],
  ["shops", "equipment-and-value"],
];

describe("mechanicLinksFor", () => {
  for (const [table, guide] of MAPPED) {
    test(`${table} points at ${guide}`, async () => {
      const parsed = await parsePublishedMechanics(await artifact(), null);
      const links = mechanicLinksFor(table, ROW, parsed.documents);
      expect(links).toHaveLength(1);
      expect(links[0]!.id).toBe(guide);
      expect(links[0]!.href).toBe(`/mechanics/${guide}/`);
      expect(links[0]!.title.length).toBeGreaterThan(0);
      expect(links[0]!.summary.length).toBeGreaterThan(0);
    });
  }

  test("the map covers exactly the contract's tables and nothing else", async () => {
    const parsed = await parsePublishedMechanics(await artifact(), null);
    const linked = MAPPED.filter(([table]) => mechanicLinksFor(table, ROW, parsed.documents).length === 1);
    expect(linked).toHaveLength(MAPPED.length);
  });

  test("an unknown table gets no link", async () => {
    const parsed = await parsePublishedMechanics(await artifact(), null);
    expect(mechanicLinksFor("dragons", ROW, parsed.documents)).toEqual([]);
  });

  test("tables whose guide names no record get no link", async () => {
    const parsed = await parsePublishedMechanics(await artifact(), null);
    for (const table of ["zones_dungeons", "quests", "world_bosses", "achievements"]) {
      expect(mechanicLinksFor(table, ROW, parsed.documents)).toEqual([]);
    }
  });

  test("a mapped table whose guide is unpublished fails loudly", async () => {
    const parsed = await parsePublishedMechanics(await artifact(), null);
    const without = parsed.documents.filter((entry) => entry.id !== "equipment-and-value");
    expect(() => mechanicLinksFor("items", ROW, without)).toThrow(
      /the items guide link names equipment-and-value/,
    );
  });
});

describe("category headings", () => {
  test("cover every published category once, in reading order", async () => {
    const parsed = await parsePublishedMechanics(await artifact(), null);
    expect(MECHANIC_CATEGORY_HEADINGS.map((entry) => entry.category)).toEqual([
      "combat",
      "skills",
      "equipment",
      "progression",
    ]);
    for (const document of parsed.documents) {
      expect(MECHANIC_CATEGORY_HEADINGS.some((entry) => entry.category === document.category)).toBe(true);
    }
  });
});
