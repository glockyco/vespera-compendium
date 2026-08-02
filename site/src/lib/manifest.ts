/**
 * Defines the published manifest in one place.
 *
 * `index.json` is the contract between the pipeline and every site surface.
 * The prerender server, browser SQL playground, and emitted-data checker read it.
 * One shared type, schema literal, parser, and client request prevent drift.
 */

/** The only schema-version literal in the site. */
export const MANIFEST_SCHEMA_VERSION = 3;

/** The manifest's filename inside a published data directory. */
export const MANIFEST_FILE = "index.json";

/** Where the browser fetches the manifest from. */
export const MANIFEST_URL = `/data/${MANIFEST_FILE}`;

/** Longest edge, in pixels, of each generated art derivative. */
export const IMAGE_VARIANT_SIZES = {
  thumb: 64,
  card: 192,
  portrait: 384,
  wide: 640,
  hero: 1280,
} as const;

export type ImageVariant = keyof typeof IMAGE_VARIANT_SIZES;

export type ManifestColumn = { name: string; type: string };

export type ManifestTable = {
  name: string;
  slug: string;
  kind: "entity" | "join" | "meta";
  rows: number;
  primaryKey: string[];
  columns: ManifestColumn[];
  json: string;
  csv: string;
  /** Packed-column key to real column name, for the compacted search index. */
  jsonKeys?: Record<string, string>;
};

export type ManifestImages = {
  canonicalRoot: "images";
  canonicalCount: number;
  variantIndex: "images/variants.json";
  variantCount: number;
  configSha256: string;
  variants: typeof IMAGE_VARIANT_SIZES;
};

export type Manifest = {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  buildId: string;
  generatedAt: string;
  sqlite: string;
  mechanics: "mechanics.json";
  mechanicCount: number;
  mechanicsApprovalSha256: string;
  images: ManifestImages;
  tables: ManifestTable[];
};

const TABLE_KIND: Record<string, ManifestTable["kind"] | undefined> = {
  entity: "entity",
  join: "join",
  meta: "meta",
};

const SHA256_HEX = /^[0-9a-f]{64}$/;

