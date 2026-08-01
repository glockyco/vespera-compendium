import { error } from "@sveltejs/kit";
import { BROWSE_COLUMNS, FACETS, LEVEL_COLUMN } from "$lib/browse";
import { browsableTables, primaryKeyColumn, table, tableBySlug } from "$lib/server/dataset";

export const entries = () => browsableTables().map((entry) => ({ table: entry.slug }));

/**
 * Only the columns the browser actually renders are sent.
 *
 * These pages are prerendered, so every row is inlined into the HTML. Shipping the full row put all
 * 949 item descriptions into `/items/`, which is several hundred kilobytes a reader never sees; the
 * complete row is one click away on the record page and always available through `/query/`.
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
  // Carried so the level filter can say how many rows it hides rather than dropping them silently.
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
