import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readInstalledBuildId } from "@vespera/core";
import { composeAll } from "./compose.ts";
import { toCsv } from "./csv.ts";
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

export type PublishResult = {
  buildId: string;
  outDirs: string[];
  tables: { name: string; rows: number }[];
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
};

export type Manifest = {
  schemaVersion: number;
  buildId: string;
  generatedAt: string;
  sqlite: string;
  tables: ManifestTable[];
};

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
  const dataset = projectAll(composed, resolvedBuildId);

  const failures = checkInvariants(dataset, composed).filter((result) => result.status === "FAIL");
  if (failures.length > 0) {
    throw new InvariantError(failures.map((result) => `${result.id}: ${result.detail}`).join("\n"));
  }

  const generatedAt =
    dataset.meta?.find((row) => row.key === "generated_at")?.value ?? new Date().toISOString();

  const manifest: Manifest = {
    schemaVersion: SCHEMA_VERSION,
    buildId: resolvedBuildId,
    generatedAt: String(generatedAt),
    sqlite: SQLITE_FILENAME,
    tables: TABLES.map((table) => ({
      name: table.name,
      slug: table.slug,
      kind: table.kind,
      rows: dataset[table.name]?.length ?? 0,
      primaryKey: [...table.primaryKey],
      columns: table.columns.map((column) => ({ name: column.name, type: column.type })),
      json: `${table.name}.json`,
      csv: `${table.name}.csv`,
    })),
  };

  const outDirs = [path.join("data", resolvedBuildId), path.join("data", LATEST_DIR)];
  for (const dir of outDirs) {
    mkdirSync(dir, { recursive: true });
    clearPublished(dir);

    for (const table of TABLES) {
      const columns = table.columns.map((column) => column.name);
      writeFileSync(
        path.join(dir, `${table.name}.json`),
        `${JSON.stringify(ordered(dataset, table.name, columns), null, 2)}\n`,
      );
      writeFileSync(
        path.join(dir, `${table.name}.csv`),
        toCsv(columns, dataset[table.name] ?? []),
      );
    }
    writeFileSync(path.join(dir, "index.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    writeSqlite(dataset, path.join(dir, SQLITE_FILENAME));
  }

  return {
    buildId: resolvedBuildId,
    outDirs,
    tables: manifest.tables.map((table) => ({ name: table.name, rows: table.rows })),
  };
}
