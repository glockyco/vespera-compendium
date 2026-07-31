import { manifest } from "$lib/server/dataset";

/**
 * The build stamp belongs in the footer of every page rather than in the home page's opening line.
 * It is provenance, which matters, but a player arriving with a question should not have to read
 * schema metadata before reaching the answer.
 */
export const load = () => {
  const data = manifest();
  return {
    buildId: data.buildId,
    schemaVersion: data.schemaVersion,
    generatedAt: data.generatedAt,
  };
};
