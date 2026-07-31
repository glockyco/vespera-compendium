<script lang="ts">
  /**
   * The game's own artwork, in a rarity-tinted frame.
   *
   * Boxes are fixed per size so a grid of several hundred cards reserves its layout before any
   * image arrives; without that, lazy loading reflows the page as the user scrolls. A row with no
   * art renders lettered rather than blank, because an empty frame reads as a loading failure.
   *
   * The image is decorative and carries an empty alt: every place this is used renders the record's
   * name beside it, so describing the picture as well makes a screen reader announce the same name
   * twice. `alt` is still required, because it supplies the letters of the fallback.
   */
  type Size = "sm" | "md" | "lg" | "hero";

  let {
    src,
    alt,
    size = "md",
    rarity = null,
  }: { src: string | null; alt: string; size?: Size; rarity?: string | null } = $props();

  // Published paths are `images/...`; the art is served from `/game/`.
  let href = $derived(src ? `/game/${src.replace(/^images\//, "")}` : null);
  let initials = $derived(
    alt
      .replace(/[^\p{L}\p{N} ]/gu, "")
      .trim()
      .slice(0, 2)
      .toUpperCase() || "??",
  );
</script>

<span class="art art-{size}" class:art-rarity={rarity} data-rarity={rarity} aria-hidden="true">
  {#if href}
    <img src={href} alt="" loading="lazy" decoding="async" />
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
    border-radius: 8px;
    background: linear-gradient(160deg, var(--art-top), var(--art-bottom));
  }

  .art img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    /* The source art is pixel-scaled game UI; smoothing it turns crisp edges to mush. */
    image-rendering: auto;
  }

  .art-sm {
    width: 2rem;
    height: 2rem;
  }

  .art-md {
    width: 3.5rem;
    height: 3.5rem;
  }

  .art-lg {
    width: 6rem;
    height: 6rem;
  }

  .art-hero {
    width: 100%;
    aspect-ratio: 16 / 9;
    border-radius: var(--radius);
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
