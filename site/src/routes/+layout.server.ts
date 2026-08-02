import { manifest } from "$lib/server/dataset";

/**
 * Puts the build stamp in every page footer instead of the home page opening.
 * The stamp gives provenance, but readers can reach answers before schema metadata.
 */
export const load = () => {
  const data = manifest();
  return {
    buildId: data.buildId,
    schemaVersion: data.schemaVersion,
    generatedAt: data.generatedAt,
  };
};
