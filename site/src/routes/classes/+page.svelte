<script lang="ts">
  import { resolve } from "$app/paths";
  import { CLASS_BLURB, type ClassId } from "$lib/classes";
  import Art from "$lib/components/Art.svelte";
  import { titleCase } from "$lib/format";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>Classes — Vespera Compendium</title>
  <meta
    name="description"
    content="The four Vespera classes, each with its 27 abilities and the gear restricted to it, slot by slot."
  />
</svelte:head>

<nav class="crumbs" aria-label="Breadcrumb"><a href={resolve("/")}>Home</a> / Classes</nav>

<span class="kicker">CLASSES</span>
<h1>What does your class use?</h1>
<p class="lede">
  Four classes, 27 abilities each, and the gear the game restricts to them. Ability ladders are
  ordered by the combat level that unlocks them.
</p>

<div class="class-grid">
  {#each data.classes as entry (entry.id)}
    <a class="panel pad class-card" href={resolve(`/classes/${entry.id}/`)}>
      <Art src={entry.image} alt={titleCase(entry.id)} size="md" />
      <span class="class-body">
        <span class="class-name">{titleCase(entry.id)}</span>
        <span class="class-blurb">{CLASS_BLURB[entry.id as ClassId]}</span>
        <span class="class-counts">{entry.abilityCount} abilities · {entry.itemCount} items</span>
      </span>
    </a>
  {/each}
</div>

<style>
  .lede {
    max-inline-size: 46rem;
  }

  .class-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
    gap: 0.7rem;
    margin-block-start: 1.3rem;
  }

  .class-card {
    display: flex;
    gap: 0.8rem;
    color: inherit;
    text-decoration: none;
  }

  .class-card:hover {
    border-color: var(--brass);
    text-decoration: none;
  }

  .class-body {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .class-name {
    color: var(--parchment);
    font-size: var(--text-lead);
    font-weight: 800;
  }

  .class-blurb {
    color: var(--lavender-grey);
    font-size: var(--text-sm);
  }

  .class-counts {
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }
</style>
