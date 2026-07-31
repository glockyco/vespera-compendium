import { slotLabel } from "../format";
import { primaryKeyColumn, rowByKey, rowsWhere, table, type Row } from "./dataset";

/**
 * The shape of a record page, resolved per entity type at build time.
 *
 * This replaced a generic "dump every related table as columns" pass. That pass was honest but
 * useless: it answered "what rows reference this id" when the reader asked "where do I get this",
 * and it made a quest's own guidance text — the single most useful field the game ships — one
 * anonymous column among fifteen.
 *
 * Each type below names its own blocks in the order a reader wants them, so the page leads with the
 * answer rather than with the schema. Every cross-reference resolves to a `Ref`, which carries the
 * art and rarity a link needs, so the rendering layer never re-joins anything.
 */

/** A resolved link to another record: everything `EntityLink` needs, nothing more. */
export type Ref = {
  slug: string;
  id: string;
  name: string;
  image: string | null;
  rarity: string | null;
  sub: string | null;
};

/** One line in a block: a reference plus the facts that qualify it. */
export type Line = {
  ref: Ref | null;
  /** Prose shown when there is no reference to link, or beside one that needs qualifying. */
  text?: string | null;
  chance?: number | null;
  quantity?: string | null;
  facts?: { label: string; value: string }[];
  /** Nested lines, used for a crafted input's own inputs. */
  children?: Line[];
};

export type Block = {
  title: string;
  empty?: string;
  /** Rendered as prose rather than as a line list. */
  prose?: string | null;
  /** Rendered as a labelled stat list. */
  stats?: { label: string; value: string }[];
  lines?: Line[];
  /** Drop-style lines get a proportion bar; the renderer keys off this. */
  showChance?: boolean;
};

export type Chip = {
  tone: "combat" | "gathering" | "crafting" | "rarity" | "neutral";
  label: string;
  value?: string | number;
  rarity?: string | null;
};

export type RecordShape = {
  heroSize: "lg" | "hero";
  image: string | null;
  rarity: string | null;
  description: string | null;
  chips: Chip[];
  blocks: Block[];
};

const SLUGS: Record<string, string> = {
  items: "items",
  enemies: "enemies",
  recipes: "recipes",
  gathering_nodes: "gathering-nodes",
  quests: "quests",
  abilities: "abilities",
  affixes: "affixes",
  gems: "gems",
  shop_listings: "shop-listings",
  zones_dungeons: "zones-dungeons",
  achievements: "achievements",
  world_bosses: "world-bosses",
};

/** `item_sources.source_kind` points at a different table per kind. */
const SOURCE_TABLES: Record<string, string> = {
  recipe: "recipes",
  enemy: "enemies",
  gathering: "gathering_nodes",
  shop: "items",
  quest: "quests",
  world_boss: "world_bosses",
};

/** Quest step target kinds that name a real entity, as opposed to a slot or recipe-class token. */
const TARGET_TABLES: Record<string, string> = {
  item: "items",
  enemy: "enemies",
  gathering_node: "gathering_nodes",
  zone: "zones_dungeons",
  recipe: "recipes",
};

const num = (value: unknown): number | null => (typeof value === "number" ? value : null);
const str = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

function ref(tableName: string, id: unknown, sub: string | null = null): Ref | null {
  const key = typeof id === "string" || typeof id === "number" ? String(id) : "";
  if (!key) return null;
  const row = rowByKey(tableName, key);
  if (!row) return null;
  return {
    slug: SLUGS[tableName] ?? tableName,
    id: key,
    name: str(row.name) ?? key,
    image: str(row.image),
    rarity: str(row.rarity),
    sub,
  };
}

/** `min`–`max` when a drop yields a range, a bare count when it does not. */
function quantity(min: unknown, max: unknown): string | null {
  const low = num(min);
  const high = num(max);
  if (low === null && high === null) return null;
  if (low !== null && high !== null && low !== high) return `${low}–${high}`;
  return `×${low ?? high}`;
}

