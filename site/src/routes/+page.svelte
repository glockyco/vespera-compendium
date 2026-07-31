<script lang="ts">
  import { resolve } from "$app/paths";
  import Search from "$lib/components/Search.svelte";
  import { tableLabel } from "$lib/labels";
  import { QUESTION_CARDS } from "$lib/questions";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>Vespera Compendium</title>
  <meta
    name="description"
    content="Every Vespera item, enemy, quest, recipe and zone, with where it comes from and at what level, read from the shipped game and verified against it."
  />
</svelte:head>

<span class="kicker">VESPERA COMPENDIUM</span>
<h1>What are you looking for?</h1>
<p class="lede">
  {data.totalRecords.toLocaleString("en-US")} records read out of the shipped game and verified against
  it: where each item comes from, what a zone holds, and what your class casts from level
  {data.levelFloor} to {data.levelCeiling}.
</p>

<div class="home-search">
  <Search size="lg" placeholder="Search an item, enemy, quest, recipe or zone…" />
  <p class="home-hint">Press <kbd>/</kbd> from anywhere to search.</p>
</div>

{#if QUESTION_CARDS.length > 0}
  <div class="question-grid">
    {#each QUESTION_CARDS as card (card.href)}
      <a class="panel pad question-card" href={resolve(card.href)}>
        <span class="question-title">{card.question}</span>
        <span class="question-sub">{card.subtitle}</span>
      </a>
    {/each}
  </div>
{/if}

<!--
  With no question shape carrying enough measured demand to earn a card, the browse strip is the
  page's primary content rather than its index, and is grouped by the question each pair of tables
  answers so a reader still arrives through a question rather than a schema.
-->
<div class="browse">
  {#each data.groups as group (group.question)}
    <section class="browse-group">
      <h2>{group.question}</h2>
      <div class="browse-row">
        {#each group.tables as entry (entry.name)}
          <a class="panel browse-link" href={resolve(`/${entry.slug}/`)}>
            <span class="browse-name">{tableLabel(entry.name)}</span>
            <span class="browse-count">{entry.rows.toLocaleString("en-US")}</span>
          </a>
        {/each}
      </div>
    </section>
  {/each}
</div>

<p class="tools">
  <a href={resolve("/query/")}>Query the dataset</a> with read-only SQL, or take
  <a href={resolve("/sheets/")}>spreadsheet feeds</a> for every published table.
</p>

<style>
  .lede {
    max-inline-size: 46rem;
    font-size: 1.05rem;
  }

  .home-search {
    margin-block: 1.6rem 2.4rem;
    max-inline-size: 46rem;
  }

  .home-hint {
    margin: 0.5rem 0 0;
    color: var(--text-muted);
    font-size: 0.82rem;
  }

  kbd {
    padding: 0.05rem 0.35rem;
    border: 1px solid var(--line-soft);
    border-radius: 5px;
    background: rgba(19, 38, 64, 0.6);
    font-family: var(--font-mono);
    font-size: 0.78rem;
  }

  .question-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
    gap: 1rem;
    margin-block-end: 2.4rem;
  }

  .question-card {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    color: inherit;
    text-decoration: none;
  }

  .question-title {
    color: var(--parchment);
    font-size: 1.05rem;
    font-weight: 800;
  }

  .question-sub {
    color: var(--lavender-grey);
    font-size: 0.88rem;
  }

  .browse {
    display: flex;
    flex-direction: column;
    gap: 1.4rem;
  }

  .browse-group h2 {
    margin-block-end: 0.5rem;
    color: var(--kicker);
    font-size: 0.76rem;
    font-weight: 800;
    letter-spacing: 0.13em;
    text-transform: uppercase;
  }

  .browse-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
    gap: 0.6rem;
  }

  .browse-link {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.7rem 0.95rem;
    color: inherit;
    text-decoration: none;
  }

  .browse-link:hover {
    border-color: var(--brass);
    text-decoration: none;
  }

  .browse-link:hover .browse-name {
    color: var(--brass-warm);
  }

  .browse-name {
    color: var(--parchment);
    font-weight: 700;
  }

  .browse-count {
    color: var(--text-muted);
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
  }

  .tools {
    margin-block-start: 2rem;
    color: var(--text-muted);
    font-size: 0.9rem;
  }
</style>
