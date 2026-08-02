import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { serveWithBridge } from "./bridge.ts";
import { CANONICAL_BRIDGE_SUFFIX, fingerprintBundleSources, type BundleFingerprints } from "@vespera/core";
import type { CdpClient, CdpMethod, CdpNetworkResponse, CdpPropertyDescriptor, CdpRemoteObject } from "./cdp.ts";
import { captureRuntimeBundleSources } from "./run.ts";

const bodies: Record<string, string> = {
  document: "__VESPERA_FEATURE_FLAGS__ <div id=\"root\">",
  index: "GRANDWORKS_ENABLED function getItemSellValue function getIncomingDefenseMitigation",
  gameView: "codex.math.normalMitigation guide.endgame.routeTitle",
};

const URLS: Record<string, string> = {
  document: "http://game/index.html",
  index: "http://game/assets/index.js",
  gameView: "http://game/assets/game-view.js",
};

/**
 * A fake client that replays a navigation.
 *
 * The real capture observes a load instead of querying a finished load. Chromium evicts response bodies after load.
 * The fake emits `Network.responseReceived` and `Network.loadingFinished` after `Page.navigate`.
 * It refuses a body request for a request that it never announced.
 */
function fakeClient(mutateIndex = false): CdpClient {
  const responses: CdpNetworkResponse[] = [
    { requestId: "document", url: URLS.document!, status: 200, redirect: false, finished: true },
    { requestId: "index", url: URLS.index!, status: 200, redirect: false, finished: true },
    { requestId: "gameView", url: URLS.gameView!, status: 200, redirect: false, finished: true },
  ];
  const handlers = new Map<string, ((value: unknown) => void)[]>();
  const emit = (event: string, value: unknown): void => {
    for (const handler of handlers.get(event) ?? []) handler(value);
  };
  const announced = new Set<string>();
  return {
    async send<T = unknown>(method: CdpMethod, params: Record<string, unknown> = {}): Promise<T> {
      if (method === "Network.setCacheDisabled") return undefined as T;
      if (method === "Page.navigate") {
        for (const requestId of Object.keys(URLS)) {
          announced.add(requestId);
          emit("Network.responseReceived", {
            requestId,
            response: { url: URLS[requestId]!, status: 200 },
          });
          emit("Network.loadingFinished", { requestId });
        }
        return undefined as T;
      }
      if (method !== "Network.getResponseBody") throw new Error(`unexpected ${method}`);
      const requestId = params.requestId;
      if (typeof requestId !== "string") throw new Error("missing request id");
      if (!announced.has(requestId)) throw new Error("No resource with given identifier found");
      const key = requestId === "index" && mutateIndex ? "index-mutated" : requestId;
      const body = key === "index-mutated" ? `${bodies.index}!` : bodies[key]!;
      return { body, base64Encoded: false } as T;
    },
    on(event: string, handler: (value: unknown) => void) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return () => {
        handlers.set(event, (handlers.get(event) ?? []).filter((entry) => entry !== handler));
      };
    },
    async evaluate<T = unknown>(_expression: string, _timeoutMs?: number): Promise<T> {
      return URLS.document as T;
    },
    async callFunctionOn<T = unknown>(_objectId: string, _functionDeclaration: string, _args: readonly CdpRemoteObject[], _timeoutMs?: number): Promise<T> { return null as T; },
    async getProperties(): Promise<readonly CdpPropertyDescriptor[]> { return []; },
    getNetworkResponses() { return responses; },
    getScriptsParsed() { return []; },
    executedOperations(): ReadonlySet<string> {
      return new Set<string>();
    },
    close() { return undefined; },
  };
}

describe("runtime bundle capture", () => {
  test("uses final response bodies for every semantic role", async () => {
    const captured = await captureRuntimeBundleSources(fakeClient());
    const expected = fingerprintBundleSources([
      { url: URLS.document!, bytes: new TextEncoder().encode(bodies.document) },
      { url: URLS.index!, bytes: new TextEncoder().encode(bodies.index) },
      { url: URLS.gameView!, bytes: new TextEncoder().encode(bodies.gameView) },
    ]);
    expect(captured).toEqual(expected satisfies BundleFingerprints);
  });

  test("keeps changed runtime bytes distinct", async () => {
    const captured = await captureRuntimeBundleSources(fakeClient(true));
    const clean = await captureRuntimeBundleSources(fakeClient());
    expect(captured.index.sha256).not.toBe(clean.index.sha256);
  });
  test("serves the clean index bytes followed by only the canonical suffix", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "vespera-bridge-"));
    const assets = path.join(root, "assets");
    mkdirSync(assets);
    const clean = new TextEncoder().encode(bodies.index);
    writeFileSync(path.join(root, "index.html"), bodies.document);
    writeFileSync(path.join(assets, "index.js"), clean);
    writeFileSync(path.join(assets, "game.js"), bodies.gameView);
    const bridge = await serveWithBridge(root, 0);
    try {
      const response = await fetch(`${bridge.url}/assets/index.js`);
      const served = new Uint8Array(await response.arrayBuffer());
      const suffix = new TextEncoder().encode(CANONICAL_BRIDGE_SUFFIX);
      const expected = new Uint8Array(clean.byteLength + suffix.byteLength);
      expected.set(clean);
      expected.set(suffix, clean.byteLength);
      expect(served).toEqual(expected);
    } finally {
      bridge.stop();
      rmSync(root, { recursive: true, force: true });
    }
  });

});
