import { table } from "$lib/server/dataset";

/**
 * Builds the level spine from the first zone to the last.
 *
 * Twelve base zones define combat bands because the game gates them by Combat level.
 * Each band starts at its zone level and ends before the next zone.
 * The last band ends at the highest level in the data.
 *
 * Keep Combat, Gathering, and Crafting scales separate.
 * A band uses a Combat range. Nodes and recipes use their own scales within that numeric range.
 * The page labels this distinction. The game's quest guidance makes the same distinction at Gathering 10 and Crafting 10.
 */
export const load = () => {
  const zones = table("zones_dungeons");
  const quests = table("quests");
  const nodes = table("gathering_nodes");
  const recipes = table("recipes");

  const level = (value: unknown): number | null => (typeof value === "number" ? value : null);

  const baseZones = zones
    .filter((zone) => zone.type === "zone" && !zone.heroic && !zone.nightmare)
    .sort((left, right) => (level(left.combat_level) ?? 0) - (level(right.combat_level) ?? 0));

  const ceiling = Math.max(
    ...zones.map((zone) => level(zone.combat_level) ?? 0),
    ...quests.map((quest) => level(quest.combat_level) ?? 0),
  );

  const bands = baseZones.map((zone, index) => {
    const from = level(zone.combat_level) ?? 1;
    const next = baseZones[index + 1];
    const to = next ? (level(next.combat_level) ?? from) - 1 : ceiling;
    const inCombatBand = (value: unknown): boolean => {
      const numeric = level(value);
      return numeric !== null && numeric >= from && numeric <= to;
    };

    const bandRecipes = recipes.filter((recipe) => inCombatBand(recipe.crafting_level));

    return {
      from,
      to,
      zone: {
        id: String(zone.id),
        name: String(zone.name ?? zone.id),
        image: (zone.image as string | null) ?? null,
        act: level(zone.act),
      },
      // Place each other location by its own Combat level.
      // Heroic zones and nightmare dungeons are separate places, not base-zone variants.
      // Keep their flags instead of folding them into a base zone.
      places: zones
        .filter((entry) => entry.id !== zone.id && inCombatBand(entry.combat_level))
        .map((entry) => ({
          id: String(entry.id),
          name: String(entry.name ?? entry.id),
          image: (entry.image as string | null) ?? null,
          type: String(entry.type ?? "zone"),
          level: level(entry.combat_level),
          heroic: entry.heroic === true,
          nightmare: entry.nightmare === true,
        }))
        .sort((left, right) => (left.level ?? 0) - (right.level ?? 0)),
      quests: quests
        .filter((quest) => inCombatBand(quest.combat_level))
        .map((quest) => ({
          id: String(quest.id),
          name: String(quest.name ?? quest.id),
          category: String(quest.category ?? "side"),
          level: level(quest.combat_level),
        }))
        // Main quests come before side quests, then tutorials. The main chain is the player spine.
        .sort((left, right) => {
          const rank = (category: string): number =>
            category === "main" ? 0 : category === "side" ? 1 : 2;
          return rank(left.category) - rank(right.category) || (left.level ?? 0) - (right.level ?? 0);
        }),
      nodes: nodes
        .filter((node) => inCombatBand(node.gathering_level))
        .map((node) => ({
          id: String(node.id),
          name: String(node.name ?? node.id),
          image: (node.image as string | null) ?? null,
          type: String(node.type ?? ""),
          level: level(node.gathering_level),
        }))
        .sort((left, right) => (left.level ?? 0) - (right.level ?? 0)),
      recipeCount: bandRecipes.length,
      recipes: [...bandRecipes]
        .sort((left, right) => (level(right.xp) ?? 0) - (level(left.xp) ?? 0))
        .slice(0, 3)
        .map((recipe) => ({
          id: String(recipe.id),
          name: String(recipe.name ?? recipe.id),
          level: level(recipe.crafting_level),
          category: String(recipe.category ?? ""),
        })),
    };
  });

  return { bands, ceiling };
};
