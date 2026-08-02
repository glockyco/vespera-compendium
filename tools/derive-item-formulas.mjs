import fs from "node:fs";
import path from "node:path";
import { resolveBundles, table, balance, size } from "./extract.mjs";

const dir = process.argv[2] || "extracted";
const B = resolveBundles(dir);
const idx = fs.readFileSync(path.join(dir, "assets", B.index), "utf8");

function declarationExpression(src, symbol) {
  const from = src.indexOf(symbol);
  if (from < 0) throw new Error(`missing ${symbol}`);
  const eq = src.indexOf("=", from);
  const [start, end] = balance(src, eq + 1);
  return src.slice(start, end);
}
function tableWrapped(src, symbol, probes) {
  let expr = declarationExpression(src, symbol);
  // Shipped constants use Object.freeze(literal). table() recognizes the same literal after it removes the outer freeze wrapper.
  if (expr.startsWith("(") && expr.endsWith(")"))
    expr = expr.slice(1, -1);
  const generated = `const ${symbol} = ${expr};`;
  const r = table(generated, probes, { min: 1 });
  if (!r) {
    console.log("generated", generated.slice(0, 180), generated.slice(-180));
    throw new Error(`table() failed for ${symbol}`);
  }
  return r;
}

const specs = [
  ["curve", "COMPLETE_GEAR_POWER_CURVE", [/level:\s*1,\s*offense:\s*35,\s*health:\s*30/, /level:\s*150,\s*offense:\s*780,\s*health:\s*5200/]],
  ["budgets", "COMPLETE_GEAR_CLASS_BUDGETS", [/barbarian:\s*Object\.freeze\(/, /nightblade:\s*Object\.freeze\(/]],
  ["offenseShares", "COMPLETE_GEAR_SLOT_OFFENSE_SHARE", [/mainHand:\s*0\.3,\s*offHand:\s*0\.18/, /ring2:\s*0\.09/]],
  ["survivalShares", "COMPLETE_GEAR_SLOT_SURVIVAL_SHARE", [/mainHand:\s*0,\s*offHand:\s*0\.15/, /ring2:\s*0\.085/]],
  ["percentCaps", "COMPLETE_GEAR_PERCENT_CAPS", [/armorPen:\s*0\.08,\s*bleedChance:\s*0\.08/, /tripleHitChance:\s*0\.04/]],
];
for (const [name, symbol, probes] of specs) {
  const r = tableWrapped(idx, symbol, probes);
  console.log(name, JSON.stringify({ symbol: r.name, count: r.count, bytes: r.bytes, value: r.value }));
}
const scalingWeights = tableWrapped(idx, "WORLD_BOSS_STAT_POWER", [/attack:\s*1/, /maxMana:\s*0\.18/, /manaCostReduction:\s*200/]);
console.log("gearScalingWeights", JSON.stringify({ symbol: scalingWeights.name, count: scalingWeights.count, value: scalingWeights.value }));
const itemPowerWeights = tableWrapped(idx, "Ws", [/attack:\s*1/, /energyPerHit:\s*1/, /goldFind:\s*0\.5/]);
console.log("itemPowerWeights", JSON.stringify({ symbol: itemPowerWeights.name, count: itemPowerWeights.count, value: itemPowerWeights.value }));
const rarityBlock = idx.slice(idx.indexOf("function Na("), idx.indexOf("function getItemSellValue("));
const rarityMultipliers = Object.fromEntries([...rarityBlock.matchAll(/case "([^"]+)":\s*return ([0-9.e+-]+)/g)].map((match) => [match[1], Number(match[2])]));
rarityMultipliers.common = 1;
console.log("rarityMultipliers", JSON.stringify({ count: Object.keys(rarityMultipliers).length, value: rarityMultipliers }));
const itemTable = table(idx, [/stackable:/, /rarity:/, /"?sword_bronze/]);
const items = itemTable.value;
const values = Object.values(items).filter((item) => Object.prototype.hasOwnProperty.call(item, "value"));
console.log("items", JSON.stringify({ symbol: itemTable.name, count: itemTable.count, withValue: values.length, positiveValue: values.filter((item) => Number(item.value) > 0).length, valueTypes: Object.fromEntries(values.reduce((counts, item) => counts.set(typeof item.value, (counts.get(typeof item.value) || 0) + 1), new Map())), min: Math.min(...values.map((item) => Number(item.value))), positiveMin: Math.min(...values.filter((item) => Number(item.value) > 0).map((item) => Number(item.value))), max: Math.max(...values.map((item) => Number(item.value))), positiveMax: Math.max(...values.filter((item) => Number(item.value) > 0).map((item) => Number(item.value))), zeros: values.filter((item) => Number(item.value) === 0).map((item) => ({ id: item.id, type: item.type, value: item.value })), missing: Object.values(items).filter((item) => !Object.prototype.hasOwnProperty.call(item, "value")).map((item) => item.id) }));
