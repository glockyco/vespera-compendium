import { readFileSync } from "node:fs";
import path from "node:path";
import { balance, evalComposition, locateTable, resolveBundles } from "@vespera/core";

export type ComposedTable = {
  base: number;
  live: number;
  mechanism: string;
  value: unknown;
};

export type ComposedTables = Record<string, ComposedTable>;

type DataRecord = Record<string, any>;

type AnchoredDeclaration = { symbol: string; text: string };

function declarationByAnchor(
  source: string,
  probes: RegExp | RegExp[],
  expected?: "{" | "[",
): AnchoredDeclaration {
  const tests = Array.isArray(probes) ? probes : [probes];
  const declaration = /(?:^|[\n,])\s*(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s*=\s*([\[{])/g;
  let match: RegExpExecArray | null;
  while ((match = declaration.exec(source))) {
    if (expected && match[2] !== expected) continue;
    const open = source.indexOf(match[2]!, match.index);
    try {
      const [, end] = balance(source, open);
      const text = source.slice(open, end);
      if (!tests.every((probe) => probe.test(text))) {
        declaration.lastIndex = end;
        continue;
      }
      return { symbol: match[1]!, text };
    } catch {
      continue;
    }
  }
  throw new Error(`missing declaration anchor: ${tests.map((probe) => probe.source).join(", ")}`);
}

function composedDeclarationByAnchor(
  source: string,
  probes: RegExp | RegExp[],
  expected?: "{" | "[",
): any {
  return evalComposition(declarationByAnchor(source, probes, expected).text);
}

function setByAnchor(source: string, probes: RegExp[]): Set<string> {
  const calls = /new\s+Set\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = calls.exec(source))) {
    const open = source.indexOf("(", match.index);
    try {
      const [, end] = balance(source, open);
      const text = source.slice(match.index, end);
      if (!probes.every((probe) => probe.test(text))) {
        calls.lastIndex = end;
        continue;
      }
      const raw = evalComposition(source.slice(open, end));
      return new Set(
        (Array.isArray(raw) ? raw : Object.keys((raw ?? {}) as object)).map((value) => String(value)),
      );
    } catch {
      continue;
    }
  }
  throw new Error(`missing Set anchor: ${probes.map((probe) => probe.source).join(", ")}`);
}

function functionByAnchor(source: string, probes: RegExp[]): { symbol: string; text: string } {
  const functions = /function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = functions.exec(source))) {
    const open = source.indexOf("{", match.index);
    try {
      const [, end] = balance(source, open);
      const text = source.slice(match.index, end);
      if (probes.every((probe) => probe.test(text))) return { symbol: match[1]!, text };
      functions.lastIndex = end;
    } catch {
      continue;
    }
  }
  throw new Error(`missing function anchor: ${probes.map((probe) => probe.source).join(", ")}`);
}

function generated(source: string, probes: RegExp[], setup: string): any {
  const fn = functionByAnchor(source, probes);
  return evalComposition(`(()=>{${setup};${fn.text};return ${fn.symbol}();})()`);
}

function collectionIds(value: any): Set<string> {
  return new Set(
    Array.isArray(value)
      ? value.map((entry) => String(entry?.id)).filter((id) => id !== "undefined")
      : Object.keys(value ?? {}),
  );
}

function callObjectAfterAnchor(source: string, callPattern: RegExp, idAnchor: string): DataRecord {
  for (const call of source.matchAll(callPattern)) {
    const at = call.index ?? 0;
    if (!source.slice(at, at + 500).includes(idAnchor)) continue;
    const open = source.indexOf("{", at);
    const [start, end] = balance(source, open);
    return evalComposition(source.slice(start, end)) as DataRecord;
  }
  throw new Error(`missing call/object anchor: ${idAnchor}`);
}

function frozenObjectAfterAnchor(source: string, anchor: RegExp): DataRecord {
  const match = anchor.exec(source);
  if (!match) throw new Error(`missing object anchor: ${anchor.source}`);
  const open = source.indexOf("(", match.index);
  const [, end] = balance(source, open);
  return evalComposition(source.slice(open + 1, end - 1)) as DataRecord;
}

function stripAchievementTitle(entry: DataRecord): DataRecord {
  if (!entry?.reward || !Object.prototype.hasOwnProperty.call(entry.reward, "title")) return entry;
  const reward = { ...entry.reward };
  delete reward.title;
  return { ...entry, reward };
}

