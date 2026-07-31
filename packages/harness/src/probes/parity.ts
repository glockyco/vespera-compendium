import { composeAll, type ComposedTables } from "@vespera/pipeline";
import type { RuntimeTable } from "../identify.ts";
import type { ProbeResult } from "../types.ts";

export const TABLE_IDS = [
  "items",
  "enemies",
  "recipes",
  "gatheringNodes",
  "quests",
  "abilities",
  "affixes",
  "gems",
  "shopListings",
  "zonesDungeons",
  "achievements",
] as const;

export type TableId = (typeof TABLE_IDS)[number];

export function runParityProbes(
  buildId: string,
  extractedDir: string,
  identified: RuntimeTable[],
  composed: ComposedTables = composeAll(extractedDir),
): ProbeResult[] {
  const runtime = new Map(identified.map((table) => [table.id, table]));
  return TABLE_IDS.map((id) => {
    const live = runtime.get(id);
    if (!live) {
      return {
        buildId,
        id,
        suite: "parity",
        status: "UNRESOLVED",
        detail: `${id}: no exported runtime table matched its content shape`,
      };
    }
    const expected = composed[id]?.live;
    if (typeof expected !== "number") {
      return {
        buildId,
        id,
        suite: "parity",
        status: "FAIL",
        detail: `${id}: static composed table is unavailable`,
        observed: live.count,
      };
    }
    const status = live.count === expected ? "PASS" : "FAIL";
    return {
      buildId,
      id,
      suite: "parity",
      status,
      detail: `${id}: alias=${live.alias} live=${live.count} static=${expected}`,
      observed: live.count,
      expected,
    };
  });
}
