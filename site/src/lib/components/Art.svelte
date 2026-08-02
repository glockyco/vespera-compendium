<script lang="ts">
  import { artVariantUrl, type ArtKind, type ArtVariant } from "$lib/art";

  /**
   * Shows the game's artwork in a rarity-tinted frame.
   *
   * Each call site passes literal `kind` and `variant` values.
   * `check:art` checks the published contract instead of guessing from CSS sizes.
   * Fixed frames reserve space before images arrive. This prevents lazy loading from moving the page.
   * A row without art shows initials instead of a blank loading frame.
   *
   * Every instance is lazy with auto priority. `HeroArt` alone loads eagerly for the home hero.
   * The image is decorative and has an empty alt. The record name already appears beside it.
   * `alt` remains required because it supplies fallback initials.
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
    /** Frame preset for a layout that needs a size the variant frame does not provide. */
    box?: Box | null;
    rarity?: string | null;
  } = $props();

  let href = $derived(src ? artVariantUrl(kind, variant, src) : null);
  // `HeroArt` owns the eager hero file. Its lazy 1280px panorama uses the full-width frame.
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
    /* The source art uses pixel-scaled game UI. Smoothing blurs its crisp edges. */
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
   * The game ships painted character-select portraits as standing figures on their own scenes.
   * They fill the frame. This is the only site use that treats art as a picture instead of an icon.
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
   * Zone and dungeon art uses painted landscapes at 1024x576 or wider.
   * A square leaves most of the landscape empty and reads as a color smear.
   * Each place keeps its own aspect ratio. `wide` is an inline strip beside a name.
   * `panorama` is the full-column plate that opens a chapter or record page.
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

    /* Rarity tints the frame, but the label remains the required signal. */
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
    /*
       DESIGN.md records this exception to the type ramp.
       Initials scale with each art box, from a 2rem thumbnail to a full-width hero frame.
       Relative sizing keeps both readable.
    */
    font-size: 0.7em;
    font-weight: 800;
    letter-spacing: 0.06em;
  }
</style>
