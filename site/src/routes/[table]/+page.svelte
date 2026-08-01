<script lang="ts">
  import { resolve } from "$app/paths";
  import { CARD_GRID_TABLES, columnLabel, TABLE_SINGULAR } from "$lib/browse";
  import Art from "$lib/components/Art.svelte";
  import DataTable from "$lib/components/DataTable.svelte";
  import Search from "$lib/components/Search.svelte";
  import { chance, duration, gold, nodeKind, slotLabel, titleCase } from "$lib/format";
  import { tableLabel } from "$lib/labels";
  import type { PageData } from "./$types";

  type Row = Record<string, string | number | boolean | null>;

  let { data }: { data: PageData } = $props();

  let filter = $state("");
  let activeFacets = $state<Record<string, string>>({});
  let minLevel = $state<number | null>(null);
  let maxLevel = $state<number | null>(null);

  let isCardGrid = $derived(CARD_GRID_TABLES.has(data.name));

  /** "Jump to an item", not "Jump to a item". Four of the twelve table nouns start with a vowel. */
  let jumpPlaceholder = $derived.by(() => {
    const singular = TABLE_SINGULAR[data.name] ?? tableLabel(data.name).toLowerCase();
    return `Jump to ${/^[aeiou]/.test(singular) ? "an" : "a"} ${singular}…`;
  });

  /** The game's own rarity ladder. Alphabetical order puts epic before common and reads as noise. */
  const RARITY_ORDER = ["common", "uncommon", "rare", "epic", "legendary", "mythic", "living"];

  /** A facet chip shows the same words the record pages use, not the raw stored token. */
  function facetLabel(column: string, value: string): string {
    if (column === "slot" || column === "gear_slot") return slotLabel(value);
    if (column === "type" && data.name === "gathering_nodes") return nodeKind(value);
    return titleCase(value);
  }

  /**
   * Facet values are whatever the data actually contains, so no page offers a filter that matches
   * nothing. Chips are keyed by their *label*, because `ring1` and `ring2` are one slot to a player
   * and two chips both reading "Ring" would be indistinguishable; selecting one matches either.
   */
  let facets = $derived.by(() =>
    data.facetColumns.map((column) => {
      const byLabel = new Map<string, string[]>();
      for (const row of data.rows as Row[]) {
        const value = row[column];
        if (value === null || value === "") continue;
        const raw = typeof value === "boolean" ? (value ? "yes" : "no") : String(value);
        const label = facetLabel(column, raw);
        const values = byLabel.get(label);
        if (values) {
          if (!values.includes(raw)) values.push(raw);
        } else byLabel.set(label, [raw]);
      }
      const entries = [...byLabel.entries()].map(([label, values]) => ({ label, values }));
      if (column === "rarity") {
        entries.sort(
          (left, right) =>
            RARITY_ORDER.indexOf(left.values[0]!) - RARITY_ORDER.indexOf(right.values[0]!),
        );
      } else {
        entries.sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }));
      }
      return { column, entries };
    }),
  );

  let levelBounds = $derived.by(() => {
    if (!data.levelColumn) return null;
    const values = (data.rows as Row[])
      .map((row) => row[data.levelColumn!])
      .filter((value): value is number => typeof value === "number");
    return values.length > 0 ? { min: Math.min(...values), max: Math.max(...values) } : null;
  });

  let lowerBound = $derived(minLevel ?? levelBounds?.min ?? 0);
  let upperBound = $derived(maxLevel ?? levelBounds?.max ?? 0);
  let levelNarrowed = $derived(
    levelBounds !== null && (lowerBound > levelBounds.min || upperBound < levelBounds.max),
  );

  function facetValue(row: Row, column: string): string {
    const value = row[column];
    if (value === null || value === "") return "";
    return typeof value === "boolean" ? (value ? "yes" : "no") : String(value);
  }

  let matched = $derived.by(() => {
    const needle = filter.trim().toLowerCase();
    return (data.rows as Row[]).filter((row) => {
      for (const [column, wanted] of Object.entries(activeFacets)) {
        if (!wanted) continue;
        const entry = facets.find((facet) => facet.column === column)?.entries.find((e) => e.label === wanted);
        if (!entry || !entry.values.includes(facetValue(row, column))) return false;
      }
      if (levelNarrowed && data.levelColumn) {
        const level = row[data.levelColumn];
        // A row with no modelled level is not "level 0"; it is excluded while the range is narrowed,
        // and the count of what that hides is stated below.
        if (typeof level !== "number") return false;
        if (level < lowerBound || level > upperBound) return false;
      }
      if (needle.length === 0) return true;
      return data.displayColumns.some((column) => String(row[column] ?? "").toLowerCase().includes(needle));
    });
  });

  let hiddenUnlevelled = $derived(
    levelNarrowed && data.levelColumn
      ? (data.rows as Row[]).filter((row) => typeof row[data.levelColumn!] !== "number").length
      : 0,
  );

  let anyFilter = $derived(
    filter.trim().length > 0 || Object.values(activeFacets).some(Boolean) || levelNarrowed,
  );

  function clearFilters(): void {
    filter = "";
    activeFacets = {};
    minLevel = null;
    maxLevel = null;
  }

  function toggleFacet(column: string, label: string): void {
    activeFacets = { ...activeFacets, [column]: activeFacets[column] === label ? "" : label };
  }

  /** Text columns render through the formatter that matches their meaning, not through String(). */
  function display(row: Row, column: string): string {
    const value = row[column];
    if (value === null || value === "") return "—";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (column === "duration") return duration(Number(value));
    if (column === "chance") return chance(Number(value));
    if (column === "sell_value" || column === "price" || column === "reward_gold") {
      return gold(Number(value));
    }
    if (column === "slot" || column === "gear_slot") return slotLabel(String(value));
    if (column === "type" && (data.name === "gathering_nodes" || data.name === "zone_resources")) {
      return nodeKind(String(value));
    }
    if (typeof value === "number") return value.toLocaleString("en-US");
    if (column === "rarity" || column === "category" || column === "element" || column === "type" || column === "kind") {
      return titleCase(String(value));
    }
    return String(value);
  }

  let tableColumns = $derived(
    data.displayColumns
      .filter((column) => column !== "image" && column !== "name")
      .map((column) => ({
        key: column,
        label: columnLabel(column),
        align: (data.columnTypes[column] === "integer" || data.columnTypes[column] === "real"
          ? "num"
          : undefined) as "num" | undefined,
      })),
  );

  let gridColumns = $derived(
    data.displayColumns.filter(
      (column) => column !== "image" && column !== "name" && column !== "rarity",
    ),
  );
