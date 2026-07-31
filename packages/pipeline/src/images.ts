import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { ComposedTables } from "./compose.ts";

/**
 * The game ships its own art, and the compendium republishes it rather than inventing placeholders.
 *
 * Two things make this awkward enough to deserve a module. The field carrying a path is not the same
 * on every table — `items` and three others call it `imagePath`, `enemies` and `zones_dungeons` call
 * it `icon`, world bosses call it `gearIcon`, and achievements have no field at all and are probed
 * by id. And `icon` is polymorphic in the shipped data: a real path on two tables and a literal `?`
 * placeholder on four, left behind by the game's own art reskin. Publishing one normalised `image`
 * column is what lets every surface read one field instead of encoding that mess.
 *
 * Paths are read from the composed tables, not the projected dataset, because projection is where
 * the source columns are dropped.
 */

export type ImageRef = {
  /** Published table name. */
  table: string;
  /** Row primary key, so `projectAll` can index refs by `(table, id)`. */
  id: string;
  /** Path inside the extracted build, without any query suffix. */
  source: string;
  /** Path inside the published dataset, which is what the `image` column carries. */
  published: string;
};

/** Composed table, published table name, and the field on it that carries a path. */
const PATH_FIELDS: [composed: string, table: string, field: string][] = [
  ["items", "items", "imagePath"],
  ["enemies", "enemies", "icon"],
  ["gatheringNodes", "gathering_nodes", "imagePath"],
  ["abilities", "abilities", "imagePath"],
  ["gems", "gems", "imagePath"],
  ["zonesDungeons", "zones_dungeons", "icon"],
];

/**
 * Achievements carry no art field. The game stores their Steam icons by id under a fixed directory,
 * in achieved and unachieved variants; the achieved one is the identifying image.
 */
const ACHIEVEMENT_DIR = "assets/achievements/phase1/steam-64/achieved";

type Source = Record<string, unknown>;

function rows(value: unknown): Source[] {
  const list = Array.isArray(value) ? value : Object.values((value ?? {}) as Source);
  return list.filter((entry): entry is Source => Boolean(entry) && typeof entry === "object");
}

/**
 * Strips the cache-busting suffix the game appends to reskinned art, for example
 * `...wood_oak.webp?v=bright-items-20260715`. The file on disk carries no suffix.
 */
function cleanPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.split("?")[0]!.trim();
  // The reskin left literal `?` and `??(Ab)` placeholders in `icon` on four tables. Anything that
  // is not a path into the asset tree is one of those, not art.
  if (!trimmed.startsWith("assets/")) return null;
  return trimmed;
}

/**
 * Every image the published dataset references, resolved against the extracted build.
 *
 * A ref whose file is absent is skipped and appended to `missing` rather than throwing: a future
 * build may drop an asset, and one missing picture must not block a publish.
 */
export function collectImages(
  composed: ComposedTables,
  extractedDir: string,
  missing?: string[],
): ImageRef[] {
  const refs: ImageRef[] = [];
  const add = (table: string, id: string, source: string | null): void => {
    if (!source || !id) return;
    if (!existsSync(path.join(extractedDir, source))) {
      missing?.push(`${table}/${id}: ${source}`);
      return;
    }
    // `assets/items/celestial/skybound-spirit.webp` publishes as `images/items/celestial/...`.
    refs.push({
      table,
      id,
      source,
      published: path.posix.join("images", source.slice("assets/".length)),
    });
  };

  for (const [composedId, table, field] of PATH_FIELDS) {
    for (const row of rows(composed[composedId]?.value)) {
      add(table, String(row.id ?? ""), cleanPath(row[field]));
    }
  }

  // A world boss's art is its reward gear's art, which is why the field is named for the gear.
  for (const boss of rows(composed.worldBosses?.value)) {
    add("world_bosses", String(boss.id ?? ""), cleanPath(boss.gearIcon));
  }

  for (const achievement of rows(composed.achievements?.value)) {
    const id = String(achievement.id ?? "");
    if (!id) continue;
    add("achievements", id, `${ACHIEVEMENT_DIR}/${id}.png`);
  }

  return refs;
}

/**
 * Copies each distinct image into `outDir`, returning how many files were written.
 *
 * Distinct by published path: several rows share one picture, and copying it once per reference
 * would multiply the published byte count for no gain.
 */
export function copyImages(refs: readonly ImageRef[], extractedDir: string, outDir: string): number {
  const seen = new Set<string>();
  let written = 0;
  for (const ref of refs) {
    if (seen.has(ref.published)) continue;
    seen.add(ref.published);
    const destination = path.join(outDir, ...ref.published.split("/").slice(1));
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(path.join(extractedDir, ref.source), destination);
    written++;
  }
  return written;
}

/** Refs indexed by `(table, id)`, which is how projection fills the `image` column. */
export function indexRefs(refs: readonly ImageRef[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const ref of refs) index.set(`${ref.table}\u0000${ref.id}`, ref.published);
  return index;
}
