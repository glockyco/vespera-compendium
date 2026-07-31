import { error } from "@sveltejs/kit";
import { entityKeys, primaryKeyColumn, rowByKey, tableBySlug } from "$lib/server/dataset";
import { headingFor, shapeFor } from "$lib/server/related";

export const entries = () => entityKeys();

/**
 * The page receives a shaped record rather than the raw row plus a pile of related tables. Shaping
 * happens here because it is a build-time join across up to six tables, and doing it in the
 * component would ship those tables to the browser to answer a question already settled.
 */
export const load = ({ params }: { params: { table: string; id: string } }) => {
  const spec = tableBySlug(params.table);
  if (!spec || spec.kind !== "entity") {
    throw error(404, `Dataset not found: ${params.table}`);
  }

  const row = rowByKey(spec.name, params.id);
  if (!row) throw error(404, `${spec.name} record not found: ${params.id}`);

  const heading = headingFor(spec.name, row);
  const level = spec.name === "items" ? { value: row.level, source: String(row.level_source ?? "unknown") } : null;

  return {
    slug: spec.slug,
    name: spec.name,
    id: String(row[primaryKeyColumn(spec.name)]),
    heading: heading.title,
    headingSub: heading.sub,
    level,
    shape: shapeFor(spec.name, row),
  };
};
