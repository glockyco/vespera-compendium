import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { parse } from "svelte/compiler";

export type Finding = {
  code: string;
  file: string;
  line: number;
  column: number;
  message: string;
};

type SourceCall = {
  file: string;
  tag: string;
  props: string;
  start: number;
};

type VariantRecord = {
  path: string;
  width?: number;
  height?: number;
};

type VariantEntry = {
  variants: Record<string, VariantRecord>;
};

const SVELTE_ROOT = "site/src";
const ALLOWED_VARIANTS: Record<string, readonly string[]> = {
  general: ["thumb", "card"],
  class: ["thumb", "card", "portrait"],
  zone: ["thumb", "card", "wide", "hero"],
};
const SKIP_DIRS = new Set(["node_modules", ".svelte-kit", "build", ".wrangler"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function textAt(source: string, offset: number): { line: number; column: number } {
  const prefix = source.slice(0, offset);
  const line = prefix.split("\n").length;
  const last = prefix.lastIndexOf("\n");
  return { line, column: offset - (last < 0 ? 0 : last + 1) + 1 };
}

function finding(root: string, file: string, source: string, offset: number, code: string, message: string): Finding {
  const location = textAt(source, offset);
  return { code, file: path.relative(root, file).replaceAll(path.sep, "/"), ...location, message };
}

function walk(dir: string, result: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), result);
    } else if (entry.name.endsWith(".svelte")) {
      result.push(path.join(dir, entry.name));
    }
  }
}

function attr(props: string, name: string): { value: string | null; offset: number } | null {
  const expression = new RegExp(`\\b${name}\\s*=\\s*(?:([\\"'])(.*?)\\1|\\{([^}]*)\\})`, "s");
  const match = expression.exec(props);
  if (!match) return null;
  const quoted = match[2];
  const expressionText = match[3];
  return {
    value: quoted ?? null,
    offset: match.index + (match[0].indexOf(quoted ?? expressionText ?? "") >= 0 ? match[0].indexOf(quoted ?? expressionText ?? "") : 0),
  };
}

function staticSource(props: string): string | null {
  const source = attr(props, "src");
  return source?.value ?? null;
}

function componentAliases(source: string): Set<string> {
  const aliases = new Set(["Art", "HeroArt"]);
  const importPattern = /import\s+([^;\n]+?)\s+from\s+["']([^"']*(?:Art|HeroArt)\.svelte)["']/g;
  for (const match of source.matchAll(importPattern)) {
    const clause = match[1];
    if (clause === undefined) continue;
    const defaultPart = clause.match(/^([A-Za-z_$][\w$]*)/);
    if (defaultPart?.[1]) aliases.add(defaultPart[1]);
    const named = clause.match(/\{([^}]*)\}/)?.[1] ?? "";
    for (const item of named.split(",")) {
      const parts = item.trim().split(/\s+as\s+/);
      const name = parts.at(-1)?.trim();
      if (name && (item.includes("Art") || item.includes("Hero"))) aliases.add(name);
    }
  }
  return aliases;
}

