import { error } from "@sveltejs/kit";
import { BROWSE_COLUMNS, FACETS, LEVEL_COLUMN } from "$lib/browse";
import { browsableTables, primaryKeyColumn, table, tableBySlug } from "$lib/server/dataset";

export const entries = () => browsableTables().map((entry) => ({ table: entry.slug }));

/**
 * Sends only the columns that the browser shows.
 *
 * Prerendered pages inline every row. Sending the full row put 949 item descriptions into `/items/`.
 * That data adds hundreds of kilobytes that readers do not see.
 * The record page and `/query/` still provide the full row.
 */
export const load = ({ params }: { params: { table: string } }) => {
  const spec = tableBySlug(params.table);
  if (!spec || spec.kind !== "entity") {
    throw error(404, `Dataset not found: ${params.table}`);
  }

  const keyColumn = primaryKeyColumn(spec.name);
  const schema = new Map(spec.columns.map((column) => [column.name, column.type]));
  const levelColumn = LEVEL_COLUMN[spec.name] ?? null;

  const needed = new Set<string>([
    keyColumn,
    ...(BROWSE_COLUMNS[spec.name] ?? spec.columns.map((column) => column.name)),
    ...(FACETS[spec.name] ?? []),
  ]);
  if (schema.has("name")) needed.add("name");
  if (schema.has("rarity")) needed.add("rarity");
  if (schema.has("image")) needed.add("image");
  // Keep this column so the level filter can state how many rows it hides.
  if (spec.name === "items") needed.add("level_source");
  if (levelColumn) needed.add(levelColumn);

  const columns = [...needed].filter((column) => schema.has(column));
  const rows = table(spec.name).map((row) =>
    Object.fromEntries(columns.map((column) => [column, row[column] ?? null])),
  );

  return {
    slug: spec.slug,
    name: spec.name,
    keyColumn,
    levelColumn,
    displayColumns: (BROWSE_COLUMNS[spec.name] ?? columns).filter((column) => schema.has(column)),
    facetColumns: (FACETS[spec.name] ?? []).filter((column) => schema.has(column)),
    columnTypes: Object.fromEntries(columns.map((column) => [column, schema.get(column)!])),
    rows,
  };
};
