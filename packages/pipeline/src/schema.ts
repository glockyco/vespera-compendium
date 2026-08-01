/**
 * The published schema. Column order here is canonical: it fixes JSON key order, CSV headers and
 * SQLite DDL, which is what makes republished artifacts byte-comparable between builds.
 *
 * Every column name is the snake_case form of its source field. Where a table flattens a nested
 * object or splits one out into a join table, the reason is noted on the table.
 */

export const SCHEMA_VERSION = 2;

export type ColumnType = "text" | "integer" | "real" | "boolean";
export type Column = { name: string; type: ColumnType };

export type TableSpec = {
  /** SQLite table name, snake_case. Also the JSON and CSV file stem. */
  name: string;
  /** URL segment, kebab-case. */
  slug: string;
  kind: "entity" | "join" | "meta";
  primaryKey: string[];
  columns: Column[];
};

const text = (name: string): Column => ({ name, type: "text" });
const integer = (name: string): Column => ({ name, type: "integer" });
const real = (name: string): Column => ({ name, type: "real" });
const boolean = (name: string): Column => ({ name, type: "boolean" });

/** Column names carrying an item id, used to give every join table the same link treatment. */
export const ITEM_REFERENCE_COLUMNS = ["item_id", "gear_item_id", "requirement_item_id"] as const;

