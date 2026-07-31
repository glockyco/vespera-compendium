import { error } from "@sveltejs/kit";
import {
  entityTables,
  primaryKeyColumn,
  table,
  tableBySlug,
} from "$lib/server/dataset";

export const entries = () => entityTables().map((entry) => ({ table: entry.slug }));

export const load = ({ params }: { params: { table: string } }) => {
  const spec = tableBySlug(params.table);
  if (!spec || spec.kind !== "entity") {
    throw error(404, `Dataset not found: ${params.table}`);
  }

  const keyColumn = primaryKeyColumn(spec.name);
  return {
    slug: spec.slug,
    name: spec.name,
    columns: spec.columns.map(({ name, type }) => ({ name, type })),
    keyColumn,
    rows: table(spec.name),
  };
};
