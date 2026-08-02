import type { ComposedTables } from "./compose.ts";
import type { MechanicDocument } from "./mechanics.ts";
import { collectImages, indexRefs } from "./images.ts";
import { SCHEMA_VERSION, TABLES } from "./schema.ts";

/**
 * Turn composed runtime tables into flat rows for the published schema.
 *
 * Enforce two properties here, not in serializers.
 * Each row has exactly its table columns.
 * Row order is deterministic.
 * Without deterministic order, republishing one build produces different bytes.
 * A consumer cannot then compare two releases.
 */

export type Scalar = string | number | boolean | null;
export type Row = Record<string, Scalar>;
/** Keyed by `TableSpec.name`. */
export type Dataset = Record<string, Row[]>;

type Source = Record<string, unknown>;

/** Item ids that name currency instead of inventory items. */
export const CURRENCY_ITEM_IDS: ReadonlySet<string> = new Set(["gold"]);

/** Read a composed table as rows, whether stored as an array or keyed by id. */
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

/** Six modeled item sources in the order used by `item_sources`. */
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

/**
 * Source of an item's published level.
 * Equipment uses the game's balance level.
 * Other items use a source property.
 * Naming the source keeps the number honest.
 * A gathering requirement and gear tier are different numbers.
 */
export const LEVEL_SOURCES = [
  "game-balance",
  "world-boss-gear",
  "crafting",
  "gathering",
  "enemy-drop",
  "shop",
  "unknown",
] as const;
export type LevelSource = (typeof LEVEL_SOURCES)[number];

/**
 * The game's shorthand inside a display key.
 * Without conversion, `affix.class.mage.time_warp_cd` shows "Time Warp Cd".
 * That is not the game's wording and is not readable.
 */
const AFFIX_WORDS: Record<string, string> = {
  cd: "Cooldown",
  dmg: "Damage",
  hp: "HP",
  mp: "MP",
  xp: "XP",
  vs: "vs",
  // A unit is not part of the name. The game label is "+{{value}}ms Stun Duration", so the unit stays with the value.
  ms: "",
};

/**
 * A readable affix label from the game's `displayKey`.
 *
 * `affix.cp.armorPenetration` becomes "Armor Penetration".
 * The game ships the key but no label table.
 * Split the final segment at camel-case boundaries.
 * This keeps the game's word instead of inventing one.
 * If no label exists, use the id because it is the row's only other identifier.
 */
