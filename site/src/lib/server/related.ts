import { rowsWhere, table, tableByName, type Row } from "./dataset";

/**
 * Related blocks turn one entity row into the surrounding context a compendium reader actually
 * wants: what an item drops from, what a recipe consumes, which zone holds an enemy.
 *
 * They share one shape so a single component renders every table, which is why the link map is data
 * rather than markup. `linkColumns` says which cells become links and to which entity slug.
 */

export type RelatedBlock = {
  title: string;
  columns: string[];
  rows: Row[];
  /** Column name to entity table slug. */
  linkColumns: Record<string, string>;
  /** Shown instead of an empty table. */
  empty?: string;
};

/** Applied to every block, then overridden per block where a column means something else. */
const DEFAULT_LINKS: Record<string, string> = {
  item_id: "items",
  enemy_id: "enemies",
  recipe_id: "recipes",
  node_id: "gathering-nodes",
  quest_id: "quests",
  ability_id: "abilities",
  gem_id: "gems",
  zone_id: "zones-dungeons",
  boss_id: "world-bosses",
  affix_id: "affixes",
  next_quest_id: "quests",
  required_quest_id: "quests",
  gear_item_id: "items",
  requirement_item_id: "items",
  required_boss: "enemies",
};

/** `item_sources.source_id` points at a different table per source kind. */
const SOURCE_SLUGS: Record<string, string> = {
  recipe: "recipes",
  enemy: "enemies",
  gathering: "gathering-nodes",
  shop: "items",
  quest: "quests",
  world_boss: "world-bosses",
};

/** Quest step target kinds that name a real entity, as opposed to a slot or recipe-class token. */
const TARGET_SLUGS: Record<string, string> = {
  item: "items",
  enemy: "enemies",
  gathering_node: "gathering-nodes",
  zone: "zones-dungeons",
  recipe: "recipes",
};

function columnsOf(tableName: string, omit: string[] = []): string[] {
  const spec = tableByName(tableName);
  if (!spec) throw new Error(`unknown table: ${tableName}`);
  return spec.columns.map((column) => column.name).filter((name) => !omit.includes(name));
}

function block(
  title: string,
  tableName: string,
  column: string,
  value: string,
  options: { empty?: string; omit?: string[]; links?: Record<string, string> } = {},
): RelatedBlock {
  return {
    title,
    columns: columnsOf(tableName, [column, ...(options.omit ?? [])]),
    rows: rowsWhere(tableName, column, value),
    linkColumns: { ...DEFAULT_LINKS, ...options.links },
    empty: options.empty,
  };
}

/** One row from another entity table, rendered as a single-row block. */
function record(title: string, tableName: string, key: string): RelatedBlock {
  const spec = tableByName(tableName);
  const keyColumn = spec?.primaryKey[0] ?? "id";
  const row = table(tableName).find((entry) => String(entry[keyColumn]) === key);
  return {
    title,
    columns: columnsOf(tableName),
    rows: row ? [row] : [],
    linkColumns: DEFAULT_LINKS,
    empty: `No ${tableName} record for ${key}.`,
  };
}

export function relatedFor(tableName: string, row: Row): RelatedBlock[] {
  const id = String(row[tableByName(tableName)?.primaryKey[0] ?? "id"] ?? "");
  switch (tableName) {
    case "items": {
      const sources = block("Sources", "item_sources", "item_id", id, {
        // Never "unobtainable": item_sources models six reward paths and several endgame systems are
        // not modelled at all, so absence is a gap in the model, not a fact about the game.
        empty: "No source is modelled for this item yet.",
      });
      // source_id resolves through its own row's source_kind, so the link target is per row.
      sources.rows = sources.rows.map((source) => ({
        ...source,
        source_slug: SOURCE_SLUGS[String(source.source_kind)] ?? "",
      }));
      sources.columns = [...sources.columns, "source_slug"];
      return [
        block("Stats", "item_stats", "item_id", id, { empty: "This item has no stats." }),
        sources,
        block("Used in recipes", "recipe_inputs", "item_id", id, { empty: "Not used by any recipe." }),
        block("Dropped by", "enemy_drops", "item_id", id, { empty: "No enemy drops this item." }),
        block("Gathered from", "gathering_node_drops", "item_id", id, {
          empty: "No gathering node yields this item.",
        }),
        block("Sold in shop", "shop_listings", "item_id", id, { empty: "Not sold by any vendor." }),
        block("Quest rewards", "quest_reward_items", "item_id", id, {
          empty: "Not granted by any quest.",
        }),
      ];
    }
    case "enemies":
      return [
        block("Drops", "enemy_drops", "enemy_id", id, { empty: "This enemy drops nothing." }),
        block("Found in", "zone_enemies", "enemy_id", id, { empty: "Not placed in any zone." }),
        {
          title: "Quest targets",
          columns: columnsOf("quest_steps", ["target_id", "target_kind"]),
          rows: table("quest_steps").filter(
            (step) => step.target_kind === "enemy" && String(step.target_id) === id,
          ),
          linkColumns: DEFAULT_LINKS,
          empty: "No quest targets this enemy.",
        },
      ];
    case "recipes":
      return [
        block("Inputs", "recipe_inputs", "recipe_id", id),
        block("Outputs", "recipe_outputs", "recipe_id", id),
      ];
    case "gathering_nodes":
      return [
        block("Drops", "gathering_node_drops", "node_id", id, { empty: "This node yields nothing." }),
        block("Found in", "zone_resources", "node_id", id, { empty: "Not placed in any zone." }),
      ];
    case "quests": {
      const steps = block("Steps", "quest_steps", "quest_id", id);
      // Only entity kinds get a link; slot and recipe-class tokens stay plain text.
      steps.rows = steps.rows.map((step) => ({
        ...step,
        target_slug: TARGET_SLUGS[String(step.target_kind)] ?? "",
      }));
      steps.columns = [...steps.columns, "target_slug"];
      return [steps, block("Reward items", "quest_reward_items", "quest_id", id, {
        empty: "This quest grants no items.",
      })];
    }
    case "abilities":
      return [
        block("Effects", "ability_effects", "ability_id", id),
        block("Tags", "ability_tags", "ability_id", id, { empty: "This ability has no tags." }),
      ];
    case "affixes":
      return [
        block("Gear weights", "affix_weights", "affix_id", id, {
          empty: "This affix has no gear weights.",
        }),
      ];
    case "gems":
      return [
        block("Stats", "gem_stats", "gem_id", id),
        record("Item record", "items", id),
      ];
    case "shop_listings":
      return [record("Item", "items", id)];
    case "zones_dungeons":
      return [
        block("Enemies", "zone_enemies", "zone_id", id, { empty: "No enemies are placed here." }),
        block("Gathering nodes", "zone_resources", "zone_id", id, {
          empty: "No gathering nodes are placed here.",
        }),
      ];
    case "world_bosses":
      return [
        block("Gear stats", "world_boss_gear_stats", "boss_id", id),
        block("Abilities", "world_boss_abilities", "boss_id", id),
      ];
    default:
      // Achievements carry their requirement and reward as columns, so they need no blocks.
      return [];
  }
}
