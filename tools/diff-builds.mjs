#!/usr/bin/env node
// Diff two extracted Vespera builds.
//   node tools/diff-builds.mjs <oldDir> <newDir>
//
// Reports file additions, removals, and changes. For changed JavaScript files, it reports new top-level
// identifiers and constants. These items provide the useful signal for a patch.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const [oldDir, newDir] = process.argv.slice(2);
if (!oldDir || !newDir) { console.error("usage: diff-builds.mjs <oldDir> <newDir>"); process.exit(1); }

const MEDIA = /\.(webp|png|jpg|jpeg|mp3|ogg|woff2?|ttf|ico)$/i;

function index(root) {
  const out = new Map();
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.set(path.relative(root, p).split(path.sep).join("/"), p);
    }
  })(root);
  return out;
}
const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex").slice(0, 16);

const A = index(oldDir), B = index(newDir);
const added = [...B.keys()].filter((k) => !A.has(k)).sort();
const removed = [...A.keys()].filter((k) => !B.has(k)).sort();
const changed = [...B.keys()].filter((k) => A.has(k) && sha(A.get(k)) !== sha(B.get(k))).sort();

console.log(`# Build diff\n\nold: ${oldDir}  (${A.size} files)\nnew: ${newDir}  (${B.size} files)\n`);
console.log(`added ${added.length} · removed ${removed.length} · changed ${changed.length}\n`);
if (added.length)   { console.log("## Added");   added.forEach((k) => console.log(`- ${k}`)); console.log(); }
if (removed.length) { console.log("## Removed"); removed.forEach((k) => console.log(`- ${k}`)); console.log(); }

const code = changed.filter((k) => !MEDIA.test(k));
const media = changed.filter((k) => MEDIA.test(k));

console.log("## Changed (code/text)\n");
console.log("| file | bytes | Δ |");
console.log("|---|---|---|");
for (const k of code) {
  const a = fs.statSync(A.get(k)).size, b = fs.statSync(B.get(k)).size;
  console.log(`| \`${k}\` | ${b.toLocaleString()} | ${b - a >= 0 ? "+" : ""}${(b - a).toLocaleString()} |`);
}
console.log(`\n(${media.length} changed media/binary files omitted)\n`);

// Newly introduced identifiers provide the useful signal in a patch.
const IDENT = /\b[A-Z][A-Z0-9_]{4,}\b|function\s+([A-Za-z_$][\w$]{4,})/g;
console.log("## New identifiers by file\n");
for (const k of code.filter((f) => f.endsWith(".js") || f.endsWith(".cjs"))) {
  const a = new Set(fs.readFileSync(A.get(k), "utf8").split("\n"));
  const bl = fs.readFileSync(B.get(k), "utf8").split("\n");
  const addedText = bl.filter((l) => !a.has(l)).join("\n");
  if (!addedText) continue;
  const oldText = fs.readFileSync(A.get(k), "utf8");
  const ids = [...new Set([...addedText.matchAll(IDENT)].map((m) => m[1] || m[0]))]
    .filter((id) => !oldText.includes(id));
  if (!ids.length) continue;
  console.log(`### \`${k}\``);
  ids.slice(0, 40).forEach((i) => console.log(`- \`${i}\``));
  if (ids.length > 40) console.log(`- …${ids.length - 40} more`);
  console.log();
}
