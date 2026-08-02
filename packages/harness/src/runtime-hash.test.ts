import { describe, expect, test } from "bun:test";
import { checkProbeRuntime } from "../../../tools/check-probe-runtime.ts";

describe("probe runtime closure checker", () => {
  test("rejects an injected stale approval hash", () => {
    expect(() => checkProbeRuntime(process.cwd(), "0".repeat(64))).toThrow();
  });
});
