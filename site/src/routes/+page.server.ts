import { BROWSE_GROUPS } from "$lib/browse";
import { entityTables, table } from "$lib/server/dataset";

/**
 * The home page is a way in, not an index, so the load returns the browse groups already ordered by
 * measured question demand plus the few counts worth stating up front.
 */
export const load = () => {
  const counts = new Map(entityTables().map((entry) => [entry.name, entry.rows]));
  const slugs = new Map(entityTables().map((entry) => [entry.name, entry.slug]));

  const groups = BROWSE_GROUPS.map((group) => ({
    question: group.question,
    tables: group.tables
      .filter((name) => counts.has(name))
      .map((name) => ({ name, slug: slugs.get(name)!, rows: counts.get(name)! })),
  }));

  const zones = table("zones_dungeons");
  const levels = zones
    .map((zone) => zone.combat_level)
    .filter((level): level is number => typeof level === "number");

  return {
    groups,
    totalRecords: [...counts.values()].reduce((sum, rows) => sum + rows, 0),
    itemCount: counts.get("items") ?? 0,
    levelFloor: Math.min(...levels),
    levelCeiling: Math.max(...levels),
  };
};
