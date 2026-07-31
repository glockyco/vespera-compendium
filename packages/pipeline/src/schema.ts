/**
 * The published schema. Column order here is canonical: it fixes JSON key order, CSV headers and
 * SQLite DDL, which is what makes republished artifacts byte-comparable between builds.
 *
 * Every column name is the snake_case form of its source field. Where a table flattens a nested
 * object or splits one out into a join table, the reason is noted on the table.
 */

export const SCHEMA_VERSION = 1;

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
      text("type"),
      text("description"),
      text("rarity"),
      boolean("stackable"),
      integer("value"),
      text("icon"),
      text("image_path"),
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
      integer("level"),
      integer("max_hp"),
      integer("damage"),
      integer("defense"),
      integer("attack_interval"),
      integer("xp"),
      text("attack_style"),
      text("element"),
      boolean("is_boss"),
      text("icon"),
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
      text("category"),
      integer("level_req"),
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
      text("type"),
      integer("level_req"),
      integer("base_xp"),
      integer("base_duration"),
      text("required_tool"),
      text("icon"),
      text("image_path"),
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
      integer("level_req"),
      text("icon"),
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
    name: "abilities",
    slug: "abilities",
    kind: "entity",
    primaryKey: ["id"],
    columns: [
      text("id"),
      text("name"),
      text("category"),
      text("description"),
      text("required_class"),
      text("required_subclass"),
      integer("required_level"),
      integer("unlock_level"),
      integer("mana_cost"),
      integer("cooldown"),
      integer("execute_multiplier"),
      real("execute_threshold"),
      boolean("guaranteed_crit"),
      text("icon"),
      text("image_path"),
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
      text("family"),
      integer("tier"),
      text("color"),
      text("description"),
      text("icon"),
      text("image_path"),
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
      integer("price"),
      integer("level_req"),
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
      text("description"),
      text("type"),
      integer("level_req"),
      integer("act"),
      boolean("heroic"),
      boolean("nightmare"),
      text("zone_essence"),
      text("required_boss"),
      text("icon"),
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
      text("description"),
      text("category"),
      text("requirement_type"),
      integer("requirement_target"),
      text("requirement_item_id"),
      integer("reward_gold"),
      text("icon"),
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
      text("subtitle"),
      text("epithet"),
      integer("recommended_gear_level"),
      text("gear_slot"),
      text("gear_name"),
      text("gear_item_id"),
      integer("gear_level"),
      text("gear_icon"),
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
