<script lang="ts">
  import { resolve } from "$app/paths";
  import { tableLabel } from "$lib/labels";
  import type { PageData } from "./$types";

  type Column = { name: string; type: string };
  type SortDirection = "asc" | "desc";

  let { data }: { data: PageData } = $props();
  let filter = $state("");
  let sortColumn = $state<string | null>(null);
  let sortDirection = $state<SortDirection>("asc");

  function formatValue(value: unknown): string {
    if (value === null) return "—";
    if (typeof value === "boolean") return value ? "yes" : "no";
    return String(value);
  }

  function cellClass(column: Column, keyColumn: string, value: unknown): string {
    const classes: string[] = [];
    if (column.name === keyColumn) classes.push("mono");
    if (column.type === "integer" || column.type === "real") classes.push("num");
    if (column.name === "rarity" && typeof value === "string") classes.push(`rarity-${value}`);
    // Descriptions run to several sentences. Left unbounded they stretch a row to a dozen lines and
    // the table stops being scannable, so long prose is capped here and shown in full on the detail
    // page.
    if (column.type === "text" && column.name !== keyColumn && typeof value === "string" && value.length > 60) {
      classes.push("cell-prose");
    }
    return classes.join(" ");
  }

  function compareValues(left: unknown, right: unknown): number {
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    if (typeof left === "number" && typeof right === "number") return left - right;
    return String(left).localeCompare(String(right));
  }

  function toggleSort(column: string): void {
    if (sortColumn === column) {
      sortDirection = sortDirection === "asc" ? "desc" : "asc";
    } else {
      sortColumn = column;
      sortDirection = "asc";
    }
  }

  function directionMarker(column: string): string {
    if (sortColumn !== column) return "";
    return sortDirection === "asc" ? " ↑" : " ↓";
  }

  let filteredRows = $derived.by(() => {
    const query = filter.trim().toLowerCase();
    if (query.length === 0) return data.rows;
    return data.rows.filter((row) =>
      data.columns.some((column) => formatValue(row[column.name]).toLowerCase().includes(query)),
    );
  });

  let sortedRows = $derived.by(() => {
    const rows = [...filteredRows];
    if (sortColumn === null) return rows;
    const column = data.columns.find((entry) => entry.name === sortColumn);
    if (!column) return rows;

    rows.sort((left, right) => {
      const leftValue = left[column.name];
      const rightValue = right[column.name];
      const comparison = compareValues(leftValue, rightValue);
      if (leftValue === null || rightValue === null) return comparison;
      return sortDirection === "asc" ? comparison : -comparison;
    });
    return rows;
  });
</script>

<svelte:head>
  <title>{tableLabel(data.name)} — Vespera Compendium</title>
</svelte:head>

<span class="kicker">DATASET</span>
<h1>{tableLabel(data.name)}</h1>
<nav class="crumbs" aria-label="Breadcrumb">
  <a href={resolve("/")}>Home</a> / {tableLabel(data.name)}
</nav>

<div class="controls">
  <input type="search" bind:value={filter} aria-label={`Filter ${tableLabel(data.name)}`} placeholder="Filter all columns" />
  <button class="btn" type="button" onclick={() => (filter = "")}>Reset</button>
  <span class="status">{sortedRows.length} of {data.rows.length} rows</span>
</div>

<div class="panel scroll">
  <table>
    <thead>
      <tr>
        {#each data.columns as column}
          <th
            scope="col"
            aria-sort={sortColumn === column.name
              ? sortDirection === "asc"
                ? "ascending"
                : "descending"
              : "none"}
          >
            <button type="button" onclick={() => toggleSort(column.name)} aria-label={`Sort by ${column.name}`}>
              {column.name}{directionMarker(column.name)}
            </button>
          </th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each sortedRows as row (String(row[data.keyColumn]))}
        <tr>
          {#each data.columns as column}
            {@const value = row[column.name]}
            <td class={cellClass(column, data.keyColumn, value)}>
              {#if column.name === data.keyColumn}
                <a href={resolve(`/${data.slug}/${String(value)}/`)}>{formatValue(value)}</a>
              {:else}
                <span class:muted={value === null}>{formatValue(value)}</span>
              {/if}
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>
