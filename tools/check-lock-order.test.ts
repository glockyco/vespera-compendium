import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { checkLockOrder } from "./check-lock-order";

function fixture(source: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "vespera-lock-order-"));
  writeFileSync(path.join(root, "locks.ts"), source);
  return root;
}

describe("checkLockOrder", () => {
  test("accepts mechanics-source -> mechanics -> site-data", () => {
    const root = fixture(`
      function ordered() {
        acquireLease("mechanics-source");
        acquireLease("mechanics");
        acquireLease("site-data");
      }
      ordered();
    `);
    try {
      expect(checkLockOrder(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("follows inputs acquisitions through a barrel and re-export", () => {
    const root = fixture(`
      import { acquireLease as lease, acquireLeases } from "./packages/pipeline/src/index";
      function reverse() { lease("site-data", "outer"); acquireLeases(["mechanics-source", "mechanics"], "inner"); }
      reverse();
    `);
    try {
      mkdirSync(path.join(root, "packages", "pipeline", "src"), { recursive: true });
      writeFileSync(path.join(root, "packages", "pipeline", "src", "inputs.ts"), `export function acquireLease(kind: string, detail: string) { return { kind, detail }; }\nexport function acquireLeases(kinds: string[], detail: string) { return kinds.map((kind) => acquireLease(kind, detail)); }`);
      writeFileSync(path.join(root, "packages", "pipeline", "src", "index.ts"), `export * from "./inputs";`);
      expect(checkLockOrder(root).some((item) => item.code === "LOCK_ORDER")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test("does not infer acquisition from lock-like function names", () => {
    const root = fixture(`
      function serializeMechanicsLock() { return "lock"; }
      function parseMechanicsLock() { return serializeMechanicsLock(); }
      function caller() { acquireLease("mechanics-source"); parseMechanicsLock(); acquireLease("mechanics"); }
      caller();
    `);
    try {
      expect(checkLockOrder(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reports an unresolved non-literal acquisition", () => {
    const root = fixture(`
      function caller(kind: string) { acquireLease(kind); }
      caller("mechanics");
    `);
    try {
      expect(checkLockOrder(root).some((item) => item.code === "UNRESOLVED_LOCK_ACQUISITION")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reports every reverse and equal nested acquisition through calls", () => {
    const root = fixture(`
      function sourceThenSource() {
        acquireLease("mechanics-source");
        acquireLease("mechanics-source");
      }
      function child() { acquireLease("mechanics-source"); }
      function reverse() {
        acquireLease("mechanics");
        child();
      }
      function reverseTwo() {
        acquireLease("site-data");
        acquireLease("mechanics");
      }
      sourceThenSource();
      reverse();
      reverseTwo();
    `);
    try {
      const findings = checkLockOrder(root);
      expect(findings.length).toBeGreaterThanOrEqual(3);
      expect(findings.every((item) => item.code === "LOCK_ORDER")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
