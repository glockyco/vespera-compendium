/**
 * The sole authoritative registry of live probe contracts.
 *
 * A probe is not `a name that passed`. It is one hashed object with exact inputs, outputs, resolver, bundle role, bridge suffix, and published claim bindings.
 * The pipeline, harness, and site read this object. The runtime case grid, shown fact, and approved obligation cannot drift into separate truths.
 * `contractSha256` is `hash({ executorSha256, contractWithoutHashes })`.
 * A change to execution logic, a case, an expectation, or a claim binding changes the hash. It marks affected documents `MODEL_CHANGED` and makes old evidence ineligible.
 */

import { canonicalJson, type BundleRole, type CanonicalJson, type PublicProbeContract } from "./canonical-public-evidence.ts";
import { MECHANIC_PROBE_EXECUTOR_SHA256 } from "./execution-source-hashes/index.ts";
import type {
  MechanicProbeCase,
  MechanicProbeClaimBinding,
  MechanicProbeContract,
} from "./mechanic-probe-executor.ts";
import { sha256Hex } from "./source-hash.ts";

export type { MechanicProbeCase, MechanicProbeClaimBinding, MechanicProbeContract };

/** Every live probe belongs to one suite. The name is part of the deduplicated execution tuple. */
export const MECHANIC_PROBE_SUITE = "formulas";

/**
 * The exact source appended to the index module served to the bridged harness session.
 *
 * One assignment captures the module-scope function object. It copies and reimplements nothing, so the probe calls the game's own code.
 * The served bytes differ from the shipped bytes. Every Defense claim binding is therefore ineligible for promotion.
 */
export const CANONICAL_BRIDGE_SUFFIX =
  "\n;globalThis.__VESPERA_DEFENSE_BRIDGE__ = getIncomingDefenseMitigation;\n";

/** SHA-256 of {@link CANONICAL_BRIDGE_SUFFIX}. Sync uses it to reconstruct the served bytes. */
export const CANONICAL_BRIDGE_SUFFIX_SHA256 = sha256Hex(new TextEncoder().encode(CANONICAL_BRIDGE_SUFFIX));

const DEFENSE_LEVEL_CAP = 256;
const DEFENSE_MITIGATION_CAP = 0.75;

/**
 * The expectation, stated independently of the game's source.
 *
 * A probe that uses the game's function to compute its expectation only shows that a value equals itself.
 * This independent statement is the claim. If the implementation changes, the probe fails.
 * A human then decides whether the compendium explanation is wrong or the game's balance changed.
 */
function expectedMitigation(defense: number, attackerLevel: number): number {
  const mitigationLevel = Math.min(DEFENSE_LEVEL_CAP, attackerLevel);
  const mitigation = defense / (defense + 100 + 25 * mitigationLevel);
  return attackerLevel > DEFENSE_LEVEL_CAP ? Math.min(DEFENSE_MITIGATION_CAP, mitigation) : mitigation;
}

const MITIGATION_DEFENSES = [0, 100, 1000, 100_000] as const;
const MITIGATION_LEVELS = [1, 50, 256, 10_000] as const;

/** Defense-major and level-minor. A reviewer reads one defense's full level curve on adjacent rows. */
const MITIGATION_CAP_CASES: MechanicProbeCase[] = MITIGATION_DEFENSES.flatMap((defense) =>
  MITIGATION_LEVELS.map((attackerLevel) => ({
    id: `d${defense}-l${attackerLevel}`,
    input: { defense, attackerLevel },
    expected: expectedMitigation(defense, attackerLevel),
  })),
);

/**
 * The two cases that isolate the level clamp.
 *
 * Both return the same number. Above Level 256, the mitigation level stops rising while enemy raw damage keeps rising.
 * One case cannot show this. The full grid hides the boundary.
 */
