<script lang="ts" generics="Row extends Record<string, unknown>">
  import type { Snippet } from "svelte";

  /**
   * The genuinely tabular case: stat lists, drop tables, and the four entity browsers whose records
   * have no art to identify them. Sorting is kept here rather than duplicated per page.
   *
   * Cells are rendered by the caller through the `cell` snippet, because a compendium cell is
   * usually a link, a bar or a formatted figure rather than a string.
   */
  type Column = { key: string; label: string; align?: "num" };

  let {
    columns,
    rows,
    cell,
    sortable = true,
    empty = "Nothing to show.",
  }: {
    columns: Column[];
    rows: Row[];
    cell?: Snippet<[Row, Column]>;
    sortable?: boolean;
    empty?: string;
  } = $props();

  let sortKey = $state<string | null>(null);
  let ascending = $state(true);

  function toggle(key: string): void {
    if (sortKey === key) ascending = !ascending;
    else {
      sortKey = key;
      ascending = true;
    }
  }

  let sorted = $derived.by(() => {
    if (!sortKey) return rows;
    const key = sortKey;
    // Nulls sort last in both directions: they mean "not modelled", which is never the answer a
    // reader is looking for at the top of a sorted column.
    return [...rows].sort((left, right) => {
      const a = left[key];
      const b = right[key];
      if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1;
      if (b === null || b === undefined) return -1;
      const comparison =
        typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
      return ascending ? comparison : -comparison;
    });
  });
</script>

{#if rows.length === 0}
  <p class="muted">{empty}</p>
{:else}
  <div class="scroll">
    <table>
      <thead>
        <tr>
          {#each columns as column (column.key)}
            <th class:num={column.align === "num"} aria-sort={sortKey === column.key ? (ascending ? "ascending" : "descending") : "none"}>
              {#if sortable}
                <button type="button" onclick={() => toggle(column.key)}>
                  {column.label}{sortKey === column.key ? (ascending ? " ↑" : " ↓") : ""}
                </button>
              {:else}
                {column.label}
              {/if}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each sorted as row, index (index)}
          <tr>
            {#each columns as column (column.key)}
              <td class:num={column.align === "num"}>
                {#if cell}{@render cell(row, column)}{:else}{row[column.key] ?? "—"}{/if}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
