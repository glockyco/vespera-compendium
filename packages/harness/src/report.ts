import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync, existsSync } from "node:fs";
import path from "node:path";
import {
  allExternalLeafCoverageIds,
  canonicalJson,
  MECHANIC_PROBE_CONTRACTS,
  PROBE_RUNTIME_SHA256,
  probeContract,
  sha256Hex,
} from "@vespera/core";
import { runtimeArtifactPaths } from "./launch.ts";
import type { PreparedHarnessRun, EvidenceReport, PlatformArtifact, ProbeResult, ProbeStatus } from "./types.ts";
import type { BundleFingerprints } from "@vespera/core";

export type ReportWriteResult = {
  status: "WRITTEN" | "SKIPPED";
  jsonPath: string;
  markdownPath: string;
};

type ReportInput = PreparedHarnessRun & {
  readonly executedTransportOperations: ReadonlySet<string>;
  runtimeBundles: BundleFingerprints | null;
  outputRoot?: string;
};

type ReportOptions = { mechanicsSourceApprovalSha256?: string };
const STATUSES: ProbeStatus[] = ["PASS", "FAIL", "SKIPPED", "UNRESOLVED"];

function tuple(result: ProbeResult): string {
  return `${result.suite}\u0000${result.id}\u0000${result.category ?? "null"}\u0000${result.contractSha256 ?? ""}`;
}

function validateFormulaResults(results: readonly ProbeResult[]): void {
  const formulaResults = results.filter((result) => result.suite === "formulas");
  const seen = new Set<string>();
  for (const result of formulaResults) {
    const contract = probeContract(result.suite, result.id);
    if (!contract) throw new Error(`unknown mechanics probe contract ${result.suite}.${result.id}`);
    if (result.contractSha256 !== contract.contractSha256) {
      throw new Error(`mismatched contractSha256 for ${result.suite}.${result.id}`);
    }
    const key = tuple(result);
    if (seen.has(key)) throw new Error(`duplicate mechanics probe tuple ${key}`);
    seen.add(key);
    if (result.category !== contract.category) throw new Error(`category mismatch for ${result.suite}.${result.id}`);
    if (!result.cases || result.cases.length !== contract.cases.length) {
      throw new Error(`case grid mismatch for ${result.suite}.${result.id}`);
    }
    for (const [index, declared] of contract.cases.entries()) {
      const observed = result.cases[index];
      if (!observed || observed.id !== declared.id || canonicalJson(observed.input) !== canonicalJson(declared.input) || canonicalJson(observed.expected) !== canonicalJson(declared.expected)) {
        throw new Error(`case declaration mismatch for ${result.suite}.${result.id}`);
      }
      if (result.status === "PASS" && (canonicalJson(observed.firstObserved) !== canonicalJson(observed.secondObserved) || canonicalJson(observed.firstObserved) !== canonicalJson(observed.expected))) {
        throw new Error(`probe observations do not match for ${result.suite}.${result.id}.${declared.id}`);
      }
    }
  }
  if (formulaResults.length === 0) return;
  const expected = new Set(MECHANIC_PROBE_CONTRACTS.map((contract) => `${contract.suite}\u0000${contract.id}\u0000${contract.category ?? "null"}\u0000${contract.contractSha256}`));
  const actual = new Set(formulaResults.map(tuple));
  if (actual.size !== expected.size || [...expected].some((entry) => !actual.has(entry))) {
    throw new Error("formula coverage is missing, extra, or duplicated");
  }
}

function requiredProbeKey(ref: { suite: string; id: string; category: string | null; contractSha256: string }): string {
  return `${ref.suite}\u0000${ref.id}\u0000${ref.category ?? "null"}\u0000${ref.contractSha256}`;
}

function deriveMechanics(input: ReportInput, results: readonly ProbeResult[]) {
  const passed = new Map<string, ProbeResult>();
  for (const result of results) {
    if (result.status !== "PASS" || result.suite !== "formulas") continue;
    passed.set(tuple(result), result);
  }
  return input.mechanics.map((mechanic) => {
    const requiredProbes = [...mechanic.requiredProbes];
    const passedProbes = requiredProbes.filter((probe) => passed.has(requiredProbeKey(probe)));
    return { id: mechanic.id, requiredProbes, passedProbes };
  });
}

function runtimeVersions(): { bun: string; node: string; chrome: string } {
  return {
    bun: typeof Bun.version === "string" ? Bun.version : "unknown",
    node: process.versions.node,
    chrome: process.env.VESPERA_CHROME_VERSION ?? "unknown",
  };
}

