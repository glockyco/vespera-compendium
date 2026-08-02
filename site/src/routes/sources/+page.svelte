<script lang="ts">
  import { resolve } from "$app/paths";
  import AnswerBlock from "$lib/components/AnswerBlock.svelte";
  import EntityLink from "$lib/components/EntityLink.svelte";
  import { titleCase } from "$lib/format";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  let coverage = $derived(Math.round((data.sourcedTotal / data.itemTotal) * 100));
</script>

<svelte:head>
  <title>Item sources — Vespera Compendium</title>
  <meta
    name="description"
    content="Every modelled way to obtain an item in Vespera, plus an honest account of items whose source this model does not cover."
  />
</svelte:head>

<nav class="crumbs" aria-label="Breadcrumb"><a href={resolve("/")}>Home</a> / Sources</nav>

<span class="kicker">ACQUISITION</span>
<h1>Item sources</h1>
<p class="lede">
  {data.sourcedTotal} of {data.itemTotal} items have at least one modelled source, or {coverage}%.
  The page lists the rest by name instead of hiding them. A missing source marks a boundary of this
  model, not evidence that an item cannot be obtained.
</p>

<div class="source-grid">
  {#each data.kinds as kind (kind.kind)}
    <section class="panel pad source">
      <header>
        <h2>{kind.title}</h2>
        <span class="source-count">{kind.items} items</span>
      </header>
      <p class="source-blurb">{kind.blurb}</p>
      <ul class="rarity-list">
        {#each kind.rarities as entry (entry.rarity)}
          <li>
            <span
              class:rarity-common={entry.rarity === "common"}
              class:rarity-uncommon={entry.rarity === "uncommon"}
              class:rarity-rare={entry.rarity === "rare"}
              class:rarity-epic={entry.rarity === "epic"}
              class:rarity-legendary={entry.rarity === "legendary"}
              class:rarity-mythic={entry.rarity === "mythic"}
              class:rarity-living={entry.rarity === "living"}
            >{titleCase(entry.rarity)}</span>
            <span class="rarity-count">{entry.count}</span>
          </li>
        {/each}
      </ul>
      <p class="source-rows">{kind.rows} source rows</p>
    </section>
  {/each}
</div>

<AnswerBlock title="Items with no modelled source" count={data.unsourced.length}>
  <p class="gap-note">
    These {data.unsourced.length} items exist in the game and the compendium knows their stats, but
    nothing in the modelled systems yields them. {data.unlevelledCount} items likewise have no
    modelled level. Both figures trace to the same cause: the game also ships
    {data.unmodelled.join(", ")}, none of which this pipeline reconstructs. Until one of those is
    modelled, the honest statement is that the source is unknown to this model — not that the item
    is unobtainable.
  </p>
  <ul class="unsourced">
    {#each data.unsourced as item (item.id)}
      <li>
        <EntityLink
          slug="items"
          id={item.id}
          name={item.name}
          image={item.image}
          rarity={item.rarity}
          sub={titleCase(item.type)}
        />
      </li>
    {/each}
  </ul>
</AnswerBlock>

<style>
  .lede {
    max-inline-size: 50rem;
  }

  .source-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
    gap: 0.7rem;
    margin-block: 1.3rem;
  }

  .source header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.6rem;
  }

  .source h2 {
    margin: 0;
    color: var(--parchment);
    font-size: var(--text-body);
  }

  .source-count {
    color: var(--brass);
    font-variant-numeric: tabular-nums;
    font-weight: 700;
  }

  .source-blurb {
    margin: 0.3rem 0 0.6rem;
    color: var(--lavender-grey);
    font-size: var(--text-sm);
  }

  .rarity-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .rarity-list li {
    display: flex;
    justify-content: space-between;
    gap: 0.6rem;
    padding-block: 0.08rem;
    border-block-end: 1px dotted var(--hairline-faint);
    font-size: var(--text-sm);
  }

  .rarity-count {
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .source-rows {
    margin: 0.5rem 0 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .gap-note {
    max-inline-size: 54rem;
  }

  .unsourced {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
    gap: 0.1rem;
    margin: 0.6rem 0 0;
    padding: 0;
    list-style: none;
  }
</style>
