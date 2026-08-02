/**
 * Converts published values to the words a player reads.
 *
 * Raw values can be unreadable, ambiguous, or hidden game identifiers.
 * For example, `0.05625`, a bare `10`, and `maxHp` need context.
 * One module formats these values the same way on every page.
 * It also keeps the three level scales separate.
 */

/** `0.05625` becomes `5.6%`. Below one tenth of a percent, the exact figure is noise. */
export function chance(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value >= 1) return "always";
  if (value < 0.001) return "<0.1%";
  const percent = value * 100;
  return `${percent < 10 ? percent.toFixed(1) : Math.round(percent)}%`;
}

/** Formats milliseconds as the game states them: `13000` becomes `13s`, and `300000` becomes `5m`. */
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

/** These stats use percentages. Other stats use flat amounts, so `+120` and `4%` stay distinct. */
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

/** The game publishes stat keys in camelCase. `maxHp` becomes `Max HP`, and `critChance` becomes `Crit chance`. */
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
 * `gathering_nodes.type` and `zone_resources.resource_kind` name four activities with different words.
 * For example, one uses `hunt` and the other uses `hunting`.
 * The page uses one vocabulary, so a zone and its linked node agree.
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

/** Names the three level scales so a reader never has to guess a bare number. */
export const LEVEL_SCALES = {
  combat: "Combat",
  gathering: "Gathering",
  crafting: "Crafting",
} as const;

/**
 * Returns the provenance sentence beside each item level.
 * An item without a modelled level states that boundary instead of showing a blank.
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