function directTable(source: string, probes: RegExp[], minBytes: number): any {
  const located = locateTable(source, probes, minBytes);
  return evalComposition(located.code);
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

function rarityMultiplier(rarity: unknown): number {
  return ({ common: 1, uncommon: 1.1, rare: 1.22, epic: 1.36, legendary: 1.52, mythic: 1.7, living: 1.52 } as Record<string, number>)[String(rarity)] ?? 1;
}

const PERCENT_STATS = new Set([
  "armorPen", "bleedChance", "blockChance", "blockReduction", "critChance", "critDamage",
  "dodgeChance", "doubleHitChance", "fireDamage", "fireResist", "freezeChance", "goldFind",
  "haste", "hpRegenPerTick", "lifeSteal", "manaCostReduction", "poisonApplyChance",
  "poisonDamage", "poisonResist", "stunChance", "tripleHitChance",
]);
const STAT_POWER: Record<string, number> = {
  attack: 1, strength: 1, defense: 1, intelligence: 1, magicDamage: 1, dexterity: 1,
  hitpoints: 0.4, maxHp: 0.4, maxMana: 0.18, haste: 2000, critChance: 1000,
  lifeSteal: 500, fireDamage: 1.2, fireResist: 500, poisonDamage: 1.2, poisonResist: 500,
  dodgeChance: 500, blockChance: 500, blockReduction: 500, hpRegenPerTick: 200,
  manaCostReduction: 200,
};
const GEAR_CURVE = [
  { level: 1, offense: 35, health: 30 }, { level: 10, offense: 60, health: 60 },
  { level: 25, offense: 105, health: 120 }, { level: 32, offense: 130, health: 170 },
  { level: 40, offense: 160, health: 220 }, { level: 50, offense: 190, health: 280 },
  { level: 55, offense: 220, health: 350 }, { level: 60, offense: 250, health: 450 },
  { level: 75, offense: 300, health: 600 }, { level: 85, offense: 370, health: 850 },
  { level: 95, offense: 430, health: 1200 }, { level: 105, offense: 500, health: 2000 },
  { level: 120, offense: 560, health: 2800 }, { level: 124, offense: 620, health: 3700 },
  { level: 130, offense: 640, health: 3900 }, { level: 140, offense: 720, health: 4600 },
  { level: 150, offense: 780, health: 5200 },
];
const CLASS_BUDGETS: Record<string, { attack: number; primary: number; magic: number; defense: number; health: number }> = {
  barbarian: { attack: 1, primary: 1, magic: 0, defense: 1.95, health: 1.2 },
  arcanist: { attack: 0.65, primary: 1, magic: 0.45, defense: 1.5, health: 1.08 },
  warden: { attack: 0.55, primary: 1, magic: 0, defense: 1.45, health: 1.07 },
  nightblade: { attack: 1.05, primary: 0.35, magic: 0, defense: 1.25, health: 0.95 },
};
const OFFENSE_SHARE: Record<string, number> = { mainHand: 0.3, offHand: 0.18, head: 0.08, chest: 0.08, legs: 0.08, amulet: 0.1, ring1: 0.09, ring2: 0.09 };
const SURVIVAL_SHARE: Record<string, number> = { mainHand: 0, offHand: 0.15, head: 0.15, chest: 0.25, legs: 0.2, amulet: 0.08, ring1: 0.085, ring2: 0.085 };
const PERCENT_CAPS: Record<string, number> = {
  armorPen: 0.08, bleedChance: 0.08, blockChance: 0.08, blockReduction: 0.12,
  critChance: 0.03, critDamage: 0.35, dodgeChance: 0.06, doubleHitChance: 0.08,
  fireDamage: 0.12, fireResist: 0.15, freezeChance: 0.08, goldFind: 0.15, haste: 0.05,
  hpRegenPerTick: 0.05, lifeSteal: 0.015, manaCostReduction: 0.08,
  poisonApplyChance: 0.08, poisonDamage: 0.12, poisonResist: 0.15, stunChance: 0.08,
  tripleHitChance: 0.04,
};

function normalizeClassId(value: unknown): string | null {
  const id = String(value ?? "").trim().toLowerCase();
  if (!id) return null;
  return ({ warrior: "barbarian", mage: "arcanist", ranger: "warden", rogue: "nightblade" } as Record<string, string>)[id] ?? id;
}

function inferItemClass(item: DataRecord, definitions: DataRecord): string | null {
  if (!item || item.type !== "equipment") return null;
  const definition = definitions[item.id] as DataRecord | undefined;
  for (const candidate of [item.classRequirement, item.classAffinity, definition?.classAffinity]) {
    if (candidate && candidate !== "universal") return normalizeClassId(candidate);
  }
  if (["ring1", "ring2", "amulet"].includes(item.slot)) {
    const id = String(item.id ?? "").toLowerCase();
    if (/(?:^|[_\s-])(mage|arcanist)(?:[_\s-]|$)/.test(id)) return "arcanist";
    if (/(?:^|[_\s-])(ranger|warden)(?:[_\s-]|$)/.test(id)) return "warden";
    if (/(?:^|[_\s-])(rogue|nightblade)(?:[_\s-]|$)/.test(id)) return "nightblade";
    if (/(?:^|[_\s-])(warrior|barbarian)(?:[_\s-]|$)/.test(id)) return "barbarian";
  }
  if (["sword", "shield"].includes(item.subType)) return "barbarian";
  if (["staff", "tome", "wand"].includes(item.subType)) return "arcanist";
  if (["bow", "quiver"].includes(item.subType)) return "warden";
  if (item.subType === "dagger") return "nightblade";
  if (!["head", "chest", "legs"].includes(item.slot)) return null;
  const stats = item.stats ?? {};
  const text = `${item.id ?? ""} ${item.name ?? ""}`.toLowerCase();
  if (stats.magicDamage || stats.intelligence || /robe|cloth|spell|arcane|arcanist|mage|runebreak|codex|linen/.test(text)) return "arcanist";
  if (stats.dexterity || /quiver|bow|warden|ranger|trail|wild|hunt/.test(text)) return "warden";
  if (stats.lifeSteal || stats.poisonDamage || /rogue|nightblade|shadow|stalker|fang|silent|mask|dagger|cowl/.test(text)) return "nightblade";
  if (stats.strength || /plate|cuirass|helm|greaves|buckler|warrior|barbarian|guard/.test(text)) return "barbarian";
  return null;
}

function curveValue(level: number, field: "offense" | "health"): number {
  if (level <= GEAR_CURVE[0]!.level) return GEAR_CURVE[0]![field];
  for (let index = 1; index < GEAR_CURVE.length; index++) {
    const next = GEAR_CURVE[index]!;
    if (level <= next.level) {
      const previous = GEAR_CURVE[index - 1]!;
      const progress = (level - previous.level) / Math.max(1, next.level - previous.level);
      return previous[field] + (next[field] - previous[field]) * progress;
    }
  }
  return GEAR_CURVE.at(-1)![field];
}

function statPower(stats: DataRecord): number {
  return Object.entries(stats).reduce((total, [stat, value]) =>
    total + (typeof value === "number" ? Math.max(0, value) * (STAT_POWER[stat] ?? 0) : 0), 0);
}

function composeItems(items: DataRecord, definitions: DataRecord, recipes: DataRecord[]): DataRecord {
  const standardCategories = new Set(["smithing", "woodworking", "leatherworking", "jewelry"]);
  const universalBossDrops = new Set(["ironpeak_talisman_vs", "amulet_cinder_vs", "ring_nexus_full_vs"]);
  const sharedStarters = new Set(["helm_bronze_vs"]);
  const legacyUniversal = new Set<string>();
  const standardRecipes = recipes.filter((recipe) => {
    const output = recipe?.outputs?.[0]?.itemId;
    return standardCategories.has(recipe?.category) && items[output]?.type === "equipment" &&
      !/^craft_nightmare_(?:warrior|mage|ranger|rogue)_(?:head|ring|amulet|signet)$/.test(String(recipe?.id ?? ""));
  });
  for (const recipe of standardRecipes) {
    const id = recipe?.outputs?.[0]?.itemId;
    if (id && !inferItemClass(items[id], definitions) && !sharedStarters.has(id) && !universalBossDrops.has(id)) legacyUniversal.add(id);
  }
  const assignments: Record<string, string[]> = {
    arcanist: ["insignia_ring_vs", "gloomveil_pendant_vs", "blight_relic_vs", "runic_amulet_vs"],
    warden: ["verdant_charm_vs", "amulet_forest_vs", "tanglewood_idol_vs", "elemental_core_ring_vs", "ring_fire_vs", "ring_plague_vs", "captain_amulet_vs", "amulet_depths_vs", "amulet_plague_vs", "cinderfall_sigil_vs", "amulet_nexus_full_vs"],
    nightblade: ["ashenvale_ward_vs", "depths_token_vs", "ring_shadow_vs", "ring_pirate_vs"],
    barbarian: ["trophy_necklace"],
  };
  for (const [classId, ids] of Object.entries(assignments)) for (const id of ids) if (items[id]) items[id].classRequirement = classId;
  for (const id of legacyUniversal) if (items[id] && !items[id].classRequirement) items[id].classRequirement = "barbarian";
  for (const recipe of standardRecipes) {
    const id = recipe?.outputs?.[0]?.itemId;
    const classId = id ? inferItemClass(items[id], definitions) : null;
    if (id && classId && items[id]) items[id].classRequirement = classId;
  }
  for (const id of [...sharedStarters, ...universalBossDrops]) if (items[id]) delete items[id].classRequirement;

  const recipeLevels = new Map<string, number>();
  for (const recipe of recipes) {
    const level = Math.max(1, Math.round(Number(recipe?.levelReq) || 1));
    for (const output of recipe?.outputs ?? []) {
      if (items[output?.itemId]?.type === "equipment") recipeLevels.set(output.itemId, Math.max(level, recipeLevels.get(output.itemId) ?? 0));
    }
  }
  const balanceLevel = (item: DataRecord): { level: number; downOnly: boolean } | null => {
    const id = String(item?.id ?? "");
    if (!id || id.startsWith("wb_") || id === "the_last_memory") return null;
    const recipeLevel = recipeLevels.get(id);
    if (recipeLevel) return { level: recipeLevel, downOnly: false };
    if (id.startsWith("divine_")) return { level: 150, downOnly: false };
    if (item.rarity === "living") return { level: 120, downOnly: false };
    if (id.includes("_eternal_")) return { level: 140, downOnly: false };
    if (id.includes("_spectral_gear_") || id.includes("_spectral_shadow_") || id.includes("offhand_spectral")) return { level: 130, downOnly: false };
    if (id.startsWith("nightmare_") || id.endsWith("_nightmare")) return { level: 124, downOnly: false };
    if (id.includes("_void_gear_") || id.includes("_void_shadow_") || id.startsWith("forged_")) return { level: 120, downOnly: false };
    if (id.startsWith("heroic_") || id.endsWith("_heroic") || id.includes("_abyssal_")) return { level: 105, downOnly: false };
    const levelByRarity = ({ common: 25, uncommon: 32, rare: 50, epic: 75, legendary: 105, mythic: 140 } as Record<string, number>)[item.rarity];
    return levelByRarity ? { level: levelByRarity, downOnly: true } : null;
  };
  const scaleGroup = (item: DataRecord, names: string[], target: number, rarity: number, downOnly: boolean): void => {
    const present = names.filter((name) => typeof item.stats?.[name] === "number" && item.stats[name] > 0);
    if (present.length === 0 || !(target > 0)) return;
    const power = statPower(Object.fromEntries(present.map((name) => [name, item.stats[name]])));
    if (!(power > 0) || (downOnly && power * rarity <= target * 1.03)) return;
    const scale = target / Math.max(1e-6, power * rarity);
    for (const name of present) item.stats[name] = Math.max(1, Math.round(item.stats[name] * scale));
  };
  for (const item of Object.values(items) as DataRecord[]) {
    if (!(item?.type === "equipment" && item.stats)) continue;
    const balance = balanceLevel(item);
    if (!balance) continue;
    const survivalShare = SURVIVAL_SHARE[item.slot] ?? 0;
    if (!balance.downOnly && survivalShare > 0) {
      if (typeof item.stats.defense !== "number") item.stats.defense = 1;
      if (typeof item.stats.maxHp !== "number" && typeof item.stats.hitpoints !== "number") item.stats.maxHp = 1;
    }
    const classId = inferItemClass(item, definitions);
    const budget = CLASS_BUDGETS[classId ?? ""] ?? {
      attack: 0.8125, primary: 0.8375, magic: 0.1125, defense: 1.5375, health: 1.075,
    };
    const offense = curveValue(balance.level, "offense");
    const health = curveValue(balance.level, "health");
    const rarity = recipeLevels.has(item.id) ? 1 : rarityMultiplier(item.rarity === "living" || /(?:^divine_|^heroic_|_heroic$|^nightmare_|_nightmare$|_abyssal_|_void_gear_|_void_shadow_|_spectral_gear_|_spectral_shadow_|offhand_spectral|_eternal_|^the_last_memory$)/.test(item.id) ? "legendary" : item.rarity);
    const offenseShare = OFFENSE_SHARE[item.slot] ?? 0;
    scaleGroup(item, ["attack", "strength", "intelligence", "magicDamage", "dexterity"], offense * (budget.attack + budget.primary + budget.magic) * offenseShare, rarity, balance.downOnly);
    scaleGroup(item, ["defense"], offense * budget.defense * survivalShare, rarity, balance.downOnly);
    scaleGroup(item, ["hitpoints", "maxHp"], health * budget.health * 0.4 * survivalShare, rarity, balance.downOnly);
    scaleGroup(item, ["maxMana"], offense * (budget.magic > 0 ? 0.25 : 0.08) * survivalShare, rarity, balance.downOnly);
    for (const [stat, value] of Object.entries(item.stats)) {
      if (typeof value === "number" && PERCENT_STATS.has(stat) && PERCENT_CAPS[stat] !== undefined) {
        item.stats[stat] = Math.max(0, Math.min(value, PERCENT_CAPS[stat]));
      }
    }
  }
  return items;
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
  const itemBase = evalComposition(baseItems.code, {
    getVeiledReliquaryRingScaledStats,
    VEILED_RELIQUARY_RING_MIN_LEVEL: 40,
    VEILED_RELIQUARY_RING_MAX_LEVEL: 200,
  }) as DataRecord;
  const enemyBase = evalComposition(baseEnemies.code, { getNormalDungeonClassWeaponDrops }) as DataRecord[];
  const recipeBase = evalComposition(baseRecipes.code, {
    LATE_CRAFTING_TIER_DEFS: [],
    km: () => [],
    normalizeReplacementEndgameRecipe: (recipe: unknown) => recipe,
  }) as DataRecord[];
  const gatheringBase = evalComposition(baseGathering.code, { LATE_GATHERING_TIER_DEFS: [] }) as DataRecord[];
  const shippedFeatureFlags = frozenObjectAfterAnchor(indexHtml, /__VESPERA_FEATURE_FLAGS__\s*=\s*Object\.freeze\s*\(/);
  const questFeatureFlags = {
    VESPERA_COHESION_PHASE_1_ENABLED: shippedFeatureFlags.cohesionPhase1 === true,
    VESPERA_GLIMMERROOT_COHESION_PILOT_ENABLED: shippedFeatureFlags.glimmerrootCohesionPilot === true,
  };
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

  const lateRecipes = composedDeclarationByAnchor(
    indexSource,
    [/craft_tower_supply_cache/, /Bind Endless Supply Cache/],
    "[",
  ) as any[];
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
  composeItems(items, soulbound as DataRecord, recipes);

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

  const lateGathering = composedDeclarationByAnchor(
    indexSource,
    [/tower_alloy_seam/, /Dreadcore Hunting Ground/],
    "[",
  ) as any[];
  const gatheringNodes = [...gatheringBase, ...lateGathering].map(normalizeDropCarrier);

  const achievements = achievementBase.map(stripAchievementTitle);
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
      base: abilities.length ?? Object.keys(abilities).length,
      live: abilities.length ?? Object.keys(abilities).length,
      mechanism: "literal",
      value: abilities,
    },
    affixes: {
      base: affixes.length ?? Object.keys(affixes).length,
      live: affixes.length ?? Object.keys(affixes).length,
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
      base: shopListings.length ?? Object.keys(shopListings).length,
      live: shopListings.length ?? Object.keys(shopListings).length,
      mechanism: "literal",
      value: shopListings,
    },
    zonesDungeons: {
      base: zonesDungeons.length ?? Object.keys(zonesDungeons).length,
      live: zonesDungeons.length ?? Object.keys(zonesDungeons).length,
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
      base: worldBosses.length ?? Object.keys(worldBosses).length,
      live: worldBosses.length ?? Object.keys(worldBosses).length,
      mechanism: "literal",
      value: worldBosses,
    },
  };
}
