import { evalComposition } from "@vespera/core";
import {
  declarationByAnchor,
  functionByAnchor,
  namedDeclarationSource,
  namedFunctionSource,
  regionSource,
  type DataRecord,
} from "./anchors.ts";

/**
 * Equipment stats are not literal. The bundle declares base stats, then rewrites nearly every
 * equipment record at module scope: it assigns class requirements, converts some primary stats
 * between classes, and rescales each stat group against a level curve, a per-class power budget and
 * a per-slot share.
 *
 * Restating that model in TypeScript is what drifted. Copied constants go stale, a feature flag that
 * is on in the browser reads as off outside it, and lookup tables added in a later build go
 * unnoticed — each one silently changing published numbers. So this module runs the game's own two
 * entry points, `applyClassGearSeparationCatalog` and `normalizeCompleteGearBalance`, over our
 * composed tables, with the shipped source sliced out of the bundle verbatim.
 */

/** Bundle functions the gear pass calls that live outside the pass's own region. */
const FUNCTIONS = [
  "normalizeClassId",
  "inferAccessoryClassFromItemId",
  "getArmorClassAffinityOverride",
  "getItemRequiredClass",
  "getWorldBossStatPower",
] as const;

/** Bundle constants those functions read. */
const CONSTANTS = [
  "LEGACY_CLASS_ID_TO_CURRENT",
  "ARMOR_CLASS_AFFINITY_OVERRIDES",
  "WORLD_BOSS_STAT_POWER",
  "WORLD_BOSS_REFERENCE_CACHE",
  "EQUIPMENT_PERCENTAGE_STAT_KEYS",
] as const;

/**
 * Four earlier passes retune raw stat values before the gear-balance pass rescales them: they pin
 * each normal weapon tier to the previous tier's scenario power, pin the named endgame families to
 * their heroic and nightmare references, and pin divine and soulbound gear to a multiple of those
 * references. They run as one contiguous region ending in their own invocations, and they must run
 * before the class-gear region because the endgame pass reads the class requirement the literals
 * declare, not the one the catalog later assigns.
 */
const RAW_POWER_START = "const DIVINE_HEROIC_REFERENCE_BY_CLASS";
const RAW_POWER_END = "normalizeSoulboundRawPower();";

/**
 * The class-gear catalog and the gear-balance pass form one contiguous run of statements that ends
 * in their own invocations, so the region is taken verbatim rather than reassembled declaration by
 * declaration.
 */
const REGION_START = "const CLASS_GEAR_SPECIAL_NIGHTMARE_RECIPE_PATTERN";
const REGION_END = "normalizeCompleteGearBalance();";

const SOULBOUND_PROBES = [/soulrender:\s*\{/, /classAffinity:/] as const;
const GEAR_TIER_PROBES = [/sword_cloudglass:\s*10/, /pants_eternal_shadow_vs:\s*15/] as const;
const RARITY_MULTIPLIER_PROBES = [
  /case "living":/,
  /case "mythic":/,
  /return 1\.7;/,
  /return 1\.22;/,
] as const;

export type GearBalanceInput = {
  /** The index bundle source. */
  source: string;
  /** Composed item table keyed by id. Mutated in place, exactly as the game mutates its own. */
  items: DataRecord;
  /** Bundle symbol the item table is declared under, as reported by its content anchor. */
  itemsSymbol: string;
  /** Composed recipe list, read for crafted gear levels. The pass also edits it, so pass a copy. */
  recipes: DataRecord[];
  /** Bundle symbol the recipe array is declared under. */
  recipesSymbol: string;
  /** Soulbound item definitions, the table the pass writes rescaled stats back into. */
  definitions: DataRecord;
  /** Shipped `__VESPERA_FEATURE_FLAGS__` object, which decides two of the class attack budgets. */
  featureFlags: DataRecord;
};

/** Runs the shipped class-gear and gear-balance passes over `items`, mutating it in place. */
export function applyGearBalance(input: GearBalanceInput): void {
  const { source } = input;
  const definitions = declarationByAnchor(source, [...SOULBOUND_PROBES], "{");
  const gearTiers = declarationByAnchor(source, [...GEAR_TIER_PROBES], "{");
  const rarityMultiplier = functionByAnchor(source, [...RARITY_MULTIPLIER_PROBES]);

  // The soulbound predicate is an arrow function, so it is matched directly rather than through the
  // declaration or function helpers. Matching it also proves which table it tests membership in.
  const predicate =
    /([A-Za-z_$][\w$]*)\s*=\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*=>\s*Object\.prototype\.hasOwnProperty\.call\(\s*([A-Za-z_$][\w$]*)\s*,\s*\2\s*\)/.exec(
      source,
    );
  if (!predicate) throw new Error("missing soulbound predicate");
  if (predicate[3] !== definitions.symbol) {
    throw new Error(`soulbound predicate reads ${predicate[3]}, expected ${definitions.symbol}`);
  }

  const program = [
    // `CLASS_BALANCE_V2_ENABLED` is derived from `window`, which no sandbox provides. Reading the
    // shipped flag instead keeps the barbarian and nightblade attack budgets matching the game.
    `const CLASS_BALANCE_V2_ENABLED = ${input.featureFlags.classBalanceV2 !== false};`,
    ...CONSTANTS.map((name) => namedDeclarationSource(source, name)),
    `const ${gearTiers.symbol} = ${gearTiers.text};`,
    rarityMultiplier.text,
    `const ${predicate[1]!} = (${predicate[2]!}) => Object.prototype.hasOwnProperty.call(${definitions.symbol}, ${predicate[2]!});`,
    ...FUNCTIONS.map((name) => namedFunctionSource(source, name)),
    regionSource(source, RAW_POWER_START, RAW_POWER_END),
    regionSource(source, REGION_START, REGION_END),
  ].join("\n");

  evalComposition(`(()=>{\n${program}\n})()`, {
    [input.itemsSymbol]: input.items,
    [input.recipesSymbol]: input.recipes,
    [definitions.symbol]: input.definitions,
  });
}