function statList(rows: Row[], keyColumn: string, valueColumn: string): { label: string; value: string }[] {
  return rows.map((row) => ({ label: String(row[keyColumn] ?? ""), value: String(row[valueColumn] ?? "") }));
}

export function shapeFor(tableName: string, row: Row): RecordShape {
  switch (tableName) {
    case "items":
      return shapeItem(row);
    case "enemies":
      return shapeEnemy(row);
    case "recipes":
      return shapeRecipe(row);
    case "gathering_nodes":
      return shapeGatheringNode(row);
    case "quests":
      return shapeQuest(row);
    case "abilities":
      return shapeAbility(row);
    case "affixes":
      return shapeAffix(row);
    case "gems":
      return shapeGem(row);
    case "shop_listings":
      return shapeShopListing(row);
    case "zones_dungeons":
      return shapeZone(row);
    case "achievements":
      return shapeAchievement(row);
    case "world_bosses":
      return shapeWorldBoss(row);
    default:
      return { heroSize: "lg", image: null, rarity: null, description: null, chips: [], blocks: [] };
  }
}

/** The heading a record page shows, which is not always the row's `name`. */
export function headingFor(tableName: string, row: Row): { title: string; sub: string | null } {
  const key = primaryKeyColumn(tableName);
  if (tableName === "shop_listings") {
    const item = rowByKey("items", String(row.item_id));
    return { title: str(item?.name) ?? String(row.item_id), sub: String(row.item_id) };
  }
  return { title: str(row.name) ?? String(row[key]), sub: null };
}

function shapeItem(row: Row): RecordShape {
  const id = String(row.id);
  const sources = rowsWhere("item_sources", "item_id", id);
  const byKind = new Map<string, Row[]>();
  for (const source of sources) {
    const kind = String(source.source_kind);
    const list = byKind.get(kind);
    if (list) list.push(source);
    else byKind.set(kind, [source]);
  }

  // Drop rows carry the enemy's level and zone, so a "where does this come from" line names a place
  // and a difficulty without the page joining three tables per row.
  const dropsById = new Map<string, Row>();
  for (const drop of table("enemy_drops")) {
    if (drop.item_id === id) dropsById.set(String(drop.enemy_id), drop);
  }

  const acquisition: Line[] = [];
  const kindOrder = ["recipe", "gathering", "enemy", "shop", "quest", "world_boss"];
  for (const kind of kindOrder) {
    for (const source of byKind.get(kind) ?? []) {
      const sourceTable = SOURCE_TABLES[kind]!;
      const sourceId = String(source.source_id);
      const level = num(source.source_level);
      const facts: { label: string; value: string }[] = [];
      let sub: string | null = null;

      if (kind === "recipe" && level !== null) sub = `Crafting ${level}`;
      if (kind === "gathering" && level !== null) sub = `Gathering ${level}`;
      if (kind === "enemy") {
        const drop = dropsById.get(sourceId);
        const zone = drop ? ref("zones_dungeons", drop.zone_id) : null;
        sub = [level === null ? null : `Level ${level}`, zone?.name].filter(Boolean).join(" · ") || null;
      }
      if (kind === "shop") {
        const listing = rowByKey("shop_listings", sourceId);
        const price = num(listing?.price);
        if (price !== null) facts.push({ label: "Price", value: price.toLocaleString("en-US") });
        if (level !== null) facts.push({ label: "Combat", value: String(level) });
        sub = "Sold by the shop";
      }
      if (kind === "world_boss" && level !== null) sub = `Recommended gear ${level}`;

      acquisition.push({
        ref: ref(sourceTable, sourceId, sub) ?? null,
        text: ref(sourceTable, sourceId) ? null : (str(source.source_name) ?? sourceId),
        chance: num(source.chance),
        quantity: quantity(source.min, source.max),
        facts,
      });
    }
  }

  const stats = rowsWhere("item_stats", "item_id", id);
  const usedIn = rowsWhere("recipe_inputs", "item_id", id).flatMap((input) => {
    const outputs = rowsWhere("recipe_outputs", "recipe_id", String(input.recipe_id));
    const recipe = rowByKey("recipes", String(input.recipe_id));
    const craftingLevel = num(recipe?.crafting_level);
    return outputs.map((output) => ({
      ref: ref("items", output.item_id, craftingLevel === null ? null : `Crafting ${craftingLevel}`),
      text: null,
    }));
  });

  const chips: Chip[] = [];
  if (str(row.rarity)) chips.push({ tone: "rarity", label: "Rarity", value: String(row.rarity), rarity: str(row.rarity) });
  if (str(row.type)) chips.push({ tone: "neutral", label: "Type", value: String(row.type) });
  if (str(row.slot)) chips.push({ tone: "neutral", label: "Slot", value: slotLabel(String(row.slot)) });
  if (str(row.class_requirement)) chips.push({ tone: "neutral", label: "Class", value: String(row.class_requirement) });
  if (num(row.sell_value) !== null) chips.push({ tone: "neutral", label: "Sells for", value: num(row.sell_value)!.toLocaleString("en-US") });

  const blocks: Block[] = [
    {
      title: "How to get it",
      empty: "No source is modelled for this item yet.",
      lines: acquisition,
      showChance: true,
    },
  ];

  if (stats.length > 0) {
    blocks.push({ title: "Stats", stats: statList(stats, "stat", "value") });
  }
  if (usedIn.length > 0) {
    blocks.push({ title: "Used to make", lines: usedIn });
  }
  if (str(row.passive_type)) {
    blocks.push({
      title: "Set bonus",
      prose: str(row.passive_description) ?? String(row.passive_type),
    });
  }
  const gem = ref("gems", id);
  if (gem) blocks.push({ title: "Gem", lines: [{ ref: gem }] });

  return {
    heroSize: "lg",
    image: str(row.image),
    rarity: str(row.rarity),
    description: str(row.description),
    chips,
    blocks,
  };
}

