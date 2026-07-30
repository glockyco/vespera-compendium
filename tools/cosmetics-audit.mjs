#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { resolveBundles, table, distribution, balance, evalLiteral } from "./extract.mjs";

const dir = process.argv[2];
if (!dir) throw new Error("usage: node tools/cosmetics-audit.mjs <extractedDir>");
const bundles = resolveBundles(dir);
const idxPath = path.join(dir, "assets", bundles.index);
const gvPath = path.join(dir, "assets", bundles.gameView);
const idx = fs.readFileSync(idxPath, "utf8");
const gv = fs.readFileSync(gvPath, "utf8");
const pick = (src, probes, min = 0) => {
  const found = table(src, probes, { min });
  if (!found || found.error) throw new Error(`no table: ${found?.error || probes}`);
  return found;
};
const namedLiteral = (src, name) => {
  const match = src.match(new RegExp(`\\b${name}\\s*=\\s*([\\[{])`));
  if (!match) throw new Error(`no named literal: ${name}`);
  const open = match.index + match[0].lastIndexOf(match[1]);
  const [, end] = balance(src, open);
  return evalLiteral(src.slice(open, end));
};
const heroPortraitMap = namedLiteral(idx, "HERO_PORTRAITS");
const heroPresentationMap = namedLiteral(idx, "HERO_PRESENTATION_PORTRAITS");
const subclassPortraitMap = namedLiteral(idx, "SUBCLASS_PORTRAITS");
const subclassPresentationMap = namedLiteral(idx, "SUBCLASS_PRESENTATION_PORTRAITS");
const avatarPackIds = namedLiteral(idx, "CHARACTER_AVATAR_PACK_IDS");
const avatarPackPurchaseKeys = namedLiteral(idx, "CHARACTER_AVATAR_PACK_PURCHASE_KEYS");
const avatarSubclassSlugs = namedLiteral(idx, "CHARACTER_AVATAR_SUBCLASS_SLUGS");
const leafCount = (value) => Object.values(value).reduce((n, entry) => n + (entry && typeof entry === "object" ? Object.keys(entry).length : 1), 0);
const walkFiles = (root) => {
  let count = 0;
  for (const name of fs.readdirSync(root)) {
    const full = path.join(root, name);
    if (fs.statSync(full).isDirectory()) count += walkFiles(full);
    else count++;
  }
  return count;
};
const avatarAssetRoot = path.join(dir, "assets", "hero", "avatar-packs");
const avatarAssetFilesByPack = Object.fromEntries(
  fs.readdirSync(avatarAssetRoot).filter((name) => fs.statSync(path.join(avatarAssetRoot, name)).isDirectory()).map((name) => [name, walkFiles(path.join(avatarAssetRoot, name))]),
);

