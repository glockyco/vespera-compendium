import type { ComposedTables } from "./compose.ts";
import type {
  MechanicDocument,
  MechanicFact,
  MechanicFormula,
  MechanicSection,
  MechanicText,
} from "./mechanics.ts";
import { CURRENCY_ITEM_IDS, LEVEL_SOURCES, type Dataset, type Row } from "./project.ts";
import { SCHEMA_VERSION, TABLES } from "./schema.ts";

/**
 * Guards that must hold before anything is written. They exist because a published dataset is read
 * by people who cannot check it against the game: a dangling item id or a silently dropped column
 * looks exactly like real data. A failure here writes nothing rather than shipping a broken file.
 */

export type InvariantResult = { id: string; status: "PASS" | "FAIL"; detail: string };

/** Foreign keys, as `table.column` to the entity table it must resolve into. */
const REFERENCES: [string, string, string][] = [
  ["item_stats", "item_id", "items"],
  ["item_sources", "item_id", "items"],
  ["recipe_inputs", "item_id", "items"],
  ["recipe_outputs", "item_id", "items"],
  ["gathering_node_drops", "item_id", "items"],
  ["quest_reward_items", "item_id", "items"],
  ["shop_listings", "item_id", "items"],
  ["achievements", "requirement_item_id", "items"],
  ["world_bosses", "gear_item_id", "items"],
  ["gem_stats", "gem_id", "gems"],
  ["enemy_drops", "enemy_id", "enemies"],
  ["zone_enemies", "enemy_id", "enemies"],
  ["zones_dungeons", "required_boss", "enemies"],
  ["zone_resources", "node_id", "gathering_nodes"],
  ["zone_resources", "zone_id", "zones_dungeons"],
  ["zone_enemies", "zone_id", "zones_dungeons"],
  ["quests", "next_quest_id", "quests"],
  ["quests", "required_quest_id", "quests"],
  ["quest_steps", "quest_id", "quests"],
  ["quest_reward_items", "quest_id", "quests"],
  ["recipe_inputs", "recipe_id", "recipes"],
  ["recipe_outputs", "recipe_id", "recipes"],
  ["gathering_node_drops", "node_id", "gathering_nodes"],
  ["ability_effects", "ability_id", "abilities"],
  ["ability_tags", "ability_id", "abilities"],
  ["affix_weights", "affix_id", "affixes"],
  ["item_stats", "item_id", "items"],
  ["world_boss_gear_stats", "boss_id", "world_bosses"],
  ["world_boss_abilities", "boss_id", "world_bosses"],
  ["class_traits", "class_id", "classes"],
  ["abilities", "required_class", "classes"],
  ["items", "class_requirement", "classes"],
];

/** `item_sources.source_id` points at a different table per source kind. */
const SOURCE_KIND_TABLES: Record<string, string> = {
  recipe: "recipes",
  enemy: "enemies",
  gathering: "gathering_nodes",
  shop: "items",
  quest: "quests",
  world_boss: "world_bosses",
};

function primaryKeyValues(dataset: Dataset, tableName: string): Set<string> {
  const table = TABLES.find((entry) => entry.name === tableName);
  const key = table?.primaryKey[0];
  if (!key) return new Set();
  return new Set((dataset[tableName] ?? []).map((row) => String(row[key] ?? "")));
}

/** Composed table id per published entity table, for the cardinality check. */
const COMPOSED_BY_TABLE: Record<string, string> = {
  items: "items",
  enemies: "enemies",
  recipes: "recipes",
  gathering_nodes: "gatheringNodes",
  quests: "quests",
  abilities: "abilities",
  affixes: "affixes",
  gems: "gems",
  shop_listings: "shopListings",
  zones_dungeons: "zonesDungeons",
  achievements: "achievements",
  world_bosses: "worldBosses",
  classes: "classes",
};

export type MechanicsInvariantManifest = { mechanicCount: number };

