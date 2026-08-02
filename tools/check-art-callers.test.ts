import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { checkArtCallers } from "./check-art-callers";

function fixture(): string { return mkdtempSync(path.join(os.tmpdir(), "vespera-art-callers-")); }
function put(root: string, file: string, source: string): void {
  const target = path.join(root, "site", "src", file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, source);
}
function codes(root: string, dataDir?: string): Set<string> { return new Set(checkArtCallers(root, dataDir).map((item) => item.code)); }

describe("checkArtCallers", () => {
  test("rejects missing literals, disallowed variants, loading overrides, and misplaced HeroArt", () => {
    const root = fixture();
    try {
      put(root, "lib/components/HeroArt.svelte", `<div kind="zone" variant="hero"><img loading="eager" fetchpriority="high" /></div>`);
      put(root, "routes/+page.svelte", `<script>import Art from '$lib/components/Art.svelte'; import HeroArt from '$lib/components/HeroArt.svelte';</script><HeroArt /><Art src="images/foo.png" kind="general" variant="thumb" />`);
      put(root, "routes/bad.svelte", `<script>import Art from '$lib/components/Art.svelte'; import HeroArt from '$lib/components/HeroArt.svelte'; let kind = 'general';</script><Art src="images/foo.png" kind={kind} variant="portrait" loading="eager" /><HeroArt kind="general" variant="hero" />`);
      const found = codes(root);
      expect(found.has("ART_KIND_NOT_LITERAL")).toBe(true);
      expect(found.has("ART_VARIANT_DISALLOWED")).toBe(true);
      expect(found.has("ART_LOADING_OVERRIDE")).toBe(true);
      expect(found.has("HERO_ART_LOCATION")).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("joins a generated variant index to static calls", () => {
    const root = fixture();
    const data = path.join(root, "data");
    try {
      put(root, "lib/components/HeroArt.svelte", `<div kind="zone" variant="hero"><img loading="eager" fetchpriority="high" /></div>`);
      put(root, "routes/+page.svelte", `<script>import Art from '$lib/components/Art.svelte'; import HeroArt from '$lib/components/HeroArt.svelte';</script><HeroArt /><Art src="images/foo.png" kind="general" variant="thumb" />`);
      mkdirSync(path.join(data, "images", "variants", "thumb"), { recursive: true });
      writeFileSync(path.join(data, "images", "foo.png"), "png");
      writeFileSync(path.join(data, "images", "variants.json"), JSON.stringify({ version: 1, entries: { "foo.png": { variants: { thumb: { path: "images/variants/thumb/foo.webp", width: 64, height: 64 } } } } }));
      writeFileSync(path.join(data, "images", "variants", "thumb", "foo.webp"), "webp");
      expect(checkArtCallers(root, data)).toEqual([]);
      rmSync(path.join(data, "images", "variants", "thumb", "foo.webp"));
      expect(codes(root, data).has("VARIANT_FILE_MISSING")).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
