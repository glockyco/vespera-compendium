import { error } from "@sveltejs/kit";
import { entityKeys, primaryKeyColumn, rowByKey, tableBySlug } from "$lib/server/dataset";
import { relatedFor } from "$lib/server/related";

export const entries = () => entityKeys();

export const load = ({ params }: { params: { table: string; id: string } }) => {
  const spec = tableBySlug(params.table);
  if (!spec || spec.kind !== "entity") {
    throw error(404, `Dataset not found: ${params.table}`);
  }

  const keyColumn = primaryKeyColumn(spec.name);
  const row = rowByKey(spec.name, params.id);
  if (!row) throw error(404, `${spec.name} record not found: ${params.id}`);

  const nameValue = row.name;
  const heading = typeof nameValue === "string" && nameValue.length > 0 ? nameValue : String(row[keyColumn]);

  return {
    slug: spec.slug,
    name: spec.name,
    keyColumn,
    columns: spec.columns.map(({ name, type }) => ({ name, type })),
    row,
    related: relatedFor(spec.name, row),
    heading,
  };
};
