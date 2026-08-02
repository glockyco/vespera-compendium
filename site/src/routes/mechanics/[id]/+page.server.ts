import { error } from "@sveltejs/kit";
import { LEVEL_SCALES, statLabel } from "$lib/format";
import {
  approvedProbeKeys,
  deriveVerificationStatus,
  guideContentLabel,
  hasLiveCheckedContent,
} from "$lib/mechanics-verification";
import type { MechanicVerificationStatus, PublishedMechanicText } from "$lib/mechanics-verification";
import { publishedMechanics } from "$lib/server/mechanics";
import type { PageServerLoad } from "./$types";

/**
 * Loads one guide page.
 *
 * The page uses a projection, not the artifact.
 * Each string keeps its semantic ID, text, and derived status.
 * Probe hashes, source IDs, and contract IDs stay on the server.
 * Readers do not need implementation names.
 */

export type Claim = { id: string; text: string; status: MechanicVerificationStatus };

export type ClaimFormula = { id: string; label: Claim; expression: Claim; note: Claim | null };

/**
 * Stores a fact value that the compendium lays out.
 *
 * Some values use a serialized array of records.
 * That transport shape puts schema keys and JSON punctuation before a reader.
 * This projection turns that shape into rows.
 * The test uses the shape, not a fact ID, so any matching value gets the same layout.
 */
export type ClaimFactColumn = { key: string; heading: string; numeric: boolean };

export type ClaimFactCell = { key: string; raw: string; text: string; numeric: boolean };

export type ClaimFactTable = { columns: ClaimFactColumn[]; rows: ClaimFactCell[][] };

export type ClaimFact = { label: Claim; value: Claim; table: ClaimFactTable | null };

export type ClaimSection = {
  id: string;
  title: Claim;
  paragraphs: Claim[];
  bullets: Claim[];
  formulas: ClaimFormula[];
  facts: ClaimFact[];
};

export type ClaimRelated = { label: Claim; href: { id: string; text: string } };

/** One published record, once it is known to hold only values a cell can print. */
type FactRecord = Record<string, number | string>;

/**
 * Defines fact-table columns and their order.
 *
 * A bare `Level` is ambiguous because Combat, Gathering, and Crafting use separate scales.
 * The heading names the scale.
 * Canonical JSON sorts payload keys alphabetically, so this list keeps a measure after its level.
 * Unknown keys keep their published position and use shared stat wording.
 */
const FACT_TABLE_COLUMNS: readonly { key: string; heading: string }[] = [
  { key: "level", heading: `${LEVEL_SCALES.combat} level` },
  { key: "health", heading: "Health" },
  { key: "offense", heading: "Offense" },
];

/**
 * Returns records from a table-shaped value, or `null` for another value.
 *
 * A table-shaped value is a non-empty JSON array of objects with equal keys.
 * Each value must fit a printable cell.
 * Nested objects, missing keys, and other types keep their one-line published form.
 */
function factRecords(text: string): { keys: string[]; records: FactRecord[] } | null {
  if (!text.startsWith("[")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const records: FactRecord[] = [];
  let keys: string[] | null = null;
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
    const record: FactRecord = {};
    for (const [key, value] of Object.entries(entry)) {
      if (typeof value === "string") record[key] = value;
      else if (typeof value === "number" && Number.isFinite(value)) record[key] = value;
      else return null;
    }
    const entryKeys = Object.keys(record);
    if (entryKeys.length === 0) return null;
    if (keys === null) keys = entryKeys;
    else if (entryKeys.length !== keys.length || keys.some((key) => !(key in record))) return null;
    records.push(record);
  }
  return keys === null ? null : { keys, records };
}

/** A column counts as numeric only when every row published a number for it, not just the first. */
function factColumns(records: readonly FactRecord[], keys: readonly string[]): ClaimFactColumn[] {
  const known = FACT_TABLE_COLUMNS.filter((column) => keys.includes(column.key));
  const rest = keys
    .filter((key) => !FACT_TABLE_COLUMNS.some((column) => column.key === key))
    .map((key) => ({ key, heading: statLabel(key) }));
  return [...known, ...rest].map(({ key, heading }) => ({
    key,
    heading,
    numeric: records.every((record) => typeof record[key] === "number"),
  }));
}

/** Magnitudes are grouped the way every other figure on the site is grouped. */
function factCellText(value: number | string): string {
  return typeof value === "number" ? value.toLocaleString("en-US") : value;
}

function factTable(text: string): ClaimFactTable | null {
  const parsed = factRecords(text);
  if (parsed === null) return null;
  const columns = factColumns(parsed.records, parsed.keys);
  const rows: ClaimFactCell[][] = [];
  for (const record of parsed.records) {
    const cells: ClaimFactCell[] = [];
    for (const column of columns) {
      const value = record[column.key];
      /* `factRecords` checks that all rows use one key set. A missing key breaks that invariant. */
      if (value === undefined) throw new Error(`a fact table row has no ${column.key}`);
      /* `raw` keeps the published value. `text` gives its reading.
       * Both let the cell group and align values without losing the exact input for a later check. */
      cells.push({
        key: column.key,
        raw: String(value),
        text: factCellText(value),
        numeric: column.numeric,
      });
    }
    rows.push(cells);
  }
  return { columns, rows };
}

/** The prerender list. A missing or repeated ID fails the build instead of making a broken URL. */
export const entries = async (): Promise<{ id: string }[]> => {
  const documents = (await publishedMechanics()).documents;
  if (documents.length === 0) throw new Error("no mechanic guides were published");
  const seen: Record<string, true | undefined> = {};
  for (const document of documents) {
    if (document.id.length === 0) throw new Error("a published mechanic guide has an empty id");
    if (seen[document.id]) throw new Error(`mechanic guide ${document.id} is published twice`);
    seen[document.id] = true;
  }
  return documents.map((document) => ({ id: document.id }));
};

export const load: PageServerLoad = async ({ params }) => {
  const artifact = await publishedMechanics();
  const document = artifact.documents.find((entry) => entry.id === params.id);
  if (!document) throw error(404, `Game system not found: ${params.id}`);

  const approvedDocument = artifact.approval.documents.find((entry) => entry.id === document.id);
  if (!approvedDocument) throw new Error(`the approval does not cover ${document.id}`);
  const approved = approvedProbeKeys(approvedDocument.verifiedProbes);

  /** Derive status here so the page never repeats an unchecked claim. */
  const claim = (text: PublishedMechanicText): Claim => ({
    id: text.id,
    text: text.text,
    status: deriveVerificationStatus(text.evidence, approved),
  });

  return {
    id: document.id,
    category: document.category,
    title: claim(document.title),
    summary: claim(document.summary),
    label: guideContentLabel(document),
    live: hasLiveCheckedContent(document),
    buildId: artifact.buildId,
    sections: document.sections.map(
      (section): ClaimSection => ({
        id: section.id,
        title: claim(section.title),
        paragraphs: section.paragraphs.map(claim),
        bullets: section.bullets.map(claim),
        formulas: section.formulas.map(
          (formula): ClaimFormula => ({
            id: formula.id,
            label: claim(formula.label),
            expression: claim(formula.expression),
            note: formula.note ? claim(formula.note) : null,
          }),
        ),
        facts: section.facts.map((fact): ClaimFact => {
          const value = claim(fact.value);
          return { label: claim(fact.label), value, table: factTable(value.text) };
        }),
      }),
    ),
    related: document.related.map(
      (related): ClaimRelated => ({
        label: claim(related.label),
        href: { id: related.href.id, text: related.href.text },
      }),
    ),
  };
};
