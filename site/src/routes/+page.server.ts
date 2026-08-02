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
 * Builds the home page in reading order.
 * The page first shows five system guides, then four game classes.
 * It next shows the normal Combat route in three chapters.
 * It ends with the complete record index.
 *
 * The page uses no example rows or schema counts as content.
 * Guides and route chapters describe the game.
 */

/** Shows the one extracted formula. The function selects it by semantic ID instead of position. */
const FEATURED_FORMULA_TEXT_ID = "combat.defense.normal-mitigation.expression";

/** Gives two guides special treatment. The other three use field-manual rows. */
const LEAD_GUIDE = "combat-mathematics";
const ROUTE_GUIDE = "endgame-systems";

/** Sets the number of stops that each route chapter shows. Three stops show the chapter range. */
const STOPS_PER_CHAPTER = 3;

/**
 * Stores one claim in the form the page needs.
 * The published text includes evidence closure and probe contract hashes.
 * The home page omits them to save transfer. Guide pages show full provenance.
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
    /* The endgame guide appears as its route. Its section titles travel with the route.
       The titles are game-authored. Each keeps its ID and status. */
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
   * Lists every non-heroic and non-nightmare place in level order.
   * Zones and dungeons stay interleaved because the game interleaves them.
   * Filtering to `type === "zone"` dropped six dungeons, including Blackvein Warrens at 18 and Null Meridian at 92.
   * That made the stated meeting order false for one quarter of the route.
   *
   * The page states two exclusions. It counts heroic and nightmare variants instead of repeating each name.
   * It also excludes `unnamed_abyss`, which is "a retired legacy route preserved only for old saves".
   * The zones browser still reaches that place.
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
   * Select the hero panorama.
   * Prefer a dungeon because its art is the most composed landscape in the game.
   * A place without art shows two initials in the leading frame.
   * Fall back to any illustrated place before accepting that result.
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
    // Use only indexed tables, so the headline and listed counts agree.
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
    /* The guide index uses the same scoped stamp.
       It names the checked guide contents, not a live check of the whole guide. */
    contentLabel: guideContentLabel(document),
  };
}

/**
 * Finds the Defense mitigation formula by semantic ID.
 *
 * Section order and array position can change between builds without changing a claim.
 * A missing ID fails the build because the home page must keep its worked example.
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
 * Assigns a place to a chapter.
 *
 * A place without a Combat level sorts first and joins the opening chapter.
 * This keeps the route complete and keeps the no-level failure reachable.
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
 * Selects three stops for a chapter: first, middle, and last.
 * Adjacent rows show only sort order. The level sort then selects the three lowest places.
 * The selected stops reach the dungeon that closes the chapter.
 */
function representative(places: Place[]): Place[] {
  if (places.length <= STOPS_PER_CHAPTER) return places;
  const middle = places[Math.floor((places.length - 1) / 2)]!;
  return [places[0]!, middle, places[places.length - 1]!];
}
