import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readInstalledBuildId } from "@vespera/core";
import { composeAll } from "./compose.ts";
import { toCsv } from "./csv.ts";
import { collectImages, copyImages } from "./images.ts";
import { checkInvariants } from "./invariants.ts";
import { projectAll, type Dataset } from "./project.ts";
import { SCHEMA_VERSION, TABLES } from "./schema.ts";
import { writeSqlite } from "./sqlite.ts";

/**
 * Emits the published artifacts for one build. Every table ships as JSON and as CSV, plus one SQLite
 * file for the in-browser playground and an index describing all of it.
 *
 * Output goes to both `data/<buildId>/` and `data/latest/`, with identical bytes. The build-stamped
 * copy is what makes a dataset citable; `latest` is what the site and the spreadsheet formulas point
 * at, which is why its filenames never carry a hash or a suffix.
 */

export const SQLITE_FILENAME = "vespera.sqlite";
const LATEST_DIR = "latest";
const IMAGE_DIR = "images";

export type PublishResult = {
  buildId: string;
  outDirs: string[];
  tables: { name: string; rows: number }[];
  images: number;
  missingImages: string[];
};

export class InvariantError extends Error {}

type ManifestTable = {
  name: string;
  slug: string;
  kind: "entity" | "join" | "meta";
  rows: number;
  primaryKey: string[];
  columns: { name: string; type: string }[];
  json: string;
  csv: string;
  /** Present when the JSON is emitted with abbreviated keys; maps short key to column name. */
  jsonKeys?: Record<string, string>;
};

export type Manifest = {
  schemaVersion: number;
  buildId: string;
  generatedAt: string;
  sqlite: string;
  /** Directory holding the game's own art, relative to the manifest. */
  images: string;
  imageCount: number;
  tables: ManifestTable[];
};

/**
 * The search index is fetched whole by every visitor who types into the search field, so it is the
 * one table whose JSON is optimised for the wire rather than for reading: keys are abbreviated and
 * the output is not pretty-printed. That takes it from 575 KiB to 367 KiB.
 *
 * The mapping is published in the manifest rather than agreed by convention, so a consumer can
 * expand it without hardcoding this list. CSV and SQLite keep the real column names.
 */
const SEARCH_INDEX_KEYS: Record<string, string> = {
  t: "table",
  i: "id",
  s: "slug",
  n: "name",
  k: "kind",
  b: "subtitle",
  l: "level",
  r: "rarity",
  g: "image",
};
const SEARCH_INDEX_TABLE = "search_index";

/** Rebuilds each row in schema column order so JSON key order is stable across releases. */
function ordered(dataset: Dataset, tableName: string, columns: readonly string[]): unknown[] {
  return (dataset[tableName] ?? []).map((row) =>
    Object.fromEntries(columns.map((column) => [column, row[column] ?? null])),
  );
}

/**
 * Removes files a previous publish wrote, including tables that a later schema no longer defines.
 *
 * The build-stamped directory is shared with the runtime evidence the harness emits for the same
 * build, so it is protected by name: clearing the whole directory destroyed a verification record
 * that cannot be regenerated without relaunching the game.
 */
const FOREIGN_ARTIFACTS = new Set(["runtime-evidence.json"]);

function clearPublished(dir: string): void {
  if (!existsSync(dir)) return;
  // Art is a directory rather than a file, so the file sweep below cannot reach it and a renamed or
  // dropped asset would linger forever. Removing it wholesale is safe: every image is re-copied.
  rmSync(path.join(dir, IMAGE_DIR), { recursive: true, force: true });
  for (const entry of readdirSync(dir)) {
    if (FOREIGN_ARTIFACTS.has(entry)) continue;
    const published =
      entry.endsWith(".json") ||
      entry.endsWith(".csv") ||
      entry === SQLITE_FILENAME ||
      // Journal sidecars are never written deliberately, but a crashed run could leave one behind.
      entry.startsWith(`${SQLITE_FILENAME}-`);
    if (published) rmSync(path.join(dir, entry), { force: true });
  }
}

export function publish(extractedDir = "extracted", buildId?: string): PublishResult {
  const composed = composeAll(extractedDir);
  const resolvedBuildId = buildId ?? readInstalledBuildId();
  const dataset = projectAll(composed, resolvedBuildId, extractedDir);

  const failures = checkInvariants(dataset, composed).filter((result) => result.status === "FAIL");
  if (failures.length > 0) {
    throw new InvariantError(failures.map((result) => `${result.id}: ${result.detail}`).join("\n"));
  }

  const missingImages: string[] = [];
  const imageRefs = collectImages(composed, extractedDir, missingImages);
  const imageCount = new Set(imageRefs.map((ref) => ref.published)).size;

  const generatedAt =
    dataset.meta?.find((row) => row.key === "generated_at")?.value ?? new Date().toISOString();

  const manifest: Manifest = {
    schemaVersion: SCHEMA_VERSION,
    buildId: resolvedBuildId,
    generatedAt: String(generatedAt),
    sqlite: SQLITE_FILENAME,
    images: IMAGE_DIR,
    imageCount,
    tables: TABLES.map((table) => ({
      name: table.name,
      slug: table.slug,
      kind: table.kind,
      rows: dataset[table.name]?.length ?? 0,
      primaryKey: [...table.primaryKey],
      columns: table.columns.map((column) => ({ name: column.name, type: column.type })),
      json: `${table.name}.json`,
      csv: `${table.name}.csv`,
      ...(table.name === SEARCH_INDEX_TABLE ? { jsonKeys: SEARCH_INDEX_KEYS } : {}),
    })),
  };

  const outDirs = [path.join("data", resolvedBuildId), path.join("data", LATEST_DIR)];
  for (const dir of outDirs) {
    mkdirSync(dir, { recursive: true });
    clearPublished(dir);

    for (const table of TABLES) {
      const columns = table.columns.map((column) => column.name);
      const rows = ordered(dataset, table.name, columns);
      const json =
        table.name === SEARCH_INDEX_TABLE
          ? JSON.stringify(
              (rows as Record<string, unknown>[]).map((row) =>
                Object.fromEntries(
                  Object.entries(SEARCH_INDEX_KEYS).map(([short, column]) => [short, row[column]]),
                ),
              ),
            )
          : `${JSON.stringify(rows, null, 2)}\n`;
      writeFileSync(path.join(dir, `${table.name}.json`), json);
      writeFileSync(
        path.join(dir, `${table.name}.csv`),
        toCsv(columns, dataset[table.name] ?? []),
      );
    }
    writeFileSync(path.join(dir, "index.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    writeSqlite(dataset, path.join(dir, SQLITE_FILENAME));
    copyImages(imageRefs, extractedDir, path.join(dir, IMAGE_DIR));
  }

  return {
    buildId: resolvedBuildId,
    outDirs,
    tables: manifest.tables.map((table) => ({ name: table.name, rows: table.rows })),
    images: imageCount,
    missingImages,
  };
}