const MITIGATION_CLAMP_CASES: MechanicProbeCase[] = [
  { id: "d1000-l256", input: { defense: 1000, attackerLevel: 256 }, expected: expectedMitigation(1000, 256) },
  { id: "d1000-l10000", input: { defense: 1000, attackerLevel: 10_000 }, expected: expectedMitigation(1000, 10_000) },
];

const multiplierBonus = (target: string, value: number): CanonicalJson => ({
  source: "vespera-compendium-probe",
  target,
  type: "multiplier",
  value,
});

/** Checks target filtering, additive stacking of both bonus kinds, and the final floor. */
const XP_CASES: MechanicProbeCase[] = [
  { id: "base", input: { baseXp: 101, skillType: "combat", bonuses: [] }, expected: 101 },
  {
    id: "matching",
    input: { baseXp: 101, skillType: "combat", bonuses: [multiplierBonus("combatXp", 0.1)] },
    expected: 111,
  },
  {
    id: "global",
    input: { baseXp: 101, skillType: "combat", bonuses: [multiplierBonus("xpBonus", 0.2)] },
    expected: 121,
  },
  {
    id: "both",
    input: {
      baseXp: 101,
      skillType: "combat",
      bonuses: [multiplierBonus("combatXp", 0.1), multiplierBonus("xpBonus", 0.2)],
    },
    expected: 131,
  },
  {
    id: "mismatched",
    input: { baseXp: 101, skillType: "combat", bonuses: [multiplierBonus("gatheringXp", 0.5)] },
    expected: 101,
  },
];

/**
 * The full rarity grid plus four edge cases.
 *
 * The grid fixes the ratios `[1, 1.1, 1.22, 1.36, 1.52, 1.7, 1.52]`.
 * Legendary and Living both use 1.52. This coincidence can look like a transcription error without this case grid.
 * The edge cases fix the unknown-rarity fallback, quantity floor, and final value floor.
 */
const SELL_CASES: MechanicProbeCase[] = [
  { id: "rarity-common", input: { baseValue: 100, rarity: "common", quantity: 1 }, expected: 100 },
  { id: "rarity-uncommon", input: { baseValue: 100, rarity: "uncommon", quantity: 1 }, expected: 110 },
  { id: "rarity-rare", input: { baseValue: 100, rarity: "rare", quantity: 1 }, expected: 122 },
  { id: "rarity-epic", input: { baseValue: 100, rarity: "epic", quantity: 1 }, expected: 136 },
  { id: "rarity-living", input: { baseValue: 100, rarity: "living", quantity: 1 }, expected: 152 },
  { id: "rarity-mythic", input: { baseValue: 100, rarity: "mythic", quantity: 1 }, expected: 170 },
  { id: "rarity-legendary", input: { baseValue: 100, rarity: "legendary", quantity: 1 }, expected: 152 },
  { id: "quantity-zero", input: { baseValue: 100, rarity: "common", quantity: 0 }, expected: 0 },
  { id: "rare-quantity-three", input: { baseValue: 100, rarity: "rare", quantity: 3 }, expected: 366 },
  { id: "fractional-uncommon", input: { baseValue: 10.5, rarity: "uncommon", quantity: 3 }, expected: 34 },
  { id: "unknown-rarity", input: { baseValue: 100, rarity: "unknown", quantity: 1 }, expected: 100 },
];

const SELL_RARITIES = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "living",
  "mythic",
  "legendary",
] as const;

/** The dependency closure of the incoming-mitigation implementation, per document. */
const mitigationTargets = (derivationId: string): string[] => [
  `derivation.${derivationId}.node.0`,
  `derivation.${derivationId}.node.1`,
  `derivation.${derivationId}.node.2`,
];

const COMBAT_MITIGATION_DERIVATION = "combat.defense.mitigation";
const ENDGAME_MITIGATION_DERIVATION = "endgame.shared-defense.mitigation";
const SKILLS_XP_DERIVATION = "skills.xp";
const EQUIPMENT_SELL_DERIVATION = "equipment.sell";

