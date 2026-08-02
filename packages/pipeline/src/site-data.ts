import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import type { LeaseSet, PreparedPublishedInputs } from "./inputs.ts";
import { verifyPublished, verifyPublishedMechanics } from "./verify.ts";

const SITE_DATA_DIR = path.join("site", "static", "data");
const SITE_GAME_DIR = path.join("site", "static", "game");
const SITE_WASM_DIR = path.join("site", "static", "wasm");
const SQL_WASM_CANDIDATES = [
  path.join("node_modules", "sql.js", "dist", "sql-wasm.wasm"),
  path.join("site", "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
];

export type SiteDataResult = {
  dataDirectory: string;
  gameDirectory: string;
  imageCount: number;
  wasmPath: string;
};

function assertLeaseSetLive(leases: LeaseSet): void {
  const candidate: unknown = leases;
  if (typeof candidate !== "object" || candidate === null) throw new Error("site-data lease set is invalid");
  if ("assertLive" in candidate && typeof candidate.assertLive === "function") candidate.assertLive();
  if ("assertLeasesLive" in candidate && typeof candidate.assertLeasesLive === "function") candidate.assertLeasesLive();
}

function assertLeases(prepared: PreparedPublishedInputs, leases: LeaseSet): void {
  prepared.assertLeasesLive();
  assertLeaseSetLive(leases);
}

/**
 * Sorted path, size, and content hash for every file under a root.
 *
 * Sorted, because the prepared manifest is sorted and the comparison below is index-by-index: directory
 * order is a filesystem detail, and letting it decide the result reports a coherent tree as mutated.
 */
function files(root: string, prefix = ""): { path: string; bytes: number; sha256: string }[] {
  const entries: { path: string; bytes: number; sha256: string }[] = [];
  for (const name of readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, name.name);
    const relative = prefix ? path.join(prefix, name.name) : name.name;
    if (name.isDirectory()) entries.push(...files(absolute, relative));
    else {
      const bytes = readFileSync(absolute);
      const digest = new Bun.CryptoHasher("sha256");
      digest.update(bytes);
      entries.push({ path: relative.split(path.sep).join("/"), bytes: bytes.byteLength, sha256: digest.digest("hex") });
    }
  }
  // The same byte comparison the prepared manifest uses. `localeCompare` orders mixed case and
  // punctuation differently, and an index-by-index comparison then reports a coherent tree as mutated.
  return entries.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

function sameFiles(left: readonly { path: string; bytes: number; sha256: string }[], right: readonly { path: string; bytes: number; sha256: string }[]): boolean {
  return left.length === right.length && left.every((entry, index) => {
    const other = right[index];
    return other?.path === entry.path && other.bytes === entry.bytes && other.sha256 === entry.sha256;
  });
}

function countFiles(root: string): number {
  if (!existsSync(root)) return 0;
  return readdirSync(root, { withFileTypes: true }).reduce((count, entry) => count + (entry.isDirectory() ? countFiles(path.join(root, entry.name)) : 1), 0);
}

function replaceDirectory(staging: string, destination: string): void {
  const backup = `${destination}.backup-${process.pid}-${Date.now()}`;
  const present = existsSync(destination);
  try {
    if (present) renameSync(destination, backup);
    renameSync(staging, destination);
    if (present) rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (present && existsSync(backup) && !existsSync(destination)) {
      try { renameSync(backup, destination); } catch { /* preserve original failure */ }
    }
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

export function verifySiteData(prepared: PreparedPublishedInputs, leases: LeaseSet): SiteDataResult {
  assertLeases(prepared, leases);
  const manifestBefore = Buffer.from(prepared.manifestBytesBefore);
  if (!manifestBefore.equals(Buffer.from(prepared.manifestBytesStaged)) || !manifestBefore.equals(Buffer.from(prepared.manifestBytesAfter))) throw new Error("INPUT_MUTATED: published manifest generation advanced");
  const rootManifest = path.join(prepared.snapshotPath, "index.json");
  if (!existsSync(rootManifest) || !Buffer.from(readFileSync(rootManifest)).equals(Buffer.from(prepared.manifestBytesBefore))) throw new Error("INPUT_MUTATED: prepared manifest differs from snapshot");
  const checks = verifyPublished(prepared);
  const failures = checks.filter((check) => check.status === "FAIL");
  if (failures.length > 0) throw new Error(failures.map((check) => `${check.id}: ${check.detail}`).join("\n"));
  verifyPublishedMechanics(prepared);
  return {
    dataDirectory: prepared.snapshotPath,
    gameDirectory: path.join(prepared.snapshotPath, "images"),
    imageCount: countFiles(path.join(prepared.snapshotPath, "images")),
    wasmPath: path.join(SITE_WASM_DIR, "sql-wasm.wasm"),
  };
}

export function syncSiteData(prepared: PreparedPublishedInputs, leases: LeaseSet): SiteDataResult {
  assertLeases(prepared, leases);
  verifySiteData(prepared, leases);
  const before = files(prepared.snapshotPath);
  if (!sameFiles(before, prepared.fileManifest)) throw new Error("INPUT_MUTATED: prepared data manifest differs from snapshot");
  const staging = `${SITE_DATA_DIR}.staging-${process.pid}-${Date.now()}`;
  const gameStaging = `${SITE_GAME_DIR}.staging-${process.pid}-${Date.now()}`;
  mkdirSync(staging, { recursive: true });
  mkdirSync(gameStaging, { recursive: true });
  try {
    cpSync(prepared.snapshotPath, staging, { recursive: true });
    const after = files(prepared.snapshotPath);
    const stagedBeforeArt = files(staging);
    if (!sameFiles(before, after) || !sameFiles(before, stagedBeforeArt)) throw new Error("INPUT_MUTATED: data snapshot changed during site sync");
    const images = path.join(staging, "images");
    let imageCount = 0;
    if (existsSync(images)) {
      cpSync(images, gameStaging, { recursive: true });
      imageCount = countFiles(gameStaging);
      rmSync(images, { recursive: true, force: true });
    }
    const staged = files(staging);
    if (!sameFiles(before.filter((entry) => !entry.path.startsWith("images/")), staged)) throw new Error("INPUT_MUTATED: staged site data differs from source");
    const sqlWasm = SQL_WASM_CANDIDATES.find((candidate) => existsSync(candidate));
    if (!sqlWasm) throw new Error(`sql-wasm.wasm not found in ${SQL_WASM_CANDIDATES.join(" or ")} — run bun install first`);
    assertLeases(prepared, leases);
    replaceDirectory(staging, SITE_DATA_DIR);
    replaceDirectory(gameStaging, SITE_GAME_DIR);
    mkdirSync(SITE_WASM_DIR, { recursive: true });
    cpSync(sqlWasm, path.join(SITE_WASM_DIR, "sql-wasm.wasm"));
    return { dataDirectory: SITE_DATA_DIR, gameDirectory: SITE_GAME_DIR, imageCount, wasmPath: path.join(SITE_WASM_DIR, "sql-wasm.wasm") };
  } catch (error) {
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
    if (existsSync(gameStaging)) rmSync(gameStaging, { recursive: true, force: true });
    throw error;
  }
}
