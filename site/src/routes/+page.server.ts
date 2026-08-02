import { COMPENDIUM_INDEX, ROUTE_CHAPTERS } from "$lib/browse";
import { CLASSES } from "$lib/classes";
import { tableLabel } from "$lib/labels";
import { entityTables, table } from "$lib/server/dataset";
import { mechanicDocuments } from "$lib/server/mechanics";
import { guideContentLabel } from "$lib/mechanics-verification";
import type {
  MechanicVerificationStatus,
  PublishedMechanicDocument,
  PublishedMechanicText,
} from "$lib/mechanics-verification";

/**
 * The home page explains the shipped systems before it exposes the database, so the load assembles
 * four real things in that order: the five system guides, the four classes as the game presents
 * them, the normal Combat route in three chapters, and the complete record index.
 *
 * No example rows and no counts standing in for content. A row count describes a schema; the guides
 * and the route describe the game.
 */

/** The one extracted formula the home shows, named by its semantic ID rather than by position. */
const FEATURED_FORMULA_TEXT_ID = "combat.defense.normal-mitigation.expression";

/** The two guides the home gives their own treatment. The remaining three are field-manual rows. */
const LEAD_GUIDE = "combat-mathematics";
const ROUTE_GUIDE = "endgame-systems";

/** How many stops each route chapter names. Three is enough to show a chapter's range. */
const STOPS_PER_CHAPTER = 3;

/**
 * One rendered claim, reduced to what the page needs.
 *
 * The published text carries its evidence closure and probe contract hashes. None of that belongs
 * in a prerendered home page: it costs transfer on the site's busiest route, and the guide pages are
 * where a reader inspects provenance in full.
 */
type HomeText = { id: string; text: string; status: MechanicVerificationStatus };

type Place = {
  id: string;
  name: string;
  image: string | null;
  kind: string;
  level: number | null;
};

