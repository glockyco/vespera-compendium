/**
 * The external-leaf coverage aggregate.
 *
 * Source hashing stops at declared platform leaves. Each leaf names an executable test.
 * The assignment is checked before source approval, but assignment is not execution.
 * A leaf can be listed and assigned without running.
 * This aggregate links assignment to execution. It must be present and current before review, sync, or publication.
 *
 * Two suites provide the coverage. They cannot run in one process.
 * A byte-vector command exercises Node and Bun primitives.
 * The harness exercises WebSocket and CDP operations because only a real browser can demonstrate them.
 * Neither suite is complete alone. The aggregate requires both and stores each input's exact bytes.
 */

import path from "node:path";
import {
  allExternalLeafCoverageIds,
  canonicalJson,
  canonicalSha256,
  externalLeafSuite,
  sha256Hex,
  withoutMember,
  type CanonicalJson,
} from "@vespera/core";

export type CoverageRow = { id: string; status: "PASS" | "FAIL" | "SKIPPED"; detail: string };

export type NodeCoverageArtifact = {
  version: 1;
  suite: "node";
  passed: string[];
  skipped: string[];
  failed: string[];
  /** Harness-owned ids are absent, not skipped. This suite cannot run them. */
  absent: string[];
  mechanicsSourceApprovalSha256: string;
  runtimeVersions: { bun: string; node: string };
  platformArtifacts: { role: "bun" | "node"; sha256: string }[];
};

export type ExternalLeafApproval = {
  version: 1;
  mechanicsSourceApprovalSha256: string;
  runtimeVersions: { bun: string; node: string; chrome: string };
  platformArtifacts: { role: string; sha256: string }[];
  coverage: CoverageRow[];
  nodeArtifactSha256: string;
  harnessArtifactSha256: string;
  approvalSha256: string;
};

function asRecord(value: unknown, detail: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`expected a JSON object: ${detail}`);
  }
  return value as Record<string, unknown>;
}

/**
 * Read the node suite outcome arrays into coverage rows.
 *
 * The suite reports `passed`, `failed`, `skipped`, and `absent` in separate arrays.
 * "Absent" is a real state with a different meaning.
 * A harness-owned id is not skipped by this suite. This suite cannot run it.
 * Drop absent ids here. The harness must provide them.
 */
function parseNodeOutcome(record: Record<string, unknown>): CoverageRow[] {
  const read = (key: "passed" | "skipped" | "failed"): string[] => {
    const value = record[key];
    if (!Array.isArray(value)) throw new Error(`the node coverage artifact has no ${key} array`);
    return value.map((entry) => {
      if (typeof entry !== "string") throw new Error(`the node coverage artifact has a non-string ${key} id`);
      return entry;
    });
  };
  return [
    ...read("passed").map((id) => ({ id, status: "PASS" as const, detail: "Executed by the node suite" })),
    ...read("skipped").map((id) => ({ id, status: "SKIPPED" as const, detail: "Skipped by the node suite" })),
    ...read("failed").map((id) => ({ id, status: "FAIL" as const, detail: "Failed in the node suite" })),
  ];
}

function parseCoverage(value: unknown, detail: string): CoverageRow[] {
  if (!Array.isArray(value)) throw new Error(`${detail} has no coverage array`);
  return value.map((entry) => {
    const record = asRecord(entry, `${detail} coverage row`);
    if (typeof record.id !== "string") throw new Error(`${detail} has a coverage row with no id`);
    const status = record.status;
    if (status !== "PASS" && status !== "FAIL" && status !== "SKIPPED") {
      throw new Error(`${detail} coverage row ${record.id} has the unknown status ${String(status)}`);
    }
    return { id: record.id, status, detail: typeof record.detail === "string" ? record.detail : "" };
  });
}

/**
 * Merge the two coverage inputs and require the exact assigned ID set with every id passing.
 *
 * This function is the only aggregate writer.
 * It stores the exact bytes of both inputs, so replacement after approval is detectable.
 * It rejects a skipped row. A skip is honest suite reporting, but it is not coverage.
 */
