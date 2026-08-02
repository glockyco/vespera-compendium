/**
 * Which generated art file a component may ask for, and where it lives.
 *
 * The published `image` column stays the canonical source path. It is 1024 to 1536 px, which is the
 * right file for a hero panorama and forty times too many pixels for a 32 px row thumbnail, so every
 * component picks a generated derivative instead of guessing from a CSS box size.
 *
 * The kind/variant matrix mirrors `VARIANTS_BY_KIND` in the pipeline's `images.ts`. It is restated
 * rather than imported because the site never imports pipeline code, and the emitted-data gate
 * compares the generated variant index against the same matrix, so a drift fails the build.
 */

export type ArtKind = "general" | "class" | "zone";
export type ArtVariant = "thumb" | "card" | "portrait" | "wide" | "hero";

const VARIANTS_BY_KIND: Record<ArtKind, readonly ArtVariant[]> = {
  general: ["thumb", "card"],
  class: ["thumb", "card", "portrait"],
  zone: ["thumb", "card", "wide", "hero"],
};

/**
 * The URL of one generated variant.
 *
 * Throws rather than falling back to the canonical file. Every caller passes literal props, every
 * route is prerendered, and a fallback would ship a 1.2 MB panorama into a 32 px box silently.
 */
export function artVariantUrl(kind: ArtKind, variant: ArtVariant, image: string): string {
  const allowed = VARIANTS_BY_KIND[kind];
  if (!allowed.includes(variant)) {
    throw new Error(
      `Art variant "${variant}" is not generated for kind "${kind}" (allowed: ${allowed.join(", ")})`,
    );
  }
  // Published paths are `images/<relative>`; the art tree is served from `/game/`.
  const relative = image.replace(/^images\//, "");
  const webp = relative.replace(/\.[^./]+$/, ".webp");
  return `/game/variants/${variant}/${webp}`;
}
