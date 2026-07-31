<script lang="ts">
  import { resolve } from "$app/paths";
  import { tableLabel } from "$lib/labels";
  import type { PageData } from "./$types";

  type CellValue = string | number | boolean | null;
  type Column = { name: string; type: string };
  type RelatedBlock = PageData["related"][number];
  type RelatedRow = Record<string, CellValue>;

  const DETAIL_LINKS: Record<string, string> = {
    next_quest_id: "quests",
    required_quest_id: "quests",
    required_boss: "enemies",
    gear_item_id: "items",
    requirement_item_id: "items",
    item_id: "items",
  };

  let { data }: { data: PageData } = $props();

  function formatValue(value: unknown): string {
    if (value === null || value === undefined) return "—";
    if (typeof value === "boolean") return value ? "yes" : "no";
    return String(value);
  }

  function detailCellClass(column: Column, keyColumn: string, value: unknown): string {
    const classes: string[] = [];
    if (column.name === keyColumn || column.name === "image_path" || column.name === "icon") {
      classes.push("mono");
    }
    if (column.type === "integer" || column.type === "real") classes.push("num");
    if (column.name === "rarity" && typeof value === "string") classes.push(`rarity-${value}`);
    return classes.join(" ");
  }

  function relatedCellClass(column: string, value: unknown): string {
    const classes: string[] = [];
    if (column.endsWith("_id") || column === "source_id" || column === "target_id") {
      classes.push("mono");
    }
    if (typeof value === "number") classes.push("num");
    if (column === "rarity" && typeof value === "string") classes.push(`rarity-${value}`);
    return classes.join(" ");
  }

  function detailHref(column: string, value: unknown): string | null {
    const slug = DETAIL_LINKS[column];
    if (!slug || value === null || value === undefined || String(value).length === 0) return null;
    return resolve(`/${slug}/${String(value)}/`);
  }

  function relatedHref(
    block: RelatedBlock,
    row: RelatedRow,
    column: string,
    value: unknown,
  ): string | null {
    let slug = block.linkColumns[column];
    if (column === "source_id") slug = typeof row.source_slug === "string" ? row.source_slug : "";
    if (column === "target_id") slug = typeof row.target_slug === "string" ? row.target_slug : "";
    if (!slug || value === null || value === undefined || String(value).length === 0) return null;
    return resolve(`/${slug}/${String(value)}/`);
  }

  function isHiddenRelatedColumn(column: string): boolean {
    return column === "source_slug" || column === "target_slug";
  }
</script>

<svelte:head>
  <title>{data.heading} — {tableLabel(data.name)} — Vespera Compendium</title>
</svelte:head>

<span class="kicker">{data.name.toUpperCase()}</span>
<h1>{data.heading}</h1>
<nav class="crumbs" aria-label="Breadcrumb">
  <a href={resolve("/")}>Home</a> /
  <a href={resolve(`/${data.slug}/`)}>{tableLabel(data.name)}</a> /
  {data.heading}
</nav>

<div class="stack">
  <section class="panel pad">
    <dl class="detail-list">
      {#each data.columns as column}
        {@const value = data.row[column.name]}
        {@const href = detailHref(column.name, value)}
        {#if value !== null}
          <div>
            <dt>{column.name}</dt>
            <dd class={detailCellClass(column, data.keyColumn, value)}>
              {#if href}
                <a href={href}>{formatValue(value)}</a>
              {:else}
                <span class:muted={value === null}>{formatValue(value)}</span>
              {/if}
            </dd>
          </div>
        {/if}
      {/each}
    </dl>
  </section>

  {#each data.related as block}
    <section class="panel pad">
      <h2>{block.title}</h2>
      {#if block.rows.length === 0}
        <p class="muted">{block.empty ?? "No rows."}</p>
      {:else}
        <div class="scroll">
          <table>
            <thead>
              <tr>
                {#each block.columns.filter((column) => !isHiddenRelatedColumn(column)) as column}
                  <th scope="col">{column}</th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each block.rows as row}
                <tr>
                  {#each block.columns.filter((column) => !isHiddenRelatedColumn(column)) as column}
                    {@const value = row[column]}
                    {@const href = relatedHref(block, row, column, value)}
                    <td class={relatedCellClass(column, value)}>
                      {#if href}
                        <a href={href}>{formatValue(value)}</a>
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
      {/if}
    </section>
  {/each}
</div>

<style>
  .detail-list {
    display: grid;
    grid-template-columns: minmax(10rem, 0.35fr) minmax(0, 1fr);
    margin: 0;
  }

  .detail-list > div {
    display: contents;
  }

  .detail-list dt,
  .detail-list dd {
    margin: 0;
    padding: 0.55rem 0.7rem;
    border-bottom: 1px solid var(--line-soft);
  }

  .detail-list dt {
    color: var(--lavender-grey);
    font-weight: 800;
  }

  .detail-list dd {
    overflow-wrap: anywhere;
  }

  @media (max-width: 42rem) {
    .detail-list {
      grid-template-columns: 1fr;
    }

    .detail-list > div {
      display: grid;
      grid-template-columns: minmax(8rem, 0.45fr) minmax(0, 1fr);
    }
  }
</style>
