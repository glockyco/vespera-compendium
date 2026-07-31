import type { Row } from "./project.ts";

/**
 * RFC 4180 CSV, because the published tables are meant to be pulled straight into Google Sheets and
 * Excel. `parseCsv` exists so the emitted files can be round-tripped in verification without adding
 * a dependency whose bugs would then be indistinguishable from ours.
 */

const NEEDS_QUOTING = /["\r\n,]/;

function field(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value === true) return "1";
  if (value === false) return "0";
  const text = String(value);
  return NEEDS_QUOTING.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(columns: readonly string[], rows: readonly Row[]): string {
  const lines = [columns.map(field).join(",")];
  for (const row of rows) lines.push(columns.map((column) => field(row[column])).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

export function parseCsv(text: string): { columns: string[]; rows: string[][] } {
  const records: string[][] = [];
  let record: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character !== '"') {
        value += character;
        continue;
      }
      if (text[index + 1] === '"') {
        value += '"';
        index += 1;
        continue;
      }
      quoted = false;
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === ",") {
      record.push(value);
      value = "";
      continue;
    }
    if (character === "\r" || character === "\n") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      record.push(value);
      records.push(record);
      record = [];
      value = "";
      continue;
    }
    value += character;
  }
  if (value !== "" || record.length > 0) {
    record.push(value);
    records.push(record);
  }

  const [columns = [], ...rows] = records;
  return { columns, rows };
}