function shapeEnemy(row: Row): RecordShape {
  const id = String(row.id);
  const drops = [...rowsWhere("enemy_drops", "enemy_id", id)].sort(
    (left, right) => (num(right.chance) ?? 0) - (num(left.chance) ?? 0),
  );
  const zones = rowsWhere("zone_enemies", "enemy_id", id);

  const resists = (["stun_resist", "freeze_resist", "poison_resist", "crit_resist"] as const)
    .filter((column) => num(row[column]) !== null)
    .map((column) => ({ label: column.replace("_resist", ""), value: `${Math.round((num(row[column]) ?? 0) * 100)}%` }));

  const questTargets = table("quest_steps").filter(
    (step) => step.target_kind === "enemy" && step.target_id === id,
  );

  const chips: Chip[] = [];
  if (num(row.level) !== null) chips.push({ tone: "combat", label: "Combat", value: num(row.level)! });
  if (str(row.element)) chips.push({ tone: "neutral", label: "Element", value: String(row.element) });
  if (str(row.attack_style)) chips.push({ tone: "neutral", label: "Style", value: String(row.attack_style) });
  if (row.is_boss) chips.push({ tone: "neutral", label: "Boss", value: "yes" });

  const blocks: Block[] = [
    {
      title: "Drops",
      empty: "No drops are modelled for this enemy.",
      showChance: true,
      lines: drops.map((drop) => ({
        // `gold` is a currency the drop table names alongside real items, so it has no record page.
        ref: ref("items", drop.item_id),
        text: rowByKey("items", String(drop.item_id)) ? null : String(drop.item_id),
        chance: num(drop.chance),
        quantity: quantity(drop.min, drop.max),
      })),
    },
    {
      title: "Found in",
      empty: "This enemy is not placed in a modelled zone.",
      lines: zones.map((zone) => ({ ref: ref("zones_dungeons", zone.zone_id) })),
    },
    {
      title: "Fights",
      stats: (["max_hp", "damage", "defense", "attack_interval", "xp"] as const)
        .filter((column) => num(row[column]) !== null)
        .map((column) => ({ label: column, value: String(num(row[column])) })),
    },
  ];

  if (resists.length > 0) blocks.push({ title: "Resistances", stats: resists });
  if (questTargets.length > 0) {
    blocks.push({
      title: "Quest target",
      lines: questTargets.map((step) => ({
        ref: ref("quests", step.quest_id, num(step.count) === null ? null : `${step.count} needed`),
      })),
    });
  }

  return {
    heroSize: "lg",
    image: str(row.image),
    rarity: null,
    description: null,
    chips,
    blocks,
  };
}

