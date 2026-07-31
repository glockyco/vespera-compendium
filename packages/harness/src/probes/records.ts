import type { ComposedTables } from "@vespera/pipeline";
import type { CdpClient } from "../cdp.ts";
import type { RuntimeTable } from "../identify.ts";
import type { ProbeResult } from "../types.ts";
import { TABLE_IDS } from "./parity.ts";

type JsonRecord = Record<string, unknown>;

function recordsById(value: unknown): Map<string, JsonRecord> {
  if (Array.isArray(value)) {
    return new Map(
      value
        .filter((entry): entry is JsonRecord => Boolean(entry) && typeof entry === "object")
        .map((entry) => [String(entry.id ?? entry.itemId), entry]),
    );
  }
  if (value && typeof value === "object") {
    return new Map(
      Object.entries(value).filter((entry): entry is [string, JsonRecord] =>
        Boolean(entry[1]) && typeof entry[1] === "object",
      ),
    );
  }
  return new Map();
}

function sampledIds(records: Map<string, JsonRecord>): string[] {
  const ids = [...records.keys()].sort((left, right) => left.localeCompare(right));
  const step = Math.max(1, Math.ceil(ids.length / 10));
  const sampled: string[] = [];
  for (let index = 0; index < ids.length && sampled.length < 10; index += step) {
    sampled.push(ids[index]!);
  }
  return sampled;
}

function scalarLeaves(value: unknown, prefix = "", output = new Map<string, unknown>()): Map<string, unknown> {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
    output.set(prefix, value);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scalarLeaves(entry, `${prefix}[${index}]`, output));
    return output;
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value).sort()) {
      scalarLeaves((value as JsonRecord)[key], prefix ? `${prefix}.${key}` : key, output);
    }
  }
  return output;
}

const shown = (value: unknown): string => (value === undefined ? "<missing>" : JSON.stringify(value));

function transformationCategory(table: string, field = ""): string {
  if (table === "enemies") {
    if (field.startsWith("drops")) return "enemies.drop-normalization";
    if (/^(maxHp|damage|defense|xp)(\.|$)/.test(field)) return "enemies.stat-scaling";
    return "enemies.runtime-extension";
  }
  if (table === "items") {
    if (field.startsWith("stats")) return "items.stat-scaling";
    if (/^(classRequirement|rarity|stackable|id)(\.|$)/.test(field)) return "items.normalization";
    return "items.runtime-overlay";
  }
  if (table === "quests") {
    if (field.startsWith("rewards")) return "quests.reward-rebalance";
    if (field === "nextQuestId") return "quests.chain-rewrite";
    return "quests.runtime-overlay";
  }
  if (table === "abilities") return field.startsWith("tags") ? "abilities.tag-overlay" : "abilities.base-table";
  if (table === "gems") return field === "description" ? "gems.description-overlay" : "gems.base-table";
  if (table === "recipes") return field.startsWith("inputs") ? "recipes.input-normalization" : "recipes.runtime-filtering";
  if (table === "gatheringNodes") return field.startsWith("drops") ? "gathering.drop-normalization" : "gathering.runtime-extension";
  if (table === "achievements") return "achievements.active-filter";
  return `${table}.base-table`;
}

export async function runRecordProbes(
  buildId: string,
  client: CdpClient,
  indexBundle: string,
  identified: RuntimeTable[],
  composed: ComposedTables,
): Promise<ProbeResult[]> {
  const aliases = Object.fromEntries(identified.map(({ id, alias }) => [id, alias]));
  const staticRecords = new Map<string, Map<string, JsonRecord>>();
  const selections: Record<string, string[]> = {};
  for (const id of TABLE_IDS) {
    const records = recordsById(composed[id]?.value);
    staticRecords.set(id, records);
    selections[id] = sampledIds(records);
  }

  const expression = `(async () => {
    const namespace = await import(new URL(${JSON.stringify(`./assets/${indexBundle}`)}, location.href).href);
    const aliases = ${JSON.stringify(aliases)};
    const selections = ${JSON.stringify(selections)};
    const output = {};
    for (const [table, ids] of Object.entries(selections)) {
      const value = namespace[aliases[table]];
      const records = Array.isArray(value)
        ? Object.fromEntries(value.filter((entry) => entry && (entry.id != null || entry.itemId != null)).map((entry) => [String(entry.id ?? entry.itemId), entry]))
        : value;
      output[table] = Object.fromEntries(ids.map((id) => [id, records?.[id] ?? null]));
    }
    return output;
  })()`;
  const live = await client.evaluate<Record<string, Record<string, JsonRecord | null>>>(expression, 120_000);
  const results: ProbeResult[] = [];

  for (const id of TABLE_IDS) {
    const differences: ProbeResult[] = [];
    const coveredCategories = new Set<string>();
    for (const recordId of selections[id]!) {
      const staticRecord = staticRecords.get(id)?.get(recordId);
      const liveRecord = live[id]?.[recordId];
      if (!staticRecord || !liveRecord) {
        const category = transformationCategory(id);
        coveredCategories.add(category);
        differences.push({
          buildId,
          id: `${id}.${recordId}`,
          suite: "records",
          status: "FAIL",
          category,
          detail: `${id}.${recordId}: live=${liveRecord ? "present" : "<missing>"} static=${staticRecord ? "present" : "<missing>"}`,
        });
        continue;
      }
      const staticLeaves = scalarLeaves(staticRecord);
      const liveLeaves = scalarLeaves(liveRecord);
      const fields = [...new Set([...staticLeaves.keys(), ...liveLeaves.keys()])].sort();
      for (const field of fields) {
        const expected = staticLeaves.get(field);
        const observed = liveLeaves.get(field);
        const category = transformationCategory(id, field);
        coveredCategories.add(category);
        if (Object.is(observed, expected)) continue;
        differences.push({
          buildId,
          id: `${id}.${recordId}.${field}`,
          suite: "records",
          status: "FAIL",
          category,
          detail: `${id}.${recordId}.${field}: live=${shown(observed)} static=${shown(expected)}`,
          observed,
          expected,
        });
      }
    }
    if (differences.length > 0) results.push(...differences);
    else {
      for (const category of coveredCategories) {
        results.push({
          buildId,
          id,
          suite: "records",
          status: "PASS",
          category,
          detail: `${id}: ${selections[id]!.length} deterministic samples matched`,
        });
      }
    }
  }
  return results;
}