export function verifyExternalLeafEvidence(input: {
  nodeBytes: Uint8Array;
  harnessBytes: Uint8Array;
  mechanicsSourceApprovalSha256: string;
  commit: (bytes: Uint8Array) => void;
}): ExternalLeafApproval {
  const nodeParsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input.nodeBytes));
  const nodeRecord = asRecord(nodeParsed, "the node coverage artifact");
  if (nodeRecord.version !== 1) throw new Error("the node coverage artifact must be version 1");
  const nodeCoverage = parseNodeOutcome(nodeRecord);
  if (nodeRecord.mechanicsSourceApprovalSha256 !== input.mechanicsSourceApprovalSha256) {
    throw new Error(
      `the node coverage artifact was produced against source approval ${String(nodeRecord.mechanicsSourceApprovalSha256)}, the current approval is ${input.mechanicsSourceApprovalSha256}`,
    );
  }

  const harnessParsed: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(input.harnessBytes),
  );
  const harnessRecord = asRecord(harnessParsed, "the runtime evidence report");
  if (harnessRecord.schemaVersion !== 2) throw new Error("the runtime evidence report must be schema version 2");
  const harnessCoverage = parseCoverage(harnessRecord.externalLeafCoverage, "the runtime evidence report");
  if (harnessRecord.mechanicsSourceApprovalSha256 !== input.mechanicsSourceApprovalSha256) {
    throw new Error("the runtime evidence report was produced against a different source approval");
  }

  const expected = allExternalLeafCoverageIds();
  const byId = new Map<string, CoverageRow>();
  for (const [rows, suiteName] of [
    [nodeCoverage, "node"],
    [harnessCoverage, "harness"],
  ] as const) {
    for (const row of rows) {
      // A suite that reports an unowned id can claim a capability that it did not exercise. Splitting the aggregate prevents this error.
      if (externalLeafSuite(row.id) !== suiteName) {
        throw new Error(`coverage id ${row.id} was reported by the ${suiteName} suite, which does not own it`);
      }
      if (byId.has(row.id)) throw new Error(`coverage id ${row.id} was reported twice`);
      byId.set(row.id, row);
    }
  }
  const failures: string[] = [];
  const missing = expected.filter((id) => !byId.has(id));
  const extra = [...byId.keys()].filter((id) => !expected.includes(id));
  if (missing.length > 0) failures.push(`missing coverage: ${missing.join(", ")}`);
  if (extra.length > 0) failures.push(`unassigned coverage: ${extra.join(", ")}`);
  for (const id of expected) {
    const row = byId.get(id);
    if (row && row.status !== "PASS") failures.push(`coverage ${id} is ${row.status}: ${row.detail}`);
  }
  if (failures.length > 0) {
    throw new Error(`external leaf coverage is incomplete\n${failures.join("\n")}`);
  }

  const runtimeVersions = asRecord(harnessRecord.runtimeVersions, "the runtime evidence versions");
  const nodeVersions = asRecord(nodeRecord.runtimeVersions, "the node coverage versions");
  for (const key of ["bun", "node"] as const) {
    if (nodeVersions[key] !== runtimeVersions[key]) {
      throw new Error(
        `the two coverage inputs disagree about the ${key} version (${String(nodeVersions[key])} and ${String(runtimeVersions[key])})`,
      );
    }
  }

  const platformArtifacts = [
    ...(Array.isArray(nodeRecord.platformArtifacts) ? nodeRecord.platformArtifacts : []),
    ...(Array.isArray(harnessRecord.platformArtifacts) ? harnessRecord.platformArtifacts : []),
  ]
    .map((entry) => {
      const record = asRecord(entry, "a platform artifact");
      if (typeof record.role !== "string" || typeof record.sha256 !== "string") {
        throw new Error("a platform artifact is malformed");
      }
      return { role: record.role, sha256: record.sha256 };
    })
    .filter((entry, index, all) => all.findIndex((other) => other.role === entry.role) === index)
    .sort((left, right) => (left.role < right.role ? -1 : 1));

  const body = {
    version: 1 as const,
    mechanicsSourceApprovalSha256: input.mechanicsSourceApprovalSha256,
    runtimeVersions: {
      bun: String(runtimeVersions.bun),
      node: String(runtimeVersions.node),
      chrome: String(runtimeVersions.chrome),
    },
    platformArtifacts,
    coverage: expected.map((id) => byId.get(id)!),
    nodeArtifactSha256: sha256Hex(input.nodeBytes),
    harnessArtifactSha256: sha256Hex(input.harnessBytes),
  };
  const approval: ExternalLeafApproval = {
    ...body,
    approvalSha256: canonicalSha256(body as unknown as CanonicalJson),
  };
  input.commit(new TextEncoder().encode(`${canonicalJson(approval as unknown as CanonicalJson)}\n`));
  return approval;
}

/** Parse and check the aggregate. */
export function parseExternalLeafApproval(bytes: Uint8Array): ExternalLeafApproval {
  const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  const record = asRecord(parsed, "the external leaf approval");
  if (record.version !== 1) throw new Error("the external leaf approval must be version 1");
  if (typeof record.approvalSha256 !== "string") throw new Error("the external leaf approval has no hash");
  const approval = record as unknown as ExternalLeafApproval;
  const recomputed = canonicalSha256(withoutMember(record, "approvalSha256"));
  if (recomputed !== approval.approvalSha256) {
    throw new Error(`the external leaf approval records ${approval.approvalSha256} but hashes to ${recomputed}`);
  }
  return approval;
}

/**
 * Store the aggregate for one build.
 *
 * Store it beside the runtime report that it binds.
 * The two files are meaningful only together.
 */
export function externalLeafApprovalPath(evidenceRoot: string, buildId: string): string {
  return path.join(evidenceRoot, buildId, "external-leaves-approved.json");
}