function shapeRecipe(row: Row): RecordShape {
  const id = String(row.id);
  const outputs = rowsWhere("recipe_outputs", "recipe_id", id);
  const inputs = rowsWhere("recipe_inputs", "recipe_id", id);

  /** An input that is itself crafted shows its own inputs one level down, so a player sees the
   * intermediate materials without navigating away and back. */
  const nested = (itemId: string): Line[] => {
    const producing = table("recipe_outputs").find((output) => output.item_id === itemId);
    if (!producing) return [];
    return rowsWhere("recipe_inputs", "recipe_id", String(producing.recipe_id)).map((input) => ({
      ref: ref("items", input.item_id),
      quantity: num(input.count) === null ? null : `×${input.count}`,
    }));
  };

  const unlockedBy = table("quest_steps").filter(
    (step) => step.target_kind === "recipe" && step.target_id === id,
  );

  const chips: Chip[] = [];
  if (str(row.category)) chips.push({ tone: "neutral", label: "Profession", value: String(row.category) });
  if (num(row.crafting_level) !== null) chips.push({ tone: "crafting", label: "Crafting", value: num(row.crafting_level)! });
  if (num(row.duration) !== null) chips.push({ tone: "neutral", label: "Takes", value: String(row.duration) });
  if (num(row.xp) !== null) chips.push({ tone: "neutral", label: "XP", value: num(row.xp)! });

  const blocks: Block[] = [
    {
      title: "Makes",
      empty: "This recipe produces nothing the model knows about.",
      lines: outputs.map((output) => ({
        ref: ref("items", output.item_id),
        quantity: num(output.count) === null ? null : `×${output.count}`,
      })),
    },
    {
      title: "Needs",
      empty: "This recipe consumes nothing.",
      lines: inputs.map((input) => ({
        ref: ref("items", input.item_id),
        quantity: num(input.count) === null ? null : `×${input.count}`,
        children: nested(String(input.item_id)),
      })),
    },
  ];

  if (unlockedBy.length > 0) {
    blocks.push({
      title: "Unlocked by",
      lines: unlockedBy.map((step) => ({ ref: ref("quests", step.quest_id) })),
    });
  }

  return { heroSize: "lg", image: null, rarity: null, description: null, chips, blocks };
}

