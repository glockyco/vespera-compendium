#!/usr/bin/env node
// Vespera bundle extractor.
//
// Locates data tables by CONTENT ANCHOR (never by line number or filename hash — both move
// between builds), balances the literal, and evaluates it in a VM sandbox. Emits normalized
// JSON keyed by Steam buildid.
//
//   node tools/extract.mjs <extractedDir> [buildid]

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const IS_MAIN = import.meta.url === `file://${process.argv[1]}`;
const root = process.argv[2];
const buildId = process.argv[3] || "unknown";
if (IS_MAIN && !root) { console.error("usage: extract.mjs <extractedDir> [buildid]"); process.exit(1); }

/** Resolve bundle filenames from index.html + the bootstrap module it loads. */
export function resolveBundles(dir) {
  const assets = path.join(dir, "assets");
  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  const grab = (s) => [...s.matchAll(/(?:src|href|from\s+)["'](?:\.\/)?(?:assets\/)?([A-Za-z0-9._-]+\.js)/g)].map((m) => m[1]);
  let hrefs = grab(html);
  // index-*.js is not referenced by index.html; it is imported by the bootstrap module.
  for (const entry of hrefs.filter((h) => /bootstrap/.test(h))) {
    const p = path.join(assets, entry);
    if (fs.existsSync(p)) hrefs = hrefs.concat(grab(fs.readFileSync(p, "utf8")));
  }
  // last resort: scan the assets dir for the canonical entry shapes
  const dirFiles = fs.readdirSync(assets);
  const pick = (re) => hrefs.find((h) => re.test(h)) || dirFiles.find((h) => re.test(h));
  const index = pick(/^index-.*\.js$/);
  const gameView = pick(/^GameView-.*\.js$/);
  if (!index || !gameView) throw new Error(`could not resolve bundles (index=${index}, gameView=${gameView})`);
  return { index, gameView, all: [...new Set(hrefs)] };
}

const OPEN = { "{": "}", "[": "]", "(": ")" };
const CLOSE = new Set(["}", "]", ")"]);

/**
 * Balance a literal starting at `from`, skipping strings, template literals,
 * regex literals and comments. Returns [start, endExclusive].
 */
export function balance(src, from) {
  let i = from;
  while (i < src.length && !"{[(".includes(src[i])) i++;
  const start = i;
  const stack = [];
  let inStr = null, inTmpl = false, inLine = false, inBlock = false, prev = "";
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (inLine) { if (c === "\n") inLine = false; continue; }
    if (inBlock) { if (c === "*" && n === "/") { inBlock = false; i++; } continue; }
    if (inStr) { if (c === "\\") { i++; continue; } if (c === inStr) inStr = null; continue; }
    if (inTmpl) { if (c === "\\") { i++; continue; } if (c === "`") inTmpl = false; continue; }
    if (c === "/" && n === "/") { inLine = true; i++; continue; }
    if (c === "/" && n === "*") { inBlock = true; i++; continue; }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === "`") { inTmpl = true; continue; }
    if (OPEN[c]) { stack.push(OPEN[c]); prev = c; continue; }
    if (CLOSE.has(c)) {
      if (stack.pop() !== c) throw new Error(`unbalanced at ${i} (expected close of ${prev})`);
      if (!stack.length) return [start, i + 1];
    }
  }
  throw new Error("unterminated literal");
}

/** Evaluate an extracted literal in a sandbox that tolerates unknown globals. */
export function evalLiteral(code) {
  const real = {
    Object, Array, Math, JSON, Number, String, Boolean, Date, Map, Set, RegExp, Symbol,
    isNaN, parseInt, parseFloat, Infinity, NaN, undefined,
  };
  // Any identifier the literal references but we do not provide resolves to a permissive
  // stub, so tables that call helper functions still evaluate.
  const stub = new Proxy(function () {}, {
    get: () => stub, apply: () => stub, construct: () => stub,
    has: () => true,
  });
  const sandbox = new Proxy(real, {
    has: () => true,
    get: (t, k) => (k in t ? t[k] : k === Symbol.unscopables ? undefined : stub),
  });
  return vm.runInNewContext(`(${code})`, vm.createContext(sandbox), { timeout: 20000 });
}

/**
 * Find every top-level declaration line (`const X = [` / `  Xx = {`) and return the
 * balanced span of each. Pretty-printed bundles keep these at a shallow indent.
 */
function declSpans(src) {
  const spans = [];
  const re = /(?:^|\n)(?:\s{0,4})(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s*=\s*([[{])\s*(?=\n)/g;
  let m;
  while ((m = re.exec(src))) {
    const open = m.index + m[0].lastIndexOf(m[2]);
    let span;
    try { span = balance(src, open); } catch { continue; }
    spans.push({ name: m[1], start: span[0], end: span[1] });
    re.lastIndex = open + 1; // allow nested discovery, balance() handles extent
  }
  return spans;
}

/**
 * Locate the largest declaration whose body matches every probe, then evaluate it.
 * Content-addressed: independent of line numbers, symbol names and filename hashes.
 */
export function table(src, probes, { min = 0 } = {}) {
  const list = Array.isArray(probes) ? probes : [probes];
  const cands = [];
  for (const s of declSpans(src)) {
    const body = src.slice(s.start, s.end);
    if (body.length < min) continue;
    if (!list.every((p) => p.test(body))) continue;
    cands.push({ ...s, body });
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.body.length - a.body.length);
  for (const c of cands) {
    try {
      const value = evalLiteral(c.body);
      const n = size(value);
      if (n > 0) return { value, name: c.name, bytes: c.body.length, count: n };
    } catch { /* try next candidate */ }
  }
  return { error: "all candidates failed to evaluate", tried: cands.length };
}

export const size = (v) => (Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : 0);

/** Count occurrences of a value across a collection, by key path. */
export function distribution(coll, keyFn) {
  const items = Array.isArray(coll) ? coll : Object.values(coll || {});
  const out = {};
  for (const it of items) {
    const k = keyFn(it);
    for (const kk of Array.isArray(k) ? k : [k]) {
      if (kk === undefined || kk === null) continue;
      out[kk] = (out[kk] || 0) + 1;
    }
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

// ---------------------------------------------------------------- table registry

const B = root ? resolveBundles(root) : null;
const IDX = B ? fs.readFileSync(path.join(root, "assets", B.index), "utf8") : "";
const GV = B ? fs.readFileSync(path.join(root, "assets", B.gameView), "utf8") : "";

const SPECS = [
  ["items",          IDX, [/stackable:/, /rarity:/, /"?sword_bronze/]],
  ["enemies",        IDX, [/maxHp:/, /attackInterval:/, /drops:/]],
  ["recipes",        IDX, [/inputs:/, /outputs:/, /levelReq:/], 50000],
  ["gatheringNodes", IDX, [/requiredTool:/, /baseXp:/, /drops:/], 10000],
  ["quests",         IDX, [/steps:/, /rewards:/, /nextQuestId:/], 50000],
  ["abilities",      IDX, [/manaCost:/, /cooldown:/, /effects:/], 50000],
  ["affixes",        IDX, [/statTarget:/, /valueIsPercent:|weight:/], 5000],
  ["gems",           IDX, [/family:/, /tier:/, /stats:/], 5000],
  ["shopListings",   IDX, [/price:/, /levelReq:/, /category:/], 1000],
  ["achievements",   IDX, [/requirement:/, /reward:/, /category:/], 10000],
  ["zonesDungeons",  IDX, [/type:\s*"(zone|dungeon)"/, /levelReq:/], 10000],
  ["worldBosses",    GV,  [/gearItemId:/, /epithet:|recommendedGearLevel:/], 2000],
];

const out = { buildId, extractedAt: new Date().toISOString(), bundles: B, tables: {}, errors: [] };
for (const [name, src, probes, min] of (IS_MAIN ? SPECS : [])) {
  const r = table(src, probes, { min: min || 0 });
  if (!r) { out.errors.push(`${name}: no match`); continue; }
  if (r.error) { out.errors.push(`${name}: ${r.error} (${r.tried} candidates)`); continue; }
  out.tables[name] = { count: r.count, symbol: r.name, bytes: r.bytes, value: r.value };
}

if (!IS_MAIN) { /* imported as a library: no side effects */ }
else if (process.argv.includes("--json")) {
  const slim = { ...out, tables: Object.fromEntries(Object.entries(out.tables).map(([k, v]) => [k, v.value])) };
  console.log(JSON.stringify(slim));
} else {
  console.log(`build ${buildId}  bundles: ${B.index}, ${B.gameView}`);
  for (const [k, v] of Object.entries(out.tables)) console.log(`  ${k.padEnd(16)} ${String(v.count).padStart(5)}  ${String(v.symbol).padStart(6)}  (${v.bytes.toLocaleString()} B)`);
  for (const e of out.errors) console.log(`  ! ${e}`);
}
export default out;
