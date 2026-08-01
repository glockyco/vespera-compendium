import { readFileSync } from "node:fs";
import path from "node:path";
import { balance, collectionSize, evalComposition, locateTable, resolveBundles } from "@vespera/core";
import {
  callObjectAfterAnchor,
  composedDeclarationByAnchor,
  declarationByAnchor,
  directTable,
  frozenObjectAfterAnchor,
  generated,
  setByAnchor,
} from "./anchors.ts";
import { applyGearBalance, gearBalanceLevels } from "./gear.ts";

export type ComposedTable = {
  base: number;
  live: number;
  mechanism: string;
  value: unknown;
};

export type ComposedTables = Record<string, ComposedTable>;

type DataRecord = Record<string, any>;

function stripAchievementTitle(entry: DataRecord): DataRecord {
  if (!entry?.reward || !Object.prototype.hasOwnProperty.call(entry.reward, "title")) return entry;
  const reward = { ...entry.reward };
  delete reward.title;
  return { ...entry, reward };
}

/**
 * Achievement gold is not literal. The bundle declares a per-achievement weight table, divides a
 * fixed total pot across it, rounds each share to 500 gold, then overwrites every matching
 * achievement's reward. The shipped declaration chain is evaluated as-is so the rounding rules and
 * the single hand-tuned exception stay the game's own rather than a restatement of them here.
 */
