import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { canonicalJson } from "@vespera/core";
import type { ComposedTables } from "./compose.ts";

/**
 * The game ships its own art. The compendium republishes it instead of using placeholders.
 *
 * Tables use different path fields.
 * `items` and three other tables use `imagePath`.
 * `enemies` and `zones_dungeons` use `icon`.
 * World bosses use `gearIcon`.
 * Achievements have no field and use an id lookup.
 * The shipped `icon` field also has two forms: a real path on two tables and `?` on four tables.
 * The game's art reskin left those placeholders.
 * The published `image` column gives every surface one field.
 *
 * Read paths from composed tables, not the projected dataset.
 * Projection drops the source columns.
 */

const IMAGE_DIR = "images";

export const IMAGE_VARIANTS = {
  thumb: 64,
  card: 192,
  portrait: 384,
  wide: 640,
  hero: 1280,
} as const;

export type ImageVariant = keyof typeof IMAGE_VARIANTS;
export type ArtKind = "general" | "class" | "zone";

export const VARIANTS_BY_KIND: Record<ArtKind, readonly ImageVariant[]> = {
  general: ["thumb", "card"],
  class: ["thumb", "card", "portrait"],
  zone: ["thumb", "card", "wide", "hero"],
};

const VARIANT_CONFIG = {
  format: "webp",
  sizes: IMAGE_VARIANTS,
  fit: "inside",
  withoutEnlargement: true,
  quality: 82,
  effort: 6,
} as const;

export function artVariantConfigSha256(): string {
  return createHash("sha256").update(canonicalJson(VARIANT_CONFIG)).digest("hex");
}

export type VariantFile = {
  path: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
};

export type VariantIndex = {
  version: 1;
  configSha256: string;
  entries: Record<
    string,
    {
      source: { width: number; height: number; bytes: number; sha256: string };
      variants: Partial<Record<ImageVariant, VariantFile>>;
    }
  >;
};

export type ImageRef = {
  /** Published table name. */
  table: string;
  /** Row primary key. `projectAll` indexes refs by `(table, id)`. */
  id: string;
  /** Path inside the extracted build, without a query suffix. */
  source: string;
  /** Path inside the published dataset. The `image` column carries this content-hashed path. */
  published: string;
  /** Art contract for this table. */
  kind?: ArtKind;
};

  /**
   * A composed table, its published table name, and its path field.
   * The last field gives the primary-key field when it is not `id`.
   */
const PATH_FIELDS: [composed: string, table: string, field: string, idField?: string][] = [
  ["items", "items", "imagePath"],
  ["enemies", "enemies", "icon"],
  ["gatheringNodes", "gathering_nodes", "imagePath"],
  ["abilities", "abilities", "imagePath"],
  ["gems", "gems", "imagePath"],
  ["zonesDungeons", "zones_dungeons", "icon"],
  // Character-select portraits are the only full-figure art that the game ships. Class rows use `classId`, not `id`.
  ["classes", "classes", "image", "classId"],
];

/**
 * Achievements have no art field.
 * The game stores Steam icons by id in a fixed directory.
 * It stores achieved and unachieved variants.
 * The achieved variant identifies the image.
 */
const ACHIEVEMENT_DIR = "assets/achievements/phase1/steam-64/achieved";

type Source = Record<string, unknown>;

function rows(value: unknown): Source[] {
  const list = Array.isArray(value) ? value : Object.values((value ?? {}) as Source);
  return list.filter((entry): entry is Source => Boolean(entry) && typeof entry === "object");
}

/**
 * Strip the cache-busting suffix that the game adds to reskinned art.
 * For example, `...wood_oak.webp?v=bright-items-20260715` has no suffix on disk.
 */
function cleanPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.split("?")[0]!.trim();
  // The reskin left `?` and `??(Ab)` in `icon` on four tables. A value outside the asset tree is a placeholder, not art.
  if (!trimmed.startsWith("assets/")) return null;
  return trimmed;
}

