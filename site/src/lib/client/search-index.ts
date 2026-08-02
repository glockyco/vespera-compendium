/**
 * The one owner of the published search index in the browser.
 *
 * The index is 367 KiB, so it is fetched on first focus rather than on mount: a visitor who never
 * searches never pays for it. Two fields are on screen at once on every route that carries its own
 * instrument, and both must resolve to the same transfer, so the in-flight promise and the decoded
 * rows live here at module scope rather than in a component instance.
 *
 * A rejected promise is cleared, and only a rejected one. Keeping a fulfilled promise is the point,
 * and keeping a rejected one would make one dropped request permanent for the rest of the session.
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
 * Keys in the published JSON are abbreviated to keep it small. The mapping is expanded here and
 * published in the manifest, so it is not a private convention.
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

/**
 * Start or join the single transfer. Every mounted field calls this on first focus and on input, so
 * it must be cheap to call repeatedly.
 */
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
      // Only a failed attempt is forgotten, so the next focus can retry it.
      pending = null;
      throw error;
    });
  return pending;
}

/**
 * Where a search result goes.
 *
 * Mechanic guides are published into the same index as records so one field finds both, but they are
 * not a relational table and have no record route, so the synthetic `mechanics` table maps to the
 * guide URL instead of `/<slug>/<id>/`.
 */
export function searchHref(entry: SearchEntry): string {
  return entry.table === "mechanics" ? `/mechanics/${entry.id}/` : `/${entry.slug}/${entry.id}/`;
}

/**
 * Exact name, then name prefix, then name substring, then id substring, then subtitle substring;
 * shorter names win ties. Ranked rather than filtered because a substring match over the whole
 * index otherwise buries the record whose name the player actually typed.
 *
 * The subtitle rank sits last on purpose. It is what makes `defense`, `craft` and `tower` reach the
 * guide that explains them, and it must never outrank a record that carries the typed word in its
 * own name.
 *
 * One exception, and only one: the best matching system guide leads. Five guides sit against a few
 * thousand records, and a bare system word asks what the system is rather than which item is named
 * after it. It costs the reader one row, and every record keeps its order behind it. A scoped
 * browser filters guides out entirely, so this never touches an entity browser.
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