function shapeGatheringNode(row: Row): RecordShape {
  const id = String(row.id);
  const drops = rowsWhere("gathering_node_drops", "node_id", id);
  const zones = rowsWhere("zone_resources", "node_id", id);

  const chips: Chip[] = [];
  if (str(row.type)) chips.push({ tone: "neutral", label: "Node", value: String(row.type) });
  if (num(row.gathering_level) !== null) {
    chips.push({ tone: "gathering", label: "Gathering", value: num(row.gathering_level)! });
  }
  if (str(row.required_tool)) chips.push({ tone: "neutral", label: "Tool", value: String(row.required_tool) });
  if (num(row.base_xp) !== null) chips.push({ tone: "neutral", label: "XP", value: num(row.base_xp)! });
  if (num(row.base_duration) !== null) chips.push({ tone: "neutral", label: "Takes", value: String(row.base_duration) });

  return {
    heroSize: "lg",
    image: str(row.image),
    rarity: null,
    description: null,
    chips,
    blocks: [
      {
        title: "Yields",
        empty: "This node yields nothing the model knows about.",
        showChance: true,
        lines: drops.map((drop) => ({
          ref: ref("items", drop.item_id),
          chance: num(drop.chance),
          quantity: quantity(drop.min, drop.max),
        })),
      },
      {
        title: "Found in",
        empty: "This node is not placed in a modelled zone.",
        lines: zones.map((zone) => ({ ref: ref("zones_dungeons", zone.zone_id) })),
      },
    ],
  };
}

/** Quest step types as verbs, so a step reads as an instruction rather than as an enum. */
const STEP_VERBS: Record<string, string> = {
  KILL: "Defeat",
  COLLECT: "Collect",
  CRAFT: "Craft",
  EQUIP: "Equip",
  TRAVEL: "Travel to",
  ENCHANT: "Enchant",
  DUNGEON_COMPLETE: "Clear",
};

function shapeQuest(row: Row): RecordShape {
  const id = String(row.id);
  const steps = rowsWhere("quest_steps", "quest_id", id);
  const rewards = rowsWhere("quest_reward_items", "quest_id", id);
  const previous = table("quests").find((quest) => quest.next_quest_id === id);

  const chips: Chip[] = [];
  if (str(row.category)) chips.push({ tone: "neutral", label: "Kind", value: String(row.category) });
  if (num(row.act) !== null) chips.push({ tone: "neutral", label: "Act", value: num(row.act)! });
  if (num(row.combat_level) !== null) chips.push({ tone: "combat", label: "Combat", value: num(row.combat_level)! });

  const blocks: Block[] = [];

  // The game's own hint, and the most useful single field on the record.
  if (str(row.guidance)) blocks.push({ title: "Guidance", prose: str(row.guidance) });

  blocks.push({
    title: "Steps",
    empty: "This quest has no modelled steps.",
    lines: steps.map((step) => {
      const verb = STEP_VERBS[String(step.type)] ?? String(step.type);
      const targetTable = TARGET_TABLES[String(step.target_kind)];
      const count = num(step.count);
      const suffix = count !== null && count > 1 ? ` ×${count}` : "";
      const target = targetTable ? ref(targetTable, step.target_id) : null;
      return {
        ref: target,
        text: target ? `${verb}${suffix}` : `${verb} ${step.target_id}${suffix}`,
      };
    }),
  });

  const rewardChips = (["reward_xp", "reward_gold", "reward_crafting_xp", "reward_gather_xp"] as const)
    .filter((column) => num(row[column]) !== null)
    .map((column) => ({ label: column.replace("reward_", "").replace("_", " "), value: String(num(row[column])) }));
  if (rewardChips.length > 0 || rewards.length > 0) {
    blocks.push({
      title: "Rewards",
      stats: rewardChips,
      lines: rewards.map((reward) => ({
        ref: ref("items", reward.item_id),
        quantity: num(reward.count) === null ? null : `×${reward.count}`,
      })),
    });
  }

  const chain: Line[] = [];
  if (previous) chain.push({ ref: ref("quests", previous.id, "Comes before this") });
  if (str(row.next_quest_id)) chain.push({ ref: ref("quests", row.next_quest_id, "Comes after this") });
  if (chain.length > 0) blocks.push({ title: "Chain", lines: chain });

  if (str(row.dialogue_on_complete)) {
    blocks.push({ title: "On completion", prose: str(row.dialogue_on_complete) });
  }

  return {
    heroSize: "lg",
    image: null,
    rarity: null,
    description: str(row.description),
    chips,
    blocks,
  };
}