function achievementGoldRewards(source: string): Record<string, number> {
  const weights = /([A-Za-z_$][\w$]*)\s*=\s*Object\.freeze\(\s*\{\s*wake_first_spark:/.exec(source);
  if (!weights) throw new Error("missing achievement gold weight table");
  const derivation = /([A-Za-z_$][\w$]*)\s*=\s*Object\.freeze\(\s*Object\.fromEntries\(/g;
  derivation.lastIndex = weights.index;
  const rewards = derivation.exec(source);
  if (!rewards) throw new Error("missing achievement gold reward derivation");
  const [, end] = balance(source, rewards.index + rewards[0].indexOf("("));
  const declarations = source.slice(weights.index, end);
  if (!/goldWeight/.test(declarations)) throw new Error("unexpected achievement gold derivation shape");
  return evalComposition(`(()=>{const ${declarations};return ${rewards[1]};})()`) as Record<string, number>;
}

function collectionIds(value: unknown): Set<string> {
  return new Set(
    Array.isArray(value)
      ? value.map((entry) => String((entry as { id?: unknown })?.id)).filter((id) => id !== "undefined")
      : Object.keys((value ?? {}) as object),
  );
}

const BOSS_HP_CURVE = [
  [1, 120], [5, 1500], [14, 5_000], [30, 13_000], [50, 23_000], [60, 30_000],
  [80, 48_000], [95, 68_000], [100, 100_000], [106, 120_000], [120, 160_000],
  [125, 185_000], [130, 220_000], [134, 245_000], [140, 290_000], [142, 310_000], [154, 360_000],
] as const;
const REGULAR_HP_CURVE = [
  [1, 20], [5, 120], [14, 500], [30, 1800], [50, 4000], [60, 5500], [80, 8500],
  [95, 12_000], [100, 15_000], [120, 24_000], [130, 32_000], [140, 38_000], [154, 45_000],
] as const;
const BOSS_DAMAGE_CURVE = [
  [1, 8], [5, 16], [14, 28], [30, 58], [50, 135], [60, 180], [80, 297], [95, 396],
  [100, 486], [120, 828], [130, 1008], [140, 1170], [154, 1368],
] as const;
const REGULAR_DAMAGE_CURVE = [
  [1, 45], [5, 90], [14, 180], [30, 375], [50, 750], [60, 1000], [80, 1650],
  [95, 2200], [100, 2700], [120, 4600], [130, 5600], [140, 6500], [154, 7600],
] as const;
const BOSS_DEFENSE_CURVE = [
  [1, 0], [5, 12], [14, 20], [30, 55], [50, 130], [60, 220], [80, 390], [95, 540],
  [100, 675], [120, 820], [130, 940], [140, 1180], [154, 1450],
] as const;

type BalanceCurve = readonly (readonly [number, number])[];

function interpolateCurve(level: number, curve: BalanceCurve): number {
  const safeLevel = Math.max(1, Number(level) || 1);
  if (safeLevel <= curve[0]![0]) return curve[0]![1];
  for (let index = 1; index < curve.length; index++) {
    const [nextLevel, nextValue] = curve[index]!;
    if (safeLevel <= nextLevel) {
      const [previousLevel, previousValue] = curve[index - 1]!;
      const progress = (safeLevel - previousLevel) / Math.max(1, nextLevel - previousLevel);
      return previousValue + (nextValue - previousValue) * progress;
    }
  }
  const [lastLevel, lastValue] = curve.at(-1)!;
  const [previousLevel, previousValue] = curve.at(-2)!;
  return lastValue + Math.max(0, safeLevel - lastLevel) *
    ((lastValue - previousValue) / Math.max(1, lastLevel - previousLevel));
}

function median(values: number[]): number {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function legacyAetherValue(itemId: unknown): number {
  if (/^mythic_key_t\d+$/.test(String(itemId ?? ""))) return 300;
  return ({
    mythic_essence_vs: 25,
    abyssal_essence_vs: 5,
    heart_of_abyss_vs: 60,
    focusing_prism: 30,
    eternal_fragment_vs: 100,
    vault_room_deed: 500,
  } as Record<string, number>)[String(itemId)] ?? 0;
}

function normalizeDropCarrier(carrier: DataRecord): DataRecord {
  if (!Array.isArray(carrier.drops)) return carrier;
  let changed = false;
  const drops = carrier.drops.map((drop: DataRecord) => {
    const conversion = legacyAetherValue(drop?.itemId);
    if (conversion === 0) return drop;
    changed = true;
    const min = Math.max(1, Math.floor(Number(drop.min ?? drop.count ?? 1) || 1));
    const max = Math.max(min, Math.floor(Number(drop.max ?? drop.count ?? min) || min));
    const normalized: DataRecord = { ...drop, itemId: "aether", min: min * conversion, max: max * conversion };
    delete normalized.count;
    delete normalized.rarity;
    return normalized;
  });
  return changed ? { ...carrier, drops } : carrier;
}

function evaluateEnemyArray(
  text: string,
  items: DataRecord,
  commonShards: string[],
  rareShards: string[],
  mode: "heroic" | "nightmare",
): DataRecord[] {
  const shared = `const H=${JSON.stringify(items)};const ELEMENT_COMMON_SHARD_ITEM_IDS=${JSON.stringify(commonShards)};const ELEMENT_RARE_SHARD_ITEM_IDS=${JSON.stringify(rareShards)};`;
  const helpers = mode === "heroic"
    ? `const heroicDrops=(t,r,e,a,n=2)=>[{itemId:"gold",chance:1,min:e,max:a},{itemId:"heroic_essence",chance:.75,min:1,max:n},{itemId:"heroic_rune_lockstone",chance:r?.015:.005,min:1,max:1},...ELEMENT_COMMON_SHARD_ITEM_IDS.map(s=>({itemId:s,chance:r?.1875:.05625,min:1,max:r?4:1})),...ELEMENT_RARE_SHARD_ITEM_IDS.map(s=>({itemId:s,chance:r?.03:.015,min:1,max:1})),{itemId:t,chance:.55,min:1,max:2},...(r?[{itemId:"heroic_writ",chance:.03,min:1,max:1},{itemId:r,chance:1,min:1,max:1}]:[])];const HEROIC_CLASS_DROP_TABLE={mainHand:["sword_heroic","staff_heroic","bow_heroic","dagger_heroic"],offHand:["shield_heroic","tome_heroic","quiver_heroic","dagger_offhand_heroic"],head:["heroic_warrior_head","heroic_mage_head","heroic_ranger_head","heroic_rogue_head"],chest:["heroic_warrior_chest","heroic_mage_chest","heroic_ranger_chest","heroic_rogue_chest"],legs:["heroic_warrior_legs","heroic_mage_legs","heroic_ranger_legs","heroic_rogue_legs"],ring:["heroic_warrior_ring","heroic_mage_ring","heroic_ranger_ring","heroic_rogue_ring"],amulet:["heroic_warrior_amulet","heroic_mage_amulet","heroic_ranger_amulet","heroic_rogue_amulet"],signet:["heroic_warrior_signet","heroic_mage_signet","heroic_ranger_signet","heroic_rogue_signet"]};const heroicClassDrops=(t,r=.18)=>(HEROIC_CLASS_DROP_TABLE[t]||[]).map(e=>({itemId:e,chance:r,min:1,max:1,classRequirement:(H[e]||{}).classRequirement}));const withHeroicClassDrops=(t,r,e)=>[...t,...heroicClassDrops(r,e)];`
    : `const nightmareDungeonDrops=(t,r=false,e=[])=>[{itemId:"gold",chance:1,min:r?9000+t*4200:2600+t*1100,max:r?17000+t*7600:5200+t*1800},{itemId:"aether",chance:r?1:.45,min:r?8+t*4:2,max:r?16+t*6:4+t*2},{itemId:"nightmare_alloy",chance:r?1:.24,min:r?3+t*2:1,max:r?6+t*3:2},{itemId:"nightmare_gloam_thread",chance:r?.95:.28,min:r?3+t:1,max:r?7+t*2:2},{itemId:"nightmare_dread_core",chance:r?.55:.06,min:1,max:r?Math.max(1,Math.ceil(t/2)):1},{itemId:"heroic_essence",chance:r?.9:.45,min:r?3+t:1,max:r?5+t*2:2+t},{itemId:"heroic_writ",chance:r?.06+t*.01:.01,min:1,max:1},...e.map(a=>({itemId:a,chance:r?.045:.006,min:1,max:1,rarity:"legendary",classRequirement:(H[a]||{}).classRequirement})),...ELEMENT_COMMON_SHARD_ITEM_IDS.map(e=>({itemId:e,chance:r?.135:.05625,min:1,max:r?3:1})),...ELEMENT_RARE_SHARD_ITEM_IDS.map(e=>({itemId:e,chance:r?.01875:.015,min:1,max:1}))];`;
  return evalComposition(`(()=>{${shared}${helpers}return ${text};})()`) as DataRecord[];
}

function composeEnemies(
  source: string,
  base: DataRecord[],
  extensions: DataRecord[][],
  items: DataRecord,
  zonesDungeons: DataRecord[],
): DataRecord[] {
  const commonShards = composedDeclarationByAnchor(source, [/ember_shard/, /shard_air_vs/], "[") as string[];
  const rareShards = composedDeclarationByAnchor(source, [/dawn_shard/, /shard_shadow_vs/], "[") as string[];
  const legacyShards = new Set([...commonShards, ...rareShards, "fire_shard", "ice_shard", "earth_shard", "air_shard"]);
  const filteredBase = base.map((enemy) => ({
    ...enemy,
    drops: (Number(enemy.level) || 0) < 40 && Array.isArray(enemy.drops)
      ? enemy.drops.filter((drop: DataRecord) => !legacyShards.has(String(drop.itemId)))
      : enemy.drops,
  }));

  const heroicText = declarationByAnchor(source, [/h2_mournfield_lantern/, /h2_vesper_gateking/, /maxHp:/, /attackInterval:/], "[").text;
  const nightmareText = declarationByAnchor(source, [/nightmare_moonwell_sentry/, /nightmare_orchard_gateking/, /maxHp:/, /attackInterval:/], "[").text;
  const heroic = evaluateEnemyArray(heroicText, items, commonShards, rareShards, "heroic");
  const nightmare = evaluateEnemyArray(nightmareText, items, commonShards, rareShards, "nightmare");
  for (const enemy of heroic) {
    enemy.xp = Math.max(1, Math.round((enemy.xp || 1) * 4.375 * 1.3));
    if (Array.isArray(enemy.drops)) {
      enemy.drops = enemy.drops.map((drop: DataRecord) => drop.itemId === "gold"
        ? { ...drop, min: Math.max(1, Math.round((drop.min || 1) * 0.82)), max: Math.max(1, Math.round((drop.max || 1) * 0.82)) }
        : drop);
    }
  }
  for (const enemy of nightmare) {
    const scale = Math.max(0, (Number(enemy.level) || 124) - 124);
    enemy.maxHp = Math.max(1, Math.floor(enemy.maxHp * (1 + scale * 0.055)));
    enemy.defense = Math.max(0, Math.floor(enemy.defense * (1 + scale * 0.032)));
    enemy.damage = Math.max(1, Math.floor(enemy.damage * (1 + scale * 0.034)));
    enemy.xp = Math.max(1, Math.floor(enemy.level * enemy.level * (enemy.isBoss ? 2.4 : 1.15)));
  }

  const enemies = [...filteredBase, ...extensions.flat(), ...heroic, ...nightmare].map(normalizeDropCarrier);
  const groups = new Map<string, { hp: number[]; damage: number[]; defense: number[] }>();
  for (const enemy of enemies) {
    if (!(enemy?.level > 0 && enemy.maxHp > 0)) continue;
    const key = `${enemy.isBoss ? "boss" : "regular"}:${enemy.level}`;
    const group = groups.get(key) ?? { hp: [], damage: [], defense: [] };
    group.hp.push(Number(enemy.maxHp) || 1);
    group.damage.push(Number(enemy.damage) || 1);
    group.defense.push(Number(enemy.defense) || 0);
    groups.set(key, group);
  }
  for (const enemy of enemies) {
    if (!(enemy?.level > 0 && enemy.maxHp > 0)) continue;
    const group = groups.get(`${enemy.isBoss ? "boss" : "regular"}:${enemy.level}`)!;
    const ratio = (value: unknown, middle: number, min: number, max: number): number =>
      Math.max(min, Math.min(max, (Number(value) || 0) / Math.max(1, middle)));
    enemy.maxHp = Math.max(1, Math.floor(interpolateCurve(enemy.level, enemy.isBoss ? BOSS_HP_CURVE : REGULAR_HP_CURVE) * ratio(enemy.maxHp, median(group.hp), 0.82, 1.18)));
    enemy.damage = Math.max(1, Math.floor(interpolateCurve(enemy.level, enemy.isBoss ? BOSS_DAMAGE_CURVE : REGULAR_DAMAGE_CURVE) * (enemy.isBoss ? 1 : 0.45) * ratio(enemy.damage, median(group.damage), 0.85, 1.15)));
    enemy.defense = Math.max(0, Math.floor(interpolateCurve(enemy.level, BOSS_DEFENSE_CURVE) * (enemy.isBoss ? 1 : 0.7) * ratio(enemy.defense, median(group.defense), 0.9, 1.1)));
  }

  const openingHp: Record<string, number> = { bear: 110, kobold: 60, wolf: 80, hogger: 2100 };
  for (const enemy of enemies) {
    if (openingHp[enemy.id]) enemy.maxHp = openingHp[enemy.id];
    const level = Math.max(1, Math.floor(Number(enemy.level) || 1));
    const hpPace = level <= 20 ? 0.85 : 0.9;
    const levelBoost = level >= 30 ? 1.1 : 1;
    enemy.maxHp = Math.max(1, Math.round(Math.max(1, Number(enemy.maxHp) || 1) * hpPace));
    enemy.maxHp = Math.max(1, Math.round(enemy.maxHp * levelBoost));
    enemy.damage = Math.max(1, Math.round(Math.max(1, Number(enemy.damage) || 1) * levelBoost));
    if (level >= 92) enemy.damage = Math.max(1, Math.round(enemy.damage * 1.15));
    if (level <= 20) enemy.xp = Math.max(1, Math.round(enemy.xp * 1.2));
  }

  const zoneIds = new Set(zonesDungeons.filter((zone) => zone.type === "zone" && (zone.act || 1) !== 2).flatMap((zone) => zone.enemies ?? []));
  const dungeonDefinitions = composedDeclarationByAnchor(source, [/blackvein_warrens/, /stages:/, /enemyId:/], "[") as DataRecord[];
  const dungeonIds = new Set(dungeonDefinitions.flatMap((dungeon) => (dungeon.stages ?? []).map((stage: DataRecord) => stage.enemyId).filter((id: unknown) => id && !zoneIds.has(id))));
  const zoneScaling = [
    { min: 85, hp: 1.5, damage: 1.22 }, { min: 70, hp: 1.4, damage: 1.18 },
    { min: 55, hp: 1.32, damage: 1.14 }, { min: 40, hp: 1.2, damage: 1.1 },
    { min: 25, hp: 1.1, damage: 1.05 }, { min: 0, hp: 1, damage: 1 },
  ];
  const dungeonScaling = [
    { min: 80, hp: 1.55, damage: 1.12 }, { min: 60, hp: 1.45, damage: 1.1 },
    { min: 40, hp: 1.35, damage: 1.08 }, { min: 0, hp: 1.25, damage: 1.05 },
  ];
  for (const enemy of enemies) {
    const scaling = zoneIds.has(enemy.id)
      ? zoneScaling.find((entry) => enemy.level >= entry.min)
      : dungeonIds.has(enemy.id)
        ? dungeonScaling.find((entry) => enemy.level >= entry.min)
        : undefined;
    if (scaling) {
      enemy.maxHp = Math.round(enemy.maxHp * scaling.hp);
      enemy.damage = Math.round(enemy.damage * scaling.damage);
    }
  }
  const actTwoIds = new Set(zonesDungeons.filter((zone) => zone?.type === "zone" && zone?.act === 2).flatMap((zone) => zone.enemies ?? []));
  for (const enemy of enemies) {
    if (actTwoIds.has(enemy.id)) {
      enemy.maxHp = Math.max(1, Math.round(enemy.maxHp * 1.5));
      enemy.damage = Math.max(1, Math.round(enemy.damage * 1.15));
    }
    if (enemy.isBoss) enemy.damage = Math.max(1, Math.round(enemy.damage * 1.1));
  }

  const referenceIds = new Set(["h2_vesper_sergeant", "h2_lastlight_mage", "h2_duskshield_judge", "h2_gateborn_templar", "h2_vesper_gateking"]);
  const reference = heroic.filter((enemy) => referenceIds.has(enemy.id));
  const xpPerHp = (boss: boolean): number => {
    const rows = reference.filter((enemy) => Boolean(enemy.isBoss) === boss && enemy.maxHp > 0);
    return rows.reduce((sum, enemy) => sum + Math.max(0, Number(enemy.xp) || 0), 0) /
      Math.max(1, rows.reduce((sum, enemy) => sum + Math.max(1, Number(enemy.maxHp) || 1), 0));
  };
  for (const enemy of nightmare) {
    enemy.xp = Math.max(1, Math.round(enemy.maxHp * xpPerHp(Boolean(enemy.isBoss)) * 0.56));
  }
  return enemies;
}

export function composeAll(dir = "extracted"): ComposedTables {
  const bundles = resolveBundles(dir);
  const indexSource = readFileSync(path.join(dir, "assets", bundles.index), "utf8");
  const indexHtml = readFileSync(path.join(dir, "index.html"), "utf8");
  const gameViewSource = readFileSync(path.join(dir, "assets", bundles.gameView), "utf8");

  const baseItems = locateTable(indexSource, [/stackable:/, /rarity:/, /sword_bronze/]);
  const baseEnemies = locateTable(indexSource, [/maxHp:/, /attackInterval:/, /drops:/]);
  const baseRecipes = locateTable(indexSource, [/inputs:/, /outputs:/, /levelReq:/], 50_000);
  const baseGathering = locateTable(indexSource, [/requiredTool:/, /baseXp:/, /drops:/], 10_000);
  const baseQuests = locateTable(indexSource, [/steps:/, /rewards:/, /nextQuestId:/], 50_000);
  const baseAchievements = locateTable(indexSource, [/requirement:/, /reward:/, /category:/], 10_000);

  const getVeiledReliquaryRingScaledStats = (level: unknown): DataRecord => {
    const normalized = Math.max(40, Math.min(200, Math.round(Number(level) || 40)));
    const progress = Math.pow((normalized - 40) / 80, 1.08);
    const flat = (start: number, end: number): number => Math.max(1, Math.round(start + (end - start) * progress));
    const percent = (start: number, end: number): number => Math.round((start + (end - start) * progress) * 10_000) / 10_000;
    return {
      attack: flat(12, 50), defense: flat(15, 65), maxHp: flat(80, 230),
      haste: percent(0.01, 0.03), critChance: percent(0.02, 0.04), lifeSteal: percent(0.005, 0.01),
    };
  };
  const dungeonWeaponPools = composedDeclarationByAnchor(
    indexSource,
    [/iron:\s*\{/, /nexus:\s*\{/, /dagger_offhand_nexus_vs/],
    "{",
  ) as Record<string, Record<string, string[]>>;
  const getNormalDungeonClassWeaponDrops = (tier: string, chance = 0.08): DataRecord[] =>
    Object.entries(dungeonWeaponPools[tier] ?? {}).flatMap(([classRequirement, ids]) =>
      ids.map((itemId) => ({ itemId, chance, min: 1, max: 1, classRequirement })),
    );
  const shippedFeatureFlags = frozenObjectAfterAnchor(indexHtml, /__VESPERA_FEATURE_FLAGS__\s*=\s*Object\.freeze\s*\(/);
  // Late crafting and gathering tiers are gated behind the shipped grandworks flag. While it is
  // off the bundle never evaluates LATE_*_TIER_DEFS, so empty stand-ins keep composition honest.
  const grandworks = shippedFeatureFlags.grandworks as { enabled?: unknown } | undefined;
  const lateTierFlags = {
    GRANDWORKS_ENABLED: grandworks?.enabled === true,
    LATE_CRAFTING_TIER_DEFS: [],
    LATE_GATHERING_TIER_DEFS: [],
  };
  const questFeatureFlags = {
    VESPERA_COHESION_PHASE_1_ENABLED: shippedFeatureFlags.cohesionPhase1 === true,
    VESPERA_GLIMMERROOT_COHESION_PILOT_ENABLED: shippedFeatureFlags.glimmerrootCohesionPilot === true,
  };
  const itemBase = evalComposition(baseItems.code, {
    getVeiledReliquaryRingScaledStats,
    VEILED_RELIQUARY_RING_MIN_LEVEL: 40,
    VEILED_RELIQUARY_RING_MAX_LEVEL: 200,
  }) as DataRecord;
  const enemyBase = evalComposition(baseEnemies.code, { getNormalDungeonClassWeaponDrops }) as DataRecord[];
  const recipeBase = evalComposition(baseRecipes.code, {
    ...lateTierFlags,
    km: () => [],
    normalizeReplacementEndgameRecipe: (recipe: unknown) => recipe,
  }) as DataRecord[];
  const gatheringBase = evalComposition(baseGathering.code, lateTierFlags) as DataRecord[];
  const questBase = evalComposition(baseQuests.code, questFeatureFlags) as DataRecord;
  const achievementBase = evalComposition(baseAchievements.code) as DataRecord[];

  const keyLabels = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX"];
  const keyDefinitions = Object.fromEntries(keyLabels.map((label, index) => {
    const tier = index + 1;
    const id = `mythic_key_t${tier}`;
    const rarity = tier <= 4 ? "common" : tier <= 8 ? "uncommon" : tier <= 12 ? "rare" : tier <= 16 ? "epic" : "legendary";
    return [id, {
      id,
      name: `Corruption Key ${label}`,
      description: `Required to enter Corruption ${index * 5 + 1} to ${tier * 5} dungeons.`,
      type: "resource",
      rarity,
      stackable: true,
      value: 100 + tier * 50,
      icon: "",
      imagePath: "assets/items/reskin/core/corruption-key.webp",
    }];
  }));
  const soulbound = composedDeclarationByAnchor(indexSource, [/classAffinity:/, /soulrender/], "{");
  const gemsDeclaration = declarationByAnchor(indexSource, [/family:/, /rune_power_1/], "{");
  const gems = evalComposition(gemsDeclaration.text) as DataRecord;
  const gemDescriptions: Record<string, string> = {
    power: "A Vesper-forged ruby that drives more force through every strike.",
    guard: "A pale diamond cut to brace armor against the pressure beyond the Veil.",
    vigor: "An amethyst carrying a deep violet pulse that expands the bearer's life reserve.",
    might: "A garnet set with ember-lines that reinforces physical strength.",
    wisdom: "A sunlit topaz that sharpens thought and channels denser magic.",
    precision: "An emerald lens that reveals the instant a decisive strike will land.",
    dexterity: "A midnight sapphire cut to steady the hand and quicken every Warden shot.",
  };
  for (const [id, gem] of Object.entries(gems) as [string, DataRecord][]) {
    const family = id.match(/^rune_(power|guard|vigor|might|wisdom|precision|dexterity)_\d$/)?.[1];
    if (family) gem.description = gemDescriptions[family];
  }
  const items: DataRecord = { ...itemBase };
  Object.assign(items, keyDefinitions);
  for (const definition of Object.values(soulbound as DataRecord) as DataRecord[]) {
    items[definition.id] = {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      type: "equipment",
      slot: definition.slot,
      subType: definition.subType,
      stats: { ...definition.stats },
      rarity: "living",
      stackable: false,
      value: 10_000,
      icon: definition.icon,
      imagePath: definition.imagePath,
    };
  }
  for (const definition of Object.values(gems) as DataRecord[]) {
    items[definition.id] = {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      type: "resource",
      rarity: ["common", "uncommon", "rare", "epic", "legendary"][Number(definition.tier) - 1] ?? "common",
      stackable: true,
      value: Number(definition.tier) * 50,
      icon: definition.icon,
      imagePath: definition.imagePath,
    };
  }
  for (const item of Object.values(items) as DataRecord[]) {
    if (item?.type === "consumable" && Number.isFinite(item.healAmount)) {
      item.healAmount = Math.max(1, Math.floor(item.healAmount * 7));
    }
  }

  const enemyAnchors = [
    /oathcrypt_candlebinder/,
    /forge_automaton/,
    /unnamed_wraith/,
    /drake_hatchling/,
    /nexus_guardian/,
    /abyssal_depths_siren/,
    /dragon_guard_dungeon/,
    /convergence_herald_dungeon/,
    /rift_elemental/,
  ];
  const enemyExtensions = enemyAnchors.map((anchor) =>
    evalComposition(
      declarationByAnchor(indexSource, [anchor, /maxHp:/, /attackInterval:/, /drops:/], "[").text,
      { getNormalDungeonClassWeaponDrops },
    ) as DataRecord[],
  );
  const zonesDungeons = directTable(
    indexSource,
    [/type:\s*"(?:zone|dungeon)"/, /levelReq:/],
    10_000,
  ) as DataRecord[];
  const enemies = composeEnemies(
    indexSource,
    enemyBase,
    enemyExtensions,
    items,
    zonesDungeons,
  );

  // The late crafting tier is spread into the shipped recipe table only while grandworks is on,
  // so composing it unconditionally would publish eleven recipes no player can reach.
  const lateRecipes = lateTierFlags.GRANDWORKS_ENABLED
    ? (composedDeclarationByAnchor(
        indexSource,
        [/craft_tower_supply_cache/, /Bind Endless Supply Cache/],
        "[",
        lateTierFlags,
      ) as any[])
    : [];
  const keyRecipes = generated(
    indexSource,
    [/Corruption Key/, /craft_mythic_key_t/, /mythic_keys/],
    'const bs=Array(4096).fill("");const ym=Array.from({length:4096},()=>({bar:[],wood:[],extra:[],levelReq:1,xp:1}));',
  ) as any[];
  const recipeCandidates = [...recipeBase, ...lateRecipes, ...keyRecipes];
  const recipeInputAetherValues: Record<string, number> = {
    mythic_essence_vs: 1,
    abyssal_essence_vs: 5,
    heart_of_abyss_vs: 60,
    focusing_prism: 30,
    eternal_fragment_vs: 100,
    vault_room_deed: 500,
  };
  const normalizedRecipeCandidates = recipeCandidates.map((recipe) => {
    let changed = false;
    const inputs: DataRecord[] = [];
    for (const input of recipe?.inputs ?? []) {
      const conversion = recipeInputAetherValues[input.itemId] ?? (/^mythic_key_t\d+$/.test(input.itemId ?? "") ? 300 : 0);
      if (conversion <= 0) {
        inputs.push(input);
        continue;
      }
      const count = Math.max(1, Math.floor(Number(input.count) || 1)) * conversion;
      const existing = inputs.find((candidate) => candidate.itemId === "aether");
      if (existing) existing.count += count;
      else inputs.push({ itemId: "aether", count });
      changed = true;
    }
    return changed ? { ...recipe, inputs } : recipe;
  });
  const retiredOutputs = setByAnchor(indexSource, [/mythic_essence_vs/, /vault_room_deed/]);
  const directDrops = setByAnchor(indexSource, [
    /craft_nightmare_warrior_head/,
    /craft_nightmare_rogue_signet/,
  ]);
  const classGearDrops = setByAnchor(indexSource, [/ironpeak_talisman_vs/, /ring_nexus_full_vs/]);
  const recipes = normalizedRecipeCandidates.filter(
    (recipe) =>
      !directDrops.has(recipe?.id) &&
      !(recipe?.outputs ?? []).some(
        (output: DataRecord) =>
          retiredOutputs.has(output?.itemId) || /^mythic_key_t\d+$/.test(output?.itemId ?? ""),
      ) &&
      !classGearDrops.has(recipe?.outputs?.[0]?.itemId),
  );
  recipes.push(
    callObjectAfterAnchor(indexSource, /[A-Za-z_$][\w$]*\.push\(\s*\{/g, "craft_ring_copper"),
  );
  // The shipped pass edits the recipe array it is handed (it removes universal boss-drop recipes
  // and re-adds the starter ring), and our recipe list already carries both edits, so it gets a copy.
  const gearInput = {
    source: indexSource,
    items,
    itemsSymbol: baseItems.symbol,
    recipes: [...recipes],
    recipesSymbol: baseRecipes.symbol,
    definitions: soulbound as DataRecord,
    featureFlags: shippedFeatureFlags,
  };
  applyGearBalance(gearInput);
  // Read from a second run of the same program rather than from the mutation above, because the
  // pass rescales stats without recording the level it scaled them against.
  const itemLevels = gearBalanceLevels({ ...gearInput, recipes: [...recipes] });

  const addedQuests = evalComposition(
    declarationByAnchor(indexSource, [/q_ash_bridge_001/, /Smoke and Bloodstone/], "{").text,
    questFeatureFlags,
  ) as DataRecord;
  const heroicQuests = evalComposition(
    declarationByAnchor(indexSource, [/q_h2_mourn_001/, /Act II: The Mournfield Road/], "{").text,
    questFeatureFlags,
  ) as DataRecord;
  const quests: DataRecord = { ...questBase, ...addedQuests };
  const chainLinks: Record<string, string> = {
    q_ash_003: "q_ash_bridge_001", q_iron_003: "q_iron_bridge_001", q_gloom_002: "q_gloom_bridge_001",
    q_tangle_002: "q_tangle_bridge_001", q_cinder_002: "q_cinder_bridge_001", q_blight_002: "q_blight_bridge_001",
    q_shatter_002: "q_shatter_bridge_001", q_dragon_002: "q_dragon_bridge_001", q_nexus_001: "q_nexus_bridge_001",
    q_nexus_003: "q_nexus_bridge_002", q_final_001: "q_final_002", q_final_002: "q_final_003",
    q_ash_006: "q_sw_fib_001", q_iron_005: "q_ir_fib_001", q_gloom_004: "q_gv_fib_001",
    q_tangle_004: "q_tw_fib_001", q_cinder_004: "q_cf_fib_001", q_blight_004: "q_br_fib_001",
    q_shatter_004: "q_si_fib_001", q_dragon_004: "q_ds_fib_001", q_nexus_bridge_001: "q_an_fib_001",
    q_nexus_004: "q_final_001",
  };
  for (const [id, nextQuestId] of Object.entries(chainLinks)) if (quests[id]) quests[id].nextQuestId = nextQuestId;
  const addedIds = new Set(Object.keys(addedQuests));
  for (const [id, quest] of Object.entries(quests) as [string, DataRecord][]) {
    if (!quest || quest.category === "tutorial" || addedIds.has(id) || !quest.rewards) continue;
    const rewards = { ...quest.rewards };
    for (const field of ["xp", "gold", "craftingXp", "gatherXp"]) {
      if (typeof rewards[field] === "number") rewards[field] = Math.max(1, Math.round(rewards[field] * 0.5));
    }
    if (Array.isArray(rewards.items)) rewards.items = rewards.items.map((reward: DataRecord) => ({ ...reward, count: Math.max(1, Math.ceil((reward.count || 1) * 0.5)) }));
    quest.rewards = rewards;
  }
  for (const quest of Object.values(heroicQuests) as DataRecord[]) {
    if (quest?.rewards) {
      if (typeof quest.rewards.xp === "number") quest.rewards.xp = Math.max(1, Math.round(quest.rewards.xp * 3.96));
      if (typeof quest.rewards.gold === "number") quest.rewards.gold = Math.max(1, Math.round(quest.rewards.gold * 0.9));
    }
    quests[quest.id] = quest;
  }

  const lateGathering = lateTierFlags.GRANDWORKS_ENABLED
    ? (composedDeclarationByAnchor(
        indexSource,
        [/tower_alloy_seam/, /Dreadcore Hunting Ground/],
        "[",
        lateTierFlags,
      ) as any[])
    : [];
  const gatheringNodes = [...gatheringBase, ...lateGathering].map(normalizeDropCarrier);

  const achievementGold = achievementGoldRewards(indexSource);
  const achievements = achievementBase.map(stripAchievementTitle).map((achievement) => {
    const gold = achievementGold[String(achievement?.id)];
    return Number.isFinite(gold) ? { ...achievement, reward: { gold } } : achievement;
  });
  const retiredAchievementCategories = setByAnchor(indexSource, [/"abyss"/, /"mythic"/]);
  const retiredAchievementRequirements = setByAnchor(indexSource, [
    /abyss_boss_kills/,
    /imperative_apex_r4_count/,
  ]);
  const nonSteamAchievements = setByAnchor(indexSource, [/first_blood/, /enchant_master/]);
  const activeAchievements = achievements.filter(
    (achievement) =>
      !retiredAchievementCategories.has(achievement?.category) &&
      !retiredAchievementRequirements.has(achievement?.requirement?.type) &&
      !nonSteamAchievements.has(achievement?.id),
  );

  const abilities = directTable(indexSource, [/manaCost:/, /cooldown:/, /effects:/], 50_000) as DataRecord;
  const abilityTags = composedDeclarationByAnchor(
    indexSource,
    [/iron_skin:\s*\["buff"\]/, /sub_venomshade_bloom:\s*\["poison"\]/],
    "{",
  ) as Record<string, string[]>;
  for (const [id, tags] of Object.entries(abilityTags)) if (abilities[id]) abilities[id].tags = tags;
  const affixes = directTable(indexSource, [/statTarget:/, /valueIsPercent:|weight:/], 5_000);
  const shopListings = directTable(indexSource, [/price:/, /levelReq:/, /category:/], 1_000);
  const worldBosses = directTable(
    gameViewSource,
    [/gearItemId:/, /epithet:|recommendedGearLevel:/],
    2_000,
  );

  // The game's own class definitions, which carry the copy the character select shows: a title, a
  // description, a focus line, a world role, and the four traits each class is built around. The
  // compendium had been substituting its own one-line summaries for these.
  const classList = evalComposition(
    declarationByAnchor(
      indexSource,
      [/classId:\s*"barbarian"/, /worldRole:/, /traits:\s*\[/],
      "[",
    ).text,
  );

  return {
    items: {
      base: baseItems.count,
      live: collectionIds(items).size,
      mechanism: "runtime item overlays",
      value: items,
    },
    enemies: {
      base: baseEnemies.count,
      live: enemies.length,
      mechanism: "extension arrays",
      value: enemies,
    },
    recipes: {
      base: baseRecipes.count,
      live: recipes.length,
      mechanism: "late recipes and runtime filters",
      value: recipes,
    },
    gatheringNodes: {
      base: baseGathering.count,
      live: gatheringNodes.length,
      mechanism: "late gathering definitions",
      value: gatheringNodes,
    },
    quests: {
      base: baseQuests.count,
      live: Object.keys(quests).length,
      mechanism: "quest overlays",
      value: quests,
    },
    abilities: {
      base: collectionSize(abilities),
      live: collectionSize(abilities),
      mechanism: "literal",
      value: abilities,
    },
    affixes: {
      base: collectionSize(affixes),
      live: collectionSize(affixes),
      mechanism: "literal",
      value: affixes,
    },
    gems: {
      base: Object.keys(gems).length,
      live: Object.keys(gems).length,
      mechanism: "literal",
      value: gems,
    },
    shopListings: {
      base: collectionSize(shopListings),
      live: collectionSize(shopListings),
      mechanism: "literal",
      value: shopListings,
    },
    zonesDungeons: {
      base: collectionSize(zonesDungeons),
      live: collectionSize(zonesDungeons),
      mechanism: "literal",
      value: zonesDungeons,
    },
    achievements: {
      base: achievements.length,
      live: activeAchievements.length,
      mechanism: "active achievement filter",
      value: activeAchievements,
    },
    worldBosses: {
      base: collectionSize(worldBosses),
      live: collectionSize(worldBosses),
      mechanism: "literal",
      value: worldBosses,
    },
    itemLevels: {
      base: Object.keys(itemLevels).length,
      live: Object.keys(itemLevels).length,
      mechanism: "shipped balance level",
      value: itemLevels,
    },
    classes: {
      base: collectionSize(classList),
      live: collectionSize(classList),
      mechanism: "literal",
      value: classList,
    },
  };
}
