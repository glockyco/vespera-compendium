import { error } from "@sveltejs/kit";
import { entityKeys, primaryKeyColumn, rowByKey, tableBySlug } from "$lib/server/dataset";
import { mechanicDocuments, mechanicLinksFor } from "$lib/server/mechanics";
import { headingFor, shapeFor } from "$lib/server/related";

export const entries = () => entityKeys();

/**
 * Loads a shaped record instead of a raw row and related tables.
 * Shaping runs at build time across up to six tables.
 * Doing it in the component sends those tables to the browser for a settled question.
 */
export const load = async ({ params }: { params: { table: string; id: string } }) => {
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
    // Put the rule before the record fields. Readers need the sell-value rule to use the value.
    guides: mechanicLinksFor(spec.name, row, await mechanicDocuments()),
    shape: shapeFor(spec.name, row),
  };
};