function platformArtifacts(): PlatformArtifact[] {
  const artifactPaths = runtimeArtifactPaths();
  const paths: { role: PlatformArtifact["role"]; file: string }[] = [
    { role: "bun", file: process.execPath },
    { role: "node", file: process.execPath },
    { role: "game-runtime", file: process.env.VESPERA_GAME_RUNTIME ?? artifactPaths.gameRuntime },
    { role: "crossover-launcher", file: process.env.VESPERA_CROSSOVER_WINE ?? artifactPaths.crossoverLauncher },
  ];
  const seen = new Set<string>();
  const artifacts: PlatformArtifact[] = [];
  for (const entry of paths) {
    if (seen.has(entry.role) || !entry.file || !existsSync(entry.file)) continue;
    seen.add(entry.role);
    artifacts.push({ role: entry.role, sha256: sha256Hex(new Uint8Array(readFileSync(entry.file))) });
  }
  return artifacts;
}

/**
 * Which harness transport operations actually executed.
 *
 * Coverage records that an operation ran and behaved, not that a probe agreed with its expectation. Folding
 * a probe disagreement into coverage would report the platform as broken whenever the game's balance moved,
 * which is the opposite of what the aggregate is for.
 */
function externalLeafCoverage(
  executed: ReadonlySet<string>,
  launched: boolean,
): EvidenceReport["externalLeafCoverage"] {
  return allExternalLeafCoverageIds()
    .filter((id) => id.startsWith("harness."))
    .map((id) => {
      if (!launched) return { id, status: "SKIPPED" as const, detail: "Harness launch skipped" };
      if (executed.has(id)) {
        return { id, status: "PASS" as const, detail: "Executed by the harness transport" };
      }
      return { id, status: "FAIL" as const, detail: "The harness never exercised this operation" };
    });
}

function markdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", "<br>");
}

function atomicWrite(file: string, bytes: Uint8Array): void {
  const temporary = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  const descriptor = openSync(temporary, "wx", 0o644);
  try {
    writeSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  try {
    renameSync(temporary, file);
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* The original error is more useful. */ }
    throw error;
  }
}

function canonicalRanAt(): string {
  const value = new Date().toISOString();
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) throw new Error(`invalid evidence timestamp ${value}`);
  return value;
}

export function writeReports(
  input: ReportInput,
  results: ProbeResult[],
  options: ReportOptions = {},
): ReportWriteResult {
  const jsonPath = path.join(input.outputRoot ?? ".", "evidence", input.buildId, "runtime-evidence.json");
  const markdownPath = path.join(input.outputRoot ?? ".", "docs", `RUNTIME-EVIDENCE-${input.buildId}.md`);
  if (results.length > 0 && results.every((result) => result.status === "SKIPPED")) {
    console.log(`SKIPPED runtime evidence for build ${input.buildId}`);
    return { status: "SKIPPED", jsonPath, markdownPath };
  }
  if (options.mechanicsSourceApprovalSha256 && options.mechanicsSourceApprovalSha256 !== input.mechanicsSourceApprovalSha256) {
    throw new Error("mechanics-source approval mismatch");
  }
  validateFormulaResults(results);
  const ranAt = canonicalRanAt();
  const report: EvidenceReport = {
    schemaVersion: 2,
    buildId: input.buildId,
    ranAt,
    extractedBundles: input.extractedBundles,
    runtimeBundles: input.runtimeBundles,
    probeRuntimeSha256: PROBE_RUNTIME_SHA256,
    mechanicsSourceApprovalSha256: input.mechanicsSourceApprovalSha256,
    runtimeVersions: runtimeVersions(),
    platformArtifacts: platformArtifacts(),
    externalLeafCoverage: externalLeafCoverage(input.executedTransportOperations, input.runtimeBundles !== null),
    mechanics: deriveMechanics(input, results),
    results,
  };
  const jsonBytes = new TextEncoder().encode(`${JSON.stringify(report, null, 2)}\n`);
  const counts = Object.fromEntries(STATUSES.map((status) => [status, results.filter((result) => result.status === status).length])) as Record<ProbeStatus, number>;
  const rows = results.map((result) => `| ${markdownCell(result.suite)} | ${markdownCell(result.id)} | ${result.status} | ${markdownCell(result.detail)} |`).join("\n");
  const markdown = `# Runtime evidence — build ${input.buildId}\n\nRan at: ${ranAt}\n\nSource captured\n\nPASS ${counts.PASS} · FAIL ${counts.FAIL} · SKIPPED ${counts.SKIPPED} · UNRESOLVED ${counts.UNRESOLVED}\n\n| Suite | Probe | Status | Detail |\n|---|---|---|---|\n${rows}\n`;
  mkdirSync(path.dirname(jsonPath), { recursive: true });
  mkdirSync(path.dirname(markdownPath), { recursive: true });
  atomicWrite(jsonPath, jsonBytes);
  atomicWrite(markdownPath, new TextEncoder().encode(markdown));
  return { status: "WRITTEN", jsonPath, markdownPath };
}
