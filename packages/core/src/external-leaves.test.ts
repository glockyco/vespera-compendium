import { describe, expect, test } from "bun:test";
import {
  allExternalLeafCoverageIds,
  allExternalLeafTokens,
  assertExternalLeafTestsComplete,
  externalLeafSuite,
  isExternalLeaf,
  isExternalLeafSpecifier,
  SOURCE_CLOSURE_EXTERNAL_LEAF_TESTS,
  SOURCE_CLOSURE_EXTERNAL_LEAVES,
} from "./external-leaves.ts";

describe("external leaf coverage registry", () => {
  test("accepts the shipped assignment and has exact token keys", () => {
    expect(() => assertExternalLeafTestsComplete()).not.toThrow();
    expect(Object.keys(SOURCE_CLOSURE_EXTERNAL_LEAVES).flatMap((specifier) =>
      SOURCE_CLOSURE_EXTERNAL_LEAVES[specifier]!.map((symbol) => `${specifier}#${symbol}`),
    ).sort()).toEqual(Object.keys(SOURCE_CLOSURE_EXTERNAL_LEAF_TESTS).sort());
  });

  test("assigns every leaf at least one coverage id", () => {
    for (const [token, ids] of Object.entries(SOURCE_CLOSURE_EXTERNAL_LEAF_TESTS)) {
      expect(ids.length, token).toBeGreaterThan(0);
      for (const id of ids) expect(id.length, token).toBeGreaterThan(0);
    }
  });

  test("routes harness coverage to harness and other coverage to node", () => {
    expect(externalLeafSuite("harness.cdp.runtime.evaluate")).toBe("harness");
    expect(externalLeafSuite("node.fs.readFile.bytes")).toBe("node");
    expect(externalLeafSuite("bun.version.semver")).toBe("node");
  });

  test("returns sorted, deduplicated coverage ids", () => {
    const ids = allExternalLeafCoverageIds();
    expect(ids).toEqual([...ids].sort());
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      [...new Set(Object.values(SOURCE_CLOSURE_EXTERNAL_LEAF_TESTS).flat())].sort(),
    );
    expect(allExternalLeafTokens()).toEqual([...allExternalLeafTokens()].sort());
  });

  test("accepts only listed specifiers and symbols", () => {
    expect(isExternalLeafSpecifier("node:fs")).toBe(true);
    expect(isExternalLeaf("node:fs", "readFileSync")).toBe(true);
    expect(isExternalLeafSpecifier("node:not-reviewed")).toBe(false);
    expect(isExternalLeaf("node:fs", "notReviewed")).toBe(false);
    expect(isExternalLeaf("not-reviewed", "readFileSync")).toBe(false);
  });
});