/** The codex literal that both Defense expressions quote verbatim. */
const CODEX_MITIGATION_TARGET = "codex.normalMitigation.expression";

/** The endgame bullet that states the same rule in the game's own prose. */
const ENDGAME_DEFENSE_BULLET_TARGET = "endgame.section.shared-math.bullet.1";

type ContractWithoutHashes = Omit<MechanicProbeContract, "executorSha256" | "contractSha256">;

const DEFENSE_CORROBORATION: MechanicProbeClaimBinding[] = [
  {
    textId: "combat.defense.normal-mitigation.expression",
    expectedRawValue: "M = D / [D + 100 + 25 × min(L, 256)]; L > 256: M ≤ 75%",
    sourceTargetIds: [CODEX_MITIGATION_TARGET],
    derivationOutputId: null,
    promotionEligible: false,
  },
  {
    textId: "endgame.shared-defense.normal-mitigation.expression",
    expectedRawValue: "M = D / [D + 100 + 25 × min(L, 256)]; L > 256: M ≤ 75%",
    sourceTargetIds: [CODEX_MITIGATION_TARGET, ENDGAME_DEFENSE_BULLET_TARGET],
    derivationOutputId: null,
    promotionEligible: false,
  },
];

const CONTRACTS_WITHOUT_HASHES: ContractWithoutHashes[] = [
  {
    suite: MECHANIC_PROBE_SUITE,
    id: "mitigationCap",
    category: null,
    resolver: "function",
    bundle: "index" satisfies BundleRole,
    methodName: null,
    bridgeSuffix: CANONICAL_BRIDGE_SUFFIX,
    expression: "M = D / [D + 100 + 25 × min(L, 256)]; L > 256: M ≤ 75%",
    argumentTemplate: ["$.defense", "$.attackerLevel"],
    cases: MITIGATION_CAP_CASES,
    claimBindings: [
      ...DEFENSE_CORROBORATION,
      {
        textId: "combat.defense.mitigation-cap.value",
        expectedRawValue: DEFENSE_MITIGATION_CAP,
        sourceTargetIds: mitigationTargets(COMBAT_MITIGATION_DERIVATION),
        derivationOutputId: `${COMBAT_MITIGATION_DERIVATION}.cap`,
        promotionEligible: false,
      },
      {
        textId: "endgame.shared-defense.mitigation-cap.value",
        expectedRawValue: DEFENSE_MITIGATION_CAP,
        sourceTargetIds: mitigationTargets(ENDGAME_MITIGATION_DERIVATION),
        derivationOutputId: `${ENDGAME_MITIGATION_DERIVATION}.cap`,
        promotionEligible: false,
      },
    ],
  },
  {
    suite: MECHANIC_PROBE_SUITE,
    id: "mitigationLevelClamp",
    category: null,
    resolver: "function",
    bundle: "index" satisfies BundleRole,
    methodName: null,
    bridgeSuffix: CANONICAL_BRIDGE_SUFFIX,
    expression: "mitigation level = min(attacker level, 256)",
    argumentTemplate: ["$.defense", "$.attackerLevel"],
    cases: MITIGATION_CLAMP_CASES,
    claimBindings: [
      ...DEFENSE_CORROBORATION,
      {
        textId: "combat.defense.level-clamp.value",
        expectedRawValue: DEFENSE_LEVEL_CAP,
        sourceTargetIds: mitigationTargets(COMBAT_MITIGATION_DERIVATION),
        derivationOutputId: `${COMBAT_MITIGATION_DERIVATION}.level-clamp`,
        promotionEligible: false,
      },
      {
        textId: "endgame.shared-defense.level-clamp.value",
        expectedRawValue: DEFENSE_LEVEL_CAP,
        sourceTargetIds: mitigationTargets(ENDGAME_MITIGATION_DERIVATION),
        derivationOutputId: `${ENDGAME_MITIGATION_DERIVATION}.level-clamp`,
        promotionEligible: false,
      },
    ],
  },
  {
    suite: MECHANIC_PROBE_SUITE,
    id: "xpGainMultiplier",
    category: null,
    resolver: "method",
    bundle: "index" satisfies BundleRole,
    methodName: "calculateXpGain",
    bridgeSuffix: null,
    expression: "XP = floor(Base XP × [1 + Skill XP bonus + Global XP bonus])",
    argumentTemplate: ["$"],
    cases: XP_CASES,
    claimBindings: [
      {
        textId: "skills.xp.multiplier.expression",
        expectedRawValue: "XP = floor(Base XP × [1 + Skill XP bonus + Global XP bonus])",
        sourceTargetIds: [
          "skills.region.gather-craft",
          `derivation.${SKILLS_XP_DERIVATION}.node.0`,
          `derivation.${SKILLS_XP_DERIVATION}.node.1`,
        ],
        derivationOutputId: null,
        promotionEligible: true,
      },
      ...XP_CASES.map((declared) => ({
        textId: `skills.xp.example.${declared.id}.value`,
        expectedRawValue: declared.expected,
        sourceTargetIds: [
          `derivation.${SKILLS_XP_DERIVATION}.node.0`,
          `derivation.${SKILLS_XP_DERIVATION}.node.1`,
        ],
        derivationOutputId: `${SKILLS_XP_DERIVATION}.${declared.id}`,
        promotionEligible: true,
      })),
    ],
  },
  {
    suite: MECHANIC_PROBE_SUITE,
    id: "sellValueRarityMultipliers",
    category: null,
    resolver: "function",
    bundle: "index" satisfies BundleRole,
    methodName: null,
    bridgeSuffix: null,
    expression: "Sell = floor(Base value × Rarity multiplier × floor(Quantity))",
    argumentTemplate: [{ value: "$.baseValue" }, "$.rarity", "$.quantity"],
    cases: SELL_CASES,
    claimBindings: [
      {
        textId: "equipment.sell.expression",
        expectedRawValue: "Sell = floor(Base value × Rarity multiplier × floor(Quantity))",
        sourceTargetIds: [
          `derivation.${EQUIPMENT_SELL_DERIVATION}.node.0`,
          `derivation.${EQUIPMENT_SELL_DERIVATION}.node.1`,
        ],
        derivationOutputId: null,
        promotionEligible: true,
      },
      ...SELL_RARITIES.map((rarity) => {
        const declared = SELL_CASES.find((entry) => entry.id === `rarity-${rarity}`)!;
        return {
          textId: `equipment.sell.rarity.${rarity}.value`,
          expectedRawValue: declared.expected,
          sourceTargetIds: [
            `derivation.${EQUIPMENT_SELL_DERIVATION}.node.0`,
            `derivation.${EQUIPMENT_SELL_DERIVATION}.node.1`,
          ],
          derivationOutputId: `${EQUIPMENT_SELL_DERIVATION}.rarity.${rarity}`,
          promotionEligible: true,
        };
      }),
      ...["quantity-zero", "rare-quantity-three", "fractional-uncommon", "unknown-rarity"].map((caseId) => {
        const declared = SELL_CASES.find((entry) => entry.id === caseId)!;
        return {
          textId: `equipment.sell.edge.${caseId}.value`,
          expectedRawValue: declared.expected,
          sourceTargetIds: [
            `derivation.${EQUIPMENT_SELL_DERIVATION}.node.0`,
            `derivation.${EQUIPMENT_SELL_DERIVATION}.node.1`,
          ],
          derivationOutputId: `${EQUIPMENT_SELL_DERIVATION}.edge.${caseId}`,
          promotionEligible: true,
        };
      }),
    ],
  },
];

