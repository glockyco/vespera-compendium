<script lang="ts">
  import "@fontsource-variable/source-sans-3";
  import "../app.css";
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import Search from "$lib/components/Search.svelte";
  import type { LayoutData } from "./$types";

  let { data, children }: { data: LayoutData; children: import("svelte").Snippet } = $props();

  /**
   * Seven destinations, ordered by what a visitor needs first: the guides explain the systems, the
   * two hubs answer the most-asked progression and class questions, three indexes carry the bulk of
   * the records, and the two tools sit last because they serve the much smaller data-literate
   * audience.
   */
  const DESTINATIONS = [
    { href: "/mechanics/", label: "Mechanics" },
    { href: "/progression/", label: "Progression" },
    { href: "/classes/", label: "Classes" },
    { href: "/zones-dungeons/", label: "Zones" },
    { href: "/items/", label: "Items" },
    { href: "/query/", label: "Query" },
    { href: "/sheets/", label: "Sheets" },
  ];

  let generated = $derived(data.generatedAt.slice(0, 10));

  /**
   * Routes that carry their own full-width field as the page's primary instrument. Rendering the
   * shell's as well would put two identical, identically-named search boxes on screen, and two live
   * handlers racing for the `/` shortcut, so the shell yields on those routes.
   *
   * Keyed on the route id rather than the pathname: the pathname has to be compared against a
   * `resolve()`d string, which does not match during prerender, so the duplicate shipped in the
   * static HTML and was only removed once the client hydrated.
   */
  const OWN_SEARCH = new Set(["/", "/404"]);
  let showShellSearch = $derived(!OWN_SEARCH.has(page.route.id ?? ""));
</script>

<a class="skip" href="#main">Skip to content</a>

<header class="topbar">
  <div class="topbar-inner">
    <a class="wordmark" href={resolve("/")}>
      <span class="wordmark-name">Vespera</span>
      <span class="wordmark-sub">Compendium</span>
    </a>

    {#if showShellSearch}
      <div class="topbar-search">
        <Search idBase="shell-search" />
      </div>
    {/if}

    <nav class="topbar-nav" aria-label="Sections">
      {#each DESTINATIONS as destination (destination.href)}
        <a href={resolve(destination.href)}>{destination.label}</a>
      {/each}
    </nav>
  </div>
</header>

<main id="main">{@render children()}</main>

<footer class="sitefoot">
  <div class="sitefoot-inner">
    <span>Reconstructed from the shipped game bundles and verified against the running game.</span>
    <span class="sitefoot-meta">
      <span>build {data.buildId}</span>
      <span>schema {data.schemaVersion}</span>
      <span>generated {generated}</span>
    </span>
  </div>
</footer>

<style>
  .skip {
    position: absolute;
    inset-inline-start: -9999px;
  }

  .skip:focus {
    position: fixed;
    z-index: 100;
    display: flex;
    align-items: center;
    inset-block-start: 0.5rem;
    inset-inline-start: 0.5rem;
    min-block-size: 2.75rem;
    padding: 0.5rem 0.8rem;
    border-radius: var(--radius-art);
    background: var(--painted-elevated);
  }

  .topbar {
    position: sticky;
    z-index: 30;
    inset-block-start: 0;
    border-block-end: 1px solid var(--line);
    background: color-mix(in srgb, var(--obsidian) 88%, transparent);
    backdrop-filter: blur(10px);
  }

  .topbar-inner {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: clamp(0.75rem, 2vw, 1.5rem);
    max-inline-size: 76rem;
    margin: 0 auto;
    padding: 0.6rem clamp(1rem, 4vw, 3rem);
  }

  .wordmark {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-block-size: 2.75rem;
    color: inherit;
    line-height: 1.05;
    text-decoration: none;
  }

  .wordmark:hover {
    text-decoration: none;
  }

  .wordmark-name {
    color: var(--brass);
    font-size: var(--text-lead);
    font-weight: 800;
    letter-spacing: 0.02em;
  }

  .wordmark-sub {
    color: var(--kicker);
    font-size: var(--text-2xs);
    font-weight: 800;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }

  .topbar-search {
    min-inline-size: 0;
  }

  .topbar-nav {
    display: flex;
    flex-wrap: wrap;
    gap: 0.15rem;
  }

  .topbar-nav a {
    display: inline-flex;
    align-items: center;
    min-block-size: 2.75rem;
    padding: 0.3rem 0.55rem;
    border-radius: var(--radius-control);
    color: var(--lavender-grey);
    font-size: var(--text-sm);
    font-weight: 600;
    text-decoration: none;
  }

  .topbar-nav a:hover {
    background: var(--panel-hover);
    color: var(--brass-warm);
    text-decoration: none;
  }

  .sitefoot {
    margin-block-start: 3rem;
    border-block-start: 1px solid var(--line-soft);
  }

  .sitefoot-inner {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1.5rem;
    justify-content: space-between;
    max-inline-size: 76rem;
    margin: 0 auto;
    padding: 1.1rem clamp(1rem, 4vw, 3rem) 2rem;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .sitefoot-meta {
    display: flex;
    gap: 1rem;
    font-variant-numeric: tabular-nums;
  }

  /*
   * Below the search field's usable width the bar stacks. The nav takes its own full-width row
   * rather than sharing one with the wordmark, because seven 44px destinations squeezed into half a
   * 320px viewport wrapped to four lines and made a sticky header eat a fifth of the screen. The bar
   * also stops sticking there: a stacked header that follows the reader down costs more than it
   * gives back on a phone.
   */
  @media (max-width: 54rem) {
    .topbar {
      position: static;
    }

    .topbar-inner {
      grid-template-columns: minmax(0, 1fr);
    }

    .topbar-search {
      grid-row: 2;
    }

    .topbar-nav {
      grid-row: 3;
      gap: 0.1rem 0.25rem;
    }

    .topbar-nav a {
      padding-inline: 0.4rem;
    }
  }
</style>
