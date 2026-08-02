/**
 * Reviewed third-party dependencies that a source closure can reach.
 *
 * A package name alone approves whatever `bun install` places there. This repository rejects that substitution.
 * A package leaf records bytes, like a bundle role. Its preimage includes the resolved version, the `bun.lock` resolution and integrity string, and a sorted inventory of every installed file, including native binaries.
 * Replacing a platform binary changes the closure hash and invalidates approval. That result is required when the binary decodes images that the site serves.
 *
 * A reviewed closure can list only a package that it reaches. An unlisted package, changed lock resolution, missing or extra file, or dynamic package specifier fails source hashing.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/** Closure identifiers that match the five approved closures. */
export type SourceClosureName = "approvalGate" | "derivation" | "inspector" | "probeExecutor" | "runtime";

/**
 * The exhaustive registry.
 *
 * `typescript` appears in four closures because they import from `@vespera/core`. That barrel re-exports the source-hash module that owns the parser.
 * Module-granular hashing follows the barrel, so the parser is reachable from those roots, not only from extraction.
 *
 * The probe executor lists no package. It imports one Node-free module and no barrel.
 * This keeps `executorSha256 -> contractSha256` acyclic. Listing an unreachable package weakens the rule that only reached packages can be declared.
 *
 * `sharp` is reached only from approval-gate roots because publication alone decodes and resizes the game's art.
 */
export const SOURCE_CLOSURE_PACKAGE_LEAVES: Readonly<Record<SourceClosureName, readonly string[]>> =
  Object.freeze({
    approvalGate: Object.freeze(["sharp", "typescript"]),
    derivation: Object.freeze(["typescript"]),
    inspector: Object.freeze(["typescript"]),
    probeExecutor: Object.freeze([]),
    runtime: Object.freeze(["typescript"]),
  });

export type PackageFileRecord = { path: string; bytes: number; sha256: string };

export type PackageLeafRecord = {
  name: string;
  version: string;
  lockResolution: string;
  lockIntegrity: string;
  files: PackageFileRecord[];
  inventorySha256: string;
};

/** Directories inside an installed package that hold another package, not this package's bytes. */
const NESTED_PACKAGE_DIR = "node_modules";

function inventory(root: string): PackageFileRecord[] {
  const records: PackageFileRecord[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    )) {
      const absolute = path.join(dir, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        // A nested install is a different package with its own identity. Do not fold it into this record.
        // Reaching it requires another reviewed leaf.
        if (entry.name === NESTED_PACKAGE_DIR) continue;
        walk(absolute, relative);
        continue;
      }
      if (!entry.isFile()) continue;
      const bytes = readFileSync(absolute);
      records.push({
        path: relative,
        bytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  };
  walk(root, "");
  return records.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

/** Converts an unknown JSON value to a record without assuming an unchecked shape. */
function asRecord(value: unknown, detail: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`expected a JSON object: ${detail}`);
  }
  return value as Record<string, unknown>;
}

/**
 * The lock resolution and integrity strings for one package.
 *
 * Bun writes each entry as a tuple. Its first member is the resolution (`name@version`), and its last member is the integrity hash.
 * Tuple positions are fragile, so this function locates both strings by shape. A missing entry fails instead of using a default.
 */
function lockEntry(lockPath: string, name: string): { resolution: string; integrity: string } {
  const source = readFileSync(lockPath, "utf8");
  // `bun.lock` is JSONC. It carries trailing commas that `JSON.parse` rejects.
  const stripped = source.replace(/,(\s*[}\]])/g, "$1");
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (cause) {
    throw new Error(`bun.lock is not parseable at ${lockPath}`, { cause });
  }
  const root = asRecord(parsed, lockPath);
  const packages = root.packages === undefined ? {} : asRecord(root.packages, `${lockPath} packages`);
  const tuple = packages[name];
  if (!Array.isArray(tuple)) {
    throw new Error(`bun.lock has no resolution for the reviewed package leaf ${name}`);
  }
  const resolution = tuple.find(
    (member): member is string => typeof member === "string" && member.startsWith(`${name}@`),
  );
  const integrity = tuple.find(
    (member): member is string => typeof member === "string" && /^sha\d+-/.test(member),
  );
  if (!resolution || !integrity) {
    throw new Error(`bun.lock entry for ${name} has no resolution/integrity pair`);
  }
  return { resolution, integrity };
}

const cache = new Map<string, PackageLeafRecord>();

/**
 * The byte-level record for one reviewed package leaf.
 *
 * The process caches this record because one command can compute several closures over the same install.
 * Repeated hashing of a native binary tree adds cost but no guarantee.
 */
export function packageLeafRecord(workspaceRoot: string, name: string): PackageLeafRecord {
  const key = `${workspaceRoot}\u0000${name}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const root = path.join(workspaceRoot, "node_modules", name);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`reviewed package leaf ${name} is not installed at ${root}`);
  }
  const manifestPath = path.join(root, "package.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`reviewed package leaf ${name} has no package.json at ${manifestPath}`);
  }
  const version = asRecord(JSON.parse(readFileSync(manifestPath, "utf8")), manifestPath).version;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error(`reviewed package leaf ${name} declares no version`);
  }
  const { resolution, integrity } = lockEntry(path.join(workspaceRoot, "bun.lock"), name);
  const files = inventory(root);
  const inventorySha256 = createHash("sha256")
    .update(files.map((file) => `${file.path}\u0000${file.bytes}\u0000${file.sha256}`).join("\n"))
    .digest("hex");
  const record: PackageLeafRecord = {
    name,
    version,
    lockResolution: resolution,
    lockIntegrity: integrity,
    files,
    inventorySha256,
  };
  cache.set(key, record);
  return record;
}

/** Whether one package is a reviewed leaf of one closure. */
export function isPackageLeaf(closure: SourceClosureName, name: string): boolean {
  return SOURCE_CLOSURE_PACKAGE_LEAVES[closure].includes(name);
}

/** The bare package name of a module specifier, including scoped packages. */
export function packageNameOf(specifier: string): string {
  if (specifier.startsWith("@")) {
    const [scope, name] = specifier.split("/");
    return name ? `${scope}/${name}` : specifier;
  }
  return specifier.split("/")[0]!;
}