</script>

<svelte:head>
  <title>{tableLabel(data.name)} — Vespera Compendium</title>
</svelte:head>

<nav class="crumbs" aria-label="Breadcrumb">
  <a href={resolve("/")}>Home</a> / {tableLabel(data.name)}
</nav>

<span class="kicker">BROWSE</span>
<h1>{tableLabel(data.name)}</h1>

<div class="browse-controls">
  <div class="browse-search">
    <Search scopeTable={data.name} placeholder={jumpPlaceholder} />
  </div>
  <input type="search" bind:value={filter} placeholder="Filter this list" aria-label="Filter the list" />
</div>

{#if facets.length > 0 || levelBounds}
  <div class="facets">
    {#each facets as facet (facet.column)}
      <div class="facet">
        <span class="facet-label">{columnLabel(facet.column)}</span>
        <div class="chip-row">
          {#each facet.entries as entry (entry.label)}
            <button
              type="button"
              class="btn"
              class:btn-active={activeFacets[facet.column] === entry.label}
              aria-pressed={activeFacets[facet.column] === entry.label}
              onclick={() => toggleFacet(facet.column, entry.label)}
            >
              {entry.label}
            </button>
          {/each}
        </div>
      </div>
    {/each}

    {#if levelBounds}
      <div class="facet">
        <span class="facet-label">{columnLabel(data.levelColumn ?? "level")} {lowerBound}–{upperBound}</span>
        <div class="range">
          <input
            type="range"
            min={levelBounds.min}
            max={levelBounds.max}
            value={lowerBound}
            aria-label="Lowest level"
            oninput={(event) => (minLevel = Math.min(Number(event.currentTarget.value), upperBound))}
          />
          <input
            type="range"
            min={levelBounds.min}
            max={levelBounds.max}
            value={upperBound}
            aria-label="Highest level"
            oninput={(event) => (maxLevel = Math.max(Number(event.currentTarget.value), lowerBound))}
          />
        </div>
      </div>
    {/if}
  </div>
{/if}

<div class="result-line">
  <span>{matched.length.toLocaleString("en-US")} of {data.rows.length.toLocaleString("en-US")}</span>
  {#if hiddenUnlevelled > 0}
    <span class="muted">{hiddenUnlevelled} with no modelled level are hidden while the range is narrowed</span>
  {/if}
  {#if anyFilter}
    <button type="button" class="btn" onclick={clearFilters}>Clear filters</button>
  {/if}
</div>

{#if matched.length === 0}
  <p class="muted">No {tableLabel(data.name).toLowerCase()} matches these filters.</p>
{:else if isCardGrid}
  <div class="card-grid">
    {#each matched as row (row[data.keyColumn])}
      <a class="panel record-card" href={resolve(`/${data.slug}/${row[data.keyColumn]}/`)}>
        <Art src={row.image as string | null} alt={String(row.name ?? row[data.keyColumn])} size="md" rarity={row.rarity as string | null} />
        <span class="record-body">
          <span
            class="record-name"
            class:rarity-common={row.rarity === "common"}
            class:rarity-uncommon={row.rarity === "uncommon"}
            class:rarity-rare={row.rarity === "rare"}
            class:rarity-epic={row.rarity === "epic"}
            class:rarity-legendary={row.rarity === "legendary"}
            class:rarity-mythic={row.rarity === "mythic"}
            class:rarity-living={row.rarity === "living"}
          >{row.name ?? row[data.keyColumn]}</span>
          <span class="record-facts">
            {#each gridColumns as column (column)}
              {#if row[column] !== null && row[column] !== "" && row[column] !== false}
                <span class="record-fact"><span class="record-fact-label">{columnLabel(column)}</span> {display(row, column)}</span>
              {/if}
            {/each}
          </span>
        </span>
      </a>
    {/each}
  </div>
{:else}
  <DataTable columns={[{ key: data.keyColumn === "item_id" ? "item_id" : "name", label: data.keyColumn === "item_id" ? "Item" : "Name" }, ...tableColumns.filter((c) => c.key !== "item_id")]} rows={matched}>
    {#snippet cell(row: Row, column)}
      {#if column.key === "name" || column.key === "item_id"}
        <a href={resolve(`/${data.slug}/${row[data.keyColumn]}/`)}>{row.name ?? row[data.keyColumn]}</a>
      {:else}
        {display(row, column.key)}
      {/if}
    {/snippet}
  </DataTable>
{/if}

<style>
  .crumbs {
    margin-block-end: 0.6rem;
  }

  .browse-controls {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
    gap: 0.6rem;
    margin-block: 1rem 1.1rem;
  }

  .facets {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin-block-end: 1rem;
  }

  .facet {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .facet-label {
    min-inline-size: 7rem;
    color: var(--kicker);
    font-size: var(--text-2xs);
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .facet .btn {
    padding: 0.15rem 0.55rem;
    font-size: var(--text-xs);
  }

  .btn-active {
    border-color: var(--brass);
    background: color-mix(in srgb, var(--brass) 22%, transparent);
    color: var(--parchment);
  }

  .range {
    display: flex;
    gap: 0.5rem;
    min-inline-size: min(22rem, 100%);
  }

  .range input {
    flex: 1 1 0;
    accent-color: var(--brass);
  }

  .result-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.8rem;
    margin-block-end: 0.9rem;
    color: var(--lavender-grey);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }

  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
    gap: 0.6rem;
  }

  .record-card {
    display: flex;
    gap: 0.7rem;
    padding: 0.6rem;
    color: inherit;
    text-decoration: none;
  }

  .record-card:hover {
    border-color: var(--brass);
    text-decoration: none;
  }

  .record-body {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-inline-size: 0;
  }

  .record-name {
    color: var(--parchment);
    font-weight: 700;
    line-height: 1.2;
  }

  .record-facts {
    display: flex;
    flex-wrap: wrap;
    gap: 0.1rem 0.6rem;
    color: var(--lavender-grey);
    font-size: var(--text-xs);
  }

  .record-fact-label {
    color: var(--text-muted);
    font-size: var(--text-2xs);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  @media (max-width: 40rem) {
    .browse-controls {
      grid-template-columns: 1fr;
    }

    .facet-label {
      min-inline-size: 0;
    }
  }
</style>
