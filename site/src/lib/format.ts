/**
 * Turning published values into the words a player reads.
 *
 * Every function here exists because the raw value is either unreadable (`0.05625`), ambiguous
 * (a bare `10` that could be any of three level scales), or an identifier the game never shows a
 * player (`maxHp`). Formatting lives in one module so a number reads identically wherever it
 * appears, and so the rule that the three level scales are never merged has one place to hold.
 */

/** `0.05625` -> `5.6%`. Below a tenth of a percent, the exact figure is noise. */
export function chance(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value >= 1) return "always";
  if (value < 0.001) return "<0.1%";
  const percent = value * 100;
  return `${percent < 10 ? percent.toFixed(1) : Math.round(percent)}%`;
}

/** Milliseconds as the game states them: `13000` -> `13s`, `300000` -> `5m`. */
export function duration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)}m`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

export function gold(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : value.toLocaleString("en-US");
}

/**
 * The stats the game treats as percentages. Anything outside this set is a flat amount, so `+120`
 * and `4%` are never confused for one another.
 */
const PERCENT_STATS = new Set([
  "critChance",
  "blockChance",
  "blockReduction",
  "dodgeChance",
  "goldFind",
  "haste",
  "lifeSteal",
  "manaCostReduction",
  "poisonApplyChance",
]);

/** Stat keys ship in the game's camelCase. `maxHp` -> `Max HP`, `critChance` -> `Crit chance`. */
export function statLabel(stat: string): string {
  const spaced = stat
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\bHp\b/g, "HP")
    .replace(/\bXp\b/g, "XP")
    .replace(/\bMp\b/g, "MP")
    .toLowerCase()
    .replace(/\bhp\b/g, "HP")
    .replace(/\bxp\b/g, "XP")
    .replace(/\bmp\b/g, "MP");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function statValue(stat: string, value: number): string {
  if (PERCENT_STATS.has(stat)) {
    const percent = value <= 1 ? value * 100 : value;
    return `${Number.isInteger(percent) ? percent : Number(percent.toFixed(1))}%`;
  }
  return value > 0 ? `+${value.toLocaleString("en-US")}` : value.toLocaleString("en-US");
}

const SLOT_LABELS: Record<string, string> = {
  mainHand: "Main hand",
  offHand: "Off hand",
  head: "Head",
  chest: "Chest",
  legs: "Legs",
  amulet: "Amulet",
  ring1: "Ring",
  ring2: "Ring",
  relic1: "Relic",
};

export function slotLabel(slot: string): string {
  return SLOT_LABELS[slot] ?? statLabel(slot);
}

/**
 * `gathering_nodes.type` and `zone_resources.resource_kind` name the same four activities with
 * different words — `hunt` against `hunting`, `fish` against `fishing`. Display uses one vocabulary
 * so a zone's resource list and the node it links to do not appear to disagree.
 */
const NODE_KINDS: Record<string, string> = {
  ore: "Ore",
  wood: "Wood",
  hunt: "Hunting",
  hunting: "Hunting",
  fish: "Fishing",
  fishing: "Fishing",
};

export function nodeKind(kind: string): string {
  return NODE_KINDS[kind] ?? statLabel(kind);
}

/** The three level scales, each named so a bare number never has to be guessed at. */
export const LEVEL_SCALES = {
  combat: "Combat",
  gathering: "Gathering",
  crafting: "Crafting",
} as const;

/**
 * The provenance sentence shown beside every item level. An item with no modelled level says so
 * rather than showing a blank, because a missing level is a boundary of this model and not a
 * property of the item.
 */
export function levelNote(level: number | null, source: string): string {
  if (source === "unknown" || level === null) return "Level not modelled";
  switch (source) {
    case "game-balance":
      return `Level ${level}`;
    case "world-boss-gear":
      return `World boss gear, level ${level}`;
    case "crafting":
      return `Crafted at Crafting ${level}`;
    case "gathering":
      return `Gathered at Gathering ${level}`;
    case "enemy-drop":
      return `Drops from level ${level} enemies`;
    case "shop":
      return `Sold from Combat ${level}`;
    default:
      return `Level ${level}`;
  }
}

/** Sentence case for a published enum value: `attack_style` values, categories, rarities. */
export function titleCase(value: string | null): string {
  if (!value) return "—";
  const spaced = value.replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
