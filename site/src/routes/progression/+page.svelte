<script lang="ts">
  import { resolve } from "$app/paths";
  import Chip from "$lib/components/Chip.svelte";
  import EntityLink from "$lib/components/EntityLink.svelte";
  import { nodeKind, titleCase } from "$lib/format";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>Progression — Vespera Compendium</title>
  <meta
    name="description"
    content="What to do at every level of Vespera: the zone, dungeons, quests, gathering nodes and recipes reachable in each band from level 1 to 140."
  />
</svelte:head>

<nav class="crumbs" aria-label="Breadcrumb"><a href={resolve("/")}>Home</a> / Progression</nav>

<span class="kicker">PROGRESSION</span>
<h1>What to do at your level</h1>
<p class="lede">
  Every band from level 1 to {data.ceiling}, anchored on the zone the game opens at that point. The
  three level scales are tracked separately, because they are three different skills: a band's
  combat range is not its gathering range and neither is its crafting range.
</p>

<div class="legend">
  <Chip tone="combat" label="Combat" value="zones, dungeons, quests" />
  <Chip tone="gathering" label="Gathering" value="nodes" />
  <Chip tone="crafting" label="Crafting" value="recipes" />
</div>

<ol class="spine">
  {#each data.bands as band (band.zone.id)}
    <li class="band">
      <div class="band-mark">
        <span class="band-range">{band.from}–{band.to}</span>
      </div>

      <div class="panel pad band-body">
        <header class="band-head">
          <EntityLink
            slug="zones-dungeons"
            id={band.zone.id}
            name={band.zone.name}
            image={band.zone.image}
            size="md"
            sub={band.zone.act === null ? null : `Act ${band.zone.act}`}
          />
        </header>

        <div class="gutters">
          <section class="gutter">
            <h2 class="gutter-head gutter-combat">Combat {band.from}–{band.to}</h2>
            {#if band.places.length > 0}
              <ul class="entries">
                {#each band.places as place (place.id)}
                  <li>
                    <EntityLink
                      slug="zones-dungeons"
                      id={place.id}
                      name={place.name}
                      image={place.image}
                      sub={`${titleCase(place.type)} · Combat ${place.level}`}
                    />
                    {#if place.heroic}<span class="tag">Heroic</span>{/if}
                    {#if place.nightmare}<span class="tag">Nightmare</span>{/if}
                  </li>
                {/each}
              </ul>
            {/if}
            {#if band.quests.length > 0}
              <ul class="entries">
                {#each band.quests as quest (quest.id)}
                  <li>
                    <a href={resolve(`/quests/${quest.id}/`)}>{quest.name}</a>
                    <span class="entry-meta">{titleCase(quest.category)} · {quest.level}</span>
                  </li>
                {/each}
              </ul>
            {/if}
            {#if band.places.length === 0 && band.quests.length === 0}
              <p class="muted">Nothing else opens in this range.</p>
            {/if}
          </section>

          <section class="gutter">
            <h2 class="gutter-head gutter-gathering">Gathering {band.from}–{band.to}</h2>
            {#if band.nodes.length > 0}
              <ul class="entries">
                {#each band.nodes as node (node.id)}
                  <li>
                    <EntityLink
                      slug="gathering-nodes"
                      id={node.id}
                      name={node.name}
                      image={node.image}
                      sub={`${nodeKind(node.type)} · Gathering ${node.level}`}
                    />
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="muted">No node requires this gathering range.</p>
            {/if}
          </section>

          <section class="gutter">
            <h2 class="gutter-head gutter-crafting">Crafting {band.from}–{band.to}</h2>
            {#if band.recipeCount > 0}
              <p class="gutter-count">{band.recipeCount} recipes unlock here</p>
              <ul class="entries">
                {#each band.recipes as recipe (recipe.id)}
                  <li>
                    <a href={resolve(`/recipes/${recipe.id}/`)}>{recipe.name}</a>
                    <span class="entry-meta">{titleCase(recipe.category)} · {recipe.level}</span>
                  </li>
                {/each}
              </ul>
              {#if band.recipeCount > band.recipes.length}
                <p class="muted">
                  <a href={resolve("/recipes/")}>See all recipes</a>
                </p>
              {/if}
            {:else}
              <p class="muted">No recipe requires this crafting range.</p>
            {/if}
          </section>
        </div>
      </div>
    </li>
  {/each}
</ol>

<style>
  .lede {
    max-inline-size: 50rem;
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-block: 1rem 1.5rem;
  }

  .spine {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .band {
    display: grid;
    grid-template-columns: 5rem minmax(0, 1fr);
    gap: 0.8rem;
  }

  /* The rail: a continuous line through every band, so the page reads as one route. */
  .band-mark {
    position: relative;
    display: flex;
    justify-content: flex-end;
    padding-block-start: 0.9rem;
    padding-inline-end: 0.9rem;
  }

  .band-mark::before {
    content: "";
    position: absolute;
    inset-block: 0;
    inset-inline-end: 0;
    inline-size: 1px;
    background: var(--line);
  }

  .band-mark::after {
    content: "";
    position: absolute;
    inset-block-start: 1.1rem;
    inset-inline-end: -3.5px;
    inline-size: 8px;
    block-size: 8px;
    border-radius: 50%;
    background: var(--brass);
  }

  .band-range {
    color: var(--brass);
    font-variant-numeric: tabular-nums;
    font-weight: 800;
  }

  .band-head {
    margin-block-end: 0.7rem;
    padding-block-end: 0.6rem;
    border-block-end: 1px solid var(--line-soft);
  }

  .gutters {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
    gap: 1rem;
    align-items: start;
  }

  .gutter-head {
    margin-block-end: 0.4rem;
    padding-inline-start: 0.5rem;
    border-inline-start: 2px solid var(--line-soft);
    font-size: var(--text-2xs);
    font-weight: 800;
    letter-spacing: 0.11em;
    text-transform: uppercase;
  }

  .gutter-combat {
    border-inline-start-color: var(--ember);
    color: var(--ember);
  }

  .gutter-gathering {
    border-inline-start-color: var(--green);
    color: var(--green);
  }

  .gutter-crafting {
    border-inline-start-color: var(--cyan);
    color: var(--cyan);
  }

  .gutter-count {
    margin: 0 0 0.3rem;
    color: var(--lavender-grey);
    font-size: var(--text-sm);
  }

  .entries {
    margin: 0 0 0.5rem;
    padding: 0;
    list-style: none;
  }

  .entries li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    padding-block: 0.1rem;
    font-size: var(--text-sm);
  }

  .entry-meta {
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .tag {
    padding: 0.05rem 0.4rem;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    color: var(--brass);
    font-size: var(--text-2xs);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  @media (max-width: 40rem) {
    .band {
      grid-template-columns: 3.2rem minmax(0, 1fr);
      gap: 0.5rem;
    }
  }
</style>