export const load = async () => {
  const documents = await mechanicDocuments();

  const leadGuide = guideCard(pick(documents, LEAD_GUIDE));
  const routeDocument = pick(documents, ROUTE_GUIDE);
  const routeGuide = {
    ...guideCard(routeDocument),
    /* The endgame guide is rendered as the route it describes, so its section titles travel with it.
       They are game-authored, and each keeps its own ID and status. */
    steps: routeDocument.sections.map((section) => homeText(section.title)),
  };
  const fieldGuides = documents
    .filter((document) => document.id !== LEAD_GUIDE && document.id !== ROUTE_GUIDE)
    .map(guideCard);

  const featuredFormula = findFeaturedFormula(documents);

  const entities = entityTables();
  const byName = new Map(entities.map((entry) => [entry.name, entry]));
  const indexTables = COMPENDIUM_INDEX.map((name) => {
    const spec = byName.get(name);
    if (!spec) throw new Error(`Compendium index table missing: ${name}`);
    return { name, slug: spec.slug, label: tableLabel(name), rows: spec.rows };
  });

  const abilities = table("abilities");
  const items = table("items");
  const traits = table("class_traits");
  const classRows = table("classes");

  const classes = CLASSES.map((id) => {
    const record = classRows.find((row) => row.id === id);
    return {
      id,
      name: typeof record?.name === "string" ? record.name : id,
      title: typeof record?.title === "string" ? record.title : "",
      worldRole: typeof record?.world_role === "string" ? record.world_role : "",
      image: typeof record?.image === "string" ? record.image : null,
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
  const allPlaces = table("zones_dungeons");
  const route: Place[] = allPlaces
    .filter(
      (place) =>
        !place.heroic &&
        !place.nightmare &&
        !/\bretired\b|\blegacy\b/i.test(String(place.description ?? "")),
    )
    .map((place) => ({
      id: String(place.id),
      name: String(place.name),
      image: typeof place.image === "string" ? place.image : null,
      kind: String(place.type ?? "zone"),
      level: typeof place.combat_level === "number" ? place.combat_level : null,
    }))
    .sort((left, right) => (left.level ?? 0) - (right.level ?? 0));

  const chapters = ROUTE_CHAPTERS.map((chapter) => {
    const places = route.filter((place) => chapterIdOf(place) === chapter.id);
    if (places.length === 0) return null;
    const levels = places
      .map((place) => place.level)
      .filter((level): level is number => level !== null);
    if (levels.length === 0) throw new Error("Route chapter has no Combat level");
    return {
      id: chapter.id,
      label: chapter.label,
      blurb: chapter.blurb,
      from: Math.min(...levels),
      to: Math.max(...levels),
      count: places.length,
      panorama: places.find((place) => place.image !== null) ?? places[0]!,
      stops: representative(places),
    };
  }).filter((chapter) => chapter !== null);

  /*
   * The hero panorama. A dungeon is preferred because the dungeon art is the most composed
   * landscape the game ships, and a place with no art would put two initials in the one frame the
   * page leads on — so the search falls back through any illustrated place before it accepts that.
   */
  const heroPlace =
    route.find((place) => place.kind === "dungeon" && place.image !== null) ??
    route.find((place) => place.image !== null) ??
    route[0] ??
    null;

  const levelCeiling = Math.max(
    ...allPlaces
      .map((place) => place.combat_level)
      .filter((level): level is number => typeof level === "number"),
  );

  return {
    leadGuide,
    routeGuide,
    fieldGuides,
    featuredFormula,
    classes,
    chapters,
    heroPlace,
    indexTables,
    mechanicCount: documents.length,
    // Only what the index actually lists, so the headline figure and the counts beneath it agree
    // when a reader adds them up.
    recordCount: indexTables.reduce((sum, entry) => sum + entry.rows, 0),
    unmodelledItems: items.filter((item) => item.has_modelled_source !== true).length,
    endgamePlaces: allPlaces.filter((place) => place.heroic || place.nightmare).length,
    levelCeiling,
  };
};

function homeText(text: PublishedMechanicText): HomeText {
  return { id: text.id, text: text.text, status: text.verification.status };
}

function pick(documents: PublishedMechanicDocument[], id: string): PublishedMechanicDocument {
  const document = documents.find((entry) => entry.id === id);
  if (!document) throw new Error(`Mechanic document missing: ${id}`);
  return document;
}

function guideCard(document: PublishedMechanicDocument) {
  return {
    id: document.id,
    category: document.category,
    title: document.title.text,
    summary: document.summary.text,
    /* The same scoped stamp the guide index prints. It states what the guide's own contents are
       checked against, and never that the whole guide is live verified. */
    contentLabel: guideContentLabel(document),
  };
}

/**
 * The Defense mitigation formula, found by the semantic ID of its expression.
 *
 * Section order and array position are extraction details that can move between builds without any
 * claim changing, so neither is used to locate it. A miss fails the build naming the ID, because a
 * home page that quietly drops its one worked example is worse than one that does not build.
 */
function findFeaturedFormula(documents: PublishedMechanicDocument[]): {
  label: HomeText;
  expression: HomeText;
  note: HomeText | null;
} {
  for (const section of pick(documents, LEAD_GUIDE).sections) {
    for (const formula of section.formulas) {
      if (formula.expression.id !== FEATURED_FORMULA_TEXT_ID) continue;
      return {
        label: homeText(formula.label),
        expression: homeText(formula.expression),
        note: formula.note === null ? null : homeText(formula.note),
      };
    }
  }
  throw new Error(`Mechanic formula missing: ${FEATURED_FORMULA_TEXT_ID}`);
}

/**
 * Which chapter a place belongs to.
 *
 * A place the game never gave a Combat level sorts to the front of the route and joins the opening
 * chapter rather than disappearing from it. That keeps the route complete, and it keeps the
 * "chapter with no Combat level" failure reachable instead of hiding the case by construction.
 */
function chapterIdOf(place: Place): string {
  const chapter = ROUTE_CHAPTERS.find(
    (entry) =>
      place.level !== null &&
      place.level >= entry.from &&
      (entry.to === null || place.level <= entry.to),
  );
  return (chapter ?? ROUTE_CHAPTERS[0]!).id;
}

/**
 * Three stops that stand for a chapter: its first place, its middle, and its last.
 *
 * Adjacent rows would show the sort order rather than the chapter, and the sort order here is the
 * level, so the first three would always be the lowest three and never reach the dungeon the
 * chapter closes on.
 */
function representative(places: Place[]): Place[] {
  if (places.length <= STOPS_PER_CHAPTER) return places;
  const middle = places[Math.floor((places.length - 1) / 2)]!;
  return [places[0]!, middle, places[places.length - 1]!];
}