function shapeAbility(row: Row): RecordShape {
  const id = String(row.id);
  const effects = rowsWhere("ability_effects", "ability_id", id);
  const tags = rowsWhere("ability_tags", "ability_id", id);

  const chips: Chip[] = [];
  if (str(row.required_class)) chips.push({ tone: "neutral", label: "Class", value: String(row.required_class) });
  if (str(row.category)) chips.push({ tone: "neutral", label: "Kind", value: String(row.category) });
  if (num(row.combat_level) !== null) chips.push({ tone: "combat", label: "Combat", value: num(row.combat_level)! });
  if (num(row.mana_cost) !== null) chips.push({ tone: "neutral", label: "Mana", value: num(row.mana_cost)! });
  if (num(row.cooldown) !== null) chips.push({ tone: "neutral", label: "Cooldown", value: String(row.cooldown) });
  if (str(row.required_subclass)) chips.push({ tone: "neutral", label: "Subclass", value: String(row.required_subclass) });

  return {
    heroSize: "lg",
    image: str(row.image),
    rarity: null,
    description: str(row.description),
    chips,
    blocks: [
      {
        title: "Effects",
        empty: "This ability has no modelled effects.",
        lines: effects.map((effect) => ({ ref: null, text: effectSentence(effect) })),
      },
      {
        title: "Tags",
        empty: "No tags.",
        lines: tags.map((tag) => ({ ref: null, text: String(tag.tag) })),
      },
    ],
  };
}

/** An effect row as a sentence, rather than as eight columns the reader has to recombine. */
function effectSentence(effect: Row): string {
  const parts: string[] = [String(effect.type ?? "effect")];
  const value = num(effect.value);
  if (value !== null) parts.push(effect.is_percent ? `${value}%` : String(value));
  if (str(effect.stat)) parts.push(`to ${effect.stat}`);
  if (str(effect.target)) parts.push(`on ${effect.target}`);
  const duration = num(effect.duration);
  if (duration !== null) parts.push(`for ${duration}ms`);
  const stacks = num(effect.stacks);
  if (stacks !== null) parts.push(`up to ${stacks} stacks`);
  const perStack = num(effect.per_stack);
  if (perStack !== null) parts.push(`(${perStack} per stack)`);
  return parts.join(" ");
}

function shapeAffix(row: Row): RecordShape {
  const id = String(row.id);
  const weights = rowsWhere("affix_weights", "affix_id", id);
  const percent = row.value_is_percent === true;
  const format = (value: number | null): string =>
    value === null ? "—" : percent ? `${value}%` : String(value);

  const applies = (["profile_target", "required_class", "stat_target", "spell_id"] as const)
    .filter((column) => str(row[column]))
    .map((column) => ({ label: column.replace(/_/g, " "), value: String(row[column]) }));

  const chips: Chip[] = [];
  if (str(row.kind)) chips.push({ tone: "neutral", label: "Kind", value: String(row.kind) });
  if (str(row.category)) chips.push({ tone: "neutral", label: "Category", value: String(row.category) });
  chips.push({ tone: "neutral", label: "Percent", value: percent ? "yes" : "no" });

  const blocks: Block[] = [
    {
      title: "Range",
      stats: [{ label: "from", value: format(num(row.min_value)) }, { label: "to", value: format(num(row.max_value)) }],
    },
    {
      title: "Gear weights",
      empty: "This affix is not weighted for any gear kind.",
      showChance: true,
      lines: weights.map((weight) => ({
        ref: null,
        text: String(weight.gear_kind),
        chance: num(weight.weight),
      })),
    },
  ];
  if (applies.length > 0) blocks.push({ title: "Applies to", stats: applies });

  return {
    heroSize: "lg",
    image: null,
    rarity: null,
    description: str(row.effect),
    chips,
    blocks,
  };
}

