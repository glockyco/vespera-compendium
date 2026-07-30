#!/usr/bin/env node
// Derives the distributions and tables that were previously unverified.
//   node tools/analyse.mjs <extractedDir>

import fs from "node:fs";
import path from "node:path";
import { resolveBundles, table, distribution, size } from "./extract.mjs";

const root = process.argv[2] || "extracted";
const B = resolveBundles(root);
const IDX = fs.readFileSync(path.join(root, "assets", B.index), "utf8");
const GV = fs.readFileSync(path.join(root, "assets", B.gameView), "utf8");

const get = (src, probes, min) => {
  const r = table(src, probes, { min: min || 0 });
  if (!r || r.error) return null;
  return r;
};
const arr = (v) => (Array.isArray(v) ? v : Object.values(v || {}));
const pct = (o, total) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, `${v} (${((v / total) * 100).toFixed(1)}%)`]));

const report = {};

// ---- achievements -------------------------------------------------------
const ach = get(IDX, [/requirement:/, /reward:/, /category:/], 10000);
if (ach) {
  const a = arr(ach.value);
  const rewards = a.map((x) => Number(x?.reward?.gold || 0));
  report.achievements = {
    symbol: ach.name,
    total: a.length,
    byCategory: distribution(a, (x) => x.category || "(none)"),
    byRequirementType: distribution(a, (x) => x.requirement?.type || "(none)"),
    rewardGold: {
      withGold: rewards.filter((r) => r > 0).length,
      zeroOrMissing: rewards.filter((r) => !r).length,
      min: Math.min(...rewards.filter((r) => r > 0)),
      max: Math.max(...rewards),
      total: rewards.reduce((s, r) => s + r, 0),
    },
    rewardKeys: [...new Set(a.flatMap((x) => Object.keys(x?.reward || {})))],
    fields: [...new Set(a.flatMap((x) => Object.keys(x || {})))],
    sample: a[0],
  };
}

// ---- quests: step types -------------------------------------------------
const q = get(IDX, [/steps:/, /rewards:/, /nextQuestId:/], 50000);
if (q) {
  const qs = arr(q.value);
  const steps = qs.flatMap((x) => x.steps || []);
  report.quests = {
    symbol: q.name,
    baseCount: qs.length,
    byCategory: distribution(qs, (x) => x.category || "(none)"),
    totalSteps: steps.length,
    byStepType: distribution(steps, (s) => s.type || "(none)"),
    rewardKeys: [...new Set(qs.flatMap((x) => Object.keys(x?.rewards || {})))],
  };
}

// ---- gathering nodes: type split ---------------------------------------
const gn = get(IDX, [/requiredTool:/, /baseXp:/, /drops:/], 10000);
if (gn) {
  const g = arr(gn.value);
  report.gatheringNodes = {
    symbol: gn.name,
    baseCount: g.length,
    byType: distribution(g, (x) => x.type || "(none)"),
    byTool: distribution(g, (x) => x.requiredTool || "(none)"),
    levelRange: [Math.min(...g.map((x) => x.levelReq ?? 0)), Math.max(...g.map((x) => x.levelReq ?? 0))],
  };
}

// ---- shop listings: categories -----------------------------------------
const sh = get(IDX, [/price:/, /levelReq:/, /category:/], 1000);
if (sh) {
  const s = arr(sh.value);
  report.shopListings = {
    symbol: sh.name,
    count: s.length,
    byCategory: distribution(s, (x) => x.category || "(none)"),
    priceRange: [Math.min(...s.map((x) => x.price ?? 0)), Math.max(...s.map((x) => x.price ?? 0))],
  };
}

// ---- items: rarity / slot / value --------------------------------------
const it = get(IDX, [/stackable:/, /rarity:/], 100000);
if (it) {
  const items = arr(it.value);
  const valued = items.filter((x) => Number(x?.value) > 0);
  report.items = {
    symbol: it.name,
    baseCount: items.length,
    byRarity: distribution(items, (x) => x.rarity || "(none)"),
    byType: distribution(items, (x) => x.type || "(none)"),
    bySlot: distribution(items, (x) => x.slot || "(no slot)"),
    valueField: {
      itemsWithValue: valued.length,
      min: Math.min(...valued.map((x) => x.value)),
      max: Math.max(...valued.map((x) => x.value)),
    },
    statKeys: [...new Set(items.flatMap((x) => Object.keys(x?.stats || {})))],
  };
}

// ---- gems ---------------------------------------------------------------
const gm = get(IDX, [/family:/, /tier:/, /stats:/], 5000);
if (gm) {
  const g = arr(gm.value);
  report.gems = {
    symbol: gm.name, count: g.length,
    byFamily: distribution(g, (x) => x.family || "(none)"),
    byTier: distribution(g, (x) => String(x.tier ?? "(none)")),
  };
}

// ---- affixes ------------------------------------------------------------
const af = get(IDX, [/statTarget:/, /valueIsPercent:|weight:/], 5000);
if (af) {
  const a = arr(af.value);
  report.affixes = {
    symbol: af.name, count: a.length,
    byKind: distribution(a, (x) => x.kind || "(none)"),
    byCategory: distribution(a, (x) => x.category || "(none)"),
    percentAffixes: a.filter((x) => x.valueIsPercent).length,
  };
}

// ---- enemies ------------------------------------------------------------
const en = get(IDX, [/maxHp:/, /attackInterval:/, /drops:/], 10000);
if (en) {
  const e = arr(en.value);
  report.enemies = {
    symbol: en.name, baseCount: e.length,
    byElement: distribution(e, (x) => x.element || "(none)"),
    byAttackStyle: distribution(e, (x) => x.attackStyle || "(none)"),
    levelRange: [Math.min(...e.map((x) => x.level ?? 0)), Math.max(...e.map((x) => x.level ?? 0))],
  };
}

// ---- abilities ----------------------------------------------------------
const ab = get(IDX, [/manaCost:/, /cooldown:/, /effects:/], 50000);
if (ab) {
  const a = arr(ab.value);
  report.abilities = {
    symbol: ab.name, count: a.length,
    byClass: distribution(a, (x) => x.requiredClass || "(none)"),
    byCategory: distribution(a, (x) => x.category || "(none)"),
    effectTypes: distribution(a.flatMap((x) => x.effects || []), (e) => e.type || "(none)"),
  };
}

console.log(JSON.stringify(report, null, 1));