/** The exact preimage of a contract hash: the contract without either hash, plus the executor hash. */
export function probeContractPreimage(contract: ContractWithoutHashes): CanonicalJson {
  return {
    executorSha256: MECHANIC_PROBE_EXECUTOR_SHA256,
    contract: {
      suite: contract.suite,
      id: contract.id,
      category: contract.category,
      resolver: contract.resolver,
      bundle: contract.bundle,
      methodName: contract.methodName,
      bridgeSuffix: contract.bridgeSuffix,
      expression: contract.expression,
      argumentTemplate: [...contract.argumentTemplate],
      cases: contract.cases.map((declared) => ({
        id: declared.id,
        input: declared.input,
        expected: declared.expected,
      })),
      claimBindings: contract.claimBindings.map((binding) => ({
        textId: binding.textId,
        expectedRawValue: binding.expectedRawValue,
        sourceTargetIds: [...binding.sourceTargetIds],
        derivationOutputId: binding.derivationOutputId,
        promotionEligible: binding.promotionEligible,
      })),
    },
  };
}

function materialize(contract: ContractWithoutHashes): MechanicProbeContract {
  return {
    ...contract,
    executorSha256: MECHANIC_PROBE_EXECUTOR_SHA256,
    contractSha256: sha256Hex(new TextEncoder().encode(canonicalJson(probeContractPreimage(contract)))),
  };
}

