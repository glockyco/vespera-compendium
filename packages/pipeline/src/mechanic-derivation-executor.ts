/**
 * Run shipped code to produce a published value.
 *
 * The compendium publishes numbers about a game that it does not own.
 * A number computed by the compendium is only a guess.
 * Each source-derived value comes from the game's function or constant.
 * The executor runs it over source slices that the model cites by hash.
 *
 * This module has no parser.
 * `mechanics.ts` resolves locators, hashes slices, and passes a materialized request.
 * This file builds a program from those slices, evaluates it twice in the strict sandbox, and formats results.
 * Separate modules let the derivation closure exclude TypeScript and the full extractor from its hash.
 */

import {
  canonicalJson,
  canonicalSha256,
  evalComposition,
  MECHANIC_DERIVATION_EXECUTOR_SHA256,
  sha256Hex,
  type CanonicalJson,
} from "@vespera/core";
import { applyGearBalance, type GearBalanceInput } from "./gear.ts";
import type { MechanicValueFormat } from "./mechanics-contract.ts";

export type MechanicJson = CanonicalJson;

export type { MechanicValueFormat };

export type MechanicDerivationOutput = {
  id: string;
  textId: string;
  rawValue: MechanicJson;
  format: MechanicValueFormat;
  template: string | null;
  formattedText: string;
};

export type MechanicDerivation = {
  id: string;
  derivationExecutorSha256: string;
  executionTraceSha256: string;
  evaluator: "eval-composition" | "gear-balance";
  outputs: MechanicDerivationOutput[];
  sourceTargetIds: string[];
  bindings: Record<string, MechanicJson>;
  calls: { sourceTargetId: string; args: MechanicJson[] }[];
  resultSha256: string;
};

/** One cited slice of shipped source. Index 0 of `sources` is the semantic root. */
export type DerivationSource = { sourceTargetId: string; text: string };

export type MechanicDerivationRequest = {
  id: string;
  evaluator: "eval-composition" | "gear-balance";
  sources: DerivationSource[];
  bindings: Record<string, MechanicJson>;
  /** Applying zero arguments to a non-function declaration reads its value. */
  calls: { sourceTargetId: string; args: MechanicJson[] }[];
  outputs: { id: string; textId: string; format: MechanicValueFormat; template: string | null }[];
  /** Only the `gear-balance` branch uses this. It is never published. */
  gearInput?: GearBalanceInput;
  /** The item id that the gear branch reports when it runs. */
  gearItemId?: string;
};

