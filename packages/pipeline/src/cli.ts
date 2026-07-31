import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { InvariantError, publish, SQLITE_FILENAME } from "./publish.ts";
import { SCHEMA_VERSION } from "./schema.ts";
import { verify } from "./verify.ts";

const SITE_DATA_DIR = path.join("site", "static", "data");
const SITE_WASM_DIR = path.join("site", "static", "wasm");
const LATEST_DIR = path.join("data", "latest");
const SQL_WASM = path.join("node_modules", "sql.js", "dist", "sql-wasm.wasm");

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
  console.log(`SYNCED ${LATEST_DIR} -> ${SITE_DATA_DIR}`);

  if (!existsSync(SQL_WASM)) {
    throw new Error(`${SQL_WASM} not found — run "bun install" first`);
  }
  mkdirSync(SITE_WASM_DIR, { recursive: true });
  cpSync(SQL_WASM, path.join(SITE_WASM_DIR, "sql-wasm.wasm"));
  console.log(`SYNCED ${SQL_WASM} -> ${path.join(SITE_WASM_DIR, "sql-wasm.wasm")}`);
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
