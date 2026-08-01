import { BROWSE_GROUPS } from "$lib/browse";
import { CLASSES } from "$lib/classes";
import { browsableTables, rowsWhere, table } from "$lib/server/dataset";

/**
 * The home page opens as the game's own class select, so the load's job is to assemble three real
 * things rather than a table of contents: the four classes with the copy and portraits the game
 * ships, every place a player passes through in level order, and genuine example records per
 * browsable table. Counts alone were what made the previous version read as a schema dump.
 */

/** How many example records each browse group shows. Two is enough to imply a table's range. */
const EXAMPLES_PER_TABLE = 2;

type Example = {
  id: string;
  name: string;
  image: string | null;
  rarity: string | null;
};

/**
 * Two records that stand for a table.
 *
 * Adjacent rows would show the sort order rather than the contents — the first two items are
 * `Aberration Core` and `Aberration Shard` — so the pick is spread across the table. Items are
 * additionally restricted to rows the compendium can actually answer for: 153 of 949 have no
 * modelled source, and leading the page with two of them teaches a visitor the opposite of what
 * the lede promises.
 */
function examples(name: string, keyColumn: string): Example[] {
  const rows = table(name);
  const answerable =
    name === "items" ? rows.filter((row) => row.has_modelled_source === true) : rows;
  const pool = answerable.length >= EXAMPLES_PER_TABLE ? answerable : rows;
  const withArt = pool.filter((row) => typeof row.image === "string" && row.image);
  const source = withArt.length >= EXAMPLES_PER_TABLE ? withArt : pool;

  const picks = Array.from({ length: EXAMPLES_PER_TABLE }, (_, index) =>
    source[Math.floor((index * source.length) / EXAMPLES_PER_TABLE)],
  ).filter((row): row is NonNullable<typeof row> => Boolean(row));

  return picks.map((row) => ({
    id: String(row[keyColumn] ?? ""),
    name: String(row.name ?? row.id ?? ""),
    image: (row.image as string | null) ?? null,
    rarity: (row.rarity as string | null) ?? null,
  }));
}

export const load = () => {
  const tables = browsableTables();
  const counts = new Map(tables.map((entry) => [entry.name, entry.rows]));
  const slugs = new Map(tables.map((entry) => [entry.name, entry.slug]));
  const keys = new Map(tables.map((entry) => [entry.name, entry.primaryKey[0] ?? "id"]));

  const abilities = table("abilities");
  const items = table("items");
  const traits = table("class_traits");
  const classRows = table("classes");

  const classes = CLASSES.map((id) => {
    const record = classRows.find((row) => row.id === id);
    return {
      id,
      name: (record?.name as string) ?? id,
      title: (record?.title as string) ?? "",
      worldRole: (record?.world_role as string) ?? "",
      image: (record?.image as string | null) ?? null,
      traits: traits.filter((trait) => trait.class_id === id).map((trait) => String(trait.label)),
      abilityCount: abilities.filter((ability) => ability.required_class === id).length,
      itemCount: items.filter((item) => item.class_requirement === id).length,
    };
  });

  /*
   * Every place a player passes through, in level order: zones and dungeons interleaved, because
   * the game interleaves them. Filtering to `type === "zone"` silently dropped six dungeons sitting
   * inside the range — Blackvein Warrens at 18, Null Meridian at 92 — which made "in the order you
   * meet them" false for a quarter of the route.
   *
   * Two exclusions, both stated on the page rather than silent. Heroic and nightmare variants are
   * counted, not listed, since repeating each name three times would stop this reading as a route.
   * And `unnamed_abyss` is "a retired legacy route preserved only for old saves", so it is not a
   * place anyone meets on the way up; it stays reachable through the zones browser.
   */
  const places = table("zones_dungeons");
  const retired = (row: (typeof places)[number]) =>
    /\bretired\b|\blegacy\b/i.test(String(row.description ?? ""));

  const spine = places
    .filter((place) => !place.heroic && !place.nightmare && !retired(place))
    .map((place) => ({
      id: String(place.id),
      name: String(place.name),
      image: (place.image as string | null) ?? null,
      kind: String(place.type ?? "zone"),
      level: typeof place.combat_level === "number" ? place.combat_level : null,
      description: String(place.description ?? ""),
      enemies: rowsWhere("zone_enemies", "zone_id", place.id).length,
    }))
    .sort((left, right) => (left.level ?? 0) - (right.level ?? 0));

  const endgame = places.filter((place) => place.heroic || place.nightmare).length;

  const groups = BROWSE_GROUPS.map((group) => ({
    question: group.question,
    tables: group.tables
      .filter((name) => counts.has(name))
      .map((name) => ({
        name,
        slug: slugs.get(name)!,
        rows: counts.get(name)!,
        examples: examples(name, keys.get(name)!),
      })),
  }));

  const levels = spine.map((place) => place.level).filter((level): level is number => level !== null);
  const allLevels = places
    .map((place) => place.combat_level)
    .filter((level): level is number => typeof level === "number");

  return {
    classes,
    spine,
    endgame,
    groups,
    // Only what the browse region actually lists, so the headline figure and the twelve counts
    // beneath it agree when a reader adds them up.
    totalRecords: [...counts.values()].reduce((sum, rows) => sum + rows, 0),
    unmodelledItems: items.filter((item) => item.has_modelled_source !== true).length,
    itemCount: counts.get("items") ?? 0,
    spineFloor: Math.min(...levels),
    spineCeiling: Math.max(...levels),
    levelCeiling: Math.max(...allLevels),
  };
};