/**
 * Published art paths carry a content hash.
 * A CDN can serve them as immutable files for one year.
 *
 * The game's filenames are not safe for this cache policy.
 * The game reuses names and adds a query string for cache busting.
 * `wood_oak.webp?v=bright-items-20260715` is a reskin of an existing path.
 * A client that keeps `wood_oak.webp` for one year keeps the wrong art after the next reskin.
 * Hashing the bytes puts the version in the filename.
 * Both a CDN and a browser can then use the version.
 *
 * An art change also becomes visible in the published dataset.
 * It is not an invisible byte change behind a stable name.
 */
const hashes = new Map<string, string>();

function contentHash(file: string): string {
  const cached = hashes.get(file);
  if (cached) return cached;
  const digest = createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 8);
  hashes.set(file, digest);
  return digest;
}

/**
 * Collect every image that the published dataset references from the extracted build.
 *
 * If a file is absent, skip the ref and append it to `missing` instead of throwing.
 * A future build can drop an asset, and one missing picture must not block publication.
 */
export function collectImages(
  composed: ComposedTables,
  extractedDir: string,
  missing?: string[],
): ImageRef[] {
  const refs: ImageRef[] = [];
  const add = (table: string, id: string, source: string | null): void => {
    if (!source || !id) return;
    const file = path.join(extractedDir, source);
    if (!existsSync(file)) {
      missing?.push(`${table}/${id}: ${source}`);
      return;
    }
    // `assets/items/celestial/skybound-spirit.webp` publishes as
    // `images/items/celestial/skybound-spirit.<hash>.webp`.
    const relative = source.slice("assets/".length);
    const extension = path.posix.extname(relative);
    const stem = relative.slice(0, relative.length - extension.length);
    const kind: ArtKind = table === "classes" ? "class" : table === "zones_dungeons" ? "zone" : "general";
    refs.push({
      table,
      id,
      source,
      kind,
      published: `images/${stem}.${contentHash(file)}${extension}`,
    });
  };

  for (const [composedId, table, field, idField = "id"] of PATH_FIELDS) {
    for (const row of rows(composed[composedId]?.value)) {
      add(table, String(row[idField] ?? ""), cleanPath(row[field]));
    }
  }

  // A world boss uses its reward gear's art. This is why the field name refers to gear.
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

function variantPath(canonical: string, variant: ImageVariant): string {
  const relative = canonical.replace(/^images\//, "");
  const extension = path.posix.extname(relative);
  const stem = extension ? relative.slice(0, -extension.length) : relative;
  return `images/variants/${variant}/${stem}.webp`;
}

function kindForRef(ref: ImageRef): ArtKind {
  if (ref.kind) return ref.kind;
  if (ref.table === "classes") return "class";
  if (ref.table === "zones_dungeons") return "zone";
  return "general";
}

async function sourceMetadata(file: string, source: string): Promise<sharp.Metadata> {
  try {
    return await sharp(file, { failOn: "error" }).metadata();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Image variant generation failed for ${source}: ${message}`);
  }
}

/**
 * Copy canonical art and write one deterministic WebP set for every referencing table.
 * Decode a shared canonical path once.
 * The variant set is the union of all referencing table kinds.
 * A class portrait cannot then suppress a general thumbnail.
 */
export async function writeImages(
  refs: readonly ImageRef[],
  extractedDir: string,
  outDir: string,
): Promise<VariantIndex> {
  const grouped = new Map<string, { ref: ImageRef; kinds: Set<ArtKind> }>();
  for (const ref of refs) {
    const current = grouped.get(ref.published);
    if (current) {
      current.kinds.add(kindForRef(ref));
    } else {
      grouped.set(ref.published, { ref, kinds: new Set([kindForRef(ref)]) });
    }
  }

  const entries: VariantIndex["entries"] = {};
  for (const [canonical, group] of grouped) {
    const sourceFile = path.join(extractedDir, group.ref.source);
    const metadata = await sourceMetadata(sourceFile, group.ref.source);
    if (typeof metadata.width !== "number" || typeof metadata.height !== "number") {
      throw new Error(`Image variant generation failed for ${group.ref.source}: missing image dimensions`);
    }
    const sourceBytes = readFileSync(sourceFile);
    const sourceRecord = {
      width: metadata.width,
      height: metadata.height,
      bytes: sourceBytes.byteLength,
      sha256: createHash("sha256").update(sourceBytes).digest("hex"),
    };

    const canonicalDestination = path.join(outDir, ...canonical.split("/"));
    mkdirSync(path.dirname(canonicalDestination), { recursive: true });
    await copyFile(sourceFile, canonicalDestination);

    const required = new Set<ImageVariant>();
    for (const kind of group.kinds) {
      for (const variant of VARIANTS_BY_KIND[kind]) required.add(variant);
    }
    const variants: Partial<Record<ImageVariant, VariantFile>> = {};
    for (const variant of Object.keys(IMAGE_VARIANTS) as ImageVariant[]) {
      if (!required.has(variant)) continue;
      const size = IMAGE_VARIANTS[variant];
      const destinationRelative = variantPath(canonical, variant);
      const destination = path.join(outDir, ...destinationRelative.split("/"));
      mkdirSync(path.dirname(destination), { recursive: true });
      try {
        await sharp(sourceFile, { failOn: "error" })
          .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true })
          .webp({ quality: 82, effort: 6 })
          .toFile(destination);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Image variant generation failed for ${group.ref.source}: ${message}`);
      }
      const outputBytes = readFileSync(destination);
      let outputMetadata: sharp.Metadata;
      try {
        outputMetadata = await sharp(destination, { failOn: "error" }).metadata();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Image variant generation failed for ${group.ref.source}: ${message}`);
      }
      if (
        typeof outputMetadata.width !== "number" ||
        typeof outputMetadata.height !== "number" ||
        outputMetadata.width > size ||
        outputMetadata.height > size ||
        outputMetadata.width > metadata.width ||
        outputMetadata.height > metadata.height
      ) {
        throw new Error(`Image variant generation failed for ${group.ref.source}: variant dimensions exceed configured bounds`);
      }
      variants[variant] = {
        path: destinationRelative,
        width: outputMetadata.width,
        height: outputMetadata.height,
        bytes: outputBytes.byteLength,
        sha256: createHash("sha256").update(outputBytes).digest("hex"),
      };
    }
    entries[canonical] = { source: sourceRecord, variants };
  }

  const index: VariantIndex = { version: 1, configSha256: artVariantConfigSha256(), entries };
  const indexFile = path.join(outDir, IMAGE_DIR, "variants.json");
  mkdirSync(path.dirname(indexFile), { recursive: true });
  const indexBytes = `${JSON.stringify(index, null, 2)}\n`;
  await Bun.write(indexFile, indexBytes);

  for (const [canonical, entry] of Object.entries(index.entries)) {
    const canonicalFile = path.join(outDir, ...canonical.split("/"));
    if (!existsSync(canonicalFile)) throw new Error(`published image missing: ${canonical}`);
    for (const [variantName, variant] of Object.entries(entry.variants) as [ImageVariant, VariantFile | undefined][]) {
      if (!variant) continue;
      const variantFile = path.join(outDir, ...variant.path.split("/"));
      if (!existsSync(variantFile)) throw new Error(`published image variant missing: ${variant.path}`);
      const checked = await sharp(variantFile, { failOn: "error" }).metadata();
      const limit = IMAGE_VARIANTS[variantName];
      if (typeof checked.width !== "number" || typeof checked.height !== "number" || checked.width > limit || checked.height > limit) {
        throw new Error(`published image variant exceeds bounds: ${variant.path}`);
      }
    }
  }
  return index;
}


/** Refs indexed by `(table, id)`. Projection uses this index to fill the `image` column. */
export function indexRefs(refs: readonly ImageRef[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const ref of refs) index.set(`${ref.table}\u0000${ref.id}`, ref.published);
  return index;
}
