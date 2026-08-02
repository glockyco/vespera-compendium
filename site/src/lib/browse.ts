/**
 * Defines each entity browser and its record order.
 *
 * Each table names its columns instead of using the schema.
 * The schema includes descriptions, dialogue, accent colors, and display keys.
 * Those columns make a grid hard to scan. The full row stays in `/query/` and the CSV files.
 */

/**
 * Lists every entity table in one reading order.
 *
 * The home page uses a flat order instead of player questions.
 * Question groups made the home page a directory of riddles.
 * The twelve counts were the useful content.
 * The order starts with classes, abilities, and gems.
 * It then covers places and enemies, followed by records to carry, make, or sell.
 */
export const COMPENDIUM_INDEX: string[] = [
  "classes",
  "abilities",
  "gems",
  "zones_dungeons",
  "enemies",
  "world_bosses",
  "quests",
  "items",
  "recipes",
  "gathering_nodes",
  "shop_listings",
  "achievements",
];

/**
 * Defines the three chapters of the normal Combat route.
 *
 * The bounds use the game's gates, not equal thirds.
 * Each chapter opens on a zone and closes at the dungeon before the next zone.
 * The last chapter has no `to` value because the route ends at the highest shipped place.
 */
export type RouteChapter = {
  id: string;
  label: string;
  blurb: string;
  from: number;
  to: number | null;
};

export const ROUTE_CHAPTERS: RouteChapter[] = [
  {
    id: "frontier",
    label: "The Frontier",
    blurb: "Begin in these zones. Learn one class, gather the first materials, and clear one dungeon.",
    from: 1,
    to: 34,
  },
  {
    id: "contested-lands",
    label: "Contested Lands",
    blurb: "This middle route lets gear set the pace. A dungeon closes each stretch.",
    from: 35,
    to: 68,
  },
  {
    id: "endgame",
    label: "Endgame",
    blurb: "These are the last normal places. Nightmare, the Tower, the Spire, and the Frontier follow them.",
    from: 69,
    to: null,
  },
];

/**
 * Names one row from each table.
 *
 * The map is explicit because a trailing `s` produces wrong forms.
 * Examples include "abilitie", "enemie", and "affixe".
 * The twelve names form a closed set.
 */
export const TABLE_SINGULAR: Record<string, string> = {
  items: "item",
  enemies: "enemy",
  recipes: "recipe",
  gathering_nodes: "gathering node",
  quests: "quest",
  abilities: "ability",
  affixes: "affix",
  gems: "gem",
  shop_listings: "shop listing",
  zones_dungeons: "zone or dungeon",
  achievements: "achievement",
  world_bosses: "world boss",
  classes: "class",
};

/** Columns each browser shows. `image` is art, not a text column. */
export const BROWSE_COLUMNS: Record<string, string[]> = {
  items: ["image", "name", "type", "slot", "class_requirement", "rarity", "level", "sell_value"],
  enemies: ["image", "name", "level", "max_hp", "damage", "element", "attack_style", "is_boss"],
  recipes: ["name", "category", "crafting_level", "xp", "duration"],
  gathering_nodes: ["image", "name", "type", "gathering_level", "base_xp", "required_tool"],
  quests: ["name", "category", "act", "combat_level"],
  abilities: ["image", "name", "required_class", "category", "combat_level", "mana_cost", "cooldown"],
  affixes: ["name", "kind", "category", "min_value", "max_value", "value_is_percent"],
  gems: ["image", "name", "family", "tier"],
  // Use `name` instead of `item_id`. The listing sells the item, and the pipeline joined its name before this page used it.
  shop_listings: ["name", "price", "combat_level", "category", "stock"],
  zones_dungeons: ["image", "name", "type", "combat_level", "act", "heroic", "nightmare"],
  achievements: ["image", "name", "category", "requirement_type", "requirement_target", "reward_gold"],
  world_bosses: ["image", "name", "epithet", "recommended_gear_level", "gear_slot"],
};

/**
 * Defines prose headers.
 *
 * The three level gates need no entry because their schema names give their scales.
 * For example, `crafting_level` becomes `Crafting` under the general rule.
 */
export const COLUMN_LABELS: Record<string, string> = {
  max_hp: "Max HP",
  is_boss: "Boss",
  class_requirement: "Class",
  required_class: "Class",
  mana_cost: "Mana",
  sell_value: "Sell value",
  recommended_gear_level: "Gear level",
  requirement_target: "Target",
  requirement_type: "Requirement",
  reward_gold: "Gold",
  base_xp: "XP",
  required_tool: "Tool",
  value_is_percent: "Percent",
  item_id: "Item",
  min_value: "Min",
  max_value: "Max",
  combat_level: "Combat",
  crafting_level: "Crafting",
  gathering_level: "Gathering",
};

export function columnLabel(column: string): string {
  const label = COLUMN_LABELS[column];
  if (label) return label;
  const spaced = column.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Which tables show records as a card grid instead of a table. */
export const CARD_GRID_TABLES = new Set([
  "items",
  "enemies",
  "abilities",
  "gems",
  "zones_dungeons",
  "world_bosses",
  "achievements",
  "gathering_nodes",
]);

/** Facets per table, as toggle chip rows that AND together with the text filter. */
export const FACETS: Record<string, string[]> = {
  items: ["type", "slot", "rarity", "class_requirement"],
  enemies: ["element", "attack_style", "is_boss"],
  recipes: ["category"],
  gathering_nodes: ["type"],
  quests: ["category"],
  abilities: ["required_class", "category"],
  gems: ["family"],
  zones_dungeons: ["type", "heroic", "nightmare"],
  achievements: ["category"],
  affixes: ["kind"],
  shop_listings: [],
  world_bosses: [],
};

/** The level column each browser can range-filter on, where it has one. */
export const LEVEL_COLUMN: Record<string, string> = {
  items: "level",
  enemies: "level",
  recipes: "crafting_level",
  gathering_nodes: "gathering_level",
  zones_dungeons: "combat_level",
};
