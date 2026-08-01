<script lang="ts">
  import { resolve } from "$app/paths";
  import ClassPlate from "$lib/components/ClassPlate.svelte";
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
    <ClassPlate {...entry} />
  {/each}
</div>

<style>
  .lede {
    max-inline-size: 46rem;
  }

  .class-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.9rem;
    margin-block-start: 1.3rem;
  }

  /* Four is a closed set: an auto-fit track would orphan one class on a row of its own. */
  @media (min-width: 52rem) {
    .class-grid {
      grid-template-columns: repeat(4, 1fr);
    }
  }
</style>
