/**
 * Reviewed third-party dependencies that a source closure is allowed to reach.
 *
 * Stopping at a package name would approve whatever `bun install` happens to place there, which is
 * exactly the substitution this repository refuses elsewhere. So a package leaf is recorded the same
 * way a bundle role is: by its bytes. The preimage carries the resolved version, the `bun.lock`
 * resolution and integrity string, and a sorted inventory of every file in the installed package
 * directory, native binaries included. Replacing a platform binary changes the closure hash and
 * invalidates the approval, which is the only defensible claim when that binary decodes the images
 * the site serves.
 *
 * Only a package a reviewed closure actually reaches may be listed. An unlisted package, a changed
 * lock resolution, a missing or extra file, or a dynamic package specifier fails source hashing.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/** Closure identifiers, matching the five approved closures. */
export type SourceClosureName = "approvalGate" | "derivation" | "inspector" | "probeExecutor" | "runtime";

/**
 * The exhaustive registry.
 *
 * `typescript` appears in four closures because they import from `@vespera/core`, and that barrel
 * re-exports the source-hash module which owns the parser. Module-granular hashing follows the barrel, so
 * the parser is genuinely reachable from those roots rather than only from extraction.
 *
 * The probe executor lists nothing. It imports one Node-free module and no barrel, which is what makes
 * `executorSha256 -> contractSha256` acyclic, and listing a package it cannot reach would weaken the rule
 * that only a reached package may be declared.
 *
 * `sharp` is reached from approval-gate roots alone, because publication is the only thing that decodes
 * and resizes the game's art.
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

/** Directories inside an installed package that hold another package rather than this one's bytes. */
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
        // A nested install is a different package with its own identity, so it is not folded into
        // this record. Reaching it would require its own reviewed leaf.
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

/** Narrows an unknown JSON value to a record without asserting a shape the parser never checked. */
function asRecord(value: unknown, detail: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`expected a JSON object: ${detail}`);
  }
  return value as Record<string, unknown>;
}

/**
 * The lock's own resolution and integrity strings for one package.
 *
 * Bun writes each entry as a tuple whose first member is the resolution (`name@version`) and whose
 * last member is the integrity hash. Reading the tuple positionally is fragile, so both are located
 * by shape and a missing entry fails rather than defaulting.
 */
function lockEntry(lockPath: string, name: string): { resolution: string; integrity: string } {
  const source = readFileSync(lockPath, "utf8");
  // `bun.lock` is JSONC: it carries trailing commas that `JSON.parse` rejects.
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
 * Cached per process because a single command can compute several closures over the same install,
 * and hashing a native binary tree repeatedly is pure cost with no added guarantee.
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

/** The bare package name of a module specifier, honouring scoped packages. */
export function packageNameOf(specifier: string): string {
  if (specifier.startsWith("@")) {
    const [scope, name] = specifier.split("/");
    return name ? `${scope}/${name}` : specifier;
  }
  return specifier.split("/")[0]!;
}
