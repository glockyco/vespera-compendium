<script lang="ts">
  import { artVariantUrl } from "$lib/art";

  /**
   * Loads the site's one eager image.
   *
   * This component owns the image instead of accepting a prop on `Art`.
   * A single import lets `check:art` count the LCP candidate.
   * `Art` stays lazy with auto priority on every other route.
   * Fixed `kind` and `variant` allow only the home hero panorama.
   */
  let { src, alt }: { src: string | null; alt: string } = $props();

  let href = $derived(src ? artVariantUrl("zone", "hero", src) : null);
  let initials = $derived(
    alt
      .replace(/[^\p{L}\p{N} ]/gu, "")
      .trim()
      .slice(0, 2)
      .toUpperCase() || "??",
  );
</script>

<span class="hero-art" aria-hidden="true">
  {#if href}
    <img src={href} alt="" loading="eager" fetchpriority="high" decoding="async" />
  {:else}
    <span class="hero-empty">{initials}</span>
  {/if}
</span>

<style>
  .hero-art {
    display: grid;
    place-items: center;
    overflow: hidden;
    inline-size: 100%;
    aspect-ratio: 16 / 9;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: linear-gradient(160deg, var(--art-top), var(--art-bottom));
  }

  .hero-art img {
    inline-size: 100%;
    block-size: 100%;
    object-fit: cover;
  }

  .hero-empty {
    color: var(--text-muted);
    font-size: var(--text-display);
    font-weight: 800;
    letter-spacing: 0.06em;
  }
</style>