function mechanicTexts(document: MechanicDocument): MechanicText[] {
  const texts: MechanicText[] = [document.title, document.summary];
  const addFormula = (formula: MechanicFormula): void => {
    texts.push(formula.label, formula.expression);
    if (formula.note) texts.push(formula.note);
  };
  const addFact = (fact: MechanicFact): void => {
    texts.push(fact.label, fact.value);
  };
  const addSection = (section: MechanicSection): void => {
    texts.push(section.title, ...section.paragraphs, ...section.bullets);
    section.formulas.forEach(addFormula);
    section.facts.forEach(addFact);
  };
  document.sections.forEach(addSection);
  document.related.forEach((related) => texts.push(related.label, related.href));
  return texts;
}

export function checkMechanicDocuments(documents: readonly MechanicDocument[]): InvariantResult {
  const problems: string[] = [];
  if (documents.length !== 5) problems.push(`expected five mechanic documents, found ${documents.length}`);
  const expectedIds = new Set(["combat-mathematics", "ability-calculations", "skills-and-crafting", "equipment-and-value", "endgame-systems"]);
  for (const expected of expectedIds) if (!documents.some((document) => document.id === expected)) problems.push(`missing mechanic document ${expected}`);
  const documentIds = new Set<string>();
  for (const document of documents) {
    if (!document.id || documentIds.has(document.id)) {
      problems.push(`duplicate or empty mechanic document id ${document.id || "(empty)"}`);
      continue;
    }
    documentIds.add(document.id);
    const targetHashes = new Map(
      document.sourceTargets.map((target) => [target.id, target.sha256]),
    );
    const textIds = new Set<string>();
    for (const text of mechanicTexts(document)) {
      if (!text.id || textIds.has(text.id)) problems.push(`${document.id} has duplicate text id ${text.id || "(empty)"}`);
      textIds.add(text.id);
      if (text.evidence.kind === "editorial") continue;
      if (text.evidence.sourceTargetIds.length === 0) {
        problems.push(`${document.id}.${text.id} has no source target`);
        continue;
      }
      for (const targetId of text.evidence.sourceTargetIds) {
        const hash = targetHashes.get(targetId);
        if (!hash) problems.push(`${document.id}.${text.id} has unknown source target ${targetId}`);
        else if (!/^[0-9a-f]{64}$/i.test(hash)) problems.push(`${document.id}.${text.id} source target ${targetId} has invalid hash`);
      }
    }
    if (document.id === "endgame-systems") {
      const bulletCount = document.sections.reduce((count, section) => count + section.bullets.length, 0);
      if (document.sections.length !== 11) problems.push(`endgame-systems has ${document.sections.length} sections, expected 11`);
      if (bulletCount !== 63) problems.push(`endgame-systems has ${bulletCount} bullets, expected 63`);
    }
    const expectedTextCounts: Record<string, number> = {
      "combat-mathematics": 50,
      "ability-calculations": 18,
      "skills-and-crafting": 34,
      "equipment-and-value": 43,
      "endgame-systems": 86,
    };
    const actualTextCount = mechanicTexts(document).length;
    if (expectedTextCounts[document.id] !== actualTextCount) problems.push(`${document.id} has ${actualTextCount} text ids, expected ${expectedTextCounts[document.id]}`);
  }
  return {
    id: "mechanics",
    status: problems.length === 0 ? "PASS" : "FAIL",
    detail: problems.length === 0 ? `${documents.length} mechanic documents are structurally complete` : problems.join("; "),
  };
}

export function checkMechanicSearchRows(
  dataset: Dataset,
  documents: readonly MechanicDocument[],
): InvariantResult {
  const expected = documents.map((document) => document.id);
  const actual = (dataset.search_index ?? [])
    .filter((row) => row.table === "mechanics")
    .map((row) => String(row.id ?? ""));
  const valid = actual.length === expected.length && expected.every((id, index) => actual[index] === id);
  return {
    id: "mechanicSearchRows",
    status: valid ? "PASS" : "FAIL",
    detail: valid ? `${expected.length} mechanics search rows match document order` : `expected [${expected.join(",")}] got [${actual.join(",")}]`,
  };
}

