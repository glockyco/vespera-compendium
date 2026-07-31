import { manifest } from "$lib/server/dataset";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = () => {
  const data = manifest();

  return {
    buildId: data.buildId,
    generatedAt: data.generatedAt,
    tables: data.tables.map(({ name, rows, csv, kind }) => ({ name, rows, csv, kind })),
  };
};
