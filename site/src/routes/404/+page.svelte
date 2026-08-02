<script lang="ts">
  import { resolve } from "$app/paths";
  import Search from "$lib/components/Search.svelte";

  /**
   * Makes an unknown URL a way back into the site.
   * It keeps the home search field and likely destinations.
   * It shows no question cards because measured demand did not support one.
   */
  const WAYS_IN = [
    { href: "/mechanics/", label: "Mechanics", blurb: "Read the rules and formulas that govern the game." },
    { href: "/progression/", label: "Progression", blurb: "Find tasks for levels 1 to 140." },
    { href: "/classes/", label: "Classes", blurb: "See abilities and gear for all four classes." },
    { href: "/items/", label: "Items", blurb: "See every item and its source." },
    { href: "/zones-dungeons/", label: "Zones and dungeons", blurb: "See what each place holds." },
  ];
</script>

<svelte:head>
  <title>Not found — Vespera Compendium</title>
</svelte:head>

<span class="kicker">NOT FOUND</span>
<h1>No record at this address</h1>
<p class="lede">
  The page you asked for is not part of the compendium. Search for the missing record, or start
  from one of these.
</p>

<div class="notfound-search">
  <Search
    idBase="notfound-search"
    size="lg"
    placeholder="Search an item, enemy, quest, recipe or zone…"
    narrowPlaceholder="Search the compendium…"
  />
</div>

<div class="ways">
  {#each WAYS_IN as way (way.href)}
    <a class="panel pad way" href={resolve(way.href)}>
      <span class="way-label">{way.label}</span>
      <span class="way-blurb">{way.blurb}</span>
    </a>
  {/each}
</div>

<style>
  .lede {
    max-inline-size: 40rem;
  }

  .notfound-search {
    margin-block: 1.2rem 1.8rem;
    max-inline-size: 42rem;
  }

  .ways {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
    gap: 0.7rem;
  }

  .way {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    color: inherit;
    text-decoration: none;
  }

  .way:hover {
    border-color: var(--brass);
    text-decoration: none;
  }

  .way-label {
    color: var(--parchment);
    font-weight: 700;
  }

  .way-blurb {
    color: var(--lavender-grey);
    font-size: var(--text-sm);
  }
</style>