export function checkMechanicManifest(
  manifest: MechanicsInvariantManifest,
  documents: readonly MechanicDocument[],
): InvariantResult {
  const valid = manifest.mechanicCount === documents.length;
  return {
    id: "mechanicCount",
    status: valid ? "PASS" : "FAIL",
    detail: valid ? `manifest mechanicCount is ${manifest.mechanicCount}` : `manifest mechanicCount is ${manifest.mechanicCount}, expected ${documents.length}`,
  };
}
export function checkInvariants(
  dataset: Dataset,
  composed: ComposedTables,
  documents?: readonly MechanicDocument[],
  manifest?: MechanicsInvariantManifest,
): InvariantResult[] {
  const checks: InvariantResult[] = [
    checkColumns(dataset),
    checkPrimaryKeys(dataset),
    checkReferences(dataset),
    checkCardinality(dataset, composed),
    checkLevels(dataset),
    checkMeta(dataset),
  ];
  if (documents) {
    checks.push(checkMechanicDocuments(documents), checkMechanicSearchRows(dataset, documents));
    if (manifest) checks.push(checkMechanicManifest(manifest, documents));
  }
  return checks;
}

/**
 * Item level and its provenance stay in step.
 *
 * A level with no stated source, or a source claiming a level that is absent, is the failure mode
 * that matters here: a reader cannot tell a gear tier from a gathering requirement by looking, so
 * the pair has to be trustworthy or the number is worse than no number at all.
 */
function checkLevels(dataset: Dataset): InvariantResult {
  const allowed = new Set<string>(LEVEL_SOURCES);
  const problems: string[] = [];
  const report = (message: string): void => {
    if (problems.length < 6) problems.push(message);
  };

  for (const row of dataset.items ?? []) {
    const id = String(row.id);
    const source = String(row.level_source ?? "");
    if (!allowed.has(source)) {
      report(`${id} has level_source ${source || "(empty)"}`);
      continue;
    }
    const level = row.level;
    if (source === "unknown") {
      if (level !== null) report(`${id} is unknown but carries level ${level}`);
      continue;
    }
    if (typeof level !== "number" || !Number.isInteger(level) || level < 1 || level > 300) {
      report(`${id} has level ${level} from ${source}`);
    }
  }

  return {
    id: "levels",
    status: problems.length === 0 ? "PASS" : "FAIL",
    detail:
      problems.length === 0
        ? `every item level is an integer in 1..300 with one of ${LEVEL_SOURCES.length} stated sources`
        : problems.join("; "),
  };
}

function checkColumns(dataset: Dataset): InvariantResult {
  const problems: string[] = [];
  for (const table of TABLES) {
    const expected = table.columns.map((column) => column.name);
    const expectedSet = new Set(expected);
    for (const [index, row] of (dataset[table.name] ?? []).entries()) {
      const actual = Object.keys(row);
      const missing = expected.filter((name) => !(name in row));
      const extra = actual.filter((name) => !expectedSet.has(name));
      if (missing.length > 0 || extra.length > 0) {
        problems.push(
          `${table.name}[${index}] missing=[${missing.join(",")}] extra=[${extra.join(",")}]`,
        );
        break;
      }
    }
    if (!dataset[table.name]) problems.push(`${table.name} is absent from the dataset`);
  }
  return {
    id: "columns",
    status: problems.length === 0 ? "PASS" : "FAIL",
    detail:
      problems.length === 0
        ? `every row of ${TABLES.length} tables carries exactly its schema columns`
        : problems.join("; "),
  };
}

function checkPrimaryKeys(dataset: Dataset): InvariantResult {
  const problems: string[] = [];
  for (const table of TABLES) {
    const seen = new Set<string>();
    for (const row of dataset[table.name] ?? []) {
      const parts = table.primaryKey.map((column) => row[column]);
      const empty = table.primaryKey.filter(
        (column, index) => parts[index] === null || parts[index] === "",
      );
      if (empty.length > 0) {
        problems.push(`${table.name} has an empty key component: ${empty.join(",")}`);
        break;
      }
      const key = parts.map(String).join("\u0000");
      if (seen.has(key)) {
        problems.push(`${table.name} has duplicate key ${key.replaceAll("\u0000", "/")}`);
        break;
      }
      seen.add(key);
    }
  }
  return {
    id: "primaryKeys",
    status: problems.length === 0 ? "PASS" : "FAIL",
    detail: problems.length === 0 ? "every primary key is unique and complete" : problems.join("; "),
  };
}

