import { sha256Hex } from "@vespera/core";
import { extractMechanics, prepareMechanicsInputs, requiredProbes } from "@vespera/pipeline";
import { HarnessUnavailableError, readBuildId } from "./launch.ts";
import { runEvidenceCommand, type ProbeSuite } from "./run.ts";
import type { PreparedHarnessRun } from "./types.ts";

const VALID_SUITES = new Set<ProbeSuite>(["parity", "records", "formulas", "save"]);

function usage(message?: string): never {
  if (message) console.error(message);
  console.error("usage: bun run harness [--dir extracted] [--port 9222] [--only parity|records|formulas|save] [--output-root root]");
  process.exit(2);
}

const args = process.argv.slice(2);
let extractedDir = "extracted";
let port = 9222;
let outputRoot: string | undefined;
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
  } else if (argument === "--output-root") {
    if (!value) usage("--output-root requires a value");
    outputRoot = value;
    index++;
  } else usage(`unknown argument: ${argument}`);
}

const prepared = prepareMechanicsInputs(extractedDir, "harness");
const documents = extractMechanics(prepared);
let buildId = prepared.resolvedBuildId;
if (!buildId) {
  try {
    buildId = readBuildId();
  } catch (error) {
    if (!(error instanceof HarnessUnavailableError)) throw error;
    throw new Error("harness preparation did not resolve an installed build ID", { cause: error });
  }
}
const extractedSnapshotPath = prepared.extractedSnapshotPath;
const input: PreparedHarnessRun = {
  buildId,
  extractedSnapshotPath,
  extractedBundles: prepared.bundleFingerprints,
  // The approval's own canonical hash, not the file hash: every other reader recomputes the canonical
  // projection, and a formatting-only difference must not read as a different approval.
  mechanicsSourceApprovalSha256: prepared.mechanicsSourceApprovalSha256,
  documents,
  mechanics: documents.map((document) => ({ id: document.id, requiredProbes: requiredProbes(document) })),
  outputRoot,
};
const result = await runEvidenceCommand(input, { port, only: only.length > 0 ? only : undefined, outputRoot });
console.log(`${result.status}: ${result.jsonPath}, ${result.markdownPath}`);
if (result.status === "SKIPPED") process.exitCode = 0;
