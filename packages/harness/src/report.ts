import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { HarnessUnavailableError, readBuildId } from "./launch.ts";
import type { ProbeResult, ProbeStatus } from "./types.ts";

const STATUSES: ProbeStatus[] = ["PASS", "FAIL", "SKIPPED", "UNRESOLVED"];

function verifyBuildStamp(buildId: string, results: ProbeResult[]): void {
  try {
    const installed = readBuildId();
    if (installed !== buildId) {
      throw new Error(`refusing runtime evidence write: build changed from ${buildId} to ${installed}`);
    }
  } catch (error) {
    if (
      error instanceof HarnessUnavailableError &&
      buildId === "unknown" &&
      results.every((result) => result.status === "SKIPPED")
    ) {
      return;
    }
    throw error;
  }
}

const markdownCell = (value: string): string => value.replaceAll("|", "\\|").replaceAll("\n", "<br>");

export function writeReports(buildId: string, results: ProbeResult[]): { jsonPath: string; markdownPath: string } {
  verifyBuildStamp(buildId, results);
  const ranAt = new Date().toISOString();
  const dataDir = path.join("data", buildId);
  mkdirSync(dataDir, { recursive: true });
  mkdirSync("docs", { recursive: true });
  const jsonPath = path.join(dataDir, "runtime-evidence.json");
  const markdownPath = path.join("docs", `RUNTIME-EVIDENCE-${buildId}.md`);
  writeFileSync(jsonPath, `${JSON.stringify({ buildId, ranAt, results }, null, 2)}\n`);

  const counts = Object.fromEntries(
    STATUSES.map((status) => [status, results.filter((result) => result.status === status).length]),
  ) as Record<ProbeStatus, number>;
  const summary = `PASS ${counts.PASS} · FAIL ${counts.FAIL} · SKIPPED ${counts.SKIPPED} · UNRESOLVED ${counts.UNRESOLVED}`;
  const categories = [...new Set(results.map((result) => result.category ?? `${result.suite}.probe`))].sort();
  const categoryRows = categories.map((category) => {
    const categoryResults = results.filter((result) => (result.category ?? `${result.suite}.probe`) === category);
    const categoryCounts = Object.fromEntries(
      STATUSES.map((status) => [status, categoryResults.filter((result) => result.status === status).length]),
    ) as Record<ProbeStatus, number>;
    return `| ${markdownCell(category)} | ${categoryCounts.PASS} | ${categoryCounts.FAIL} | ${categoryCounts.SKIPPED} | ${categoryCounts.UNRESOLVED} |`;
  });
  const rows = results.map(
    (result) =>
      `| ${markdownCell(result.suite)} | ${markdownCell(result.category ?? `${result.suite}.probe`)} | ${markdownCell(result.id)} | ${result.status} | ${markdownCell(result.detail)} |`,
  );
  const saveResult = results.find((result) => result.suite === "save" && result.observed);
  const keyNames = (saveResult?.observed as { keyNames?: unknown } | undefined)?.keyNames;
  const saveSection = Array.isArray(keyNames)
    ? `\n## Save structure\n\nTop-level key names: ${keyNames.map(String).join(", ")}\n`
    : "";
  const markdown = `# Runtime evidence — build ${buildId}\n\nRan at: ${ranAt}\n\n${summary}\n\n## Transformation categories\n\n| Category | PASS | FAIL | SKIPPED | UNRESOLVED |\n|---|---:|---:|---:|---:|\n${categoryRows.join("\n")}\n\n## Probe details\n\n| Suite | Category | Probe | Status | Detail |\n|---|---|---|---|---|\n${rows.join("\n")}\n${saveSection}`;
  writeFileSync(markdownPath, markdown);
  return { jsonPath, markdownPath };
}