function checkReferences(dataset: Dataset): InvariantResult {
  const targets = new Map<string, Set<string>>();
  const idsOf = (tableName: string): Set<string> => {
    const cached = targets.get(tableName);
    if (cached) return cached;
    const ids = primaryKeyValues(dataset, tableName);
    targets.set(tableName, ids);
    return ids;
  };

  const problems: string[] = [];
  const report = (label: string, value: string): void => {
    if (problems.length < 6) problems.push(`${label} does not resolve: ${value}`);
  };

  for (const [tableName, column, targetTable] of REFERENCES) {
    const ids = idsOf(targetTable);
    for (const row of dataset[tableName] ?? []) {
      const value = row[column];
      if (value === null || value === "") continue;
      if (!ids.has(String(value))) report(`${tableName}.${column}`, String(value));
    }
  }

  // Enemy drop tables name a currency alongside real items, so that one id is allowed here and
  // nowhere else. item_sources deliberately excludes it so its item_id stays a real foreign key.
  const itemIds = idsOf("items");
  for (const row of dataset.enemy_drops ?? []) {
    const value = String(row.item_id ?? "");
    if (!itemIds.has(value) && !CURRENCY_ITEM_IDS.has(value)) {
      report("enemy_drops.item_id", value);
    }
  }

  for (const row of dataset.item_sources ?? []) {
    const targetTable = SOURCE_KIND_TABLES[String(row.source_kind)];
    if (!targetTable) {
      report("item_sources.source_kind", String(row.source_kind));
      continue;
    }
    if (!idsOf(targetTable).has(String(row.source_id))) {
      report(`item_sources.source_id (${row.source_kind})`, String(row.source_id));
    }
  }

  return {
    id: "references",
    status: problems.length === 0 ? "PASS" : "FAIL",
    detail:
      problems.length === 0
        ? `${REFERENCES.length + 2} foreign key groups resolve`
        : problems.join("; "),
  };
}

function checkCardinality(dataset: Dataset, composed: ComposedTables): InvariantResult {
  const problems: string[] = [];
  for (const [tableName, composedId] of Object.entries(COMPOSED_BY_TABLE)) {
    const expected = composed[composedId]?.live;
    const actual = dataset[tableName]?.length ?? 0;
    if (typeof expected !== "number") {
      problems.push(`${tableName} has no composed counterpart`);
      continue;
    }
    if (actual !== expected) problems.push(`${tableName} published ${actual}, composed ${expected}`);
  }
  return {
    id: "cardinality",
    status: problems.length === 0 ? "PASS" : "FAIL",
    detail:
      problems.length === 0
        ? "every entity table matches its composed live count"
        : problems.join("; "),
  };
}

function checkMeta(dataset: Dataset): InvariantResult {
  const rows: Row[] = dataset.meta ?? [];
  const values = new Map(rows.map((row) => [String(row.key), String(row.value ?? "")]));
  const problems: string[] = [];
  for (const key of ["schema_version", "build_id", "generated_at"]) {
    if (!values.get(key)) problems.push(`${key} is missing or empty`);
  }
  if (values.get("schema_version") !== String(SCHEMA_VERSION)) {
    problems.push(`schema_version is ${values.get("schema_version")}, expected ${SCHEMA_VERSION}`);
  }
  for (const table of TABLES) {
    if (table.kind === "meta") continue;
    const declared = values.get(`rows_${table.name}`);
    const actual = String(dataset[table.name]?.length ?? 0);
    if (declared !== actual) problems.push(`rows_${table.name} is ${declared}, actual ${actual}`);
  }
  return {
    id: "meta",
    status: problems.length === 0 ? "PASS" : "FAIL",
    detail: problems.length === 0 ? `${rows.length} meta rows agree with the dataset` : problems.join("; "),
  };
}
