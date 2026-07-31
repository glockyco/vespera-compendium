import type { ComposedTables } from "./compose.ts";
import { collectImages, indexRefs } from "./images.ts";
import { SCHEMA_VERSION, TABLES } from "./schema.ts";

/**
 * Turns the composed runtime tables into flat rows matching the published schema.
 *
 * Two properties matter and are enforced here rather than left to the serializers: every row has
 * exactly its table's columns, and row order is deterministic. Without the second, republishing the
 * same build produces different bytes and no consumer can diff two releases.
 */

export type Scalar = string | number | boolean | null;
export type Row = Record<string, Scalar>;
/** Keyed by `TableSpec.name`. */
export type Dataset = Record<string, Row[]>;

type Source = Record<string, unknown>;

/** Item ids that name a currency rather than an inventory item. */
export const CURRENCY_ITEM_IDS: ReadonlySet<string> = new Set(["gold"]);

/** Reads a composed table as a row list, whether it was stored as an array or keyed by id. */
function sourceRows(value: unknown): Source[] {
  const list = Array.isArray(value) ? value : Object.values((value ?? {}) as Source);
  return list.filter((entry): entry is Source => Boolean(entry) && typeof entry === "object");
}

function scalar(value: unknown): Scalar {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return null;
}

function nested(row: Source, key: string): Source | undefined {
  const value = row[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Source) : undefined;
}

function nestedList(row: Source, key: string): Source[] {
  const value = row[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is Source => Boolean(entry) && typeof entry === "object")
    : [];
}

function numberMap(row: Source, key: string): [string, unknown][] {
  const value = nested(row, key);
  return value ? Object.entries(value) : [];
}

function text(value: unknown): string {
  return String(value ?? "");
}

/** The six modelled ways an item can be obtained, in the order `item_sources` lists them. */
const SOURCE_KINDS = ["recipe", "enemy", "gathering", "shop", "quest", "world_boss"] as const;
type SourceKind = (typeof SOURCE_KINDS)[number];

type PendingSource = {
  itemId: string;
  sourceKind: SourceKind;
  sourceId: string;
  chance: Scalar;
  min: Scalar;
  max: Scalar;
};

/** Resolution order for a quest step's polymorphic target. */
const TARGET_KINDS = [
  ["item", "items"],
  ["enemy", "enemies"],
  ["gathering_node", "gathering_nodes"],
  ["zone", "zones_dungeons"],
  ["recipe", "recipes"],
] as const;

