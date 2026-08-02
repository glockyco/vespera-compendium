import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  bundleIdentities,
  cdpResponseBytes,
  decodeBundleText,
  fingerprintBundleSources,
  fingerprintBundles,
  readBundleRoles,
  resolveBundles,
  sameBundleIdentities,
} from "./bundles.ts";
import type { RawResource } from "./bundles.ts";

const encoder = new TextEncoder();
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
  temporaryRoots.length = 0;
});

const htmlBytes = encoder.encode('<html><script>window.__VESPERA_FEATURE_FLAGS__ = true</script><div id="root"></div></html>');
const indexBytes = encoder.encode(
  "GRANDWORKS_ENABLED; function getItemSellValue() {}; function getIncomingDefenseMitigation() {};",
);
const gameViewBytes = encoder.encode("codex.math.normalMitigation; guide.endgame.routeTitle;");

function extracted(
  names: { index: string; gameView: string } = { index: "renamed-core.js", gameView: "view.js" },
  includeGameView = true,
  extra: Record<string, Uint8Array> = {},
): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "vespera-bundles-"));
  temporaryRoots.push(root);
  mkdirSync(path.join(root, "assets"), { recursive: true });
  writeFileSync(path.join(root, "index.html"), htmlBytes);
  writeFileSync(path.join(root, "assets", names.index), indexBytes);
  if (includeGameView) writeFileSync(path.join(root, "assets", names.gameView), gameViewBytes);
  for (const [name, bytes] of Object.entries(extra)) writeFileSync(path.join(root, "assets", name), bytes);
  return root;
}

function resources(index = indexBytes, gameView = gameViewBytes): RawResource[] {
  return [
    { url: "https://game.invalid/index.html?cache=2", bytes: htmlBytes },
    { url: "https://game.invalid/assets/chunk-renamed.js", bytes: index },
    { url: "https://game.invalid/assets/view-renamed.js", bytes: gameView },
  ];
}

describe("bundle byte identities", () => {
  test("disk and raw response fingerprints agree for identical bytes", () => {
    const root = extracted({ index: "chunk-renamed.js", gameView: "view-renamed.js" });
    const disk = fingerprintBundles(root);
    const raw = fingerprintBundleSources(resources());
    expect(disk.index.bytes).toBe(raw.index.bytes);
    expect(disk.index.sha256).toBe(raw.index.sha256);
    expect(disk.gameView.sha256).toBe(raw.gameView.sha256);
    expect(disk.indexHtml.sha256).toBe(raw.indexHtml.sha256);
    expect(sameBundleIdentities(disk, raw)).toBe(true);
  });

  test("CDP base64 and text bodies preserve exact bytes", () => {
    const bytes = encoder.encode("bundle bytes");
    const binary = String.fromCharCode(...bytes);
    const base64 = btoa(binary);
    expect([...cdpResponseBytes(base64, true)]).toEqual([...bytes]);
    expect([...cdpResponseBytes("Grüße ☃", false)]).toEqual([...encoder.encode("Grüße ☃")]);
  });

  test("UTF-8 BOM bytes round-trip without being discarded", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x47, 0x61, 0x6d, 0x65]);
    expect(decodeBundleText(bytes, "bom fixture")).toBe("\ufeffGame");
    expect(() => decodeBundleText(new Uint8Array([0xc3, 0x28]), "invalid fixture")).toThrow(/not valid UTF-8/);
  });

  test("missing and genuinely ambiguous semantic roles fail closed", () => {
    expect(() => fingerprintBundles(extracted(undefined, false))).toThrow(/gameView/);
    // Two candidates with different bytes under one role create a real ambiguity.
    // The resolver cannot know which candidate supports the claim.
    const conflicting = encoder.encode(`${new TextDecoder().decode(indexBytes)} conflicting`);
    const duplicate = extracted(undefined, true, { "second-index.js": conflicting });
    expect(() => fingerprintBundles(duplicate)).toThrow(/ambiguous index/);
  });

  test("byte-identical duplicates of one role collapse to a single identity", () => {
    // A session can serve one asset twice. Identical bytes under one role are one evidence item, not an ambiguity.
    // Rejecting them fails a role that the bytes determine.
    const twice = extracted(undefined, true, { "second-index.js": indexBytes });
    const fingerprints = fingerprintBundles(twice);
    expect(fingerprints.index.sha256).toBe(fingerprintBundles(extracted()).index.sha256);
  });

  test("changed bytes invalidate an identity even when the filename stays the same", () => {
    const original = extracted();
    const rebuilt = extracted();
    writeFileSync(path.join(rebuilt, "assets", "renamed-core.js"), encoder.encode(`${new TextDecoder().decode(indexBytes)} changed`));
    const left = fingerprintBundles(original);
    const right = fingerprintBundles(rebuilt);
    expect(left.index.filename).toBe(right.index.filename);
    expect(left.index.sha256).not.toBe(right.index.sha256);
    expect(sameBundleIdentities(left, right)).toBe(false);
  });

  test("renamed files with identical bytes have equal filename-free identities", () => {
    const left = fingerprintBundles(extracted({ index: "first.js", gameView: "view.js" }));
    const right = fingerprintBundles(extracted({ index: "second.js", gameView: "other-view.js" }));
    expect(left.index.filename).not.toBe(right.index.filename);
    expect(left.gameView.filename).not.toBe(right.gameView.filename);
    expect(sameBundleIdentities(left, right)).toBe(true);
    expect(bundleIdentities(left)).toEqual(bundleIdentities(right));
  });
});

describe("content-resolved bundle filenames", () => {
  test("resolveBundles returns semantic files rather than an index filename pattern", () => {
    const root = extracted({ index: "renamed-core.js", gameView: "view.js" });
    expect(resolveBundles(root)).toEqual({
      index: "renamed-core.js",
      gameView: "view.js",
      all: ["renamed-core.js", "view.js"],
    });
    expect(readBundleRoles(root).text.index).toContain("getItemSellValue");
  });
});
