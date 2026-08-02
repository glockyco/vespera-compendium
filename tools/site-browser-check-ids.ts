export const SITE_BROWSER_DOCUMENT_IDS = [
  "combat-mathematics",
  "ability-calculations",
  "skills-and-crafting",
  "equipment-and-value",
  "endgame-systems",
] as const;

export const SITE_BROWSER_MAPPED_TABLES = [
  "classes",
  "enemies",
  "abilities",
  "recipes",
  "gathering-nodes",
  "items",
  "gems",
  "affixes",
  "shops",
] as const;

export const SITE_BROWSER_SEARCH_CASES = ["defense", "ability", "craft", "tower"] as const;

export const SITE_BROWSER_VIEWPORTS = ["1440x900", "390x844", "320x700"] as const;

export const SITE_BROWSER_SMOKE_ROUTES = [
  "/",
  "/mechanics/",
  "/mechanics/combat-mathematics/",
  "/mechanics/ability-calculations/",
  "/mechanics/skills-and-crafting/",
  "/mechanics/equipment-and-value/",
  "/mechanics/endgame-systems/",
  "/items/",
  "/items/eclipse_gem_ruby/",
  "/abilities/",
  "/classes/",
  "/progression/",
  "/query/",
  "/sheets/",
] as const;

function prefixed(prefix: string, values: readonly string[]): string[] {
  return values.map((value) => `${prefix}.${value}`);
}

export const SITE_BROWSER_CHECK_IDS: readonly string[] = Object.freeze([
  ...prefixed("guide-contract", SITE_BROWSER_DOCUMENT_IDS),
  ...prefixed("guide-text", SITE_BROWSER_DOCUMENT_IDS),
  ...prefixed("guide-hrefs", SITE_BROWSER_DOCUMENT_IDS),
  ...prefixed("guide-provenance", SITE_BROWSER_DOCUMENT_IDS),
  ...prefixed("index-card", SITE_BROWSER_DOCUMENT_IDS),
  ...prefixed("mapped-link", SITE_BROWSER_MAPPED_TABLES),
  ...prefixed("search", SITE_BROWSER_SEARCH_CASES),
  ...prefixed("responsive", SITE_BROWSER_VIEWPORTS),
  ...prefixed("no-internals", SITE_BROWSER_SMOKE_ROUTES),
  ...prefixed("smoke", SITE_BROWSER_SMOKE_ROUTES),
  "endgame-copy",
  "endgame-counts",
  "progression-links",
  "combobox-ids",
  "lazy-search-transfer",
  "search-keyboard",
  "desktop-fold",
  "eager-image",
  "art-variants",
  "transfer-budget",
  "prerender-content",
]);

export const EXPECTED_SITE_BROWSER_CHECK_IDS = SITE_BROWSER_CHECK_IDS;