function fail(source: string, detail: string): never {
  throw new Error(`${source} is not a schema-${MANIFEST_SCHEMA_VERSION} manifest: ${detail}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, source: string, at: string): Record<string, unknown> {
  if (!isRecord(value)) fail(source, `${at} must be an object`);
  return value;
}

function text(host: Record<string, unknown>, key: string, source: string, at: string): string {
  const value = host[key];
  if (typeof value !== "string" || value.length === 0) fail(source, `${at}.${key} must be a non-empty string`);
  return value;
}

function literal<T extends string>(host: Record<string, unknown>, key: string, expected: T, source: string, at: string): T {
  const value = host[key];
  if (value !== expected) fail(source, `${at}.${key} must be exactly ${JSON.stringify(expected)}`);
  return expected;
}

function count(host: Record<string, unknown>, key: string, source: string, at: string): number {
  const value = host[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    fail(source, `${at}.${key} must be a non-negative integer`);
  }
  return value;
}

function digest(host: Record<string, unknown>, key: string, source: string, at: string): string {
  const value = text(host, key, source, at);
  if (!SHA256_HEX.test(value)) fail(source, `${at}.${key} must be a lowercase SHA-256 hex digest`);
  return value;
}

function list(host: Record<string, unknown>, key: string, source: string, at: string): unknown[] {
  const value = host[key];
  if (!Array.isArray(value)) fail(source, `${at}.${key} must be an array`);
  return value;
}

function strings(host: Record<string, unknown>, key: string, source: string, at: string): string[] {
  return list(host, key, source, at).map((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0) {
      fail(source, `${at}.${key}[${index}] must be a non-empty string`);
    }
    return entry;
  });
}

function parseColumns(value: unknown[], source: string, at: string): ManifestColumn[] {
  return value.map((entry, index) => {
    const column = record(entry, source, `${at}[${index}]`);
    return {
      name: text(column, "name", source, `${at}[${index}]`),
      type: text(column, "type", source, `${at}[${index}]`),
    };
  });
}

function parseTable(value: unknown, source: string, index: number): ManifestTable {
  const at = `tables[${index}]`;
  const entry = record(value, source, at);
  const kind = typeof entry.kind === "string" ? TABLE_KIND[entry.kind] : undefined;
  if (!kind) fail(source, `${at}.kind must be one of entity, join, meta`);
  const table: ManifestTable = {
    name: text(entry, "name", source, at),
    slug: text(entry, "slug", source, at),
    kind,
    rows: count(entry, "rows", source, at),
    primaryKey: strings(entry, "primaryKey", source, at),
    columns: parseColumns(list(entry, "columns", source, at), source, `${at}.columns`),
    json: text(entry, "json", source, at),
    csv: text(entry, "csv", source, at),
  };
  if ("jsonKeys" in entry && entry.jsonKeys !== undefined) {
    const packed = record(entry.jsonKeys, source, `${at}.jsonKeys`);
    const mapped: Record<string, string> = {};
    for (const key of Object.keys(packed)) {
      const column = packed[key];
      if (typeof column !== "string" || column.length === 0) {
        fail(source, `${at}.jsonKeys.${key} must be a non-empty column name`);
      }
      mapped[key] = column;
    }
    table.jsonKeys = mapped;
  }
  return table;
}

function parseImages(value: unknown, source: string): ManifestImages {
  const at = "images";
  const images = record(value, source, at);
  const variants = record(images.variants, source, `${at}.variants`);
  for (const [variant, size] of Object.entries(IMAGE_VARIANT_SIZES)) {
    if (variants[variant] !== size) fail(source, `${at}.variants.${variant} must be ${size}`);
  }
  const extra = Object.keys(variants).filter((key) => !(key in IMAGE_VARIANT_SIZES));
  if (extra.length > 0) fail(source, `${at}.variants has unknown entries: ${extra.sort().join(", ")}`);

  return {
    canonicalRoot: literal(images, "canonicalRoot", "images", source, at),
    canonicalCount: count(images, "canonicalCount", source, at),
    variantIndex: literal(images, "variantIndex", "images/variants.json", source, at),
    variantCount: count(images, "variantCount", source, at),
    configSha256: digest(images, "configSha256", source, at),
    variants: IMAGE_VARIANT_SIZES,
  };
}

/** Checks a parsed `index.json` and returns its typed form.
 *
 * The site rejects an older manifest instead of degrading.
 * Every schema-2 field that this build needs has a schema-3 replacement.
 * Tolerating the old shape shows pages without approved mechanics labels.
 */
export function parseManifest(value: unknown, source: string = MANIFEST_FILE): Manifest {
  const manifest = record(value, source, "manifest");
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    fail(source, `schemaVersion must be ${MANIFEST_SCHEMA_VERSION}, found ${JSON.stringify(manifest.schemaVersion)}`);
  }

  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    buildId: text(manifest, "buildId", source, "manifest"),
    generatedAt: text(manifest, "generatedAt", source, "manifest"),
    sqlite: text(manifest, "sqlite", source, "manifest"),
    mechanics: literal(manifest, "mechanics", "mechanics.json", source, "manifest"),
    mechanicCount: count(manifest, "mechanicCount", source, "manifest"),
    mechanicsApprovalSha256: digest(manifest, "mechanicsApprovalSha256", source, "manifest"),
    images: parseImages(manifest.images, source),
    tables: list(manifest, "tables", source, "manifest").map((entry, index) => parseTable(entry, source, index)),
  };
}

/**
 * Makes the site's only client-side manifest request.
 *
 * `/query/` needs the full manifest before it runs SQL.
 * This function checks the build, then gives the query page its table list.
 * One request and one parser keep schema changes in one place.
 */
export async function fetchManifest(fetchImpl: typeof fetch = fetch): Promise<Manifest> {
  const response = await fetchImpl(MANIFEST_URL);
  if (!response.ok) {
    throw new Error(`manifest fetch failed: ${response.status}`);
  }
  return parseManifest(await response.json(), MANIFEST_URL);
}
