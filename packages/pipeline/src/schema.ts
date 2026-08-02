/**
 * The published schema.
 * Column order is canonical.
 * It fixes JSON key order, CSV headers, and SQLite DDL.
 * Republished artifacts then have comparable bytes.
 *
 * Each column name uses snake_case from its source field.
 * A table records the reason when it flattens a nested object or creates a join table.
 */

export const SCHEMA_VERSION = 3;

export type ColumnType = "text" | "integer" | "real" | "boolean";
export type Column = { name: string; type: ColumnType };

export type TableSpec = {
  /** SQLite table name in snake_case. It is also the JSON and CSV file stem. */
  name: string;
  /** URL segment in kebab-case. */
  slug: string;
  kind: "entity" | "join" | "meta";
  primaryKey: string[];
  columns: Column[];
};

const text = (name: string): Column => ({ name, type: "text" });
const integer = (name: string): Column => ({ name, type: "integer" });
const real = (name: string): Column => ({ name, type: "real" });
const boolean = (name: string): Column => ({ name, type: "boolean" });

/** Columns that carry an item id. Every join table uses the same link treatment. */
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
      // One normalized path per row replaces source art fields. Four tables use `imagePath`, two use `icon`, and four other `icon` fields contain `?`. No single source column can be published.
      text("image"),
      text("type"),
      text("description"),
      text("rarity"),
      // Equipment uses the game's balance level. Other items use the level from their source. `level_source` names the source, so a reader can distinguish a gear tier from a gathering requirement.
      integer("level"),
      text("level_source"),
      boolean("stackable"),
      integer("sell_value"),
      text("slot"),
      text("sub_type"),
      text("class_requirement"),
      text("class_affinity"),
      // The source stat map has one non-numeric entry. Keep it as a column and omit it from item_stats, whose value column stays numeric.
      text("attack_style"),
      integer("heal_amount"),
      real("heal_percent"),
      integer("mana_amount"),
      real("mana_percent"),
      // A small minority of items has one optional object. Flatten it instead of creating a table.
      text("passive_type"),
      real("passive_value"),
      real("passive_value2"),
      text("passive_description"),
      // True means that the item appears in item_sources. Absence means that no source is modeled yet, not that the item is unobtainable. This field does not prove reachability.
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
      // A recipe has no art field. The game identifies it by its first output item, as a world boss uses reward gear.
      text("image"),
      text("category"),
      // Name this field for the skill that it gates. `level_req` did not identify the game's three level scales. Quest guidance calls this scale Crafting.
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
      // The character select's one-line text, such as "Relentless front-line bruiser". Keep it separate from the longer description.
      text("title"),
      text("description"),
      // The class's numbers scale with this value, in the game's words.
      text("focus"),
      // The class's story role, which is the only published source for this fact.
      text("world_role"),
    ],
  },
  {
    name: "class_traits",
    slug: "class-traits",
    kind: "join",
    // The four traits that the game lists under each class. Ordinal preserves the order from the scaling stat to the specialities.
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
      // A separate subclass unlock, not the combat gate. Keep its own name.
      integer("unlock_level"),
      integer("mana_cost"),
      integer("cooldown"),
      integer("execute_multiplier"),
      real("execute_threshold"),
      boolean("guaranteed_crit"),
      // Keep this beside ability_tags so CSV and spreadsheet readers can see tags without a join.
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
      // The game ships no affix name. `display_key` is a lookup key with no label table.
      // Split its final segment into words, so every surface shows "Armor Penetration" instead of `affix_armor_penetration`.
      // This label is derived. Publish `display_key` beside it to show the game's key.
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
    // This is the only entity table not keyed by `id`. Source records have no id field.
    primaryKey: ["item_id"],
    columns: [
      text("item_id"),
      // A listing has no name. It is a price for an item. Resolve it from `item_id` so browsers and search can identify it without a join.
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
    // This inverse index shows where an item can come from. The game does not provide it.
    name: "item_sources",
    slug: "item-sources",
    kind: "join",
    primaryKey: ["item_id", "source_kind", "source_id", "ordinal"],
    columns: [
      text("item_id"),
      text("source_kind"),
      text("source_id"),
      // Keep this data so a "where does this come from" answer can name the source and state its difficulty without a source-specific join.
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
      // A useful drop answer needs a place and a difficulty. Both require one join. `zone_id` is the first zone listing this enemy. Some enemies appear in no zone.
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
      // target_id is polymorphic. Some values are slot or recipe-class tokens, not entities. Record the resolved kind instead of pretending that a foreign key exists.
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
    // The source pairs already use text output, so the value stays text.
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
     * One row per entity record, flattened for client-side search.
     * The site can ship one small file instead of fetching twelve tables for each keystroke.
     * Every result then uses the same format, regardless of its source table.
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
