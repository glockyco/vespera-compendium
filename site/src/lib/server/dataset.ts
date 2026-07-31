import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Build-time access to the published dataset. Server-only, so it may read the filesystem; every
 * page load runs during prerendering and nothing here reaches the browser.
 *
 * The directory is searched rather than computed, because the three contexts this runs in disagree
 * about both the working directory and this module's own location: `vite dev` loads it from source,
 * `vite build` bundles it into `.svelte-kit/output/server/chunks/`, and `svelte-kit sync` runs from
 * elsewhere again. Anchoring on the marker file is the only resolution that survives all three.
 */

function findDataDir(): string {
  const candidates: string[] = [];
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (let dir = here; ; ) {
    candidates.push(path.join(dir, "static", "data"));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  candidates.push(path.join(process.cwd(), "static", "data"));
  candidates.push(path.join(process.cwd(), "site", "static", "data"));

  const found = candidates.find((candidate) => existsSync(path.join(candidate, "index.json")));
  if (!found) {
    throw new Error('site/static/data/index.json missing — run "bun run data:sync"');
  }
  return found;
}

let dataDir: string | undefined;

export type Scalar = string | number | boolean | null;
export type Row = Record<string, Scalar>;

export type ManifestTable = {
  name: string;
  slug: string;
  kind: "entity" | "join" | "meta";
  rows: number;
  primaryKey: string[];
  columns: { name: string; type: string }[];
  json: string;
  csv: string;
};

export type Manifest = {
  schemaVersion: number;
  buildId: string;
  generatedAt: string;
  sqlite: string;
  tables: ManifestTable[];
};

// Two thousand-odd detail pages are prerendered from these files, so each one is parsed once.
const cache = new Map<string, unknown>();

function read<T>(fileName: string): T {
  const cached = cache.get(fileName);
  if (cached !== undefined) return cached as T;
  dataDir ??= findDataDir();
  let text: string;
  try {
    text = readFileSync(path.join(dataDir, fileName), "utf8");
  } catch {
    throw new Error(`site/static/data/${fileName} missing — run "bun run data:sync"`);
  }
  const parsed = JSON.parse(text) as T;
  cache.set(fileName, parsed);
  return parsed;
}

export function manifest(): Manifest {
  return read<Manifest>("index.json");
}

export function table(name: string): Row[] {
  return read<Row[]>(`${name}.json`);
}

export function entityTables(): ManifestTable[] {
  return manifest().tables.filter((entry) => entry.kind === "entity");
}

export function tableBySlug(slug: string): ManifestTable | undefined {
  return manifest().tables.find((entry) => entry.slug === slug);
}

export function tableByName(name: string): ManifestTable | undefined {
  return manifest().tables.find((entry) => entry.name === name);
}

/**
 * The key column of a table, read from the manifest rather than assumed to be `id`. Shop listings
 * are keyed by `item_id`, so hardcoding `id` would 404 every one of their detail pages.
 */
export function primaryKeyColumn(name: string): string {
  const spec = tableByName(name);
  if (!spec) throw new Error(`unknown table: ${name}`);
  const key = spec.primaryKey[0];
  if (!key) throw new Error(`table has no primary key: ${name}`);
  return key;
}

export function rowByKey(name: string, key: string): Row | undefined {
  const column = primaryKeyColumn(name);
  return table(name).find((row) => String(row[column]) === key);
}

export function rowsWhere(name: string, column: string, value: Scalar): Row[] {
  return table(name).filter((row) => row[column] === value);
}

/** Every `(slug, key)` pair across the entity tables, which is the detail-page prerender list. */
export function entityKeys(): { table: string; id: string }[] {
  return entityTables().flatMap((spec) => {
    const column = primaryKeyColumn(spec.name);
    return table(spec.name).map((row) => ({ table: spec.slug, id: String(row[column]) }));
  });
}
