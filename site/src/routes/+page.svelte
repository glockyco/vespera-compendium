<script lang="ts">
  import { resolve } from "$app/paths";
  import Art from "$lib/components/Art.svelte";
  import Chip from "$lib/components/Chip.svelte";
  import ClassPlate from "$lib/components/ClassPlate.svelte";
  import EntityLink from "$lib/components/EntityLink.svelte";
  import Search from "$lib/components/Search.svelte";
  import { tableLabel } from "$lib/labels";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const n = (value: number) => value.toLocaleString("en-US");
</script>

<svelte:head>
  <title>Vespera Compendium</title>
  <meta
    name="description"
    content="Every item, enemy, quest, recipe and ability in Vespera, reconstructed from the shipped game and verified against it."
  />
</svelte:head>

<span class="kicker">VESPERA COMPENDIUM</span>
<h1>What are you looking for?</h1>
<p class="lede">
  {n(data.totalRecords)} records read out of the shipped game and verified against it: where items come
  from, what a zone holds, and what your class casts from level {data.spineFloor} to {data.levelCeiling}.
</p>

<div class="home-search">
  <Search
    size="lg"
    focusOnDesktop
    placeholder="Search an item, enemy, quest, recipe or zone…"
    narrowPlaceholder="Search the compendium…"
  />
  <p class="home-hint">Press <kbd>/</kbd> from anywhere to search.</p>
</div>

<!--
  The class hall. A player identifies by class before anything else, so the four the game defines are
  the page's first content and its largest. The portraits, the title line, the world role and the
  traits are the game's own character select, not a summary of it. The plate is shared with
  `/classes/` so the same four objects are not rendered at two densities one click apart.
