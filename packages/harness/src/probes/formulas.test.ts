import { describe, expect, test } from "bun:test";
import { CANONICAL_BRIDGE_SUFFIX_SHA256, MECHANIC_PROBE_CONTRACTS } from "@vespera/core";
import type { CdpClient, CdpMethod, CdpPropertyDescriptor, CdpRemoteObject } from "../cdp.ts";
import {
  invokeRuntimeBinding,
  resolveSellRuntimeBinding,
  resolveXpRuntimeBinding,
  skippedFormulaResults,
  type RuntimeBinding,
  type RuntimeResource,
} from "./formulas.ts";

const resources: RuntimeResource[] = [
  { url: "http://game/index.js", bytes: new TextEncoder().encode("index"), sha256: "index-hash" },
];

function location(scriptId: string): CdpPropertyDescriptor[] {
  return [{ name: "[[FunctionLocation]]", value: { value: { scriptId, lineNumber: 1, columnNumber: 1 } } }];
}

function fakeClient(): CdpClient & { calls: { objectId: string; args: readonly unknown[] }[] } {
  const calls: { objectId: string; args: readonly unknown[] }[] = [];
  return {
    calls,
    async send<T = unknown>(method: CdpMethod, params: Record<string, unknown> = {}): Promise<T> {
      if (method !== "Runtime.evaluate") throw new Error(`unexpected ${method}`);
      const expression = params.expression;
      if (typeof expression !== "string") throw new Error("missing expression");
      if (expression.includes("getItemSellValue")) return { result: { objectId: "sell" } } as T;
      return { result: { objectId: "pair" } } as T;
    },
    on() { return () => undefined; },
    async evaluate<T = unknown>(_expression: string, _timeoutMs?: number): Promise<T> { return null as T; },
    async callFunctionOn<T = unknown>(_objectId: string, _functionDeclaration: string, args: readonly CdpRemoteObject[], _timeoutMs?: number): Promise<T> {
      calls.push({ objectId: _objectId, args });
      return 42 as T;
    },
    async getProperties(objectId) {
      if (objectId === "sell" || objectId === "method") return location("script");
      return [
        { name: "owner", value: { objectId: "owner" } },
        { name: "method", value: { objectId: "method" } },
      ];
    },
    getScriptsParsed() { return [{ scriptId: "script", url: "http://game/index.js" }]; },
    executedOperations(): ReadonlySet<string> {
      return new Set<string>();
    },
    close() { return undefined; },
  };
}

describe("formula runtime bindings", () => {
  test("registry and skipped results have the same four IDs and hashes", () => {
    const skipped = skippedFormulaResults("build", "no browser");
    expect(skipped.map((result) => result.id)).toEqual(MECHANIC_PROBE_CONTRACTS.map((contract) => contract.id));
    expect(skipped.map((result) => result.contractSha256)).toEqual(MECHANIC_PROBE_CONTRACTS.map((contract) => contract.contractSha256));
  });

  test("resolves a sell function and invokes its exact object ID", async () => {
    const client = fakeClient();
    const binding = await resolveSellRuntimeBinding(client, { indexBundle: "index.js", resources });
    expect(binding.objectId).toBe("sell");
    const observed = await invokeRuntimeBinding(client, binding, { baseValue: 100, rarity: "common", quantity: 1 }, [
      { value: "$.baseValue" },
      "$.rarity",
      "$.quantity",
    ]);
    expect(observed).toBe(42);
    expect(client.calls[0]?.objectId).toBe("sell");
  });

  test("XP binding preserves the owner object ID", async () => {
    const client = fakeClient();
    const binding = await resolveXpRuntimeBinding(client, { indexBundle: "index.js", resources });
    expect(binding.objectId).toBe("owner");
    expect(binding.methodName).toBe("calculateXpGain");
  });

  test("rejects a missing canonical Defense suffix", async () => {
    const client = fakeClient();
    const binding: RuntimeBinding = {
      objectId: "defense",
      kind: "function",
      methodName: null,
      scriptId: "script",
      resourceUrl: "http://game/index.js",
      moduleSha256: "index-hash",
      bridgeSuffixSha256: CANONICAL_BRIDGE_SUFFIX_SHA256,
    };
    expect(binding.bridgeSuffixSha256).toBe(CANONICAL_BRIDGE_SUFFIX_SHA256);
    expect(() => invokeRuntimeBinding(client, binding, { defense: 1, attackerLevel: 1 }, ["$.defense", "$.attackerLevel"])).not.toThrow();
  });
});
