/**
 * Owns the published search index in the browser.
 *
 * The index is 367 KiB. Load it on first focus instead of mount.
 * A visitor who never searches then pays no transfer cost.
 * Routes with two fields share the in-flight promise and decoded rows at module scope.
 * A rejected promise clears. A fulfilled promise stays, so one dropped request does not persist.
 */

export type SearchEntry = {
  table: string;
  id: string;
  slug: string;
  name: string;
  kind: string;
  subtitle: string | null;
  level: number | null;
  rarity: string | null;
  image: string | null;
};

/**
 * The published JSON uses short keys to reduce size.
 * This mapping expands them here and publishes it in the manifest.
 */
type PackedRow = {
  t: string;
  i: string;
  s: string;
  n: string;
  k: string;
  b: string | null;
  l: number | null;
  r: string | null;
  g: string | null;
};

const INDEX_URL = "/data/search_index.json";

let pending: Promise<SearchEntry[]> | null = null;
let decoded: SearchEntry[] | null = null;

function isPackedRow(value: unknown): value is PackedRow {
  if (typeof value !== "object" || value === null) return false;
  return (
    "t" in value &&
    typeof value.t === "string" &&
    "i" in value &&
    typeof value.i === "string" &&
    "s" in value &&
    typeof value.s === "string" &&
    "n" in value &&
    typeof value.n === "string" &&
    "k" in value &&
    typeof value.k === "string"
  );
}

function optionalText(row: PackedRow, key: "b" | "r" | "g"): string | null {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function decode(payload: unknown): SearchEntry[] {
  if (!Array.isArray(payload)) throw new Error("search index is not an array");
  return payload.map((row) => {
    if (!isPackedRow(row)) throw new Error("search index row is missing a required field");
    return {
      table: row.t,
      id: row.i,
      slug: row.s,
      name: row.n,
      kind: row.k,
      subtitle: optionalText(row, "b"),
      level: typeof row.l === "number" ? row.l : null,
      rarity: optionalText(row, "r"),
      image: optionalText(row, "g"),
    };
  });
}

/** Starts or joins the single transfer. Mounted fields call this on focus and input, so repeated calls stay cheap. */
export function loadSearchIndex(): Promise<SearchEntry[]> {
  if (decoded) return Promise.resolve(decoded);
  pending ??= fetch(INDEX_URL)
    .then(async (response) => {
      if (!response.ok) throw new Error(`search index request failed: ${response.status}`);
      const entries = decode(await response.json());
      decoded = entries;
      return entries;
    })
    .catch((error: unknown) => {
      // Forget only a failed attempt. The next focus can try again.
      pending = null;
      throw error;
    });
  return pending;
}

/**
 * Returns the destination for a search result.
 *
 * Mechanic guides share the index with records, but they have no record route.
 * The synthetic `mechanics` table therefore maps to the guide URL.
 */
export function searchHref(entry: SearchEntry): string {
  return entry.table === "mechanics" ? `/mechanics/${entry.id}/` : `/${entry.slug}/${entry.id}/`;
}

/**
 * Ranks exact names first, then prefixes, substrings, ids, and subtitles.
 * Shorter names win ties. Ranking keeps a matching name above a broad substring result.
 *
 * Subtitle matches stay last. They let `defense`, `craft`, and `tower` reach their guides.
 * They never outrank a record whose name contains the typed word.
 *
 * One exception moves the best system guide to the front.
 * Five guides share a few thousand records. A system word asks for the system, not a named item.
 * Scoped browsers remove guides before this function ranks records.
 */
export function rankSearchEntries(
  entries: SearchEntry[],
  needle: string,
  scopeTable: string | null,
): SearchEntry[] {
  if (needle.length === 0) return [];
  const scored: { entry: SearchEntry; rank: number }[] = [];
  for (const entry of entries) {
    if (scopeTable && entry.table !== scopeTable) continue;
    const name = entry.name.toLowerCase();
    const rank =
      name === needle
        ? 0
        : name.startsWith(needle)
          ? 1
          : name.includes(needle)
            ? 2
            : entry.id.toLowerCase().includes(needle)
              ? 3
              : entry.subtitle !== null && entry.subtitle.toLowerCase().includes(needle)
                ? 4
                : -1;
    if (rank >= 0) scored.push({ entry, rank });
  }
  scored.sort(
    (left, right) => left.rank - right.rank || left.entry.name.length - right.entry.name.length,
  );
  const ranked = scored.map((item) => item.entry);
  const bestGuide = ranked.findIndex((entry) => entry.table === "mechanics");
  if (bestGuide > 0) ranked.unshift(...ranked.splice(bestGuide, 1));
  return ranked;
}
