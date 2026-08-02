/**
 * Selects a generated art file for a component.
 *
 * The published `image` column stays the canonical path. It spans 1024 to 1536 px.
 * That size fits a hero panorama but is too large for a 32 px row thumbnail.
 * Each component selects a generated derivative instead of guessing from a CSS box.
 *
 * The kind and variant matrix matches `VARIANTS_BY_KIND` in the pipeline's `images.ts`.
 * The site restates it because it cannot import pipeline code.
 * The emitted-data gate compares both matrices. A mismatch fails the build.
 */

export type ArtKind = "general" | "class" | "zone";
export type ArtVariant = "thumb" | "card" | "portrait" | "wide" | "hero";

const VARIANTS_BY_KIND: Record<ArtKind, readonly ArtVariant[]> = {
  general: ["thumb", "card"],
  class: ["thumb", "card", "portrait"],
  zone: ["thumb", "card", "wide", "hero"],
};

/**
 * Returns the URL of one generated variant.
 *
 * The function throws instead of using the canonical file. Callers pass literal props.
 * Routes are prerendered. A fallback sends a 1.2 MB panorama to a 32 px box.
 */
export function artVariantUrl(kind: ArtKind, variant: ArtVariant, image: string): string {
  const allowed = VARIANTS_BY_KIND[kind];
  if (!allowed.includes(variant)) {
    throw new Error(
      `Art variant "${variant}" is not generated for kind "${kind}" (allowed: ${allowed.join(", ")})`,
    );
  }
  // Published paths use `images/<relative>`. The art tree uses `/game/`.
  const relative = image.replace(/^images\//, "");
  const webp = relative.replace(/\.[^./]+$/, ".webp");
  return `/game/variants/${variant}/${webp}`;
}