function shapeGem(row: Row): RecordShape {
  const id = String(row.id);
  const stats = rowsWhere("gem_stats", "gem_id", id);
  const chips: Chip[] = [];
  if (str(row.family)) chips.push({ tone: "neutral", label: "Family", value: String(row.family) });
  if (num(row.tier) !== null) chips.push({ tone: "neutral", label: "Tier", value: num(row.tier)! });

  const blocks: Block[] = [{ title: "Stats", empty: "No stats.", stats: statList(stats, "stat", "value") }];
  const item = ref("items", id);
  if (item) blocks.push({ title: "Item record", lines: [{ ref: item }] });

  return {
    heroSize: "lg",
    image: str(row.image),
    rarity: null,
    description: str(row.description),
    chips,
    blocks,
  };
}

function shapeShopListing(row: Row): RecordShape {
  const itemId = String(row.item_id);
  const item = rowByKey("items", itemId);
  const stats = rowsWhere("item_stats", "item_id", itemId);

  const chips: Chip[] = [];
  if (num(row.price) !== null) chips.push({ tone: "neutral", label: "Price", value: num(row.price)!.toLocaleString("en-US") });
  if (num(row.combat_level) !== null) chips.push({ tone: "combat", label: "Combat", value: num(row.combat_level)! });
  if (str(row.category)) chips.push({ tone: "neutral", label: "Category", value: String(row.category) });
  if (num(row.stock) !== null) chips.push({ tone: "neutral", label: "Stock", value: num(row.stock)! });
  if (num(row.daily_stock) !== null) chips.push({ tone: "neutral", label: "Daily", value: num(row.daily_stock)! });

  return {
    heroSize: "lg",
    image: str(item?.image),
    rarity: str(item?.rarity),
    description: str(row.description) ?? str(item?.description),
    chips,
    blocks: [
      {
        title: "Item",
        empty: "This listing names no modelled item.",
        lines: ref("items", itemId) ? [{ ref: ref("items", itemId) }] : [],
        stats: statList(stats, "stat", "value"),
      },
    ],
  };
}

function shapeZone(row: Row): RecordShape {
  const id = String(row.id);
  const enemyLinks = rowsWhere("zone_enemies", "zone_id", id);
  const resources = rowsWhere("zone_resources", "zone_id", id);

  // The union of everything the zone's enemies drop, deduplicated to each item's best chance: a
  // reader wants "can I get this here", not one row per enemy that happens to drop it.
  const best = new Map<string, number>();
  for (const link of enemyLinks) {
    for (const drop of rowsWhere("enemy_drops", "enemy_id", String(link.enemy_id))) {
      const itemId = String(drop.item_id);
      const value = num(drop.chance) ?? 0;
      if ((best.get(itemId) ?? -1) < value) best.set(itemId, value);
    }
  }
  const drops = [...best.entries()].sort((left, right) => right[1] - left[1]);
  const CAP = 40;

  const chips: Chip[] = [];
  if (str(row.type)) chips.push({ tone: "neutral", label: "Kind", value: String(row.type) });
  if (num(row.combat_level) !== null) chips.push({ tone: "combat", label: "Combat", value: num(row.combat_level)! });
  if (num(row.act) !== null) chips.push({ tone: "neutral", label: "Act", value: num(row.act)! });
  if (row.heroic) chips.push({ tone: "neutral", label: "Heroic", value: "yes" });
  if (row.nightmare) chips.push({ tone: "neutral", label: "Nightmare", value: "yes" });
  if (str(row.zone_essence)) chips.push({ tone: "neutral", label: "Essence", value: String(row.zone_essence) });

  const byKind = new Map<string, Row[]>();
  for (const resource of resources) {
    const kind = String(resource.resource_kind);
    const list = byKind.get(kind);
    if (list) list.push(resource);
    else byKind.set(kind, [resource]);
  }

  const blocks: Block[] = [
    {
      title: "Enemies here",
      empty: "No enemies are placed in this zone.",
      lines: enemyLinks.map((link) => {
        const enemy = rowByKey("enemies", String(link.enemy_id));
        const level = num(enemy?.level);
        return { ref: ref("enemies", link.enemy_id, level === null ? null : `Level ${level}`) };
      }),
    },
    {
      title: "What drops here",
      empty: "Nothing modelled drops in this zone.",
      showChance: true,
      lines: drops.slice(0, CAP).map(([itemId, value]) => ({
        ref: ref("items", itemId),
        text: rowByKey("items", itemId) ? null : itemId,
        chance: value,
      })),
      prose: drops.length > CAP ? `+${drops.length - CAP} more` : null,
    },
    {
      title: "Gathering nodes",
      empty: "This zone offers no modelled gathering.",
      lines: [...byKind.entries()].flatMap(([kind, list]) =>
        list.map((resource) => ({ ref: ref("gathering_nodes", resource.node_id, kind) })),
      ),
    },
  ];

  if (str(row.required_boss)) {
    blocks.push({ title: "Requires", lines: [{ ref: ref("enemies", row.required_boss) }] });
  }

  return {
    heroSize: "hero",
    image: str(row.image),
    rarity: null,
    description: str(row.description),
    chips,
    blocks,
  };
}