export function projectAll(
  composed: ComposedTables,
  buildId: string,
  extractedDir: string,
): Dataset {
  const items = sourceRows(composed.items?.value);
  const enemies = sourceRows(composed.enemies?.value);
  const recipes = sourceRows(composed.recipes?.value);
  const gatheringNodes = sourceRows(composed.gatheringNodes?.value);
  const quests = sourceRows(composed.quests?.value);
  const abilities = sourceRows(composed.abilities?.value);
  const affixes = sourceRows(composed.affixes?.value);
  const gems = sourceRows(composed.gems?.value);
  const shopListings = sourceRows(composed.shopListings?.value);
  const zonesDungeons = sourceRows(composed.zonesDungeons?.value);
  const achievements = sourceRows(composed.achievements?.value);
  const worldBosses = sourceRows(composed.worldBosses?.value);

  const itemIds = new Set(items.map((item) => text(item.id)));
  const gatheringNodeIds = new Set(gatheringNodes.map((node) => text(node.id)));

  // One normalised art path per row, keyed by (table, id). Resolved here rather than read off the
  // source rows because the fields carrying a path differ per table and two of them are polymorphic.
  const images = indexRefs(collectImages(composed, extractedDir));
  const image = (table: string, id: unknown): Scalar => images.get(`${table}\u0000${text(id)}`) ?? null;

  // Collected first so `items.has_modelled_source` can be set in the same pass that emits items.
  const pendingSources: PendingSource[] = [];
  const addSource = (
    itemId: unknown,
    sourceKind: SourceKind,
    sourceId: unknown,
    chance: unknown = undefined,
    min: unknown = undefined,
    max: unknown = undefined,
  ): void => {
    const id = text(itemId);
    // Keeps item_sources.item_id a real foreign key. The only value this drops is the pseudo-item
    // `gold`, which enemy_drops still records verbatim.
    if (!itemIds.has(id)) return;
    pendingSources.push({
      itemId: id,
      sourceKind,
      sourceId: text(sourceId),
      chance: scalar(chance),
      min: scalar(min),
      max: scalar(max),
    });
  };

  for (const recipe of recipes) {
    for (const output of nestedList(recipe, "outputs")) addSource(output.itemId, "recipe", recipe.id);
  }
  for (const enemy of enemies) {
    for (const drop of nestedList(enemy, "drops")) {
      addSource(drop.itemId, "enemy", enemy.id, drop.chance, drop.min, drop.max);
    }
  }
  for (const node of gatheringNodes) {
    for (const drop of nestedList(node, "drops")) {
      addSource(drop.itemId, "gathering", node.id, drop.chance, drop.min, drop.max);
    }
  }
  for (const listing of shopListings) addSource(listing.itemId, "shop", listing.itemId);
  for (const quest of quests) {
    for (const reward of nestedList(nested(quest, "rewards") ?? {}, "items")) {
      addSource(reward.itemId, "quest", quest.id);
    }
  }
  for (const boss of worldBosses) addSource(boss.gearItemId, "world_boss", boss.id);

  const modelledSourceItemIds = new Set(pendingSources.map((source) => source.itemId));

  const dataset: Dataset = {
    items: items.map((item) => {
      const stats = nested(item, "stats");
      const passive = nested(item, "passive");
      return {
        id: text(item.id),
        name: scalar(item.name),
        image: image("items", item.id),
        type: scalar(item.type),
        description: scalar(item.description),
        rarity: scalar(item.rarity),
        stackable: scalar(item.stackable),
        sell_value: scalar(item.value),
        slot: scalar(item.slot),
        sub_type: scalar(item.subType),
        class_requirement: scalar(item.classRequirement),
        class_affinity: scalar(item.classAffinity),
        attack_style: scalar(stats?.attackStyle),
        heal_amount: scalar(item.healAmount),
        heal_percent: scalar(item.healPercent),
        mana_amount: scalar(item.manaAmount),
        mana_percent: scalar(item.manaPercent),
        passive_type: scalar(passive?.type),
        passive_value: scalar(passive?.value),
        passive_value2: scalar(passive?.value2),
        passive_description: scalar(passive?.description),
        has_modelled_source: modelledSourceItemIds.has(text(item.id)),
      };
    }),
    enemies: enemies.map((enemy) => ({
      id: text(enemy.id),
      name: scalar(enemy.name),
      image: image("enemies", enemy.id),
      level: scalar(enemy.level),
      max_hp: scalar(enemy.maxHp),
      damage: scalar(enemy.damage),
      defense: scalar(enemy.defense),
      attack_interval: scalar(enemy.attackInterval),
      xp: scalar(enemy.xp),
      attack_style: scalar(enemy.attackStyle),
      element: scalar(enemy.element),
      is_boss: scalar(enemy.isBoss),
      stun_resist: scalar(enemy.stunResist),
      freeze_resist: scalar(enemy.freezeResist),
      poison_resist: scalar(enemy.poisonResist),
      crit_resist: scalar(enemy.critResist),
    })),
    recipes: recipes.map((recipe) => ({
      id: text(recipe.id),
      name: scalar(recipe.name),
      category: scalar(recipe.category),
      crafting_level: scalar(recipe.levelReq),
      xp: scalar(recipe.xp),
      duration: scalar(recipe.duration),
    })),
    gathering_nodes: gatheringNodes.map((node) => ({
      id: text(node.id),
      name: scalar(node.name),
      image: image("gathering_nodes", node.id),
      type: scalar(node.type),
      gathering_level: scalar(node.levelReq),
      base_xp: scalar(node.baseXp),
      base_duration: scalar(node.baseDuration),
      required_tool: scalar(node.requiredTool),
    })),
    quests: quests.map((quest) => {
      const rewards = nested(quest, "rewards");
      return {
        id: text(quest.id),
        name: scalar(quest.name),
        description: scalar(quest.description),
        category: scalar(quest.category),
        act: scalar(quest.act),
        combat_level: scalar(quest.levelReq),
        guidance: scalar(quest.guidance),
        dialogue_on_complete: scalar(quest.dialogueOnComplete),
        next_quest_id: scalar(quest.nextQuestId),
        required_quest_id: scalar(quest.requiredQuestId),
        reward_xp: scalar(rewards?.xp),
        reward_gold: scalar(rewards?.gold),
        reward_crafting_xp: scalar(rewards?.craftingXp),
        reward_gather_xp: scalar(rewards?.gatherXp),
      };
    }),
    abilities: abilities.map((ability) => {
      const tags = Array.isArray(ability.tags) ? ability.tags.map(text) : [];
      return {
        id: text(ability.id),
        name: scalar(ability.name),
        image: image("abilities", ability.id),
        category: scalar(ability.category),
        description: scalar(ability.description),
        required_class: scalar(ability.requiredClass),
        required_subclass: scalar(ability.requiredSubclass),
        combat_level: scalar(ability.requiredLevel),
        unlock_level: scalar(ability.unlockLevel),
        mana_cost: scalar(ability.manaCost),
        cooldown: scalar(ability.cooldown),
        execute_multiplier: scalar(ability.executeMultiplier),
        execute_threshold: scalar(ability.executeThreshold),
        guaranteed_crit: scalar(ability.guaranteedCrit),
        tags: tags.join(","),
      };
    }),
    affixes: affixes.map((affix) => ({
      id: text(affix.id),
      kind: scalar(affix.kind),
      category: scalar(affix.category),
      display_key: scalar(affix.displayKey),
      stat_target: scalar(affix.statTarget),
      profile_target: scalar(affix.profileTarget),
      required_class: scalar(affix.requiredClass),
      spell_id: scalar(affix.spellId),
      effect: scalar(affix.effect),
      min_value: scalar(affix.minValue),
      max_value: scalar(affix.maxValue),
      value_is_percent: scalar(affix.valueIsPercent),
      hidden: scalar(affix.hidden),
    })),
    gems: gems.map((gem) => ({
      id: text(gem.id),
      name: scalar(gem.name),
      image: image("gems", gem.id),
      family: scalar(gem.family),
      tier: scalar(gem.tier),
      color: scalar(gem.color),
      description: scalar(gem.description),
    })),
    shop_listings: shopListings.map((listing) => ({
      item_id: text(listing.itemId),
      price: scalar(listing.price),
      combat_level: scalar(listing.levelReq),
      category: scalar(listing.category),
      description: scalar(listing.description),
      stock: scalar(listing.stock),
      daily_stock: scalar(listing.dailyStock),
    })),
    zones_dungeons: zonesDungeons.map((zone) => ({
      id: text(zone.id),
      name: scalar(zone.name),
      image: image("zones_dungeons", zone.id),
      description: scalar(zone.description),
      type: scalar(zone.type),
      combat_level: scalar(zone.levelReq),
      act: scalar(zone.act),
      heroic: scalar(zone.heroic),
      nightmare: scalar(zone.nightmare),
      zone_essence: scalar(zone.zoneEssence),
      required_boss: scalar(zone.requiredBoss),
    })),
    achievements: achievements.map((achievement) => {
      const requirement = nested(achievement, "requirement");
      const reward = nested(achievement, "reward");
      return {
        id: text(achievement.id),
        name: scalar(achievement.name),
        image: image("achievements", achievement.id),
        description: scalar(achievement.description),
        category: scalar(achievement.category),
        requirement_type: scalar(requirement?.type),
        requirement_target: scalar(requirement?.target),
        requirement_item_id: scalar(requirement?.itemId),
        reward_gold: scalar(reward?.gold),
      };
    }),
    world_bosses: worldBosses.map((boss) => ({
      id: text(boss.id),
      name: scalar(boss.name),
      image: image("world_bosses", boss.id),
      subtitle: scalar(boss.subtitle),
      epithet: scalar(boss.epithet),
      recommended_gear_level: scalar(boss.recommendedGearLevel),
      gear_slot: scalar(boss.gearSlot),
      gear_name: scalar(boss.gearName),
      gear_item_id: scalar(boss.gearItemId),
      gear_level: scalar(boss.gearLevel),
      accent: scalar(boss.accent),
      accent2: scalar(boss.accent2),
    })),

    item_stats: items.flatMap((item) =>
      numberMap(item, "stats")
        // attackStyle is the one non-numeric stat and is published as an items column instead.
        .filter(([stat, value]) => stat !== "attackStyle" && typeof value === "number")
        .map(([stat, value]) => ({ item_id: text(item.id), stat, value: scalar(value) })),
    ),
    item_sources: [],
    enemy_drops: enemies.flatMap((enemy) =>
      nestedList(enemy, "drops").map((drop, ordinal) => ({
        enemy_id: text(enemy.id),
        ordinal,
        item_id: text(drop.itemId),
        chance: scalar(drop.chance),
        min: scalar(drop.min),
        max: scalar(drop.max),
        class_requirement: scalar(drop.classRequirement),
        rarity: scalar(drop.rarity),
      })),
    ),
    recipe_inputs: recipes.flatMap((recipe) =>
      nestedList(recipe, "inputs").map((input, ordinal) => ({
        recipe_id: text(recipe.id),
        ordinal,
        item_id: text(input.itemId),
        count: scalar(input.count),
      })),
    ),
    recipe_outputs: recipes.flatMap((recipe) =>
      nestedList(recipe, "outputs").map((output, ordinal) => ({
        recipe_id: text(recipe.id),
        ordinal,
        item_id: text(output.itemId),
        count: scalar(output.count),
      })),
    ),
    gathering_node_drops: gatheringNodes.flatMap((node) =>
      nestedList(node, "drops").map((drop, ordinal) => ({
        node_id: text(node.id),
        ordinal,
        item_id: text(drop.itemId),
        chance: scalar(drop.chance),
        min: scalar(drop.min),
        max: scalar(drop.max),
      })),
    ),
    quest_steps: [],
    quest_reward_items: quests.flatMap((quest) =>
      nestedList(nested(quest, "rewards") ?? {}, "items").map((reward, ordinal) => ({
        quest_id: text(quest.id),
        ordinal,
        item_id: text(reward.itemId),
        count: scalar(reward.count),
        tutorial_grant: scalar(reward.tutorialGrant),
      })),
    ),
    ability_effects: abilities.flatMap((ability) =>
      nestedList(ability, "effects").map((effect, ordinal) => ({
        ability_id: text(ability.id),
        ordinal,
        type: scalar(effect.type),
        value: scalar(effect.value),
        target: scalar(effect.target),
        stat: scalar(effect.stat),
        is_percent: scalar(effect.isPercent),
        duration: scalar(effect.duration),
        stacks: scalar(effect.stacks),
        per_stack: scalar(effect.perStack),
      })),
    ),
    ability_tags: abilities.flatMap((ability) =>
      (Array.isArray(ability.tags) ? ability.tags : []).map((tag) => ({
        ability_id: text(ability.id),
        tag: text(tag),
      })),
    ),
    gem_stats: gems.flatMap((gem) =>
      numberMap(gem, "stats")
        .filter(([, value]) => typeof value === "number")
        .map(([stat, value]) => ({ gem_id: text(gem.id), stat, value: scalar(value) })),
    ),
    affix_weights: affixes.flatMap((affix) =>
      numberMap(affix, "weight")
        .filter(([, value]) => typeof value === "number")
        .map(([gearKind, value]) => ({
          affix_id: text(affix.id),
          gear_kind: gearKind,
          weight: scalar(value),
        })),
    ),
    zone_enemies: zonesDungeons.flatMap((zone) =>
      (Array.isArray(zone.enemies) ? zone.enemies : []).map((enemyId, ordinal) => ({
        zone_id: text(zone.id),
        ordinal,
        enemy_id: text(enemyId),
      })),
    ),
    zone_resources: zonesDungeons.flatMap((zone) =>
      Object.entries(nested(zone, "resources") ?? {}).flatMap(([resourceKind, nodeIds]) =>
        (Array.isArray(nodeIds) ? nodeIds : [])
          // Zone definitions still name the gathering nodes of tiers the shipped feature flags keep
          // switched off. Those nodes are absent from the live node table, so listing them would
          // promise a player a resource the zone does not actually offer.
          .filter((nodeId) => gatheringNodeIds.has(text(nodeId)))
          .map((nodeId, ordinal) => ({
            zone_id: text(zone.id),
            resource_kind: resourceKind,
            ordinal,
            node_id: text(nodeId),
          })),
      ),
    ),
    world_boss_gear_stats: worldBosses.flatMap((boss) =>
      (Array.isArray(boss.gearStats) ? boss.gearStats : []).map((pair, ordinal) => {
        const [label, displayValue] = Array.isArray(pair) ? pair : [pair, null];
        return {
          boss_id: text(boss.id),
          ordinal,
          label: scalar(label),
          display_value: scalar(displayValue),
        };
      }),
    ),
    world_boss_abilities: worldBosses.flatMap((boss) =>
      nestedList(boss, "abilities").map((ability, ordinal) => ({
        boss_id: text(boss.id),
        ordinal,
        name: scalar(ability.name),
        text: scalar(ability.text),
        counter: scalar(ability.counter),
      })),
    ),
    meta: [],
  };

  // item_sources ordinals count within one (item, kind, source) group, so they are assigned after
  // every source has been collected.
  const sourceOrdinals = new Map<string, number>();
  dataset.item_sources = pendingSources.map((source) => {
    const group = `${source.itemId}\u0000${source.sourceKind}\u0000${source.sourceId}`;
    const ordinal = sourceOrdinals.get(group) ?? 0;
    sourceOrdinals.set(group, ordinal + 1);
    return {
      item_id: source.itemId,
      source_kind: source.sourceKind,
      source_id: source.sourceId,
      ordinal,
      chance: source.chance,
      min: source.min,
      max: source.max,
    };
  });

  const entityIds: Record<string, Set<string>> = {
    items: itemIds,
    enemies: new Set(enemies.map((entry) => text(entry.id))),
    gathering_nodes: new Set(gatheringNodes.map((entry) => text(entry.id))),
    zones_dungeons: new Set(zonesDungeons.map((entry) => text(entry.id))),
    recipes: new Set(recipes.map((entry) => text(entry.id))),
  };
  dataset.quest_steps = quests.flatMap((quest) =>
    nestedList(quest, "steps").map((step, ordinal) => {
      const targetId = text(step.targetId);
      const kind = TARGET_KINDS.find(([, table]) => entityIds[table]!.has(targetId));
      return {
        quest_id: text(quest.id),
        ordinal,
        type: scalar(step.type),
        target_id: targetId,
        target_kind: kind ? kind[0] : "token",
        count: scalar(step.count),
        allow_held: scalar(step.allowHeld),
      };
    }),
  );

  sortDataset(dataset);

  dataset.meta = [
    { key: "schema_version", value: String(SCHEMA_VERSION) },
    { key: "build_id", value: buildId },
    { key: "generated_at", value: new Date().toISOString() },
    ...TABLES.filter((table) => table.kind !== "meta").map((table) => ({
      key: `rows_${table.name}`,
      value: String(dataset[table.name]?.length ?? 0),
    })),
  ];

  return dataset;
}

/** Orders every table by its primary key so republishing one build yields identical bytes. */
function sortDataset(dataset: Dataset): void {
  for (const table of TABLES) {
    const rows = dataset[table.name];
    if (!rows) continue;
    rows.sort((left, right) => {
      for (const column of table.primaryKey) {
        const a = left[column];
        const b = right[column];
        if (typeof a === "number" && typeof b === "number") {
          if (a !== b) return a - b;
          continue;
        }
        const comparison = String(a ?? "").localeCompare(String(b ?? ""));
        if (comparison !== 0) return comparison;
      }
      return 0;
    });
  }
}