const STATEMENT_KEYWORDS = /^\s*(?:function|class|const|let|var|async\s+function)\b/;
const CLASS_METHOD = /^\s*static\s+([A-Za-z_$][\w$]*)\s*\(/;
const BARE_DECLARATOR = /^\s*([A-Za-z_$][\w$]*)\s*=/;
const NAMED_FUNCTION = /^\s*(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/;
const NAMED_CLASS = /^\s*class\s+([A-Za-z_$][\w$]*)\b/;
const KEYWORD_DECLARATOR = /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/;

/** The synthetic owner for shipped static methods. Bare statements cannot evaluate these methods. */
const METHOD_OWNER = "__VesperaShippedMethods";

type SliceForm =
  | { kind: "statement"; symbol: string; text: string }
  | { kind: "declarator"; symbol: string; text: string }
  | { kind: "method"; symbol: string; text: string };

/**
 * Classify one slice so the program builder can make it evaluable.
 *
 * A locator can return a bare declarator such as (`CAP = 256`) from a multi-declarator `const`.
 * It can also return a bare class method such as (`static calculateXpGain(r) { … }`).
 * Neither form is a statement.
 * The executor wraps these forms while preserving the cited bytes exactly.
 */
function classify(source: DerivationSource): SliceForm {
  const method = CLASS_METHOD.exec(source.text);
  if (method) return { kind: "method", symbol: method[1]!, text: source.text };
  if (STATEMENT_KEYWORDS.test(source.text)) {
    const symbol =
      NAMED_FUNCTION.exec(source.text)?.[1] ??
      NAMED_CLASS.exec(source.text)?.[1] ??
      KEYWORD_DECLARATOR.exec(source.text)?.[1];
    if (!symbol) {
      throw new Error(`derivation slice ${source.sourceTargetId} declares no resolvable symbol`);
    }
    return { kind: "statement", symbol, text: source.text };
  }
  const declarator = BARE_DECLARATOR.exec(source.text);
  if (declarator) return { kind: "declarator", symbol: declarator[1]!, text: source.text };
  throw new Error(`derivation slice ${source.sourceTargetId} is neither a statement nor a declarator`);
}

/** The expression that reads or calls one cited slice inside the assembled program. */
function callExpression(form: SliceForm, args: readonly MechanicJson[]): string {
  const reference = form.kind === "method" ? `${METHOD_OWNER}.${form.symbol}` : form.symbol;
  if (args.length === 0) return reference;
  return `${reference}(${args.map((argument) => canonicalJson(argument)).join(", ")})`;
}

function buildProgram(request: MechanicDerivationRequest): string {
  const forms = new Map<string, SliceForm>();
  const statements: string[] = [];
  const methods: string[] = [];
  for (const source of request.sources) {
    if (forms.has(source.sourceTargetId)) {
      throw new Error(`derivation ${request.id} cites ${source.sourceTargetId} twice`);
    }
    const form = classify(source);
    forms.set(source.sourceTargetId, form);
    if (form.kind === "method") methods.push(form.text);
    else if (form.kind === "declarator") statements.push(`const ${form.text};`);
    else statements.push(form.text);
  }
  const parts = [...statements];
  if (methods.length > 0) parts.push(`class ${METHOD_OWNER} {\n${methods.join("\n")}\n}`);

  const expressions = request.calls.map((call) => {
    const form = forms.get(call.sourceTargetId);
    if (!form) {
      throw new Error(`derivation ${request.id} calls uncited source target ${call.sourceTargetId}`);
    }
    return callExpression(form, call.args);
  });
  parts.push(`return [${expressions.join(", ")}];`);
  return `(()=>{\n${parts.join("\n")}\n})()`;
}

/** Deep equality by canonical serialization for the repeatability check. */
function sameValue(left: MechanicJson, right: MechanicJson): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

/**
 * Convert an evaluated value into canonical JSON.
 * Reject values that a published model cannot carry.
 *
 * `Object.freeze` wrappers and sandbox-created arrays and objects are supported.
 * A function, symbol, non-finite number, or cyclic structure is rejected.
 * A player cannot review any of these values as a page number.
 */
function toMechanicJson(value: unknown, path: string): MechanicJson {
  if (value === null) return null;
  if (typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`derivation produced the non-finite value ${String(value)} at ${path}`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => toMechanicJson(entry, `${path}[${index}]`));
  }
  if (typeof value === "object") {
    const record: Record<string, MechanicJson> = {};
    for (const [key, entry] of Object.entries(value)) {
      record[key] = toMechanicJson(entry, `${path}.${key}`);
    }
    return record;
  }
  throw new Error(`derivation produced a ${typeof value} at ${path}, which cannot be published`);
}

/** Show one raw value as the exact text that a page shows. */
export function formatDerivedValue(
  raw: MechanicJson,
  format: MechanicValueFormat,
  template: string | null,
): string {
  switch (format) {
    case "identity":
      return typeof raw === "string" ? raw : canonicalJson(raw);
    case "integer": {
      if (typeof raw !== "number" || !Number.isInteger(raw)) {
        throw new Error(`the integer format requires an integer, found ${canonicalJson(raw)}`);
      }
      return String(raw);
    }
    case "decimal-3": {
      if (typeof raw !== "number") {
        throw new Error(`the decimal-3 format requires a number, found ${canonicalJson(raw)}`);
      }
      return raw.toFixed(3);
    }
    case "percent-2": {
      if (typeof raw !== "number") {
        throw new Error(`the percent-2 format requires a number, found ${canonicalJson(raw)}`);
      }
      return `${(raw * 100).toFixed(2)}%`;
    }
    case "json-grid":
      return canonicalJson(raw);
    case "template": {
      if (template === null) throw new Error("the template format requires a template");
      if (!template.includes("{value}")) {
        throw new Error(`template ${JSON.stringify(template)} has no {value} placeholder`);
      }
      const rendered = typeof raw === "string" ? raw : canonicalJson(raw);
      return template.replaceAll("{value}", rendered);
    }
  }
}

/**
 * The gear-balance branch.
 *
 * It runs the shipped class-gear and gear-balance passes without changes.
 * It reports balanced numbers for one named item.
 * A claim about equipment normalization then uses the game's output instead of a copied curve.
 * The composed input is not published.
 * It is the whole item table, and a model that carried it cannot be reviewed.
 */
function runGearBalance(request: MechanicDerivationRequest): MechanicJson[] {
  const gearInput = request.gearInput;
  const itemId = request.gearItemId;
  if (!gearInput || !itemId) {
    throw new Error(`derivation ${request.id} selects the gear evaluator without composed gear input`);
  }
  const evaluate = (): MechanicJson[] => {
    const items = structuredClone(gearInput.items);
    applyGearBalance({ ...gearInput, items });
    const balanced = toMechanicJson(items[itemId] ?? null, itemId);
    if (balanced === null || typeof balanced !== "object" || Array.isArray(balanced)) {
      throw new Error(`gear balance produced no record for ${itemId}`);
    }
    const stats = balanced.stats;
    if (stats === null || typeof stats !== "object" || Array.isArray(stats)) {
      throw new Error(`gear balance produced no stats for ${itemId}`);
    }
    return [balanced.level ?? null, stats.attack ?? null, stats.health ?? null];
  };
  const first = evaluate();
  const second = evaluate();
  if (!sameValue(first, second)) {
    throw new Error(`derivation ${request.id} is not repeatable under the gear evaluator`);
  }
  return first;
}

/**
 * Run one derivation and return the publishable record.
 *
 * Always run it twice and compare the values deeply.
 * A value that differs between runs of the same shipped code and inputs is not a game fact.
 * The pipeline finds this error before the value reaches a page.
 */
export function evaluateMechanicDerivation(request: MechanicDerivationRequest): MechanicDerivation {
  if (request.sources.length === 0) throw new Error(`derivation ${request.id} cites no source`);
  if (request.outputs.length === 0) throw new Error(`derivation ${request.id} declares no output`);

  let values: MechanicJson[];
  let programIdentity: string;
  if (request.evaluator === "gear-balance") {
    programIdentity = `gear-balance:${request.gearItemId ?? ""}`;
    values = runGearBalance(request);
  } else {
    const program = buildProgram(request);
    programIdentity = program;
    const evaluate = (): MechanicJson[] => {
      const raw = evalComposition(program, { ...request.bindings });
      if (!Array.isArray(raw)) {
        throw new Error(`derivation ${request.id} did not return a value list`);
      }
      return raw.map((entry, index) => toMechanicJson(entry, `${request.id}[${index}]`));
    };
    const first = evaluate();
    const second = evaluate();
    if (!sameValue(first, second)) {
      throw new Error(
        `derivation ${request.id} is not repeatable (${canonicalJson(first)} then ${canonicalJson(second)})`,
      );
    }
    values = first;
  }

  if (values.length !== request.outputs.length) {
    throw new Error(
      `derivation ${request.id} produced ${values.length} values for ${request.outputs.length} outputs`,
    );
  }

  const outputs: MechanicDerivationOutput[] = request.outputs.map((output, index) => {
    const rawValue = values[index]!;
    return {
      id: output.id,
      textId: output.textId,
      rawValue,
      format: output.format,
      template: output.template,
      formattedText: formatDerivedValue(rawValue, output.format, output.template),
    };
  });

  const calls = request.calls.map((call) => ({
    sourceTargetId: call.sourceTargetId,
    args: [...call.args],
  }));
  const resultSha256 = canonicalSha256({
    values: values as unknown as CanonicalJson,
    outputs: outputs as unknown as CanonicalJson,
  });
  const executionTraceSha256 = canonicalSha256({
    evaluator: request.evaluator,
    program: sha256Hex(programIdentity),
    sources: request.sources.map((source) => ({
      sourceTargetId: source.sourceTargetId,
      sha256: sha256Hex(source.text),
    })),
    bindings: request.bindings as unknown as CanonicalJson,
    calls: calls as unknown as CanonicalJson,
    rawValues: values as unknown as CanonicalJson,
    formatted: outputs.map((output) => output.formattedText),
  });

  return {
    id: request.id,
    derivationExecutorSha256: MECHANIC_DERIVATION_EXECUTOR_SHA256,
    executionTraceSha256,
    evaluator: request.evaluator,
    outputs,
    sourceTargetIds: request.sources.map((source) => source.sourceTargetId),
    bindings: { ...request.bindings },
    calls,
    resultSha256,
  };
}
