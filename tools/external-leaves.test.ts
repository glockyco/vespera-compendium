import { describe, expect, test } from "bun:test";
import {
  allExternalLeafCoverageIds,
  externalLeafSuite,
} from "@vespera/core";
import {
  NODE_EXTERNAL_LEAF_TESTS,
  assertNodeExternalLeafTableComplete,
  runNodeExternalLeafTests,
  type ExternalLeafTest,
} from "./external-leaves.ts";

const nodeIds = allExternalLeafCoverageIds().filter((id) => externalLeafSuite(id) === "node");
const harnessIds = allExternalLeafCoverageIds().filter((id) => externalLeafSuite(id) === "harness");

describe("external platform leaf coverage", () => {
  test("every assigned Node and Bun ID has an executable byte-vector test", async () => {
    expect(Object.keys(NODE_EXTERNAL_LEAF_TESTS).sort()).toEqual(nodeIds);
    for (const id of nodeIds) {
      const testCase = NODE_EXTERNAL_LEAF_TESTS[id];
      expect(typeof testCase).toBe("function");
      await testCase();
    }
  });

  test("runner reports exactly assigned IDs and keeps harness coverage absent", async () => {
    const artifact = await runNodeExternalLeafTests();
    expect(artifact.passed).toEqual(nodeIds);
    expect(artifact.failed).toEqual([]);
    expect(artifact.skipped).toEqual([]);
    expect(artifact.absent).toEqual(harnessIds);
    expect([...artifact.passed, ...artifact.skipped, ...artifact.failed].sort()).toEqual(nodeIds);
    expect(artifact.absent.some((id) => externalLeafSuite(id) === "node")).toBe(false);
  });

  test("missing assignment is rejected", () => {
    const table: Record<string, ExternalLeafTest> = { ...NODE_EXTERNAL_LEAF_TESTS };
    delete table[nodeIds[0]];
    expect(() => assertNodeExternalLeafTableComplete(table)).toThrow(/missing=/);
  });

  test("extra assignment is rejected", () => {
    const table: Record<string, ExternalLeafTest> = { ...NODE_EXTERNAL_LEAF_TESTS };
    table["node.synthetic.extra"] = () => undefined;
    expect(() => assertNodeExternalLeafTableComplete(table)).toThrow(/extra=/);
  });

  test("renamed assignment is rejected as missing and extra", () => {
    const table: Record<string, ExternalLeafTest> = { ...NODE_EXTERNAL_LEAF_TESTS };
    const original = nodeIds[0];
    const renamed = `${original}.renamed`;
    const testCase = table[original];
    delete table[original];
    table[renamed] = testCase;
    expect(() => assertNodeExternalLeafTableComplete(table)).toThrow(/missing=.*extra=/);
  });
});
