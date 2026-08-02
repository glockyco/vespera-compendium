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
 * Equipment stats are not literal.
 * The bundle declares base stats and then rewrites most equipment records at module scope.
 * It assigns class requirements, converts some primary stats between classes, and rescales each stat group.
 * It uses a level curve, a per-class power budget, and a per-slot share.
 *
 * A TypeScript copy of this model drifted.
 * Copied constants became stale, browser flags read as off outside the browser, and later lookup tables went unnoticed.
 * Each error changed published numbers without a visible failure.
 * This module runs the game's two entry points over the composed tables.
 * It slices the shipped source from the bundle without changes.
 */

/** Bundle functions that the gear pass calls from outside its region. */
const FUNCTIONS = [
  "normalizeClassId",
  "inferAccessoryClassFromItemId",
  "getArmorClassAffinityOverride",
  "getItemRequiredClass",
  "getWorldBossStatPower",
] as const;

/** Bundle constants that those functions read. */
const CONSTANTS = [
  "LEGACY_CLASS_ID_TO_CURRENT",
  "ARMOR_CLASS_AFFINITY_OVERRIDES",
  "WORLD_BOSS_STAT_POWER",
  "WORLD_BOSS_REFERENCE_CACHE",
  "EQUIPMENT_PERCENTAGE_STAT_KEYS",
] as const;

/**
 * Four earlier passes retune raw stats before the gear-balance pass rescales them.
 * They set each normal weapon tier to the previous tier's scenario power.
 * They set named endgame families to their heroic and nightmare references.
 * They set divine and soulbound gear to a multiple of those references.
 * The passes form one contiguous region and end with their own invocations.
 * They must run before the class-gear region.
 * The endgame pass reads the class requirement in the literals, not the later catalog value.
 */
const RAW_POWER_START = "const DIVINE_HEROIC_REFERENCE_BY_CLASS";
const RAW_POWER_END = "normalizeSoulboundRawPower();";

/**
 * The class-gear catalog and gear-balance pass form one contiguous run.
 * The run ends with their own invocations.
 * Take the region verbatim instead of rebuilding it declaration by declaration.
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
  /** Composed item table keyed by id. The game mutates it in place, and this code does the same. */
  items: DataRecord;
  /** Bundle symbol for the item table, as reported by its content anchor. */
  itemsSymbol: string;
  /** Composed recipe list for crafted gear levels. The pass edits it, so pass a copy. */
  recipes: DataRecord[];
  /** Bundle symbol for the recipe array. */
  recipesSymbol: string;
  /** Soulbound item definitions. The pass writes rescaled stats back into this table. */
  definitions: DataRecord;
  /** Shipped `__VESPERA_FEATURE_FLAGS__` object. It sets two class attack budgets. */
  featureFlags: DataRecord;
};

/** Run the shipped class-gear and gear-balance passes over `items` in place. */
export function applyGearBalance(input: GearBalanceInput): void {
  const { program, bindings } = buildProgram(input);
  evalComposition(`(()=>{\n${program}\n})()`, bindings);
}

/**
 * The balance level that the game assigns to each equipment item.
 * The game uses this level to scale stats.
 * Publish it as `items.level` so the compendium states the game's number instead of inferring it from a recipe.
 * `getCompleteGearBalanceLevel` returns null for world-boss gear and `the_last_memory`.
 * The game deliberately excludes those ids, so they are absent here.
 */
export type GearLevel = { level: number; downOnly: boolean };

export function gearBalanceLevels(input: GearBalanceInput): Record<string, GearLevel> {
  const { program, bindings } = buildProgram(input);
  // Build the recipe map once, not per item. The shipped helper walks every recipe on each call. Calling it inside the map makes this quadratic without changing the result.
  //
  // The `equipment` and `stats` gate comes from `normalizeCompleteGearBalance`.
  // Without it, the helper returns its rarity fallback for resources and consumables. The pipeline can then publish a balance level for items that the game never computes one for.
  const collect = [
    program,
    `const __recipeLevels = getCompleteGearRecipeLevels();`,
    `return Object.fromEntries(`,
    `  Object.values(${input.itemsSymbol})`,
    `    .filter((item) => item && item.id && item.type === "equipment" && item.stats)`,
    `    .map((item) => [item.id, getCompleteGearBalanceLevel(item, __recipeLevels)])`,
    `    .filter(([, level]) => level),`,
    `);`,
  ].join("\n");
  return evalComposition(`(()=>{\n${collect}\n})()`, bindings) as Record<string, GearLevel>;
}

/**
 * Slice the shipped source that both entry points run.
 *
 * Share this source instead of duplicating it.
 * The two paths must not diverge.
 * A level from another program can describe an item that the game does not ship.
 */
function buildProgram(input: GearBalanceInput): {
  program: string;
  bindings: Record<string, unknown>;
} {
  const { source } = input;
  const definitions = declarationByAnchor(source, [...SOULBOUND_PROBES], "{");
  const gearTiers = declarationByAnchor(source, [...GEAR_TIER_PROBES], "{");
  const rarityMultiplier = functionByAnchor(source, [...RARITY_MULTIPLIER_PROBES]);

  // The soulbound predicate is an arrow function. Match it directly instead of using declaration or function helpers. The match also proves which table it tests.
  const predicate =
    /([A-Za-z_$][\w$]*)\s*=\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*=>\s*Object\.prototype\.hasOwnProperty\.call\(\s*([A-Za-z_$][\w$]*)\s*,\s*\2\s*\)/.exec(
      source,
    );
  if (!predicate) throw new Error("missing soulbound predicate");
  if (predicate[3] !== definitions.symbol) {
    throw new Error(`soulbound predicate reads ${predicate[3]}, expected ${definitions.symbol}`);
  }

  const program = [
    // `CLASS_BALANCE_V2_ENABLED` comes from `window`, which the sandbox does not provide. Read the shipped flag instead, so barbarian and nightblade attack budgets match the game.
    `const CLASS_BALANCE_V2_ENABLED = ${input.featureFlags.classBalanceV2 !== false};`,
    ...CONSTANTS.map((name) => namedDeclarationSource(source, name)),
    `const ${gearTiers.symbol} = ${gearTiers.text};`,
    rarityMultiplier.text,
    `const ${predicate[1]!} = (${predicate[2]!}) => Object.prototype.hasOwnProperty.call(${definitions.symbol}, ${predicate[2]!});`,
    ...FUNCTIONS.map((name) => namedFunctionSource(source, name)),
    regionSource(source, RAW_POWER_START, RAW_POWER_END),
    regionSource(source, REGION_START, REGION_END),
  ].join("\n");

  return {
    program,
    bindings: {
      [input.itemsSymbol]: input.items,
      [input.recipesSymbol]: input.recipes,
      [definitions.symbol]: input.definitions,
    },
  };
}
