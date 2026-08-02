import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, test } from "bun:test";
import {
  IMAGE_VARIANTS,
  VARIANTS_BY_KIND,
  artVariantConfigSha256,
  writeImages,
  type ArtKind,
  type ImageRef,
} from "./images.ts";

async function fixture(): Promise<{ root: string; out: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "vespera-images-"));
  const out = await mkdtemp(path.join(os.tmpdir(), "vespera-published-"));
  await sharp({ create: { width: 96, height: 48, channels: 4, background: { r: 60, g: 70, b: 80, alpha: 1 } } }).png().toFile(path.join(root, "source.png"));
  return { root, out };
}

function ref(kind: ArtKind): ImageRef {
  return { table: kind === "class" ? "classes" : kind === "zone" ? "zones_dungeons" : "items", id: kind, source: "source.png", published: `images/${kind}.png`, kind };
}

describe("image variants", () => {
  test("allows exactly the configured variants by art kind", () => {
    expect(VARIANTS_BY_KIND.general).toEqual(["thumb", "card"]);
    expect(VARIANTS_BY_KIND.class).toEqual(["thumb", "card", "portrait"]);
    expect(VARIANTS_BY_KIND.zone).toEqual(["thumb", "card", "wide", "hero"]);
    expect(IMAGE_VARIANTS.hero).toBe(1280);
    expect(artVariantConfigSha256()).toMatch(/^[0-9a-f]{64}$/);
  });

  test("writes deduplicated canonical art and the union of allowed generated paths", async () => {
    const { root, out } = await fixture();
    try {
      const index = await writeImages([ref("general"), ref("class"), ref("zone")], root, out);
      expect(Object.keys(index.entries)).toHaveLength(3);
      for (const kind of ["general", "class", "zone"] as ArtKind[]) {
        const entry = index.entries[`images/${kind}.png`];
        expect(entry).toBeDefined();
        for (const variant of VARIANTS_BY_KIND[kind]) {
          const generated = entry?.variants[variant];
          expect(generated).toBeDefined();
          expect(existsSync(path.join(out, generated?.path ?? ""))).toBe(true);
          expect(generated?.width).toBeLessThanOrEqual(IMAGE_VARIANTS[variant]);
          expect(generated?.height).toBeLessThanOrEqual(IMAGE_VARIANTS[variant]);
          expect(generated?.width).toBeLessThanOrEqual(entry?.source.width ?? 0);
          expect(generated?.height).toBeLessThanOrEqual(entry?.source.height ?? 0);
        }
      }
      const shared = await writeImages([
        { ...ref("general"), id: "general-shared", published: "images/shared.png" },
        { ...ref("class"), id: "class-shared", published: "images/shared.png" },
      ], root, out);
      expect(Object.keys(shared.entries["images/shared.png"]?.variants ?? {}).sort()).toEqual(["card", "portrait", "thumb"]);
      expect(existsSync(path.join(out, "images/general.png"))).toBe(true);
      expect(existsSync(path.join(out, "images/variants.json"))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(out, { recursive: true, force: true });
    }
  });

  test("reports the exact source decode failure", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "vespera-images-bad-"));
    const out = await mkdtemp(path.join(os.tmpdir(), "vespera-published-bad-"));
    try {
      await Bun.write(path.join(root, "broken.bin"), new Uint8Array([0, 1, 2, 3]));
      const broken: ImageRef = { table: "items", id: "broken", source: "broken.bin", published: "images/broken.bin", kind: "general" };
      let failure: unknown;
      try {
        await writeImages([broken], root, out);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      if (!(failure instanceof Error)) throw new Error("expected image generation to fail");
      expect(failure.message).toMatch(/^Image variant generation failed for broken\.bin: /);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(out, { recursive: true, force: true });
    }
  });
});
