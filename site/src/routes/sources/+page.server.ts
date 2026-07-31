import { table } from "$lib/server/dataset";

/**
 * Where items come from, and — just as importantly — where the model stops.
 *
 * This page exists to make the boundary visible. A reader who browses the item tables and never
 * meets a statement of what is missing will infer completeness, and 153 items have no modelled
 * source at all. That is a property of this pipeline, never evidence an item cannot be obtained.
 */

/** The rarity order the game itself uses, so a grouped list reads low to high rather than alphabetically. */
const RARITY_ORDER = ["common", "uncommon", "rare", "epic", "legendary", "mythic", "living"];

const SOURCE_TITLES: Record<string, { title: string; blurb: string }> = {
  recipe: { title: "Crafted", blurb: "Made at a station, gated by the Crafting skill." },
  enemy: { title: "Dropped", blurb: "Rolled from an enemy's drop table when it dies." },
  gathering: { title: "Gathered", blurb: "Taken from a world node, gated by the Gathering skill." },
  shop: { title: "Bought", blurb: "Stocked by the shop, gated by combat level." },
  quest: { title: "Quest reward", blurb: "Handed over on completing a quest." },
  world_boss: { title: "World boss", blurb: "The gear a world boss awards." },
};

/** Systems the pipeline does not model, named so the gap is specific rather than vague. */
const UNMODELLED_SYSTEMS = [
  "Talents",
  "Elements",
  "Factions",
  "Mercenaries",
  "Bank",
  "Caravans",
  "Dominion",
  "the Tower",
  "the Spire",
  "the Celestial Forge",
  "Tower Vanguards",
  "the Veiled Reliquary",
  "Reliquary Expeditions",
  "the Frontier",
  "Leaderboards",
  "Event Calendar",
];

export const load = () => {
  const items = table("items");
  const sources = table("item_sources");

  const itemsById = new Map(items.map((item) => [String(item.id), item]));

  const byKind = new Map<string, Set<string>>();
  for (const source of sources) {
    const kind = String(source.source_kind);
    const set = byKind.get(kind);
    if (set) set.add(String(source.item_id));
    else byKind.set(kind, new Set([String(source.item_id)]));
  }

  const kinds = [...byKind.entries()]
    .map(([kind, itemIds]) => {
      const rarities = new Map<string, number>();
      for (const id of itemIds) {
        const rarity = String(itemsById.get(id)?.rarity ?? "unknown");
        rarities.set(rarity, (rarities.get(rarity) ?? 0) + 1);
      }
      return {
        kind,
        title: SOURCE_TITLES[kind]?.title ?? kind,
        blurb: SOURCE_TITLES[kind]?.blurb ?? "",
        rows: sources.filter((source) => source.source_kind === kind).length,
        items: itemIds.size,
        rarities: [...rarities.entries()]
          .sort((left, right) => {
            const rank = (value: string): number => {
              const index = RARITY_ORDER.indexOf(value);
              return index === -1 ? RARITY_ORDER.length : index;
            };
            return rank(left[0]) - rank(right[0]);
          })
          .map(([rarity, count]) => ({ rarity, count })),
      };
    })
    .sort((left, right) => right.items - left.items);

  const unsourced = items.filter((item) => item.has_modelled_source !== true);
  const unlevelled = items.filter((item) => item.level_source === "unknown");

  return {
    kinds,
    itemTotal: items.length,
    sourcedTotal: items.length - unsourced.length,
    unsourced: unsourced
      .map((item) => ({
        id: String(item.id),
        name: String(item.name ?? item.id),
        image: (item.image as string | null) ?? null,
        rarity: (item.rarity as string | null) ?? null,
        type: String(item.type ?? ""),
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    unlevelledCount: unlevelled.length,
    unmodelled: UNMODELLED_SYSTEMS,
  };
};
