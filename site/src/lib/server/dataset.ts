import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MANIFEST_FILE, parseManifest, type Manifest, type ManifestTable } from "../manifest";

/**
 * Provides build-time access to the published dataset.
 * This is the only site module that reads a filesystem.
 *
 * A published build reads one immutable tree.
 * `tools/build-site.ts` checks a snapshot while it holds the data lease.
 * It passes this module a capability with the snapshot and exact manifest bytes.
 * Direct reads from `site/static/data` can use a tree that another command replaces.
 * The capability closes that window. Reads stay beneath the checked root or fail the build.
 */

export type { Manifest, ManifestTable };

/**
 * Names the one data tree that a build can read.
 *
 * `manifestSha256` binds the capability to exact bytes.
 * If a snapshot changes during the build, the first read detects it instead of returning changed data.
 */
export type PublishedSnapshotCapability = {
  buildToken: string;
  manifestSha256: string;
  root: string;
  version: 1;
};

/** Absolute canonical path of the checked snapshot the wrapper prepared. */
const SNAPSHOT_ROOT_VAR = "VESPERA_DATA_SNAPSHOT";

/** Canonical JSON of the {@link PublishedSnapshotCapability} for that snapshot. */
const SNAPSHOT_CAPABILITY_VAR = "VESPERA_DATA_SNAPSHOT_CAPABILITY";

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Allows one path segment in a published data filename.
 *
 * The pipeline emits letters, digits, and three punctuation marks.
 * Separators, dot segments, leading dots, absolute paths, and URLs fail this pattern.
 */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Finds the dataset directory instead of calculating one path.
 *
 * `vite dev`, `vite build`, and `svelte-kit sync` use different working directories and module paths.
 * The marker file is the only location rule that works in all three contexts.
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

  const found = candidates.find((candidate) => existsSync(path.join(candidate, MANIFEST_FILE)));
  if (!found) {
    throw new Error(`site/static/data/${MANIFEST_FILE} missing — run "bun run data:sync"`);
  }
  return found;
}

function parseCapability(serialized: string): PublishedSnapshotCapability {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (cause) {
    throw new Error(`${SNAPSHOT_CAPABILITY_VAR} is not JSON`, { cause });
  }
  if (!isRecord(value)) {
    throw new Error(`${SNAPSHOT_CAPABILITY_VAR} must be an object`);
  }
  const { buildToken, manifestSha256, root, version } = value;
  if (version !== 1) throw new Error(`${SNAPSHOT_CAPABILITY_VAR}.version must be 1`);
  if (typeof root !== "string" || !path.isAbsolute(root)) {
    throw new Error(`${SNAPSHOT_CAPABILITY_VAR}.root must be an absolute path`);
  }
  if (typeof manifestSha256 !== "string" || !SHA256_HEX.test(manifestSha256)) {
    throw new Error(`${SNAPSHOT_CAPABILITY_VAR}.manifestSha256 must be a lowercase SHA-256 hex digest`);
  }
  if (typeof buildToken !== "string" || buildToken.length < 32) {
    throw new Error(`${SNAPSHOT_CAPABILITY_VAR}.buildToken must be at least 32 characters`);
  }
  return { buildToken, manifestSha256, root, version: 1 };
}

/**
 * Creates a capability for `vite dev` or `svelte-kit sync` over the working tree.
 *
 * Development makes no approval claim. It creates a capability from `site/static/data`.
 * Production always supplies both environment variables. A missing capability fails below.
 */
function developmentCapability(): PublishedSnapshotCapability {
  const root = path.resolve(findDataDir());
  const manifestSha256 = sha256Hex(readFileSync(path.join(root, MANIFEST_FILE)));
  return { buildToken: `development-${manifestSha256}`, manifestSha256, root, version: 1 };
}

/** The capability this process must use, from the wrapper's environment or the dev fallback. */
export function publishedSnapshotCapability(): PublishedSnapshotCapability {
  const serialized = process.env[SNAPSHOT_CAPABILITY_VAR];
  const declaredRoot = process.env[SNAPSHOT_ROOT_VAR];
  if (serialized === undefined || serialized.length === 0) {
    if (declaredRoot !== undefined && declaredRoot.length > 0) {
      throw new Error(`${SNAPSHOT_ROOT_VAR} is set without ${SNAPSHOT_CAPABILITY_VAR}`);
    }
    return developmentCapability();
  }

  const capability = parseCapability(serialized);
  if (declaredRoot === undefined || path.resolve(declaredRoot) !== capability.root) {
    throw new Error(`${SNAPSHOT_ROOT_VAR} must equal ${SNAPSHOT_CAPABILITY_VAR}.root`);
  }
  return capability;
}

