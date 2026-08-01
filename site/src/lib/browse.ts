/**
 * What each entity browser shows, and in what order the twelve are presented.
 *
 * Columns are named per table rather than taken from the schema, because "every column" is what
 * made these pages unreadable: descriptions, dialogue, accent colours and display keys are all real
 * columns and none of them belongs in a scannable grid. The complete row stays available through
 * `/query/` and the CSVs.
 */

/**
 * The browse order, grouped by the question each pair of tables answers, ranked by measured demand
 * from the official Discord. Progression leads because "what should I be doing at my level" is the
 * most-asked answerable question; the acquisition tables sit fourth despite items being the largest
 * table, because table size is not demand.
 */
export const BROWSE_GROUPS: { question: string; tables: string[] }[] = [
  { question: "What should I be doing at my level?", tables: ["zones_dungeons", "quests"] },
  { question: "What does my class use?", tables: ["abilities", "gems"] },
  { question: "What do I need to craft or gather this?", tables: ["recipes", "gathering_nodes"] },
  { question: "Where do I get this?", tables: ["items", "shop_listings"] },
  { question: "What is in this zone or dungeon?", tables: ["enemies", "world_bosses"] },
  { question: "Which of these is actually better?", tables: ["affixes", "achievements"] },
];

/** Flat table order derived from the groups, which is what the browse strip iterates. */
export const BROWSE_ORDER: string[] = BROWSE_GROUPS.flatMap((group) => group.tables);

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