function heroComponentContract(root: string): boolean {
  const file = path.join(root, "site/src/lib/components/HeroArt.svelte");
  let source: string;
  try { source = readFileSync(file, "utf8"); } catch { return false; }
  const pinsKind = /\bkind\s*=\s*["']zone["']/.test(source) || /\b(?:const|let)\s+kind(?:\s*:\s*[^=]+)?\s*=\s*["']zone["']/.test(source) || /artVariantUrl\([\s\S]*["']zone["']/.test(source);
  const pinsVariant = /\bvariant\s*=\s*["']hero["']/.test(source) || /\b(?:const|let)\s+variant(?:\s*:\s*[^=]+)?\s*=\s*["']hero["']/.test(source) || /artVariantUrl\([\s\S]*["']hero["']/.test(source);
  const eager = /\bloading\s*=\s*["']eager["']/.test(source);
  const high = /\bfetchpriority\s*=\s*["']high["']/.test(source);
  return pinsKind && pinsVariant && eager && high;
}
function parseVariantEntry(value: unknown): VariantEntry | null {
  if (!isRecord(value) || !isRecord(value.variants)) return null;
  const variants: Record<string, VariantRecord> = {};
  for (const [name, item] of Object.entries(value.variants)) {
    if (!isRecord(item) || typeof item.path !== "string") continue;
    variants[name] = { path: item.path, width: typeof item.width === "number" ? item.width : undefined, height: typeof item.height === "number" ? item.height : undefined };
  }
  return { variants };
}

function readVariantIndex(dataDir: string): Map<string, VariantEntry> | Finding[] {
  const file = path.join(dataDir, "images", "variants.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch (error) {
    return [{ code: "VARIANT_INDEX_MISSING", file: path.relative(dataDir, file).replaceAll(path.sep, "/"), line: 1, column: 1, message: `Cannot read generated variant index: ${error instanceof Error ? error.message : String(error)}` }];
  }
  if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.entries)) {
    return [{ code: "VARIANT_INDEX_INVALID", file: path.relative(dataDir, file).replaceAll(path.sep, "/"), line: 1, column: 1, message: "Variant index must contain version 1 and an entries object" }];
  }
  const entries = new Map<string, VariantEntry>();
  for (const [key, value] of Object.entries(parsed.entries)) {
    const entry = parseVariantEntry(value);
    if (entry) entries.set(key.replace(/^images\//, ""), entry);
  }
  return entries;
}

function checkVariantFiles(root: string, dataDir: string, calls: SourceCall[], findings: Finding[]): void {
  const index = readVariantIndex(dataDir);
  if (Array.isArray(index)) {
    findings.push(...index.map((item) => ({ ...item, file: path.relative(root, path.join(dataDir, item.file)).replaceAll(path.sep, "/") })));
    return;
  }
  for (const call of calls) {
    const kind = attr(call.props, "kind")?.value;
    const variant = attr(call.props, "variant")?.value;
    const source = staticSource(call.props);
    if (!kind || !variant || !source || call.tag === "HeroArt") continue;
    const canonical = source.replace(/^\/?(?:game\/)?/, "").replace(/^images\//, "");
    const entry = index.get(canonical);
    if (!entry) {
      findings.push(finding(root, call.file, "", call.start, "VARIANT_SOURCE_MISSING", `No generated variant entry for ${source}`));
      continue;
    }
    const variantRecord = entry.variants[variant];
    if (!variantRecord) {
      findings.push(finding(root, call.file, "", call.start, "VARIANT_MISSING", `Generated source ${source} has no ${variant} variant`));
      continue;
    }
    const generated = path.join(dataDir, variantRecord.path);
    if (!existsSync(generated) || !statSync(generated).isFile()) {
      findings.push(finding(root, call.file, "", call.start, "VARIANT_FILE_MISSING", `Generated variant file is missing: ${variantRecord.path}`));
    }
  }
}

export function checkArtCallers(root: string, dataDir?: string): Finding[] {
  const files: string[] = [];
  walk(path.join(root, SVELTE_ROOT), files);
  const findings: Finding[] = [];
  const calls: SourceCall[] = [];
  let heroCount = 0;

  for (const file of files.sort()) {
    let source: string;
    try {
      source = readFileSync(file, "utf8");
      parse(source);
    } catch (error) {
      findings.push(finding(root, file, "", 0, "SVELTE_PARSE_ERROR", `Unable to parse Svelte source: ${error instanceof Error ? error.message : String(error)}`));
      continue;
    }
    const aliases = componentAliases(source);
    const tagPattern = /<([A-Za-z_$][\w$]*)\b([\s\S]*?)(?:\/?>)/g;
    for (const match of source.matchAll(tagPattern)) {
      const tag = match[1];
      const props = match[2];
      const start = match.index ?? 0;
      if (!tag || props === undefined || !aliases.has(tag)) continue;
      const isHero = tag.toLowerCase().includes("heroart") || tag === "HeroArt";
      if (isHero) {
        heroCount += 1;
        const isHome = path.relative(root, file).replaceAll(path.sep, "/") === "site/src/routes/+page.svelte";
        const hasBusinessProps = /\b(?:kind|variant|loading|fetchpriority)\s*=/.test(props);
        if (!isHome || hasBusinessProps || !heroComponentContract(root)) {
          findings.push(finding(root, file, source, start, "HERO_ART_LOCATION", "HeroArt owns literal zone/hero and eager/high behavior in its component"));
        }
      }
      calls.push({ file, tag, props, start });
      const kind = attr(props, "kind");
      const variant = attr(props, "variant");
      if (!isHero && (!kind || !kind.value)) findings.push(finding(root, file, source, start, "ART_KIND_NOT_LITERAL", "Art kind must be a literal attribute"));
      if (!isHero && (!variant || !variant.value)) findings.push(finding(root, file, source, start, "ART_VARIANT_NOT_LITERAL", "Art variant must be a literal attribute"));
      const resolvedKind = kind?.value;
      const resolvedVariant = variant?.value;
      if (resolvedKind && !Object.hasOwn(ALLOWED_VARIANTS, resolvedKind)) {
        findings.push(finding(root, file, source, start, "ART_KIND_INVALID", `Unknown Art kind ${resolvedKind}`));
      } else if (resolvedKind && resolvedVariant && !ALLOWED_VARIANTS[resolvedKind]?.includes(resolvedVariant)) {
        findings.push(finding(root, file, source, start, "ART_VARIANT_DISALLOWED", `${resolvedVariant} is not allowed for ${resolvedKind}`));
      }
      if (/\b(?:loading|fetchpriority|priority)\s*=/.test(props)) {
        findings.push(finding(root, file, source, start, "ART_LOADING_OVERRIDE", "Art owns loading and fetch priority"));
      }
    }
  }

  if (heroCount > 1) findings.push({ code: "HERO_ART_COUNT", file: "site/src/routes/+page.svelte", line: 1, column: 1, message: `Expected one HeroArt, found ${heroCount}` });
  if (heroCount === 0) findings.push({ code: "HERO_ART_COUNT", file: "site/src/routes/+page.svelte", line: 1, column: 1, message: "Expected one HeroArt on the home route" });
  if (dataDir) checkVariantFiles(root, dataDir, calls, findings);
  return findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column || a.code.localeCompare(b.code));
}

function main(): void {
  const args = process.argv.slice(2);
  let rootArgument: string | undefined;
  let dataArgument: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--data") { dataArgument = args[index + 1]; index += 1; continue; }
    if (argument && !argument.startsWith("--") && rootArgument === undefined) rootArgument = argument;
  }
  const root = rootArgument ?? process.cwd();
  const findings = checkArtCallers(path.resolve(root), dataArgument ? path.resolve(dataArgument) : undefined);
  for (const item of findings) console.error(`${item.code} ${item.file}:${item.line}:${item.column} ${item.message}`);
  if (findings.length > 0) process.exitCode = 1;
}

if (import.meta.main) main();
