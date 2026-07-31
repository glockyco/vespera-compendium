import { entityTables, manifest } from "$lib/server/dataset";

export const load = () => {
  const data = manifest();
  const tables = entityTables().map(({ name, slug, rows }) => ({ name, slug, rows }));

  return {
    buildId: data.buildId,
    schemaVersion: data.schemaVersion,
    generatedAt: data.generatedAt,
    tables,
  };
};
