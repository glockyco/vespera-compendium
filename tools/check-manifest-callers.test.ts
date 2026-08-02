import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { checkManifestCallers } from "./check-manifest-callers";

function fixture(): string { return mkdtempSync(path.join(os.tmpdir(), "vespera-manifest-callers-")); }
function put(root: string, file: string, source: string): void {
  const target = path.join(root, "site", "src", file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, source);
}
function codes(root: string): Set<string> { return new Set(checkManifestCallers(root).map((item) => item.code)); }

describe("checkManifestCallers", () => {
  test("keeps the five raw I/O owners and rejects direct aliases and dynamic paths", () => {
    const root = fixture();
    try {
      put(root, "lib/manifest.ts", `export type Manifest = { schemaVersion: 3 };\nconst MANIFEST_URL = "/data/index.json";\nexport async function fetchManifest(): Promise<Manifest> { return (await fetch(MANIFEST_URL)).json(); }`);
      put(root, "lib/client/search-index.ts", `export async function loadSearchIndex() { return fetch("/data/search_index.json"); }`);
      put(root, "lib/client/sql.ts", `export async function open() { return fetch("/data/vespera.sqlite"); }`);
      put(root, "lib/server/dataset.ts", `import { readFileSync } from "node:fs"; export function readPublishedSnapshotFile(capability: { root: string }, name: string) { return readFileSync(path.join(capability.root, name), "utf8"); }`);
      put(root, "routes/bad.ts", `const request = fetch; export async function direct() { await fetch("/data/index.json"); await request("/data/index.json"); const url = "/data/index.json"; await fetch(url); }`);
      const found = codes(root);
      expect(found.has("RAW_IO_NOT_ALLOWED")).toBe(true);
      expect(found.has("DIRECT_MANIFEST_READ")).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("resolves $lib imports and distinguishes data props from manifest reads", () => {
    const root = fixture();
    try {
      mkdirSync(path.join(root, "site", ".svelte-kit"), { recursive: true });
      writeFileSync(path.join(root, "site", ".svelte-kit", "tsconfig.json"), JSON.stringify({ compilerOptions: { paths: { "$lib": ["../src/lib"], "$lib/*": ["../src/lib/*"] } } }));
      put(root, "lib/manifest.ts", `export type Manifest = { schemaVersion: 3 }; export function fetchManifest() { return fetch("/data/index.json"); }`);
      put(root, "routes/+layout.svelte", `<script lang="ts">let { data }: { data: { schemaVersion: number } } = $props();</script><span>{data.schemaVersion}</span>`);
      put(root, "routes/query/+page.svelte", `<script lang="ts">import { fetchManifest } from "$lib/manifest"; const value = fetchManifest();</script>`);
      put(root, "routes/literal.svelte", `<script lang="ts">const value = import("./local"); const bad = import(name);</script>`);
      const found = checkManifestCallers(root);
      expect(found.some((item) => item.code === "UNKNOWN_MANIFEST_CONSUMER" && item.file.endsWith("+layout.svelte"))).toBe(false);
      expect(found.some((item) => item.code === "DYNAMIC_IMPORT")).toBe(true);
      expect(found.some((item) => item.code === "RAW_IO_NOT_ALLOWED")).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("requires capability validation at the dataset read edge", () => {
    const root = fixture();
    try {
      put(root, "lib/server/dataset.ts", `import { readFileSync } from "node:fs"; export function readPublishedSnapshotFile(capability: { root: string }, name: string) { return readFileSync(path.join(capability.root, name), "utf8"); }`);
      expect(codes(root).has("RAW_IO_NOT_ALLOWED")).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  test("rejects local schema-2 types and unknown semantic consumers", () => {
    const root = fixture();
    try {
      put(root, "lib/manifest.ts", `export type Manifest = { schemaVersion: 3 }; export const schemaVersion = 3;`);
      put(root, "routes/unknown.svelte", `<script lang="ts">type Manifest = { schemaVersion: number }; const value: Manifest = { schemaVersion: 2 }; export const state = value.schemaVersion;</script>`);
      const found = codes(root);
      expect(found.has("LOCAL_MANIFEST_TYPE")).toBe(true);
      expect(found.has("STALE_SCHEMA_VERSION")).toBe(true);
      expect(found.has("UNKNOWN_MANIFEST_CONSUMER")).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