-->
<section class="band">
  <h2>The four classes</h2>
  <p class="band-line">
    Every ability and every piece of class-restricted gear the game defines, for each of the four.
  </p>
  <div class="hall">
    {#each data.classes as entry (entry.id)}
      <ClassPlate {...entry} />
    {/each}
  </div>
</section>

<!--
  The level spine. "What should I be doing at my level" is the most-asked answerable question, and
  the game answers it with places, so zones and dungeons run interleaved in level order exactly as a
  player meets them.
-->
<section class="band">
  <h2>Where to go, level {data.spineFloor} to {data.spineCeiling}</h2>
  <p class="band-line">
    Every place on the way up, in the order you meet them.
  </p>
  <ol class="spine" role="list">
    {#each data.spine as place (place.id)}
      <li>
        <a class="stop" href={resolve(`/zones-dungeons/${place.id}/`)}>
          <Art src={place.image} alt={place.name} size="wide" />
          <span class="stop-body">
            <span class="stop-name">
              {place.name}
              {#if place.kind === "dungeon"}<span class="stop-kind">Dungeon</span>{/if}
            </span>
            <span class="stop-desc">{place.description}</span>
          </span>
          <Chip tone="combat" label="Combat" value={place.level ?? "—"} />
        </a>
      </li>
    {/each}
    <li class="spine-more">
      <a href={resolve("/progression/")}>
        <span class="more-figure">+{data.endgame}</span>
        <span class="more-text">
          heroic and nightmare places, up to Combat {data.levelCeiling}. See the whole spine.
        </span>
      </a>
    </li>
  </ol>
</section>

<!--
  The browsable tables, still all twelve and still grouped by the question each pair answers, but
  each now shows real records. A row count alone described the schema; two records with their art
  describe what is actually in there.
-->
<section class="band">
  <h2>The twelve tables</h2>
  <p class="band-line">
    Combat, zones and dungeons, quests, crafting, gathering, items, abilities, gems, shops and
    achievements. Talents, factions, mercenaries, the Tower and a dozen other shipped systems are
    not modelled here, and {data.unmodelledItems} items have no source the model can name —
    <a href={resolve("/sources/")}>what this model does not reach</a> says which and why.
  </p>
  <div class="groups">
    {#each data.groups as group (group.question)}
      <section class="group">
        <h3>{group.question}</h3>
        <div class="group-tables">
          {#each group.tables as entry (entry.name)}
            <div class="panel table-card">
              <a class="table-head" href={resolve(`/${entry.slug}/`)}>
                <span class="table-name">{tableLabel(entry.name)}</span>
                <span class="table-count">{n(entry.rows)}</span>
              </a>
              <ul class="table-examples">
                {#each entry.examples as example (example.id)}
                  <li>
                    <EntityLink
                      slug={entry.slug}
                      id={example.id}
                      name={example.name}
                      image={example.image}
                      rarity={example.rarity}
                    />
                  </li>
                {/each}
              </ul>
            </div>
          {/each}
        </div>
      </section>
    {/each}
  </div>
</section>

<p class="tools">
  <a href={resolve("/query/")}>Query the dataset</a> with read-only SQL, or take
  <a href={resolve("/sheets/")}>spreadsheet feeds</a> for every published table.
</p>

<style>
  .lede {
    max-inline-size: 46rem;
    font-size: var(--text-lead);
  }

  .home-search {
    margin-block: 1.6rem 0;
    max-inline-size: 46rem;
  }

  .home-hint {
    margin: 0.5rem 0 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  kbd {
    padding: 0.05rem 0.35rem;
    border: 1px solid var(--line-soft);
    border-radius: var(--radius-control);
    background: var(--panel-hover);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .band {
    margin-block-start: 2.8rem;
  }

  /*
   * A band heading is the page's top-level wayfinding, so it is a real heading rather than a kicker.
   * The kicker idiom is reserved for the page title above and for the question labels inside each
   * band, which are subordinate to it: previously the h2 was the smallest, faintest mark in its own
   * band and its h3 children out-shouted it.
   */
  .band h2 {
    margin: 0;
    color: var(--parchment);
    font-size: var(--text-title);
    font-weight: 800;
  }

  .band-line {
    margin: 0.25rem 0 0.9rem;
    max-inline-size: 52rem;
    color: var(--lavender-grey);
    font-size: var(--text-sm);
  }

  /*
   * Four is a closed set, so this grid is declared rather than intrinsic: an auto-fit track would
   * produce a three-up row with one class orphaned underneath at some widths.
   */
  .hall {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.9rem;
  }

  @media (min-width: 52rem) {
    .hall {
      grid-template-columns: repeat(4, 1fr);
    }
  }

  .spine {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(21rem, 1fr));
    gap: 0.5rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .stop {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.7rem;
    height: 100%;
    padding: 0.5rem 0.7rem;
    border: 1px solid var(--line-soft);
    border-radius: var(--radius);
    background: var(--panel-inset);
    color: inherit;
    text-decoration: none;
  }

  .stop:hover,
  .stop:focus-visible {
    border-color: var(--brass);
    background: var(--panel-hover);
    text-decoration: none;
  }

  .stop-body {
    display: grid;
    gap: 0.1rem;
    min-width: 0;
  }

  .stop-name {
    color: var(--parchment);
    font-size: var(--text-sm);
    font-weight: 700;
  }

  .stop-kind {
    margin-inline-start: 0.35rem;
    color: var(--text-muted);
    font-size: var(--text-2xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  /*
   * Clamped rather than truncated to one line. Four, because the longest dungeon description runs
   * to 88 characters and every shorter one still takes only the lines it needs — the clamp is a
   * maximum. A two-line box cut all six dungeons mid-word, losing exactly the phrase that gives
   * each place its character.
   */
  .stop-desc {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 4;
    color: var(--text-muted);
    font-size: var(--text-2xs);
    line-height: 1.35;
  }

  .spine-more a {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    height: 100%;
    padding: 0.5rem 0.9rem;
    border: 1px dashed var(--line-soft);
    border-radius: var(--radius);
    color: inherit;
    text-decoration: none;
  }

  .spine-more a:hover {
    border-color: var(--brass);
    border-style: solid;
    text-decoration: none;
  }

  .more-figure {
    color: var(--brass-warm);
    font-size: var(--text-lead);
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }

  .more-text {
    color: var(--text-muted);
    font-size: var(--text-2xs);
    line-height: 1.35;
  }

  .groups {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(21rem, 1fr));
    gap: 1.1rem 1.4rem;
  }

  /* Subordinate to the band heading: the question labels the tables answer, not sections in a page. */
  .group h3 {
    margin: 0 0 0.45rem;
    color: var(--kicker);
    font-size: var(--text-kicker);
    font-weight: 800;
    letter-spacing: 0.15em;
    text-transform: uppercase;
  }

  .group-tables {
    display: grid;
    gap: 0.6rem;
  }

  .table-card {
    padding: 0.6rem 0.75rem 0.7rem;
  }

  .table-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    color: inherit;
    text-decoration: none;
  }

  .table-head:hover .table-name,
  .table-head:focus-visible .table-name {
    color: var(--brass-warm);
  }

  .table-name {
    color: var(--parchment);
    font-size: var(--text-sm);
    font-weight: 700;
  }

  .table-count {
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .table-examples {
    display: grid;
    gap: 0.3rem;
    margin: 0.5rem 0 0;
    padding-block-start: 0.5rem;
    padding-inline-start: 0;
    border-block-start: 1px dotted var(--hairline);
    list-style: none;
  }

  .tools {
    margin-block-start: 2.4rem;
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
</style>
