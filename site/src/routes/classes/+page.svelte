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
    content="The four Vespera classes, each with its 27 abilities and class-restricted gear, slot by slot."
  />
</svelte:head>

<nav class="crumbs" aria-label="Breadcrumb"><a href={resolve("/")}>Home</a> / Classes</nav>

<span class="kicker">CLASSES</span>
<h1>What does your class use?</h1>
<p class="lede">
  The page covers four classes, with 27 abilities and class-restricted gear for each class. It orders ability
  ladders by the Combat level that unlocks each ability.
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

  /* Four is a closed set. An auto-fit track can leave one class alone on a row. */
  @media (min-width: 52rem) {
    .class-grid {
      grid-template-columns: repeat(4, 1fr);
    }
  }
</style>