function affixName(displayKey: unknown, id: string): string {
  const key = typeof displayKey === "string" ? (displayKey.split(".").pop() ?? "") : "";
  const source = key || id.replace(/^affix_/, "").replace(/_/g, " ");
  return source
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((word) => AFFIX_WORDS[word.toLowerCase()] ?? word.charAt(0).toUpperCase() + word.slice(1))
    .filter((word) => word.length > 0)
    .join(" ");
}

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
  const classes = sourceRows(composed.classes?.value);

  const itemIds = new Set(items.map((item) => text(item.id)));
  // Shop listings use the item they sell as their identity. Resolve the name and art through this item.
  const itemNames = new Map(items.map((item) => [text(item.id), text(item.name)]));
  const gatheringNodeIds = new Set(gatheringNodes.map((node) => text(node.id)));

  // Use one normalized art path per row, keyed by (table, id). Resolve it here because path fields differ and two fields are polymorphic.
  const images = indexRefs(collectImages(composed, extractedDir));
  const image = (table: string, id: unknown): Scalar => images.get(`${table}\u0000${text(id)}`) ?? null;

  // Collect sources first so `items.has_modelled_source` is set while items are emitted.
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
    // Keep item_sources.item_id as a real foreign key. The only dropped value is the pseudo-item `gold`, which enemy_drops records unchanged.
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

  // Assign each item level using the game's precedence. Equipment uses balance level. World-boss gear uses the boss level, which the balance pass skips. Other items use the level from their source.
  //
  // Gathering, enemy, and shop sources use the lowest level because it is the earliest reachable point. Crafting uses the highest because its requirement is a real gate.
  const balanceLevels = (composed.itemLevels?.value ?? {}) as Record<string, { level?: unknown }>;
  const recipeLevels = new Map(recipes.map((recipe) => [text(recipe.id), Number(recipe.levelReq)]));
  const nodeLevels = new Map(gatheringNodes.map((node) => [text(node.id), Number(node.levelReq)]));
  const enemyLevels = new Map(enemies.map((enemy) => [text(enemy.id), Number(enemy.level)]));
  const shopLevels = new Map(shopListings.map((listing) => [text(listing.itemId), Number(listing.levelReq)]));
  const bossGearLevels = new Map(
    worldBosses
      .filter((boss) => text(boss.gearItemId))
      .map((boss) => [text(boss.gearItemId), Number(boss.gearLevel)]),
  );

  const sourcesByItem = new Map<string, PendingSource[]>();
  for (const source of pendingSources) {
    const list = sourcesByItem.get(source.itemId);
    if (list) list.push(source);
    else sourcesByItem.set(source.itemId, [source]);
  }

  // Use the first zone that lists each enemy. This is the zone named by a drop answer. An enemy with no zone stays null instead of using a plausible zone.
  const zoneByEnemy = new Map<string, string>();
  for (const zone of zonesDungeons) {
    for (const enemyId of Array.isArray(zone.enemies) ? zone.enemies : []) {
      const id = text(enemyId);
      if (!zoneByEnemy.has(id)) zoneByEnemy.set(id, text(zone.id));
    }
  }

  const recipeById = new Map(recipes.map((entry) => [text(entry.id), entry]));
  const enemyById = new Map(enemies.map((entry) => [text(entry.id), entry]));
  const nodeById = new Map(gatheringNodes.map((entry) => [text(entry.id), entry]));
  const questById = new Map(quests.map((entry) => [text(entry.id), entry]));
  const bossById = new Map(worldBosses.map((entry) => [text(entry.id), entry]));
  const listingByItem = new Map(shopListings.map((entry) => [text(entry.itemId), entry]));
  const itemById = new Map(items.map((entry) => [text(entry.id), entry]));

  /**
   * How a source row describes itself for each kind.
   * World bosses report the gear level they recommend, not the level of dropped gear.
   * This column states source difficulty, not its output.
   */
  const sourceDescription = (kind: SourceKind, sourceId: string): { level: Scalar; name: Scalar } => {
    switch (kind) {
      case "recipe": {
        const recipe = recipeById.get(sourceId);
        return { level: scalar(recipe?.levelReq), name: scalar(recipe?.name) };
      }
      case "enemy": {
        const enemy = enemyById.get(sourceId);
        return { level: scalar(enemy?.level), name: scalar(enemy?.name) };
      }
      case "gathering": {
        const node = nodeById.get(sourceId);
        return { level: scalar(node?.levelReq), name: scalar(node?.name) };
      }
      case "shop": {
        // A shop source uses the item itself as its key, so its name is the item's name.
        return {
          level: scalar(listingByItem.get(sourceId)?.levelReq),
          name: scalar(itemById.get(sourceId)?.name),
        };
      }
      case "quest": {
        const quest = questById.get(sourceId);
        return { level: scalar(quest?.levelReq), name: scalar(quest?.name) };
      }
      case "world_boss": {
        const boss = bossById.get(sourceId);
        return { level: scalar(boss?.recommendedGearLevel), name: scalar(boss?.name) };
      }
    }
  };

  const levelOf = (itemId: string): { level: Scalar; source: LevelSource } => {
    const balance = balanceLevels[itemId]?.level;
    if (typeof balance === "number" && Number.isFinite(balance)) {
      return { level: balance, source: "game-balance" };
    }
    const bossGear = bossGearLevels.get(itemId);
    if (Number.isFinite(bossGear)) return { level: bossGear!, source: "world-boss-gear" };

    const sources = sourcesByItem.get(itemId) ?? [];
    const pick = (
      kind: SourceKind,
      levels: Map<string, number>,
      choose: (values: number[]) => number,
    ): number | null => {
      const values = sources
        .filter((entry) => entry.sourceKind === kind)
        .map((entry) => levels.get(entry.sourceId))
        .filter((value): value is number => Number.isFinite(value));
      return values.length > 0 ? choose(values) : null;
    };

    const crafting = pick("recipe", recipeLevels, (values) => Math.max(...values));
    if (crafting !== null) return { level: crafting, source: "crafting" };
    const gathering = pick("gathering", nodeLevels, (values) => Math.min(...values));
    if (gathering !== null) return { level: gathering, source: "gathering" };
    const enemy = pick("enemy", enemyLevels, (values) => Math.min(...values));
    if (enemy !== null) return { level: enemy, source: "enemy-drop" };
    const shop = shopLevels.get(itemId);
    if (Number.isFinite(shop)) return { level: shop!, source: "shop" };

    return { level: null, source: "unknown" };
  };

  const dataset: Dataset = {
    items: items.map((item) => {
      const stats = nested(item, "stats");
      const passive = nested(item, "passive");
      const level = levelOf(text(item.id));
      return {
        id: text(item.id),
        name: scalar(item.name),
        image: image("items", item.id),
        type: scalar(item.type),
        description: scalar(item.description),
        rarity: scalar(item.rarity),
        level: level.level,
        level_source: level.source,
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
      image: image("items", (nestedList(recipe, "outputs")[0] ?? {}).itemId),
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
    classes: classes.map((entry) => ({
      id: text(entry.classId),
      name: scalar(entry.name),
      image: image("classes", entry.classId),
      title: scalar(entry.title),
      description: scalar(entry.description),
      focus: scalar(entry.focus),
      world_role: scalar(entry.worldRole),
    })),
    class_traits: classes.flatMap((entry) =>
      nestedList(entry, "traits").map((trait, ordinal) => ({
        class_id: text(entry.classId),
        ordinal,
        label: scalar(trait.label),
        tip: scalar(trait.tip),
      })),
    ),
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
      name: affixName(affix.displayKey, text(affix.id)),
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
      name: itemNames.get(text(listing.itemId)) ?? text(listing.itemId),
      image: image("items", listing.itemId),
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
        // attackStyle is the only non-numeric stat. Publish it as an items column.
        .filter(([stat, value]) => stat !== "attackStyle" && typeof value === "number")
        .map(([stat, value]) => ({ item_id: text(item.id), stat, value: scalar(value) })),
    ),
    item_sources: [],
    enemy_drops: enemies.flatMap((enemy) =>
      nestedList(enemy, "drops").map((drop, ordinal) => ({
        enemy_id: text(enemy.id),
        enemy_level: scalar(enemy.level),
        zone_id: zoneByEnemy.get(text(enemy.id)) ?? null,
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
          // Zone definitions still name gathering nodes for tiers that feature flags disable. Those nodes are absent from the live table. Listing them promises a resource that the zone does not offer.
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
    search_index: [],
  };

  // item_sources ordinals count within each (item, kind, source) group. Assign them after collecting every source.
  const sourceOrdinals = new Map<string, number>();
  dataset.item_sources = pendingSources.map((source) => {
    const group = `${source.itemId}\u0000${source.sourceKind}\u0000${source.sourceId}`;
    const ordinal = sourceOrdinals.get(group) ?? 0;
    sourceOrdinals.set(group, ordinal + 1);
    const described = sourceDescription(source.sourceKind, source.sourceId);
    return {
      item_id: source.itemId,
      source_kind: source.sourceKind,
      source_id: source.sourceId,
      source_level: described.level,
      source_name: described.name,
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

  // Build this after sorting so row order follows the indexed tables. Build it after entity tables exist so it can read published columns.
  dataset.search_index = buildSearchIndex(dataset);

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

/** Order every table by its primary key so one build always yields identical bytes. */
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

/**
 * How each entity table describes itself in search results.
 *
 * `kind` is the singular label beside a result.
 * `level` and `subtitle` distinguish records with similar names.
 * Zones and dungeons share a table and use their `type` column for distinction.
 * Resolve their label per row.
 */
const SEARCH_SHAPES: Record<
  string,
  { kind: string | ((row: Row) => string); level?: string; subtitle?: (row: Row) => Scalar }
> = {
  items: {
    kind: "Item",
    level: "level",
    subtitle: (row) => [row.type, row.slot].filter(Boolean).join(" · ") || null,
  },
  enemies: {
    kind: "Enemy",
    level: "level",
    subtitle: (row) => [row.element, row.attack_style].filter(Boolean).join(" · ") || null,
  },
  recipes: { kind: "Recipe", level: "crafting_level", subtitle: (row) => row.category },
  gathering_nodes: {
    kind: "Gathering node",
    level: "gathering_level",
    subtitle: (row) => row.type,
  },
  quests: { kind: "Quest", level: "combat_level", subtitle: (row) => row.category },
  abilities: { kind: "Ability", level: "combat_level", subtitle: (row) => row.required_class },
  affixes: { kind: "Affix", subtitle: (row) => row.category },
  gems: { kind: "Gem", subtitle: (row) => row.family },
  shop_listings: { kind: "Shop listing", level: "combat_level", subtitle: (row) => row.category },
  zones_dungeons: {
    kind: (row) => (row.type === "zone" ? "Zone" : "Dungeon"),
    level: "combat_level",
    // Use the entry level, not a range. The upper bound of a zone band is not published, so inventing one states a game fact that does not exist.
    subtitle: (row) => (row.combat_level === null ? null : `Combat ${row.combat_level}`),
  },
  achievements: { kind: "Achievement", subtitle: (row) => row.category },
  world_bosses: {
    kind: "World boss",
    level: "recommended_gear_level",
    subtitle: (row) => row.epithet,
  },
};

export function appendMechanicSearchRows(
  dataset: Dataset,
  documents: readonly MechanicDocument[],
): void {
  const rows = dataset.search_index ?? (dataset.search_index = []);
  for (const document of documents) {
    rows.push({
      table: "mechanics",
      id: document.id,
      slug: "mechanics",
      kind: "Mechanic guide",
      name: document.title.text,
      subtitle: document.summary.text,
      level: null,
      rarity: null,
      image: null,
    });
  }
}

function buildSearchIndex(dataset: Dataset): Row[] {
  const rows: Row[] = [];
  for (const table of TABLES) {
    if (table.kind !== "entity") continue;
    const shape = SEARCH_SHAPES[table.name];
    if (!shape) continue;
    const keyColumn = table.primaryKey[0]!;
    for (const row of dataset[table.name] ?? []) {
      const id = String(row[keyColumn] ?? "");
      if (!id) continue;
      const level = shape.level ? row[shape.level] : null;
      rows.push({
        table: table.name,
        id,
        slug: table.slug,
        // Shop listings are the only entity rows without their own name.
        name: typeof row.name === "string" && row.name.length > 0 ? row.name : id,
        kind: typeof shape.kind === "function" ? shape.kind(row) : shape.kind,
        subtitle: shape.subtitle?.(row) ?? null,
        level: typeof level === "number" ? level : null,
        rarity: typeof row.rarity === "string" ? row.rarity : null,
        image: typeof row.image === "string" ? row.image : null,
      });
    }
  }
  return rows;
}
