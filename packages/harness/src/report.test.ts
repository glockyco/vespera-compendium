import { describe, expect, test } from "bun:test";
import { MECHANIC_PROBE_CONTRACTS, allExternalLeafCoverageIds } from "@vespera/core";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeReports } from "./report.ts";
import type { PreparedHarnessRun, ProbeResult } from "./types.ts";

const bundles = {
  indexHtml: { filename: "index.html", bytes: 1, sha256: "a".repeat(64) },
  index: { filename: "index.js", bytes: 1, sha256: "b".repeat(64) },
  gameView: { filename: "game.js", bytes: 1, sha256: "c".repeat(64) },
};

function input(root: string): PreparedHarnessRun & {
  runtimeBundles: typeof bundles;
  executedTransportOperations: ReadonlySet<string>;
} {
  return {
    buildId: "synthetic",
    extractedSnapshotPath: root,
    extractedBundles: bundles,
    runtimeBundles: bundles,
    executedTransportOperations: EXERCISED,
    mechanicsSourceApprovalSha256: "d".repeat(64),
    documents: [],
    mechanics: [],
    outputRoot: root,
  };
}

function results(): ProbeResult[] {
  return MECHANIC_PROBE_CONTRACTS.map((contract) => ({
    buildId: "synthetic",
    id: contract.id,
    suite: contract.suite,
    category: contract.category,
    status: "PASS" as const,
    detail: "synthetic",
    contractSha256: contract.contractSha256,
    cases: contract.cases.map((declared) => ({
      id: declared.id,
      input: declared.input,
      expected: declared.expected,
      firstObserved: declared.expected,
      secondObserved: declared.expected,
    })),
  }));
}

/**
 * Every harness-owned coverage ID that a fully exercised session reports.
 *
 * The report must not invent coverage. The test passes the same set that the CDP transport passes.
 */
const EXERCISED: ReadonlySet<string> = new Set(
  allExternalLeafCoverageIds().filter((id) => id.startsWith("harness.")),
);

describe("evidence report", () => {
  test("writes schema 2 atomically with source capture wording", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "vespera-report-"));
    try {
      const result = writeReports(input(root), results());
      expect(result.status).toBe("WRITTEN");
      const markdown = readFileSync(result.markdownPath, "utf8");
      expect(markdown).toContain("Source captured");
      expect(markdown).not.toContain("Source checked");
      const report = JSON.parse(readFileSync(result.jsonPath, "utf8")) as { schemaVersion?: number; results?: ProbeResult[] };
      expect(report.schemaVersion).toBe(2);
      expect(report.results?.every((entry) => entry.cases && entry.cases.length > 0)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects unknown contract hashes before writing", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "vespera-report-"));
    try {
      const altered = results();
      altered[0] = { ...altered[0]!, contractSha256: "e".repeat(64) };
      expect(() => writeReports(input(root), altered)).toThrow(/contractSha256/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
