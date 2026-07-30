import { HarnessUnavailableError, readBuildId } from "./launch.ts";
import { writeReports } from "./report.ts";
import { runAll, type ProbeSuite } from "./run.ts";

const VALID_SUITES = new Set<ProbeSuite>(["parity", "records", "formulas", "save"]);

function usage(message?: string): never {
  if (message) console.error(message);
  console.error("usage: bun run harness [--dir extracted] [--port 9222] [--only parity|records|formulas|save]");
  process.exit(2);
}

const args = process.argv.slice(2);
let extractedDir = "extracted";
let port = 9222;
const only: ProbeSuite[] = [];
for (let index = 0; index < args.length; index++) {
  const argument = args[index]!;
  const value = args[index + 1];
  if (argument === "--dir") {
    if (!value) usage("--dir requires a value");
    extractedDir = value;
    index++;
  } else if (argument === "--port") {
    if (!value) usage("--port requires a value");
    port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65_534) usage(`invalid port: ${value}`);
    index++;
  } else if (argument === "--only") {
    if (!value || !VALID_SUITES.has(value as ProbeSuite)) usage(`invalid suite: ${value ?? ""}`);
    only.push(value as ProbeSuite);
    index++;
  } else {
    usage(`unknown argument: ${argument}`);
  }
}

let buildId: string;
try {
  buildId = readBuildId();
} catch (error) {
  if (!(error instanceof HarnessUnavailableError)) throw error;
  buildId = "unknown";
}

const results = await runAll({
  extractedDir,
  buildId,
  port,
  only: only.length > 0 ? only : undefined,
});
const paths = writeReports(buildId, results);
for (const result of results) console.log(`${result.status} ${result.suite}.${result.id}: ${result.detail}`);
console.log(`Reports: ${paths.jsonPath}, ${paths.markdownPath}`);
if (results.some((result) => result.status === "FAIL" || result.status === "UNRESOLVED")) {
  process.exitCode = 1;
}