const themes = pick(idx, [/unnamed_default:/, /unlockCondition:/, /isPremium:/], 1000);
const portraits = pick(idx, [/default_warrior:/, /imagePath:/, /unlockCondition:/], 1000);
const frames = pick(idx, [/frame_default:/, /tier:/, /gemCost:/], 1000);
const avatarPacks = pick(gv, [/purchaseKey:/, /identities:/, /accent:/], 1000);
const summarize = (found, extra = {}) => ({
  symbol: found.name,
  bytes: found.bytes,
  count: found.count,
  ids: Object.keys(found.value),
  ...extra,
});
const byCondition = (value) => distribution(value, (entry) => entry.unlockCondition ?? "(none)");
const byTier = (value) => distribution(value, (entry) => entry.tier ?? "(none)");
const byGemCost = (value) => distribution(value, (entry) => entry.gemCost ?? "(none)");
const retired = (value) => Object.values(value).filter((entry) => entry.unlockCondition === "Retired").map((entry) => entry.id);
const defaults = (value) => Object.values(value).filter((entry) => entry.unlockCondition === "Default").map((entry) => entry.id);
const frameNoUnlock = Object.values(frames.value).filter((entry) => entry.unlockCondition == null).map((entry) => entry.id);
const groupedIds = (value, keyFn) => Object.fromEntries(
  Object.entries(
    Object.values(value).reduce((groups, entry) => {
      const key = keyFn(entry);
      (groups[key] ||= []).push(entry.id);
      return groups;
    }, {}),
  ).sort(([left], [right]) => String(left).localeCompare(String(right), undefined, { numeric: true })),
);
const avatarPackFiles = [];
for (const [classId, definition] of Object.entries(avatarPacks.value)) {
  for (const identity of definition.identities || []) {
    for (const presentation of ["male", "female"]) {
      const slug = identity === "base" ? "base" : String(identity).toLowerCase();
      avatarPackFiles.push({
        classId,
        packId: definition.id,
        purchaseKey: definition.purchaseKey,
        identity,
        presentation,
        path: `assets/hero/avatar-packs/${definition.id}/${classId}-${slug}-${presentation}.webp?v=avatar-defaults-20260727-4`,
      });
    }
  }
}
const result = {
  source: { dir, index: idxPath, gameView: gvPath },
  routingMaps: {
    heroPortraits: { count: Object.keys(heroPortraitMap).length, leafPaths: Object.keys(heroPortraitMap).length, keys: Object.keys(heroPortraitMap) },
    heroPresentationPortraits: { count: Object.keys(heroPresentationMap).length, leafPaths: leafCount(heroPresentationMap), keys: Object.keys(heroPresentationMap) },
    subclassPortraits: { count: Object.keys(subclassPortraitMap).length, leafPaths: Object.keys(subclassPortraitMap).length, keys: Object.keys(subclassPortraitMap) },
    subclassPresentationPortraits: { count: Object.keys(subclassPresentationMap).length, leafPaths: leafCount(subclassPresentationMap), keys: Object.keys(subclassPresentationMap) },
    avatarPackIds: { count: Object.keys(avatarPackIds).length, values: avatarPackIds },
    avatarPackPurchaseKeys: { count: Object.keys(avatarPackPurchaseKeys).length, values: avatarPackPurchaseKeys },
    avatarSubclassSlugs: { count: Object.keys(avatarSubclassSlugs).length, values: avatarSubclassSlugs },
  },
  themes: summarize(themes, {
    byUnlockCondition: byCondition(themes.value),
    retired: retired(themes.value),
    defaults: defaults(themes.value),
    gemCost: byGemCost(themes.value),
  }),
  portraits: summarize(portraits, {
    byUnlockCondition: byCondition(portraits.value),
    retired: retired(portraits.value),
    defaults: defaults(portraits.value),
    defaultsByKind: groupedIds(portraits.value, (entry) => entry.id.startsWith("subclass_") ? "subclass" : entry.id.startsWith("default_") ? "class" : "other"),
    byGemCost: byGemCost(portraits.value),
    imagePathByValue: distribution(portraits.value, (entry) => entry.imagePath ? "nonempty" : "empty"),
  }),
  frames: summarize(frames, {
    byTier: byTier(frames.value),
    idsByTier: groupedIds(frames.value, (entry) => entry.tier),
    byGemCost: byGemCost(frames.value),
    withExplicitUnlockCondition: byCondition(frames.value),
    noUnlockCondition: frameNoUnlock,
  }),
  avatarPacks: summarize(avatarPacks, {
    price: gv.match(/AVATAR_PACK_PRICE\s*=\s*([^,;\n]+)/)?.[1] || null,
    byClass: Object.fromEntries(Object.entries(avatarPacks.value).map(([classId, d]) => [classId, {
      id: d.id,
      purchaseKey: d.purchaseKey,
      identities: d.identities,
      identityCount: d.identities?.length || 0,
      fileCount: (d.identities?.length || 0) * 2,
      unlock: "purchase: 1,000,000 gold (matching class only)",
    }])),
    totalPortraitFilesPerOwnedPack: avatarPackFiles.length / Object.keys(avatarPacks.value).length,
    totalPortraitFilesAcrossOwnedPacks: avatarPackFiles.length,
    shippedAssetFilesByPack: avatarAssetFilesByPack,
    shippedAssetFilesTotal: Object.values(avatarAssetFilesByPack).reduce((a, b) => a + b, 0),
    paths: avatarPackFiles,
  }),
};
console.log(JSON.stringify(result, null, 2));
