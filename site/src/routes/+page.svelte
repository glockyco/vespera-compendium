<script lang="ts">
  import { resolve } from "$app/paths";
  import { tableLabel } from "$lib/labels";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

</script>

<svelte:head>
  <title>Vespera Compendium</title>
</svelte:head>

<span class="kicker">VESPERA COMPENDIUM</span>
<h1>Vespera Compendium</h1>
<p>Browse the published Vespera datasets, then follow each record into its connected drops, recipes, quests, and more.</p>
<div class="meta-line">
  <span>build {data.buildId}</span>
  <span>schema {data.schemaVersion}</span>
  <span>generated {data.generatedAt}</span>
</div>

<div class="stack">
  <div class="cards">
    {#each data.tables as table}
      <a class="card" href={resolve(`/${table.slug}/`)}>
        <div class="card-name">{tableLabel(table.name)}</div>
        <div class="card-rows">{table.rows} rows</div>
      </a>
    {/each}
  </div>

  <div>
    <p><a href={resolve("/query/")}>SQL playground</a> lets you explore the published SQLite dataset with read-only queries.</p>
    <p><a href={resolve("/sheets/")}>Spreadsheet feeds</a> provide copy-ready CSV imports for every published table.</p>
  </div>
</div>
