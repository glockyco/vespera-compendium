/**
 * What each entity browser shows, and the order the record types are presented in.
 *
 * Columns are named per table rather than taken from the schema, because "every column" is what
 * made these pages unreadable: descriptions, dialogue, accent colours and display keys are all real
 * columns and none of them belongs in a scannable grid. The complete row stays available through
 * `/query/` and the CSVs.
 */

/**
 * The compendium index: every entity table, in one flat reading order.
 *
 * Flat rather than grouped by a player question. The question grouping made the home a directory of
 * riddles, and the twelve counts underneath it were the real content. Order runs from what a player
 * is before they own anything (class, abilities, gems) through where they go and what they fight, to
 * what they carry, make, and sell.
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
 * The three chapters of the normal Combat route.
 *
 * Bounds are the game's own gates, not even thirds: each chapter opens on a zone and closes on the
 * dungeon that stands before the next zone. `to` is null on the last chapter because the route runs
 * to whatever the highest shipped place requires.
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
    blurb: "The opening zones. Learn one class, gather the first materials, and clear one dungeon.",
    from: 1,
    to: 34,
  },
  {
    id: "contested-lands",
    label: "Contested Lands",
    blurb: "The middle route. Gear decides the pace here, and a dungeon closes each stretch.",
    from: 35,
    to: 68,
  },
  {
    id: "endgame",
    label: "Endgame",
    blurb: "The last normal places. Nightmare, the Tower, the Spire, and the Frontier follow them.",
    from: 69,
    to: null,
  },
];

/**
 * What one row of each table is called.
 *
 * Declared rather than derived: stripping a trailing `s` turns Abilities into "abilitie", Enemies
 * into "enemie" and Affixes into "affixe", and the twelve are a closed set anyway.
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

/** Columns each browser renders. `image` is drawn as art rather than as a text column. */
export const BROWSE_COLUMNS: Record<string, string[]> = {
  items: ["image", "name", "type", "slot", "class_requirement", "rarity", "level", "sell_value"],
  enemies: ["image", "name", "level", "max_hp", "damage", "element", "attack_style", "is_boss"],
  recipes: ["name", "category", "crafting_level", "xp", "duration"],
  gathering_nodes: ["image", "name", "type", "gathering_level", "base_xp", "required_tool"],
  quests: ["name", "category", "act", "combat_level"],
  abilities: ["image", "name", "required_class", "category", "combat_level", "mana_cost", "cooldown"],
  affixes: ["name", "kind", "category", "min_value", "max_value", "value_is_percent"],
  gems: ["image", "name", "family", "tier"],
  // `name` rather than `item_id`: a listing is the item it sells, and the raw id was the only thing
  // identifying it here before the pipeline joined the name.
  shop_listings: ["name", "price", "combat_level", "category", "stock"],
  zones_dungeons: ["image", "name", "type", "combat_level", "act", "heroic", "nightmare"],
  achievements: ["image", "name", "category", "requirement_type", "requirement_target", "reward_gold"],
  world_bosses: ["image", "name", "epithet", "recommended_gear_level", "gear_slot"],
};

/**
 * Prose headers. The three level gates need no entry: they are named for their scale in the schema,
 * so `crafting_level` renders `Crafting` by the general rule below rather than by a per-table case.
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

/** Which tables identify their records by art, and so render as a card grid rather than a table. */
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
