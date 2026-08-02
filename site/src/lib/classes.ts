/**
 * Defines the four classes and nine equipment slots from the game.
 *
 * Both lists are closed sets in the shipped data. Each class has 27 abilities and nine slots.
 * The class page shows all nine slots, including slots without restricted items.
 * A shorter list can look like missing data.
 */
export const CLASSES = ["barbarian", "arcanist", "warden", "nightblade"] as const;
export type ClassId = (typeof CLASSES)[number];

export function isClassId(value: string): value is ClassId {
  return (CLASSES as readonly string[]).includes(value);
}

export const SLOTS = [
  "mainHand",
  "offHand",
  "head",
  "chest",
  "legs",
  "amulet",
  "ring1",
  "ring2",
  "relic1",
] as const;

/**
 * Orders ability categories as a player meets them.
 * The normal rotation comes first, then sustain, payoff, and subclass specialization.
 */
export const ABILITY_CATEGORY_ORDER = ["normal", "heal", "ultimate", "subclass"] as const;
