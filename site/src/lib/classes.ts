/**
 * The four classes, and the nine equipment slots the game defines.
 *
 * Both lists are closed sets in the shipped data — 27 abilities per class, exactly nine slots — so
 * they are declared rather than derived. A class page renders all nine slots even where a class has
 * no restricted item for one, because the nine-slot shape is what a player is comparing against and
 * a silently shorter list reads as missing data.
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
 * Ability categories in the order a player meets them: the normal rotation first, then the sustain,
 * then the payoff, then the subclass specialisation.
 */
export const ABILITY_CATEGORY_ORDER = ["normal", "heal", "ultimate", "subclass"] as const;

export const CLASS_BLURB: Record<ClassId, string> = {
  barbarian: "Heavy weapons and staying power.",
  arcanist: "Elemental damage and burst.",
  warden: "Ranged control and sustain.",
  nightblade: "Speed, crits and evasion.",
};
