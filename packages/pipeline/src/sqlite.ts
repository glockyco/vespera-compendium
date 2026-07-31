import { Database } from "bun:sqlite";
import { existsSync, rmSync } from "node:fs";
import type { Dataset } from "./project.ts";
import { TABLES, type ColumnType } from "./schema.ts";

/**
 * Writes the published dataset as a single SQLite file. The file is downloaded whole by the browser
 * playground, so it ships with journalling off and vacuumed: a `-wal` sidecar would be invisible to
 * a static host and the database would open without the newest rows.
 */

const AFFINITY: Record<ColumnType, string> = {
  text: "TEXT",
  integer: "INTEGER",
  real: "REAL",
  boolean: "INTEGER",
};

/** Columns worth an index: every foreign key a compendium query joins or filters on. */
const INDEXED: [string, string][] = [
  ["item_stats", "item_id"],
  ["item_sources", "item_id"],
  ["item_sources", "source_id"],
  ["item_sources", "source_kind"],
  ["enemy_drops", "enemy_id"],
  ["enemy_drops", "item_id"],
  ["recipe_inputs", "recipe_id"],
  ["recipe_inputs", "item_id"],
  ["recipe_outputs", "recipe_id"],
  ["recipe_outputs", "item_id"],
  ["gathering_node_drops", "node_id"],
  ["gathering_node_drops", "item_id"],
  ["quest_steps", "quest_id"],
  ["quest_steps", "target_id"],
  ["quest_reward_items", "quest_id"],
  ["quest_reward_items", "item_id"],
  ["ability_effects", "ability_id"],
  ["ability_tags", "tag"],
  ["gem_stats", "gem_id"],
  ["affix_weights", "affix_id"],
  ["zone_enemies", "zone_id"],
  ["zone_enemies", "enemy_id"],
  ["zone_resources", "zone_id"],
  ["zone_resources", "node_id"],
  ["world_boss_gear_stats", "boss_id"],
  ["world_boss_abilities", "boss_id"],
  ["shop_listings", "item_id"],
  ["search_index", "name"],
];

/**
 * Quotes an identifier. `search_index.table` is a reserved word, and any future column could be
 * too, so identifiers are quoted everywhere rather than only where a clash is already known.
 */
const quote = (name: string): string => `"${name.replaceAll('"', '""')}"`;

export function writeSqlite(dataset: Dataset, filePath: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    const sidecar = `${filePath}${suffix}`;
    if (existsSync(sidecar)) rmSync(sidecar);
  }

  const db = new Database(filePath, { create: true });
  try {
    db.run("PRAGMA journal_mode = DELETE");

    for (const table of TABLES) {
      const columns = table.columns
        .map((column) => `${quote(column.name)} ${AFFINITY[column.type]}`)
        .join(", ");
      db.run(
        `CREATE TABLE ${quote(table.name)} (${columns}, PRIMARY KEY (${table.primaryKey.map(quote).join(", ")}))`,
      );
    }

    db.transaction(() => {
      for (const table of TABLES) {
        const rows = dataset[table.name] ?? [];
        if (rows.length === 0) continue;
        const names = table.columns.map((column) => column.name);
        const statement = db.prepare(
          `INSERT INTO ${quote(table.name)} (${names.map(quote).join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
        );
        for (const row of rows) {
          statement.run(
            ...names.map((name) => {
              const value = row[name];
              return typeof value === "boolean" ? (value ? 1 : 0) : value;
            }),
          );
        }
      }
    })();

    for (const [table, column] of INDEXED) {
      db.run(`CREATE INDEX idx_${table}_${column} ON ${quote(table)}(${quote(column)})`);
    }

    db.run("VACUUM");
  } finally {
    db.close();
  }
}
