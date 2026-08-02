<script lang="ts">
  import { resolve } from "$app/paths";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
  let copiedTable = $state<string | null>(null);

  function formulaFor(table: PageData["tables"][number]): string {
    return `=IMPORTDATA("https://vespera.compendiums.org/data/${table.csv}")`;
  }

  async function copyFormula(table: PageData["tables"][number]): Promise<void> {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;

    try {
      await navigator.clipboard.writeText(formulaFor(table));
      copiedTable = table.name;
      setTimeout(() => {
        if (copiedTable === table.name) copiedTable = null;
      }, 1600);
    } catch {
      copiedTable = null;
    }
  }
</script>

<svelte:head>
  <title>Spreadsheets | Vespera Compendium</title>
  <meta
    name="description"
    content="Copy-ready Google Sheets and Excel formulas for every Vespera Compendium dataset."
  />
</svelte:head>

<span class="kicker">SPREADSHEETS</span>
<h1>Dataset spreadsheets</h1>
<nav class="crumbs" aria-label="Breadcrumb">
  <a href={resolve("/")}>Vespera Compendium</a>
  <span aria-hidden="true"> / </span>
  <span>Spreadsheets</span>
</nav>

<p>Google Sheets caches IMPORTDATA for about an hour. In Excel, choose Data, then From Web, to open the same URLs.</p>
<p>
  If <code>item_sources</code> lacks an item, this model has no source for it yet. That is a gap in what this
  dataset models, not evidence that the item cannot be obtained.
</p>

<section class="panel pad" aria-labelledby="table-list-heading">
  <h2 id="table-list-heading">All published tables</h2>
  <div class="stack">
    {#each data.tables as table (table.name)}
      <div class="formula">
        <strong>{table.name}</strong>
        <span class="muted">{table.rows} rows · {table.kind}</span>
        <code>{formulaFor(table)}</code>
        <button class="btn" type="button" onclick={() => copyFormula(table)} aria-label={`Copy formula for ${table.name}`}>
          {copiedTable === table.name ? "Copied" : "Copy"}
        </button>
      </div>
    {/each}
  </div>
</section>
