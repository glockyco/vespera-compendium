import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { InvariantError, publish, SQLITE_FILENAME } from "./publish.ts";
import { SCHEMA_VERSION } from "./schema.ts";
import { verify } from "./verify.ts";

const SITE_DATA_DIR = path.join("site", "static", "data");
const SITE_WASM_DIR = path.join("site", "static", "wasm");
// The game's own art, served from /game/ so a published `image` path maps to a URL by one prefix.
const SITE_GAME_DIR = path.join("site", "static", "game");
const LATEST_DIR = path.join("data", "latest");
// Bun may hoist a workspace dependency to the root or keep it in the member, so both are tried.
const SQL_WASM_CANDIDATES = [
  path.join("node_modules", "sql.js", "dist", "sql-wasm.wasm"),
  path.join("site", "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
];

/** Counts files in a tree, so the sync reports art actually written rather than art intended. */
function countFiles(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    total += entry.isDirectory() ? countFiles(path.join(dir, entry.name)) : 1;
  }
  return total;
}

function runVerify(dir: string): void {
  const checks = verify(dir);
  for (const check of checks) console.log(`${check.status} ${check.id}: ${check.detail}`);
  if (checks.some((check) => check.status === "FAIL")) process.exitCode = 1;
}

function runPublish(dir: string): void {
  try {
    const result = publish(dir);
    for (const table of result.tables) {
      console.log(`WROTE ${table.name} (${table.rows} rows)`);
    }
    console.log(`WROTE ${result.images} images`);
    for (const missing of result.missingImages.slice(0, 6)) console.log(`MISSING ART ${missing}`);
    if (result.missingImages.length > 6) {
      console.log(`MISSING ART +${result.missingImages.length - 6} more`);
    }
    console.log(
      `PUBLISHED build ${result.buildId} schema ${SCHEMA_VERSION} -> ${result.outDirs.join(", ")}`,
    );
  } catch (error) {
    if (!(error instanceof InvariantError)) throw error;
    for (const line of error.message.split("\n")) console.log(`FAIL ${line}`);
    console.log("PUBLISH ABORTED — no files written");
    process.exitCode = 1;
  }
}

function runSyncSite(): void {
  if (!existsSync(LATEST_DIR)) {
    throw new Error(`${LATEST_DIR} not found — run "bun run publish" first`);
  }
  rmSync(SITE_DATA_DIR, { recursive: true, force: true });
  mkdirSync(SITE_DATA_DIR, { recursive: true });
  cpSync(LATEST_DIR, SITE_DATA_DIR, { recursive: true });
  // The art is served as static files rather than from /data/, so it is moved out of the copied
  // tree instead of being duplicated under both prefixes.
  rmSync(SITE_GAME_DIR, { recursive: true, force: true });
  const publishedImages = path.join(SITE_DATA_DIR, "images");
  let imageCount = 0;
  if (existsSync(publishedImages)) {
    mkdirSync(path.dirname(SITE_GAME_DIR), { recursive: true });
    cpSync(publishedImages, SITE_GAME_DIR, { recursive: true });
    rmSync(publishedImages, { recursive: true, force: true });
    imageCount = countFiles(SITE_GAME_DIR);
  }
  console.log(`SYNCED ${LATEST_DIR} -> ${SITE_DATA_DIR}`);
  console.log(`SYNCED ${imageCount} images -> ${SITE_GAME_DIR}`);

  const sqlWasm = SQL_WASM_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!sqlWasm) {
    throw new Error(`sql-wasm.wasm not found in ${SQL_WASM_CANDIDATES.join(" or ")} — run "bun install" first`);
  }
  mkdirSync(SITE_WASM_DIR, { recursive: true });
  cpSync(sqlWasm, path.join(SITE_WASM_DIR, "sql-wasm.wasm"));
  console.log(`SYNCED ${sqlWasm} -> ${path.join(SITE_WASM_DIR, "sql-wasm.wasm")}`);
  console.log(`SQLite database: ${path.join(SITE_DATA_DIR, SQLITE_FILENAME)}`);
}

const [command = "verify", dir = "extracted"] = process.argv.slice(2);
switch (command) {
  case "verify":
    runVerify(dir);
    break;
  case "publish":
    runPublish(dir);
    break;
  case "sync-site":
    runSyncSite();
    break;
  default:
    throw new Error(`unsupported pipeline command: ${command}`);
}
