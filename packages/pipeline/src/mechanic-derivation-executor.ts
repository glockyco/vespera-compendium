/**
 * Executes shipped code to produce a published value.
 *
 * The compendium publishes numbers about a game it does not own, so a number it computed itself would
 * be a guess with good manners. Every source-derived value here comes from running the game's own
 * function or reading the game's own constant, over source slices the model cites by hash.
 *
 * The module deliberately owns no parser. `mechanics.ts` resolves locators, hashes slices, and hands
 * over a fully materialized request; this file only builds a program from those slices, evaluates it
 * twice under the strict sandbox, and formats the results. Keeping the two apart is what lets the
 * derivation closure be hashed without dragging TypeScript and the whole extractor into it.
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
  /** Only the `gear-balance` branch uses this, and it is never published. */
  gearInput?: GearBalanceInput;
  /** The item id the gear branch reports, when that branch runs. */
  gearItemId?: string;
};

const STATEMENT_KEYWORDS = /^\s*(?:function|class|const|let|var|async\s+function)\b/;
const CLASS_METHOD = /^\s*static\s+([A-Za-z_$][\w$]*)\s*\(/;
const BARE_DECLARATOR = /^\s*([A-Za-z_$][\w$]*)\s*=/;
const NAMED_FUNCTION = /^\s*(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/;
const NAMED_CLASS = /^\s*class\s+([A-Za-z_$][\w$]*)\b/;
const KEYWORD_DECLARATOR = /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/;

/** The synthetic owner for shipped static methods, which cannot be evaluated as bare statements. */
const METHOD_OWNER = "__VesperaShippedMethods";

type SliceForm =
  | { kind: "statement"; symbol: string; text: string }
  | { kind: "declarator"; symbol: string; text: string }
  | { kind: "method"; symbol: string; text: string };

/**
 * Classifies one slice so the program builder knows how to make it evaluable.
 *
 * A locator can legitimately return a bare declarator (`CAP = 256`, one of several in a single `const`)
 * or a bare class method (`static calculateXpGain(r) { … }`). Neither is a statement. Wrapping them is
 * the executor's job precisely so the cited bytes stay exactly what the source contains.
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

/** Deep equality by canonical serialization, used for the repeatability check. */
function sameValue(left: MechanicJson, right: MechanicJson): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

/**
 * Converts an evaluated value into canonical JSON, refusing anything a published model cannot carry.
 *
 * `Object.freeze` wrappers and sandbox-created arrays and objects survive; a function, a symbol, a
 * non-finite number, or a cyclic structure does not, because none of those can be reviewed as a number
 * a player reads on a page.
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

/** Renders one raw value as the exact text a page shows. */
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
 * It runs the shipped class-gear and gear-balance passes unchanged and reports the balanced numbers for
 * one named item, so a claim about equipment normalization is the game's own output rather than a
 * restatement of its curve. The composed input is never published: it is the whole item table, and a
 * model that carried it would be unreviewable.
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
 * Runs one derivation and returns the publishable record.
 *
 * Twice, always, with a deep comparison. A value that differs between two runs of the same shipped code
 * over the same inputs is not a fact about the game, and the cheapest place to notice that is before it
 * reaches a page.
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