function shapeAchievement(row: Row): RecordShape {
  const chips: Chip[] = [];
  if (str(row.category)) chips.push({ tone: "neutral", label: "Category", value: String(row.category) });
  if (num(row.reward_gold) !== null) {
    chips.push({ tone: "neutral", label: "Gold", value: num(row.reward_gold)!.toLocaleString("en-US") });
  }

  const target = num(row.requirement_target);
  const kind = str(row.requirement_type)?.replace(/_/g, " ") ?? "progress";
  const item = ref("items", row.requirement_item_id);

  return {
    heroSize: "lg",
    image: str(row.image),
    rarity: null,
    description: str(row.description),
    chips,
    blocks: [
      {
        title: "Requirement",
        prose: item ? null : `${target === null ? "Reach" : `Reach ${target}`} ${kind}.`,
        lines: item ? [{ ref: item, text: `${target === null ? "Involves" : `${target} ×`}` }] : [],
      },
    ],
  };
}

function shapeWorldBoss(row: Row): RecordShape {
  const id = String(row.id);
  const gearStats = rowsWhere("world_boss_gear_stats", "boss_id", id);
  const abilities = rowsWhere("world_boss_abilities", "boss_id", id);

  const chips: Chip[] = [];
  if (str(row.epithet)) chips.push({ tone: "neutral", label: "Epithet", value: String(row.epithet) });
  if (num(row.recommended_gear_level) !== null) {
    chips.push({ tone: "neutral", label: "Gear level", value: num(row.recommended_gear_level)! });
  }
  if (str(row.gear_slot)) chips.push({ tone: "neutral", label: "Slot", value: slotLabel(String(row.gear_slot)) });

  return {
    heroSize: "hero",
    image: str(row.image),
    rarity: null,
    description: str(row.subtitle),
    chips,
    blocks: [
      {
        title: "Reward",
        empty: "No reward is modelled for this boss.",
        lines: ref("items", row.gear_item_id) ? [{ ref: ref("items", row.gear_item_id) }] : [],
        // Already formatted for display by the game, so they are rendered verbatim.
        stats: statList(gearStats, "label", "display_value"),
      },
      {
        title: "Abilities",
        empty: "No abilities are modelled for this boss.",
        lines: abilities.map((ability) => ({
          ref: null,
          text: String(ability.name),
          facts: [
            ...(str(ability.text) ? [{ label: "Does", value: String(ability.text) }] : []),
            ...(str(ability.counter) ? [{ label: "Counter", value: String(ability.counter) }] : []),
          ],
        })),
      },
    ],
  };
}
