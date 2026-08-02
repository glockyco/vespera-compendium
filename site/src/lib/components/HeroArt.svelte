<script lang="ts">
  import { artVariantUrl } from "$lib/art";

  /**
   * The one eagerly loaded image on the site.
   *
   * It exists as its own component rather than as a prop on `Art` so that "which image is the LCP
   * candidate" is answerable by grepping for the import, and so `check:art` can assert there is
   * exactly one instance. `Art` is unconditionally lazy and auto priority, which is what keeps the
   * initial image transfer inside its budget on every other route.
   *
   * `kind` and `variant` are fixed rather than props: the only sanctioned use is the home hero
   * panorama, and a second call shape would reopen exactly the question this component closes.
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
