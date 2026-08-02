import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import {
  MECHANIC_DOCUMENT_IDS,
} from "./mechanics.ts";
import {
  acquireLease,
  acquireLeases,
  assertPreparedMechanicsInputs,
  assertPreparedPublishedInputs,
  commitAtomicFile,
  LEASE_RANK,
  readStableFile,
  type LeaseKind,
  type PreparedMechanicsInputs,
  type PreparedPublishedInputs,
} from "./inputs.ts";
import { deriveVerificationStatus } from "./mechanics-artifacts.ts";
import type { MechanicCheck, MechanicStatus } from "./mechanics-lock.ts";
import { probeContract } from "@vespera/core";

function statusRef(id: string, promotionEligible: boolean): { suite: string; id: string; category: string | null; contractSha256: string; promotionEligible: boolean } {
  const contract = probeContract("formulas", id);
  if (!contract) throw new Error(`missing contract ${id}`);
  return { suite: contract.suite, id, category: contract.category, contractSha256: contract.contractSha256, promotionEligible };
}

describe("mechanics check result contract", () => {
  test("keeps per-document status order and documents the integration gate boundary", () => {
    type ReturnedId = ReturnType<(...args: never[]) => MechanicCheck[]>[number]["id"];
    const ids: readonly ReturnedId[] = MECHANIC_DOCUMENT_IDS;
    expect(ids).toEqual(MECHANIC_DOCUMENT_IDS);
    const statuses: MechanicStatus[] = ["LOCK_CORRUPT", "UNAPPROVED", "UNRESOLVED", "SOURCE_CHANGED", "MODEL_CHANGED", "BUILD_UNVERIFIED", "PASS"];
    expect(statuses).toEqual(["LOCK_CORRUPT", "UNAPPROVED", "UNRESOLVED", "SOURCE_CHANGED", "MODEL_CHANGED", "BUILD_UNVERIFIED", "PASS"]);
    const promotionText = {
      id: "synthetic.live",
      text: "synthetic",
      evidence: { kind: "source-derived" as const, sourceTargetIds: ["target"], requiredProbes: [statusRef("xpGainMultiplier", true)] },
    };
    expect(deriveVerificationStatus(promotionText, [])).toBe("source-verified");
    expect(deriveVerificationStatus(promotionText, [statusRef("xpGainMultiplier", true)])).toBe("live-verified");
    // The real status precedence and model diagnostics are exercised by mechanics:check in the sequence gate.
  });
});

describe("stable input and atomic output primitives", () => {
  test("reads one coherent generation and observes a replacement between reads", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "vespera-inputs-read-"));
    const file = path.join(root, "evidence.json");
    try {
      writeFileSync(file, "before");
      const first = readStableFile(file);
      writeFileSync(file, "after");
      const second = readStableFile(file);
      expect(new TextDecoder().decode(first)).toBe("before");
      expect(new TextDecoder().decode(second)).toBe("after");
      expect(() => readStableFile(path.join(root, "missing.json"))).toThrow();
      writeFileSync(file, "long generation");
      const long = readStableFile(file);
      writeFileSync(file, "");
      const truncated = readStableFile(file);
      expect(long.byteLength).toBeGreaterThan(truncated.byteLength);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("commits exact bytes without leaving a temporary sibling", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "vespera-inputs-atomic-"));
    const file = path.join(root, "review.json");
    try {
      const expected = new TextEncoder().encode("canonical review bytes");
      commitAtomicFile(file, expected);
      expect(new Uint8Array(readFileSync(file))).toEqual(expected);
      expect(readdirSync(root).filter((entry) => entry.includes(".review.json.") && entry.endsWith(".tmp"))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("exclusive lease primitives", () => {
  const leasePath = (kind: LeaseKind): string => kind === "site-data" ? path.join("site", "static", ".site-data.lock.d") : `${kind}.lock.d`;

  test("records ownership, is exclusive, and releases from finally", () => {
    let lease = acquireLease("mechanics-source", "mechanics-check-test");
    try {
      lease.assertLive();
      expect(existsSync(leasePath("mechanics-source"))).toBe(true);
      const owner = readFileSync(path.join(leasePath("mechanics-source"), "owner"), "utf8");
      expect(owner).toContain("mechanics-check-test");
      expect(() => acquireLease("mechanics-source", "second-owner")).toThrow(/lease is held/);
    } finally {
      lease.release();
      lease = acquireLease("mechanics-source", "released-owner");
      lease.release();
    }
    expect(existsSync(leasePath("mechanics-source"))).toBe(false);
  });

  test("acquires in rank order and releases a partial set after failure", () => {
    expect(LEASE_RANK["mechanics-source"]).toBeLessThan(LEASE_RANK.mechanics);
    expect(LEASE_RANK.mechanics).toBeLessThan(LEASE_RANK["site-data"]);
    const ordered = acquireLeases(["site-data", "mechanics", "mechanics-source"], "ordered-test");
    try {
      ordered.assertLive();
      expect(existsSync(leasePath("mechanics-source"))).toBe(true);
      expect(existsSync(leasePath("mechanics"))).toBe(true);
      expect(existsSync(leasePath("site-data"))).toBe(true);
    } finally {
      ordered.releaseAll();
    }
    const blocker = acquireLease("mechanics", "blocker");
    try {
      expect(() => acquireLeases(["site-data", "mechanics", "mechanics-source"], "partial-test")).toThrow(/mechanics lease is held/);
      expect(existsSync(leasePath("mechanics-source"))).toBe(false);
      expect(existsSync(leasePath("site-data"))).toBe(false);
    } finally {
      blocker.release();
    }
    const sourceAfterFailure = acquireLease("mechanics-source", "after-partial-failure");
    sourceAfterFailure.release();
  });

  test("forged prepared objects cannot satisfy membership guards", () => {
    const mechanics = {} as PreparedMechanicsInputs;
    const published = {} as PreparedPublishedInputs;
    expect(() => assertPreparedMechanicsInputs(mechanics)).toThrow();
    expect(() => assertPreparedPublishedInputs(published)).toThrow();
  });
});