type AcceptedSnapshot = {
  capability: PublishedSnapshotCapability;
  /** Two thousand-odd detail pages are prerendered from these files, so each one is parsed once. */
  parsed: Map<string, unknown>;
};

let accepted: AcceptedSnapshot | undefined;

/** Checks a capability once per process and keeps it.
 *
 * One build reads one tree. A second capability puts two trees in use.
 * The function rejects that race instead of merging the trees.
 */
function acceptSnapshot(capability: PublishedSnapshotCapability): AcceptedSnapshot {
  if (accepted) {
    if (accepted.capability.buildToken !== capability.buildToken) {
      throw new Error("a second published snapshot capability was presented to this build");
    }
    return accepted;
  }

  const manifestPath = path.join(capability.root, MANIFEST_FILE);
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(manifestPath);
  } catch (cause) {
    throw new Error(`published snapshot has no ${MANIFEST_FILE}: ${capability.root}`, { cause });
  }
  const observed = sha256Hex(bytes);
  if (observed !== capability.manifestSha256) {
    throw new Error(
      `published snapshot changed under the build: ${MANIFEST_FILE} hashes ${observed}, capability names ${capability.manifestSha256}`,
    );
  }

  accepted = { capability, parsed: new Map() };
  return accepted;
}

function resolveBeneath(root: string, name: string): string {
  const segments = name.split("/");
  if (segments.length === 0 || !segments.every((segment) => SAFE_SEGMENT.test(segment))) {
    throw new Error(`unsafe published data filename: ${JSON.stringify(name)}`);
  }
  const resolved = path.resolve(root, ...segments);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`published data filename escapes the snapshot: ${JSON.stringify(name)}`);
  }
  return resolved;
}

/**
 * Reads the site's only filesystem path.
 * Every server surface uses this function, so all reads stay beneath one checked root.
 */
export function readPublishedSnapshotFile<T>(capability: PublishedSnapshotCapability, name: string): T {
  const snapshot = acceptSnapshot(capability);
  const cached = snapshot.parsed.get(name);
  if (cached !== undefined) return cached as T;

  const file = resolveBeneath(snapshot.capability.root, name);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (cause) {
    throw new Error(`published data file missing: ${name} — run "bun run data:sync"`, { cause });
  }
  const parsed: unknown = JSON.parse(text);
  snapshot.parsed.set(name, parsed);
  return parsed as T;
}

/** Reads one published JSON file by name, from this build's checked snapshot. */
export function readDataFile<T>(fileName: string): T {
  return readPublishedSnapshotFile<T>(publishedSnapshotCapability(), fileName);
}

export type Scalar = string | number | boolean | null;
export type Row = Record<string, Scalar>;

let validated: Manifest | undefined;

export function manifest(): Manifest {
  validated ??= parseManifest(readDataFile<unknown>(MANIFEST_FILE), MANIFEST_FILE);
  return validated;
}

export function table(name: string): Row[] {
  return readDataFile<Row[]>(`${name}.json`);
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

/** Returns the key column from the manifest instead of assuming `id`.
 * Shop listings use `item_id`. An assumed `id` makes every detail URL fail.
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

/**
 * Lists entity tables that the generic browser must not claim.
 * A dedicated route already owns their URLs and shows them better.
 * SvelteKit gives static routes precedence over dynamic routes, so `/classes/` reaches the class hall.
 * The declaration makes the prerender list explicit instead of relying on route order.
 */
const DEDICATED_SURFACES: Record<string, true> = { classes: true };

/** Entity tables that the generic `[table]` browser shows. */
export function browsableTables(): ManifestTable[] {
  return entityTables().filter((entry) => DEDICATED_SURFACES[entry.name] !== true);
}

/** Every `(slug, key)` pair across the entity tables, which is the detail-page prerender list. */
export function entityKeys(): { table: string; id: string }[] {
  return browsableTables().flatMap((spec) => {
    const column = primaryKeyColumn(spec.name);
    return table(spec.name).map((row) => ({ table: spec.slug, id: String(row[column]) }));
  });
}
