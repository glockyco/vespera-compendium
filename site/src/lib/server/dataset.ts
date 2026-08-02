import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MANIFEST_FILE, parseManifest, type Manifest, type ManifestTable } from "../manifest";

/**
 * Build-time access to the published dataset, and the only place in the site that touches a
 * filesystem.
 *
 * A published build must render from one immutable tree. `tools/build-site.ts` verifies a snapshot
 * while holding the data lease, then hands this module a capability naming that snapshot and the
 * exact manifest bytes it verified. Reading `site/static/data` directly instead would reopen a
 * directory another command may already be replacing, so the two would be verifying and using
 * different trees. The capability closes that window: a read either resolves beneath the verified
 * root or fails the build.
 */

export type { Manifest, ManifestTable };

/**
 * Names the one data tree a build is entitled to read.
 *
 * `manifestSha256` is what makes this more than a path: the wrapper verified those exact bytes, so
 * a snapshot swapped underneath the build is detected at the first read rather than silently
 * rendered.
 */
export type PublishedSnapshotCapability = {
  buildToken: string;
  manifestSha256: string;
  root: string;
  version: 1;
};

/** Absolute canonical path of the verified snapshot the wrapper prepared. */
const SNAPSHOT_ROOT_VAR = "VESPERA_DATA_SNAPSHOT";

/** Canonical JSON of the {@link PublishedSnapshotCapability} for that snapshot. */
const SNAPSHOT_CAPABILITY_VAR = "VESPERA_DATA_SNAPSHOT_CAPABILITY";

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * One path segment of a published data file: letters, digits and the three punctuation marks the
 * pipeline emits. Anything else — a separator variant, a dot segment, a leading dot, an absolute
 * path, a URL — never matches, so no name can climb out of the snapshot root.
 */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The dataset directory, searched rather than computed.
 *
 * The three contexts this runs in disagree about both the working directory and this module's own
 * location: `vite dev` loads it from source, `vite build` bundles it into
 * `.svelte-kit/output/server/chunks/`, and `svelte-kit sync` runs from elsewhere again. Anchoring
 * on the marker file is the only resolution that survives all three.
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
 * The capability for a normal `vite dev` or `svelte-kit sync` run, over the working tree.
 *
 * A development server makes no approval claim, so it mints its own capability from whatever is in
 * `site/static/data`. Production never reaches this: `tools/build-site.ts` always exports both
 * environment variables, and a root without a capability is rejected below rather than falling
 * back here.
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

/**
 * Validates a capability once per process and keeps it.
 *
 * One build reads one tree. A second, different capability means two trees are in play, which is
 * exactly the race the capability exists to prevent, so it is refused rather than merged.
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
 * The site's only filesystem read.
 *
 * Every server surface reaches its data through here, so the set of files a build can open is the
 * set of path-safe names beneath one verified root, and that property is checkable by reading this
 * one function rather than by auditing every loader.
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

/** Reads one published JSON file by name, from this build's verified snapshot. */
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

/**
 * Entity tables the generic browser must not claim, because a dedicated route already owns their
 * URLs and renders them better.
 *
 * SvelteKit gives a static route precedence over a dynamic one, so `/classes/` would resolve to the
 * class hall either way. Declaring it here means the prerender list says so rather than the outcome
 * depending on route-matching order.
 */
const DEDICATED_SURFACES: Record<string, true> = { classes: true };

/** Entity tables the generic `[table]` browser renders. */
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