export const TABLES: readonly TableSpec[] = [
  {
    name: "items",
    slug: "items",
    kind: "entity",
    primaryKey: ["id"],
    columns: [
      text("id"),
      text("name"),
      // One normalised path per row, replacing the source fields that carried art. Those were
      // `imagePath` on four tables and `icon` on two, while `icon` on four others held literal `?`
      // placeholders left by the game's own reskin, so no single source column could be published.
      text("image"),
      text("type"),
      text("description"),
      text("rarity"),
      // The game's own balance level for equipment; for everything else a level read off the
      // source that yields it. `level_source` says which, so a reader never has to guess whether a
      // number is a gear tier or a gathering requirement.
      integer("level"),
      text("level_source"),
      boolean("stackable"),
      integer("sell_value"),
      text("slot"),
      text("sub_type"),
      text("class_requirement"),
      text("class_affinity"),
      // The only non-numeric entry in the source stat map, so it is a column here and is left out
      // of item_stats rather than forcing that table's value column to be text.
      text("attack_style"),
      integer("heal_amount"),
      real("heal_percent"),
      integer("mana_amount"),
      real("mana_percent"),
      // A single optional object on a small minority of items, flattened rather than given a table.
      text("passive_type"),
      real("passive_value"),
      real("passive_value2"),
      text("passive_description"),
      // True when the item appears in item_sources. Absence means no source is modelled yet, which
      // is not the same as unobtainable, so nothing here may be read as proof of reachability.
      boolean("has_modelled_source"),
    ],
  },
  {
    name: "enemies",
    slug: "enemies",
    kind: "entity",
    primaryKey: ["id"],
    columns: [
      text("id"),
      text("name"),
      text("image"),
      integer("level"),
      integer("max_hp"),
      integer("damage"),
      integer("defense"),
      integer("attack_interval"),
      integer("xp"),
      text("attack_style"),
      text("element"),
      boolean("is_boss"),
      real("stun_resist"),
      real("freeze_resist"),
      real("poison_resist"),
      real("crit_resist"),
    ],
  },
  {
    name: "recipes",
    slug: "recipes",
    kind: "entity",
    primaryKey: ["id"],
    columns: [
      text("id"),
      text("name"),
      // A recipe has no art of its own; the game identifies it by what it produces. Resolved from
      // the first output's item, the same way a world boss is identified by its reward gear.
      text("image"),
      text("category"),
      // Named for the skill it gates. `level_req` said nothing about which of the game's three
      // level scales it meant, and the game's own quest guidance is explicit that this is Crafting.
      integer("crafting_level"),
      integer("xp"),
      integer("duration"),
    ],
  },
  {
    name: "gathering_nodes",
    slug: "gathering-nodes",
    kind: "entity",
    primaryKey: ["id"],
    columns: [
      text("id"),
      text("name"),
      text("image"),
      text("type"),
      integer("gathering_level"),
      integer("base_xp"),
      integer("base_duration"),
      text("required_tool"),
    ],
  },
  {
    name: "quests",
    slug: "quests",
    kind: "entity",
    primaryKey: ["id"],
    columns: [
      text("id"),
      text("name"),
      text("description"),
      text("category"),
      integer("act"),
      integer("combat_level"),
      text("guidance"),
      text("dialogue_on_complete"),
      text("next_quest_id"),
      text("required_quest_id"),
      integer("reward_xp"),
      integer("reward_gold"),
      integer("reward_crafting_xp"),
      integer("reward_gather_xp"),
    ],
  },
  {
    name: "classes",
    slug: "classes",
    kind: "entity",
    primaryKey: ["id"],
    columns: [
      text("id"),
      text("name"),
      text("image"),
      // The character select's own one-line characterisation, for example "Relentless front-line
      // bruiser". Distinct from the longer description below it.
      text("title"),
      text("description"),
      // What the class's numbers actually scale with, in the game's words.
      text("focus"),
      // What the class does in the story, which is the only place the published data says so.
      text("world_role"),
    ],
  },
  {
    name: "class_traits",
    slug: "class-traits",
    kind: "join",
    // The four traits the game lists under each class. Ordinal preserves its order, which runs from
    // the class's scaling stat outward to its specialities.
    primaryKey: ["class_id", "ordinal"],
    columns: [text("class_id"), integer("ordinal"), text("label"), text("tip")],
  },
  {
    name: "abilities",
    slug: "abilities",
    kind: "entity",
    primaryKey: ["id"],
    columns: [
      text("id"),
      text("name"),
      text("image"),
      text("category"),
      text("description"),
      text("required_class"),
      text("required_subclass"),
      integer("combat_level"),
      // A separate subclass unlock, not the combat gate, so it keeps its own name.
      integer("unlock_level"),
      integer("mana_cost"),
      integer("cooldown"),
      integer("execute_multiplier"),
      real("execute_threshold"),
      boolean("guaranteed_crit"),
      // Kept alongside ability_tags so a CSV or spreadsheet reader sees the tags without a join.
      text("tags"),
    ],
  },
  {
    name: "affixes",
    slug: "affixes",
    kind: "entity",
    primaryKey: ["id"],
    columns: [
      text("id"),
      // The game ships no affix name, only `display_key`, which is a lookup key with no shipped
      // label table behind it. This is that key's final segment split into words, so every surface
      // shows "Armor Penetration" rather than the raw `affix_armor_penetration` id. Derived, not
      // the game's own string, which is why `display_key` is published beside it.
      text("name"),
      text("kind"),
      text("category"),
      text("display_key"),
      text("stat_target"),
      text("profile_target"),
      text("required_class"),
      text("spell_id"),
      text("effect"),
      real("min_value"),
      real("max_value"),
      boolean("value_is_percent"),
      boolean("hidden"),
    ],
  },
  {
    name: "gems",
    slug: "gems",
    kind: "entity",
    primaryKey: ["id"],
    columns: [
      text("id"),
      text("name"),
      text("image"),
      text("family"),
      integer("tier"),
      text("color"),
      text("description"),
    ],
  },
  {
    name: "shop_listings",
    slug: "shop-listings",
    kind: "entity",
    // The only entity table not keyed by `id`; the source records carry no id field at all.
    primaryKey: ["item_id"],
    columns: [
      text("item_id"),
      // A listing has no name of its own; it is a price against an item. Resolved from `item_id` so
      // a listing is identifiable without a join, the same way the browsers and search need it.
      text("name"),
      text("image"),
      integer("price"),
      integer("combat_level"),
      text("category"),
      text("description"),
      integer("stock"),
      integer("daily_stock"),
    ],
  },
  {
    name: "zones_dungeons",
    slug: "zones-dungeons",
    kind: "entity",
    primaryKey: ["id"],
    columns: [
      text("id"),
      text("name"),
      text("image"),
      text("description"),
      text("type"),
      integer("combat_level"),
      integer("act"),
      boolean("heroic"),
      boolean("nightmare"),
      text("zone_essence"),
      text("required_boss"),
    ],
  },
  {
    name: "achievements",
    slug: "achievements",
    kind: "entity",
    primaryKey: ["id"],
    columns: [
      text("id"),
      text("name"),
      text("image"),
      text("description"),
      text("category"),
      text("requirement_type"),
      integer("requirement_target"),
      text("requirement_item_id"),
      integer("reward_gold"),
    ],
  },
  {
    name: "world_bosses",
    slug: "world-bosses",
    kind: "entity",
    primaryKey: ["id"],
    columns: [
      text("id"),
      text("name"),
      text("image"),
      text("subtitle"),
      text("epithet"),
      integer("recommended_gear_level"),
      text("gear_slot"),
      text("gear_name"),
      text("gear_item_id"),
      integer("gear_level"),
      text("accent"),
      text("accent2"),
    ],
  },

  {
    name: "item_stats",
    slug: "item-stats",
    kind: "join",
    primaryKey: ["item_id", "stat"],
    columns: [text("item_id"), text("stat"), real("value")],
  },
  {
    // The inverse index the game itself does not offer: where an item can come from.
    name: "item_sources",
    slug: "item-sources",
    kind: "join",
    primaryKey: ["item_id", "source_kind", "source_id", "ordinal"],
    columns: [
      text("item_id"),
      text("source_kind"),
      text("source_id"),
      // Carried here so a "where does this come from" answer can name the source and say how hard
      // it is to reach without joining a different table per source kind.
      integer("source_level"),
      text("source_name"),
      integer("ordinal"),
      real("chance"),
      integer("min"),
      integer("max"),
    ],
  },
  {
    name: "enemy_drops",
    slug: "enemy-drops",
    kind: "join",
    primaryKey: ["enemy_id", "ordinal"],
    columns: [
      text("enemy_id"),
      // A drop is only useful as an answer when it names a place and a difficulty, and both live one
      // join away. `zone_id` is the first zone listing this enemy; several enemies appear in none.
      integer("enemy_level"),
      text("zone_id"),
      integer("ordinal"),
      text("item_id"),
      real("chance"),
      integer("min"),
      integer("max"),
      text("class_requirement"),
      text("rarity"),
    ],
  },
  {
    name: "recipe_inputs",
    slug: "recipe-inputs",
    kind: "join",
    primaryKey: ["recipe_id", "ordinal"],
    columns: [text("recipe_id"), integer("ordinal"), text("item_id"), integer("count")],
  },
  {
    name: "recipe_outputs",
    slug: "recipe-outputs",
    kind: "join",
    primaryKey: ["recipe_id", "ordinal"],
    columns: [text("recipe_id"), integer("ordinal"), text("item_id"), integer("count")],
  },
  {
    name: "gathering_node_drops",
    slug: "gathering-node-drops",
    kind: "join",
    primaryKey: ["node_id", "ordinal"],
    columns: [
      text("node_id"),
      integer("ordinal"),
      text("item_id"),
      real("chance"),
      integer("min"),
      integer("max"),
    ],
  },
  {
    name: "quest_steps",
    slug: "quest-steps",
    kind: "join",
    primaryKey: ["quest_id", "ordinal"],
    columns: [
      text("quest_id"),
      integer("ordinal"),
      text("type"),
      text("target_id"),
      // target_id is polymorphic and some values are slot or recipe-class tokens that name no
      // entity, so this records what the id resolved to instead of pretending a foreign key exists.
      text("target_kind"),
      integer("count"),
      boolean("allow_held"),
    ],
  },
  {
    name: "quest_reward_items",
    slug: "quest-reward-items",
    kind: "join",
    primaryKey: ["quest_id", "ordinal"],
    columns: [
      text("quest_id"),
      integer("ordinal"),
      text("item_id"),
      integer("count"),
      text("tutorial_grant"),
    ],
  },
  {
    name: "ability_effects",
    slug: "ability-effects",
    kind: "join",
    primaryKey: ["ability_id", "ordinal"],
    columns: [
      text("ability_id"),
      integer("ordinal"),
      text("type"),
      real("value"),
      text("target"),
      text("stat"),
      boolean("is_percent"),
      integer("duration"),
      integer("stacks"),
      integer("per_stack"),
    ],
  },
  {
    name: "ability_tags",
    slug: "ability-tags",
    kind: "join",
    primaryKey: ["ability_id", "tag"],
    columns: [text("ability_id"), text("tag")],
  },
  {
    name: "gem_stats",
    slug: "gem-stats",
    kind: "join",
    primaryKey: ["gem_id", "stat"],
    columns: [text("gem_id"), text("stat"), real("value")],
  },
  {
    name: "affix_weights",
    slug: "affix-weights",
    kind: "join",
    primaryKey: ["affix_id", "gear_kind"],
    columns: [text("affix_id"), text("gear_kind"), real("weight")],
  },
  {
    name: "zone_enemies",
    slug: "zone-enemies",
    kind: "join",
    primaryKey: ["zone_id", "ordinal"],
    columns: [text("zone_id"), integer("ordinal"), text("enemy_id")],
  },
  {
    name: "zone_resources",
    slug: "zone-resources",
    kind: "join",
    primaryKey: ["zone_id", "resource_kind", "ordinal"],
    columns: [text("zone_id"), text("resource_kind"), integer("ordinal"), text("node_id")],
  },
  {
    name: "world_boss_gear_stats",
    slug: "world-boss-gear-stats",
    kind: "join",
    primaryKey: ["boss_id", "ordinal"],
    // The source pairs are already formatted for display, so the value stays text.
    columns: [text("boss_id"), integer("ordinal"), text("label"), text("display_value")],
  },
  {
    name: "world_boss_abilities",
    slug: "world-boss-abilities",
    kind: "join",
    primaryKey: ["boss_id", "ordinal"],
    columns: [
      text("boss_id"),
      integer("ordinal"),
      text("name"),
      text("text"),
      text("counter"),
    ],
  },

  {
    /**
     * One row per entity record, flattened for client-side search. It exists so the site can ship a
     * single small file instead of fetching twelve tables to answer a keystroke, and so every
     * result can be rendered identically regardless of which table it came from.
     */
    name: "search_index",
    slug: "search-index",
    kind: "meta",
    primaryKey: ["table", "id"],
    columns: [
      text("table"),
      text("id"),
      text("slug"),
      text("name"),
      text("kind"),
      text("subtitle"),
      integer("level"),
      text("rarity"),
      text("image"),
    ],
  },
  {
    name: "meta",
    slug: "meta",
    kind: "meta",
    primaryKey: ["key"],
    columns: [text("key"), text("value")],
  },
];

export const ENTITY_TABLES: readonly TableSpec[] = TABLES.filter((table) => table.kind === "entity");

export function tableByName(name: string): TableSpec | undefined {
  return TABLES.find((table) => table.name === name);
}

export function tableBySlug(slug: string): TableSpec | undefined {
  return TABLES.find((table) => table.slug === slug);
}
