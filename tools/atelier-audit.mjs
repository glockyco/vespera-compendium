import fs from "node:fs";
import path from "node:path";
const previousLog = console.log;
console.log = () => {};
const { resolveBundles, table, balance, evalLiteral } = await import("./extract.mjs");
console.log = previousLog;

const dir = process.argv[2] || "/Users/joaichberger/Projects/vespera-modding/extracted";
const B = resolveBundles(dir);
const IDX = fs.readFileSync(path.join(dir, "assets", B.index), "utf8");
const itemsResult = table(IDX, [/stackable:/, /rarity:/, /"?sword_bronze/]);
const nodesResult = table(IDX, [/requiredTool:/, /baseXp:/, /drops:/], { min: 10000 });
const leylineResult = table(IDX, [/baseProduction:/, /unlockCondition:/, /zoneId:/], { min: 1000 });
const astralResult = table(IDX, [/verdant_crown/, /tidal_lantern/, /artificers_wheel/, /bonuses:/], { min: 1000 });
const extractLiteral = (anchor) => {
  const from = IDX.indexOf(anchor);
  if (from < 0) throw new Error(`missing anchor: ${anchor}`);
  const open = IDX.indexOf("[", from);
  return evalLiteral(IDX.slice(...balance(IDX, open)));
};
const knowledgeThresholds = extractLiteral("ACADEMY_KNOWLEDGE_THRESHOLDS = [");
const bossKnowledgeThresholds = extractLiteral("ACADEMY_BOSS_KNOWLEDGE_THRESHOLDS = [");
const studyDurationsMs = extractLiteral("ACADEMY_STUDY_DURATIONS_MS = [");
const familyMasteryThresholds = extractLiteral("ACADEMY_FAMILY_MASTERY_THRESHOLDS = [");
const academyFamilies = extractLiteral("ACADEMY_FAMILIES = [");
const items = itemsResult?.value || {};
const nodes = nodesResult?.value || [];
const eligible = new Map();
for (const node of nodes) {
  for (const drop of node.drops || []) {
    if (!drop.itemId || drop.itemId === "gold" || drop.itemId.startsWith("unnamed_")) continue;
    const item = items[drop.itemId];
    if (!item || item.type === "equipment") continue;
    const baseRate = (36e5 / (node.baseDuration / 0.25)) * Math.max(0, Number(drop.chance) || 0) * Math.max(1, Number(drop.max) || 1);
    const prior = eligible.get(drop.itemId);
    if (!prior || baseRate > prior.baseRate) eligible.set(drop.itemId, {
      itemId: drop.itemId,
      name: item.name,
      imagePath: item.imagePath || item.icon || "",
      rarity: item.rarity || "common",
      category: node.type || "other",
      sourceNodeId: node.id,
      baseRate,
      minimumAllocation: 25,
      levelReq: node.levelReq || 1,
      sourceNodeBaseDuration: node.baseDuration,
      sourceDrop: drop,
    });
  }
}
const catalog = [...eligible.values()].sort((a, b) => a.levelReq - b.levelReq || a.name.localeCompare(b.name));
const academyAnchors = {
  buildings: ["sawmill", "forge", "fishery", "watchtower", "arcane_tower", "barracks", "treasury", "mana_well", "astral_observatory"],
  tiers: {
    materials: [
      ["bar_copper_vs", "plank_oak_vs"], ["bar_bronze_vs", "plank_pine_vs"], ["bar_iron_vs", "plank_maple_vs"], ["bar_starsteel", "plank_dark_oak_vs"], ["bar_gold_vs", "plank_teak_vs"], ["bar_thorium_vs", "plank_scorched_vs"], ["bar_dark_iron_vs", "plank_plagued_vs"], ["bar_wyrmscale", "plank_stormwood_vs"], ["bar_nexus_vs", "plank_volcanic_vs"], ["bar_cloudglass", "plank_reality_vs"], ["bar_aetherial_vs", "plank_rift_vs"], ["bar_abyssal_vs", "plank_abyssal_vs"], ["bar_void_vs", "plank_void_vs"], ["spectral_bar_vs", "plank_spectral_vs"], ["bar_eternal_vs", "plank_eternal_vs"]
    ],
    constructionTime: [30, 60, 180, 480, 900, 1800, 3600, 5400, 9000, 14400, 21600, 28800, 43200, 57600, 86400],
    barBase: [15, 25, 40, 65, 100, 160, 250, 430, 650, 1000, 1500, 2200, 3200, 4500, 6500],
    woodBase: [10, 18, 30, 50, 80, 130, 200, 320, 500, 800, 1200, 1800, 2600, 3800, 5500],
    goldBase: [1000, 2500, 6250, 15600, 39000, 97500, 244000, 610000, 1525000, 3800000, 9500000, 24000000, 60000000, 150000000, 375000000],
    multipliers: { sawmill: 1, forge: 1.3, fishery: 1.6, watchtower: 2, arcane_tower: 2.5, barracks: 3, treasury: 3.5, mana_well: 4, astral_observatory: 4.5 }
  }
};
const buildings = {};
for (const [id, multiplier] of Object.entries(academyAnchors.tiers.multipliers)) {
  const maxTier = id === "mana_well" ? 20 : 15;
  const tiers = [];
  for (let tier = 1; tier <= maxTier; tier++) {
    const idx = tier - 1;
    if (tier <= 15) {
      tiers.push({
        tier,
        barId: academyAnchors.tiers.materials[idx][0],
        barCount: Math.round(academyAnchors.tiers.barBase[idx] * multiplier),
        woodId: academyAnchors.tiers.materials[idx][1],
        woodCount: Math.round(academyAnchors.tiers.woodBase[idx] * multiplier),
        goldCost: Math.round(academyAnchors.tiers.goldBase[idx] * multiplier),
        constructionTime: academyAnchors.tiers.constructionTime[idx]
      });
    } else {
      const prev = tiers[tiers.length - 1];
      const s = Math.pow(1.5, tier - 15);
      tiers.push({ tier, barId: prev.barId, barCount: Math.round(prev.barCount * s), woodId: prev.woodId, woodCount: Math.round(prev.woodCount * s), goldCost: Math.round(prev.goldCost * s), constructionTime: Math.min(86400, prev.constructionTime) });
    }
  }
  buildings[id] = { maxTier, multiplier, tiers };
}
const out = {
  build: B,
  tableSymbols: { items: itemsResult?.name, gatheringNodes: nodesResult?.name },
  counts: { items: Object.keys(items).length, gatheringNodes: nodes.length, atelierCatalog: catalog.length, academyBuildings: Object.keys(buildings).length },
  leylines: { symbol: leylineResult?.name, count: leylineResult?.count, value: leylineResult?.value },
  catalog,
  buildings,
  academy: {
    knowledgeThresholds,
    bossKnowledgeThresholds,
    studyDurationsMs,
    familyMasteryThresholds,
    academyFamilies,
    astralAlignments: astralResult?.value,
  }
};
console.log(JSON.stringify(out));