/** The registry, in fixed order. */
export const MECHANIC_PROBE_CONTRACTS: readonly MechanicProbeContract[] = Object.freeze(
  CONTRACTS_WITHOUT_HASHES.map(materialize),
);

const byKey = new Map(
  MECHANIC_PROBE_CONTRACTS.map((contract) => [`${contract.suite}\u0000${contract.id}`, contract]),
);

/** The contract for one execution tuple, or `null` when the tuple names no reviewed contract. */
export function probeContract(suite: string, id: string): MechanicProbeContract | null {
  return byKey.get(`${suite}\u0000${id}`) ?? null;
}

/** Every claim binding for one published text ID, across all contracts. */
export function claimBindingsForText(textId: string): { contract: MechanicProbeContract; binding: MechanicProbeClaimBinding }[] {
  const found: { contract: MechanicProbeContract; binding: MechanicProbeClaimBinding }[] = [];
  for (const contract of MECHANIC_PROBE_CONTRACTS) {
    for (const binding of contract.claimBindings) {
      if (binding.textId === textId) found.push({ contract, binding });
    }
  }
  return found;
}

/**
 * The browser-visible projection of one contract.
 *
 * It contains everything a visitor needs to check the arithmetic. Source locators and target IDs stay private.
 */
export function publicProbeContract(contract: MechanicProbeContract): PublicProbeContract {
  return {
    suite: contract.suite,
    id: contract.id,
    category: contract.category,
    resolver: contract.resolver,
    bundle: contract.bundle,
    methodName: contract.methodName,
    bridgeSuffix: contract.bridgeSuffix,
    expression: contract.expression,
    argumentTemplate: [...contract.argumentTemplate],
    cases: contract.cases.map((declared) => ({
      id: declared.id,
      input: declared.input,
      expected: declared.expected,
    })),
    claimBindings: contract.claimBindings.map((binding) => ({
      textId: binding.textId,
      expectedRawValue: binding.expectedRawValue,
      derivationOutputId: binding.derivationOutputId,
      promotionEligible: binding.promotionEligible,
    })),
    executorSha256: contract.executorSha256,
    contractSha256: contract.contractSha256,
  };
}

/**
 * Recomputes every registry hash from the approved executor constant.
 *
 * Registry changes flow through the mechanics model and its review, not through the executor's source closure.
 * This separate operation checks that the published contract hashes match this registry.
 */
export function checkProbeContractHashes(): { id: string; expected: string; actual: string }[] {
  return CONTRACTS_WITHOUT_HASHES.map((contract, index) => ({
    id: contract.id,
    expected: MECHANIC_PROBE_CONTRACTS[index]!.contractSha256,
    actual: sha256Hex(new TextEncoder().encode(canonicalJson(probeContractPreimage(contract)))),
  }));
}
