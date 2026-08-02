<script lang="ts">
  import { resolve } from "$app/paths";
  import MechanicCard from "$lib/components/MechanicCard.svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>Game systems — Vespera Compendium</title>
  <meta
    name="description"
    content="The rules Vespera runs on: combat mathematics, ability scaling, skills and crafting, equipment value, and endgame progression, read out of the shipped game logic."
  />
</svelte:head>

<nav class="crumbs" aria-label="Breadcrumb"><a href={resolve("/")}>Home</a> / Game systems</nav>

<span class="kicker">GAME SYSTEMS</span>
<h1>Understand the game</h1>
<p class="lede">
  {data.guideCount} guides explain the rules behind the records. Every claim the game supplies is
  source checked against the shipped logic. Selected formulas and facts also pass live-game checks.
  Compendium headings and labels are marked separately, so you can see which words are the game's.
</p>

<div class="groups">
  {#each data.groups as group (group.category)}
    <section class="group" aria-labelledby="group-{group.category}">
      <h2 id="group-{group.category}" class="group-head">{group.heading}</h2>
      <div class="group-guides">
        {#each group.guides as guide (guide.id)}
          <MechanicCard
            id={guide.id}
            title={guide.title}
            summary={guide.summary}
            label={guide.label}
            live={guide.live}
            kicker={`${guide.sections} sections`}
          />
        {/each}
      </div>
    </section>
  {/each}
</div>

<style>
  .lede {
    max-inline-size: 68ch;
    font-size: var(--text-lead);
  }

  .groups {
    display: grid;
    gap: 1.6rem;
    margin-block-start: 1.8rem;
  }

  /*
   * A group is a ledger heading with its entries indented under it, not a panel. Four boxes each
   * containing more boxes would bury the guides one nesting level deeper than they deserve.
   */
  .group {
    display: grid;
    grid-template-columns: 9rem minmax(0, 1fr);
    gap: 0.9rem;
    align-items: start;
  }

  .group-head {
    padding-block-start: 0.65rem;
    border-block-start: 1px solid var(--line);
    color: var(--brass);
    font-size: var(--text-2xs);
    font-weight: 800;
    letter-spacing: 0.13em;
    text-transform: uppercase;
  }

  .group-guides {
    display: grid;
    gap: 0.5rem;
  }

  @media (max-width: 48rem) {
    .group {
      grid-template-columns: minmax(0, 1fr);
      gap: 0.5rem;
    }
  }
</style>
