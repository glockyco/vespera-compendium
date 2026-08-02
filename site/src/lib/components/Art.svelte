<script lang="ts">
  import { artVariantUrl, type ArtKind, type ArtVariant } from "$lib/art";

  /**
   * The game's own artwork, in a rarity-tinted frame.
   *
   * `kind` and `variant` are required and literal at every callsite: the file a box gets is a
   * published contract checked by `check:art`, not a guess made from a CSS size. Boxes are fixed per
   * frame so a grid of several hundred cards reserves its layout before any image arrives, because
   * otherwise lazy loading reflows the page as the user scrolls. A row with no art renders lettered
   * rather than blank, since an empty frame reads as a loading failure.
   *
   * Every instance is lazy and auto priority. `HeroArt` is the one component allowed to be eager,
   * and the home hero is the one place it appears.
   *
   * The image is decorative and carries an empty alt: every place this is used renders the record's
   * name beside it, so describing the picture as well makes a screen reader announce the same name
   * twice. `alt` is still required, because it supplies the letters of the fallback.
   */
  type Box = "thumb" | "card" | "lg" | "portrait" | "wide" | "panorama";

  let {
    src,
    alt,
    kind,
    variant,
    box = null,
    rarity = null,
  }: {
    src: string | null;
    alt: string;
    kind: ArtKind;
    variant: ArtVariant;
    /** Frame preset, when the layout needs a size the variant's own frame does not give it. */
    box?: Box | null;
    rarity?: string | null;
  } = $props();

  let href = $derived(src ? artVariantUrl(kind, variant, src) : null);
  // A hero file has no same-named frame here: `HeroArt` owns the eager one, so the lazy frame that
  // holds a 1280px panorama is the full-width one.
  let frame = $derived(box ?? (variant === "hero" ? "panorama" : variant));
  let initials = $derived(
    alt
      .replace(/[^\p{L}\p{N} ]/gu, "")
      .trim()
      .slice(0, 2)
      .toUpperCase() || "??",
  );
</script>

<span class="art art-{frame}" class:art-rarity={rarity} data-rarity={rarity} aria-hidden="true">
  {#if href}
    <img src={href} alt="" loading="lazy" fetchpriority="auto" decoding="async" />
  {:else}
    <span class="art-empty">{initials}</span>
  {/if}
</span>

<style>
  .art {
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    overflow: hidden;
    border: 1px solid var(--line-soft);
    border-radius: var(--radius-art);
    background: linear-gradient(160deg, var(--art-top), var(--art-bottom));
  }

  .art img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    /* The source art is pixel-scaled game UI; smoothing it turns crisp edges to mush. */
    image-rendering: auto;
  }

  .art-thumb {
    width: 2rem;
    height: 2rem;
  }

  .art-card {
    width: 3.5rem;
    height: 3.5rem;
  }

  .art-lg {
    width: 6rem;
    height: 6rem;
  }

  /*
   * The character-select portraits are the one painted, full-figure art the game ships, and they
   * are composed as standing figures on their own scene. They fill their frame rather than sitting
   * contained inside it, which is the only place on the site art is treated as a picture rather
   * than as an icon.
   */
  .art-portrait {
    width: 100%;
    height: auto;
    aspect-ratio: 3 / 4;
  }

  .art-portrait img {
    object-fit: cover;
    object-position: 50% 12%;
  }

  /*
   * Zone and dungeon art is painted landscape — 1024x576 and wider. Contained in a square it
   * occupies barely half the frame and reads as a colour smear with dead bands above and below, so
   * places get a box in their own aspect and fill it. `wide` is the inline strip that sits in a
   * flex row beside a name; `panorama` is the full-column plate a chapter or a record page leads on.
   */
  .art-wide {
    width: 5.5rem;
    height: 3.1rem;
  }

  .art-wide img {
    object-fit: cover;
  }

  .art-panorama {
    width: 100%;
    aspect-ratio: 16 / 9;
    border-radius: var(--radius);
  }

  .art-panorama img {
    object-fit: cover;
  }

  /* Rarity tints the frame, never the only signal: the label always states it too. */
  .art-rarity[data-rarity="uncommon"] {
    border-color: color-mix(in srgb, var(--rarity-uncommon) 55%, transparent);
  }
  .art-rarity[data-rarity="rare"] {
    border-color: color-mix(in srgb, var(--rarity-rare) 55%, transparent);
  }
  .art-rarity[data-rarity="epic"] {
    border-color: color-mix(in srgb, var(--rarity-epic) 55%, transparent);
  }
  .art-rarity[data-rarity="legendary"] {
    border-color: color-mix(in srgb, var(--rarity-legendary) 60%, transparent);
  }
  .art-rarity[data-rarity="mythic"] {
    border-color: color-mix(in srgb, var(--rarity-mythic) 60%, transparent);
  }
  .art-rarity[data-rarity="living"] {
    border-color: color-mix(in srgb, var(--rarity-living) 60%, transparent);
  }

  .art-empty {
    color: var(--text-muted);
    /* The one deliberate exception to the type ramp, recorded as such in DESIGN.md. These initials
       must scale with whichever art box holds them: a 2rem thumbnail and a full-width hero frame
       are orders apart, so the size is relative rather than a step off the ramp. */
    font-size: 0.7em;
    font-weight: 800;
    letter-spacing: 0.06em;
  }
</style>
