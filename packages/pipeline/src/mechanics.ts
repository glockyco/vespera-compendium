/**
 * Extraction of the compendium's mechanics guides from the shipped bundles.
 *
 * This module owns extraction and nothing else. It never reads the approval lock as content truth: the
 * lock records what a human approved, and treating it as a source would turn a stale explanation into a
 * self-confirming one.
 *
 * Three ideas carry the design.
 *
 * Locators are semantic. Vespera ships hashed filenames it has reused for different bytes, and its
 * bundles are minified, so a physical offset or a minified alias is not a stable address. Every target
 * is located by content or AST shape, must resolve exactly once, and is identified by the canonical
 * bytes of its resolved range.
 *
 * Provenance is per displayed scalar, not per block. A game-authored expression can sit under a
 * compendium-authored label without either inheriting the other's standing, so `MechanicText` is the
 * unit that carries evidence.
 *
 * A derived number is executed, never transcribed. Where the compendium states a cap, a multiplier, or
 * an example, that value comes from running the game's own function or reading the game's own constant
 * over slices the model cites by hash.
 */

import ts from "typescript";
import {
  canonicalJson,
  canonicalSha256,
  canonicalSourceSlice,
  canonicalSourceText,
  claimBindingsForText,
  evalComposition,
  sha256Hex,
  type BundleRole,
  type CanonicalJson,
  type MechanicProbeClaimBinding,
  type MechanicProbeContract,
} from "@vespera/core";
import {
  evaluateMechanicDerivation,
  type MechanicDerivation,
  type MechanicDerivationRequest,
  type MechanicJson,
} from "./mechanic-derivation-executor.ts";
import {
  parseMechanicsContract,
  type MechanicsContractFixture,
  type MechanicValueFormat,
} from "./mechanics-contract.ts";

export type { MechanicDerivation, MechanicJson, MechanicValueFormat, MechanicsContractFixture };
export { parseMechanicsContract };

/* ────────────────────────────── model ────────────────────────────── */

export type MechanicProbeRef = {
  suite: string;
  id: string;
  category: string | null;
  contractSha256: string;
  promotionEligible: boolean;
};

export type MechanicEvidence = {
  kind: "game-authored" | "source-derived" | "editorial";
  sourceTargetIds: string[];
  requiredProbes: MechanicProbeRef[];
};

export type MechanicText = { id: string; text: string; evidence: MechanicEvidence };
export type MechanicParagraph = MechanicText;

export type MechanicFormula = {
  id: string;
  label: MechanicText;
  expression: MechanicText;
  note: MechanicText | null;
};

export type MechanicFact = { label: MechanicText; value: MechanicText };

export type MechanicSection = {
  id: string;
  title: MechanicText;
  paragraphs: MechanicParagraph[];
  bullets: MechanicText[];
  formulas: MechanicFormula[];
  facts: MechanicFact[];
};

export type MechanicDeclarationNode = "array" | "object" | "function" | "class-method";

export type MechanicLocator =
  | { kind: "named-declaration"; name: string }
  | { kind: "declaration-shape"; node: MechanicDeclarationNode; containsAll: string[] }
  | { kind: "bounded-region"; start: string; end: string; containsAll: string[] }
  | {
      kind: "ast-string";
      declaration: { name: string; node: MechanicDeclarationNode };
      value: string;
      occurrence: number;
    }
  | {
      kind: "translation-call-argument";
      translationKey: string;
      argumentIndex: number;
      /** Which role the selected argument plays, which is what makes the match unique. */
      argumentKind: "string" | "object";
    }
  | { kind: "html-assignment"; name: string; valueType: "boolean" | "number" | "string" }
  | {
      kind: "ast-reference";
      root: MechanicLocator;
      referencePath: { field: string; index: number }[];
      declarationNodeKind: string;
      declarationShapeSha256: string;
    }
  | {
      kind: "ast-path";
      root: MechanicLocator;
      childPath: { field: string; index: number }[];
      nodeKind: string;
      shapeSha256: string;
    };

export type MechanicSourceTarget = {
  id: string;
  bundle: BundleRole;
  locator: MechanicLocator;
  sha256: string;
};

export type MechanicRelated = { label: MechanicText; href: MechanicText };

export type MechanicDocumentId =
  | "combat-mathematics"
  | "ability-calculations"
  | "skills-and-crafting"
  | "equipment-and-value"
  | "endgame-systems";

export type MechanicDocument = {
  id: MechanicDocumentId;
  title: MechanicText;
  category: "combat" | "skills" | "equipment" | "progression";
  summary: MechanicText;
  sections: MechanicSection[];
  related: MechanicRelated[];
  sourceTargets: MechanicSourceTarget[];
  derivations: MechanicDerivation[];
};

export type MechanicLockedModel = MechanicDocument & {
  derivationExecutorSha256: string;
  mechanicsSourceApprovalSha256: string;
};

export const MECHANIC_DOCUMENT_IDS = [
  "combat-mathematics",
  "ability-calculations",
  "skills-and-crafting",
  "equipment-and-value",
  "endgame-systems",
] as const satisfies readonly MechanicDocumentId[];

/**
 * The complete codex inventory, in source order.
 *
 * Combat Mathematics and Ability Calculations must consume each entry exactly once. A missing,
 * duplicate, reordered, or additional formula default fails extraction, because a codex the game grew
 * without the compendium noticing is exactly the silent gap this pipeline exists to prevent.
 */
export const CODEX_FORMULA_KEYS = [
  "normalMitigation",
  "incomingResult",
  "blockResult",
  "baseAuto",
  "effectiveArmor",
  "critMultiplier",
  "abilityLevelScale",
  "abilityStatScale",
  "abilityDefense",
  "progressionCoefficient",
  "hitpointsFormula",
  "intelligenceFormula",
  "magicDamageFormula",
  "lifestealHeal",
  "lifestealCap",
  "poisonTick",
  "freezeSlow",
] as const;

export type CodexKey = (typeof CODEX_FORMULA_KEYS)[number];

export const ABILITY_CODEX_KEYS = [
  "abilityLevelScale",
  "abilityStatScale",
  "abilityDefense",
] as const satisfies readonly CodexKey[];

const abilityKeySet: ReadonlySet<string> = new Set(ABILITY_CODEX_KEYS);

export const COMBAT_CODEX_KEYS: readonly CodexKey[] = CODEX_FORMULA_KEYS.filter(
  (key) => !abilityKeySet.has(key),
);

/* ────────────────────────────── parsed roles ────────────────────────────── */

/** The prepared bundle text plus its parsed form, so a role is parsed once per extraction. */
export type ParsedRoles = {
  text: Record<BundleRole, string>;
  source: Record<BundleRole, ts.SourceFile>;
};

/** The subset of prepared inputs extraction needs. Preparation owns the immutability guarantees. */
export type MechanicsExtractionInput = {
  readonly bundleText: Record<BundleRole, string>;
  readonly contractFixtureBytes: Uint8Array;
};

const parseCache = new WeakMap<object, ParsedRoles>();

/**
 * Parses each role once.
 *
 * The two JavaScript roles are four and six megabytes, and every document resolves locators against
 * them, so reparsing per document would dominate the pipeline's runtime for no added guarantee.
 */
export function parseRoles(input: MechanicsExtractionInput): ParsedRoles {
  const cached = parseCache.get(input);
  if (cached) return cached;
  const roles: ParsedRoles = {
    text: input.bundleText,
    source: {
      indexHtml: ts.createSourceFile(
        "indexHtml.js",
        inlineScriptProgram(input.bundleText.indexHtml),
        ts.ScriptTarget.ESNext,
        true,
        ts.ScriptKind.JS,
      ),
      index: ts.createSourceFile(
        "index.js",
        input.bundleText.index,
        ts.ScriptTarget.ESNext,
        true,
        ts.ScriptKind.JS,
      ),
      gameView: ts.createSourceFile(
        "gameView.js",
        input.bundleText.gameView,
        ts.ScriptTarget.ESNext,
        true,
        ts.ScriptKind.JS,
      ),
    },
  };
  parseCache.set(input, roles);
  return roles;
}

/**
 * The inline scripts of the main document, with every other byte replaced by a space.
 *
 * Offsets are preserved exactly, so a node's indices in the parsed program are also its indices in the
 * HTML. That is what lets an `html-assignment` target hash a range of the real document rather than a
 * range of a reconstruction.
 */
function inlineScriptProgram(html: string): string {
  const characters = new Array<string>(html.length).fill(" ");
  const pattern = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    const body = match[1]!;
    if (body.trim().length === 0) continue;
    const start = match.index + match[0]!.indexOf(body);
    for (let index = 0; index < body.length; index++) characters[start + index] = body[index]!;
  }
  return characters.join("");
}

/* ────────────────────────────── locator resolution ────────────────────────────── */

export type ResolvedRange = { sourceText: string; start: number; end: number };

/** Thrown for every expected extraction failure, so callers can report `UNRESOLVED` per document. */
export class MechanicExtractionError extends Error {}

const nodeStart = (node: ts.Node, source: ts.SourceFile): number => node.getStart(source, false);

function matchesDeclarationNode(node: ts.Node, want: MechanicDeclarationNode): boolean {
  switch (want) {
    case "array":
      return ts.isArrayLiteralExpression(node);
    case "object":
      return ts.isObjectLiteralExpression(node);
    case "function":
      return (
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isClassDeclaration(node)
      );
    case "class-method":
      return ts.isMethodDeclaration(node);
  }
}

/** Every node a declaration name resolves to: a function, a class, one declarator, or one method. */
function namedDeclarations(source: ts.SourceFile, name: string): ts.Node[] {
  const found: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name?.text === name) {
      found.push(node);
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      found.push(node);
    } else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      found.push(node);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return found;
}

/**
 * Collapses candidates whose canonical bytes are identical.
 *
 * The canonical target is `sourceText.slice(start, end)`. Two call sites that produce byte-identical
 * slices are the same evidence, so treating them as an ambiguity would refuse a target that is in fact
 * perfectly determined — the game uses one codex label twice. Offsets are never stored, so taking the
 * first is not a hidden choice.
 */
function soleRange(
  describe: string,
  sourceText: string,
  candidates: readonly { start: number; end: number }[],
): ResolvedRange {
  if (candidates.length === 0) throw new MechanicExtractionError(`${describe} resolved zero matches`);
  const distinct = new Map<string, { start: number; end: number }>();
  for (const candidate of candidates) {
    const key = canonicalSourceText(sourceText, candidate.start, candidate.end);
    if (!distinct.has(key)) distinct.set(key, candidate);
  }
  if (distinct.size > 1) {
    throw new MechanicExtractionError(`${describe} resolved ${distinct.size} distinct matches`);
  }
  const only = [...distinct.values()][0]!;
  return { sourceText, start: only.start, end: only.end };
}

/** A structural skeleton: node kinds and nesting, with every identifier and literal removed. */
function shapeOf(node: ts.Node): CanonicalJson {
  const children: CanonicalJson[] = [];
  ts.forEachChild(node, (child) => {
    children.push(shapeOf(child));
  });
  return { k: ts.SyntaxKind[node.kind]!, c: children };
}

/** The shape hash an `ast-path` or `ast-reference` locator pins, so a renamed alias still matches. */
export function astShapeSha256(node: ts.Node): string {
  return canonicalSha256(shapeOf(node));
}

function isNode(value: unknown): value is ts.Node {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    typeof value.kind === "number" &&
    "pos" in value &&
    "end" in value
  );
}

/** Child nodes grouped by the syntactic field they occupy, which is how a child path addresses them. */
export function childrenByField(node: ts.Node): Map<string, ts.Node[]> {
  const grouped = new Map<string, ts.Node[]>();
  for (const [field, value] of Object.entries(node)) {
    if (field === "parent") continue;
    if (isNode(value)) grouped.set(field, [value]);
    else if (Array.isArray(value) && value.length > 0 && value.every(isNode)) grouped.set(field, [...value]);
  }
  return grouped;
}

function followPath(
  root: ts.Node,
  path: readonly { field: string; index: number }[],
  describe: string,
): ts.Node {
  let current = root;
  for (const step of path) {
    const next = childrenByField(current).get(step.field)?.[step.index];
    if (!next) throw new MechanicExtractionError(`${describe} has no ${step.field}[${step.index}]`);
    current = next;
  }
  return current;
}

/**
 * Resolves one locator to exactly one range.
 *
 * Every variant fails on zero or multiple distinct matches rather than choosing. A locator that has
 * become ambiguous means the bundle changed shape, and strengthening the anchor is a review decision,
 * not something extraction may make on its own.
 */
export function resolveLocator(
  roles: ParsedRoles,
  bundle: BundleRole,
  locator: MechanicLocator,
): ResolvedRange {
  const source = roles.source[bundle];
  const text = roles.text[bundle];

  switch (locator.kind) {
    case "named-declaration": {
      const found = namedDeclarations(source, locator.name);
      return soleRange(
        `named declaration ${locator.name} in ${bundle}`,
        text,
        found.map((node) => ({ start: nodeStart(node, source), end: node.getEnd() })),
      );
    }

    case "declaration-shape": {
      const candidates: { start: number; end: number }[] = [];
      const visit = (node: ts.Node): void => {
        if (matchesDeclarationNode(node, locator.node)) {
          const start = nodeStart(node, source);
          const end = node.getEnd();
          const slice = text.slice(start, end);
          if (locator.containsAll.every((anchor) => slice.includes(anchor))) candidates.push({ start, end });
        }
        ts.forEachChild(node, visit);
      };
      ts.forEachChild(source, visit);
      // A qualifying node's ancestors qualify too, so only the innermost match is the target.
      const innermost = candidates.filter(
        (candidate) =>
          !candidates.some(
            (other) =>
              other !== candidate &&
              other.start >= candidate.start &&
              other.end <= candidate.end &&
              (other.start !== candidate.start || other.end !== candidate.end),
          ),
      );
      return soleRange(
        `${locator.node} declaration containing ${locator.containsAll.join(", ")} in ${bundle}`,
        text,
        innermost,
      );
    }

    case "bounded-region": {
      const starts = allIndexesOf(text, locator.start);
      if (starts.length !== 1) {
        throw new MechanicExtractionError(
          `bounded region start ${JSON.stringify(locator.start)} occurs ${starts.length} times in ${bundle}`,
        );
      }
      const start = starts[0]!;
      const endIndex = text.indexOf(locator.end, start);
      if (endIndex < 0) {
        throw new MechanicExtractionError(
          `bounded region end ${JSON.stringify(locator.end)} does not follow its start in ${bundle}`,
        );
      }
      const end = endIndex + locator.end.length;
      const slice = text.slice(start, end);
      for (const anchor of locator.containsAll) {
        if (!slice.includes(anchor)) {
          throw new MechanicExtractionError(
            `bounded region in ${bundle} lacks anchor ${JSON.stringify(anchor)}`,
          );
        }
      }
      return { sourceText: text, start, end };
    }

    case "ast-string": {
      const value = declarationValueNode(declarationNode(roles, bundle, locator.declaration.name));
      if (!matchesDeclarationNode(value, locator.declaration.node)) {
        throw new MechanicExtractionError(
          `declaration ${locator.declaration.name} is not a ${locator.declaration.node} in ${bundle}`,
        );
      }
      const literals: ts.Node[] = [];
      const visit = (node: ts.Node): void => {
        if (
          (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
          node.text === locator.value
        ) {
          literals.push(node);
        }
        ts.forEachChild(node, visit);
      };
      visit(value);
      const selected = literals[locator.occurrence - 1];
      if (!selected) {
        throw new MechanicExtractionError(
          `declaration ${locator.declaration.name} has ${literals.length} occurrences of the requested string, not ${locator.occurrence}, in ${bundle}`,
        );
      }
      return { sourceText: text, start: nodeStart(selected, source), end: selected.getEnd() };
    }

    case "translation-call-argument": {
      const quoted = JSON.stringify(locator.translationKey);
      const candidates: { start: number; end: number }[] = [];
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && node.arguments.length > locator.argumentIndex) {
          const first = node.arguments[0]!;
          if (text.slice(nodeStart(first, source), first.getEnd()).includes(quoted)) {
            const argument = node.arguments[locator.argumentIndex]!;
            const matches =
              locator.argumentKind === "string"
                ? ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)
                : ts.isObjectLiteralExpression(argument);
            if (matches) candidates.push({ start: nodeStart(argument, source), end: argument.getEnd() });
          }
        }
        ts.forEachChild(node, visit);
      };
      ts.forEachChild(source, visit);
      return soleRange(
        `translation call ${locator.translationKey} argument ${locator.argumentIndex} (${locator.argumentKind}) in ${bundle}`,
        text,
        candidates,
      );
    }

    case "html-assignment": {
      if (bundle !== "indexHtml") {
        throw new MechanicExtractionError(
          `the html-assignment locator only applies to indexHtml, not ${bundle}`,
        );
      }
      const path = locator.name.split(".");
      const candidates: { start: number; end: number }[] = [];
      const visit = (node: ts.Node): void => {
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
          const assigned = accessPath(node.left);
          if (assigned.length > 0 && path.join(".").startsWith(`${assigned}.`)) {
            const target = resolveObjectPath(node.right, path.slice(assigned.split(".").length));
            if (target) candidates.push({ start: nodeStart(target, source), end: target.getEnd() });
          }
        }
        ts.forEachChild(node, visit);
      };
      ts.forEachChild(source, visit);
      const range = soleRange(`html assignment ${locator.name}`, text, candidates);
      const node = nodeCoveringRange(source, range.start, range.end);
      if (!node || !matchesValueType(node, locator.valueType)) {
        throw new MechanicExtractionError(`html assignment ${locator.name} is not a ${locator.valueType}`);
      }
      return range;
    }

    case "ast-reference": {
      if (locator.root.kind === "ast-reference" || locator.root.kind === "ast-path") {
        throw new MechanicExtractionError("a nested ast-reference root is not allowed");
      }
      const root = resolveLocator(roles, bundle, locator.root);
      const rootNode = nodeCoveringRange(source, root.start, root.end);
      if (!rootNode) throw new MechanicExtractionError("ast-reference root has no covering node");
      const use = followPath(rootNode, locator.referencePath, "ast-reference path");
      if (!ts.isIdentifier(use)) {
        throw new MechanicExtractionError(
          `ast-reference path selects a ${ts.SyntaxKind[use.kind]}, not an identifier`,
        );
      }
      const matching = namedDeclarations(source, use.text).filter(
        (declaration) =>
          ts.SyntaxKind[declaration.kind] === locator.declarationNodeKind &&
          astShapeSha256(declaration) === locator.declarationShapeSha256,
      );
      return soleRange(
        `ast-reference to a minified binding's declaration in ${bundle}`,
        text,
        matching.map((declaration) => ({
          start: nodeStart(declaration, source),
          end: declaration.getEnd(),
        })),
      );
    }

    case "ast-path": {
      if (locator.root.kind === "ast-reference" || locator.root.kind === "ast-path") {
        throw new MechanicExtractionError("a nested ast-path root is not allowed");
      }
      const root = resolveLocator(roles, bundle, locator.root);
      const rootNode = nodeCoveringRange(source, root.start, root.end);
      if (!rootNode) throw new MechanicExtractionError("ast-path root has no covering node");
      const node = followPath(rootNode, locator.childPath, "ast-path");
      if (ts.SyntaxKind[node.kind] !== locator.nodeKind) {
        throw new MechanicExtractionError(
          `ast-path selected a ${ts.SyntaxKind[node.kind]}, expected ${locator.nodeKind}`,
        );
      }
      if (astShapeSha256(node) !== locator.shapeSha256) {
        throw new MechanicExtractionError("ast-path shape hash does not match");
      }
      return { sourceText: text, start: nodeStart(node, source), end: node.getEnd() };
    }
  }
}

function allIndexesOf(haystack: string, needle: string): number[] {
  const found: number[] = [];
  for (let index = haystack.indexOf(needle); index >= 0; index = haystack.indexOf(needle, index + 1)) {
    found.push(index);
  }
  return found;
}

/** The sole node one declaration name resolves to, used as an `ast-string` or `ast-path` root. */
export function declarationNode(roles: ParsedRoles, bundle: BundleRole, name: string): ts.Node {
  const found = namedDeclarations(roles.source[bundle], name);
  if (found.length !== 1) {
    throw new MechanicExtractionError(`declaration ${name} resolves ${found.length} times in ${bundle}`);
  }
  return found[0]!;
}

/** The declared value of a declaration, seeing through the game's `Object.freeze` wrappers. */
function declarationValueNode(node: ts.Node): ts.Node {
  if (ts.isVariableDeclaration(node) && node.initializer) return unwrapFreeze(node.initializer);
  return node;
}

function nodeCoveringRange(source: ts.SourceFile, start: number, end: number): ts.Node | null {
  let best: ts.Node | null = null;
  let bestWidth = Number.POSITIVE_INFINITY;
  const visit = (node: ts.Node): void => {
    const begin = nodeStart(node, source);
    const finish = node.getEnd();
    if (begin === start && finish === end && finish - begin <= bestWidth) {
      best = node;
      bestWidth = finish - begin;
    }
    if (begin <= start && finish >= end) ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return best;
}

function accessPath(node: ts.Expression): string {
  const parts: string[] = [];
  let current: ts.Expression = node;
  while (ts.isPropertyAccessExpression(current)) {
    parts.unshift(current.name.text);
    current = current.expression;
  }
  if (!ts.isIdentifier(current)) return "";
  parts.unshift(current.text);
  return parts.join(".");
}

/**
 * Walks an object literal by property path, seeing through `Object.freeze`.
 *
 * The main document nests its feature flags inside frozen objects, so a flag's initializer sits several
 * frozen literals deep. Following that structure is what lets the Endgame document cite the exact
 * boolean that controls three of its bullets.
 */
function resolveObjectPath(node: ts.Expression, path: readonly string[]): ts.Node | null {
  let current: ts.Node = unwrapFreeze(node);
  for (const key of path) {
    if (!ts.isObjectLiteralExpression(current)) return null;
    const property = current.properties.find(
      (candidate): candidate is ts.PropertyAssignment =>
        ts.isPropertyAssignment(candidate) &&
        (ts.isIdentifier(candidate.name) || ts.isStringLiteral(candidate.name)) &&
        candidate.name.text === key,
    );
    if (!property) return null;
    current = unwrapFreeze(property.initializer);
  }
  return current;
}

function unwrapFreeze(node: ts.Expression): ts.Node {
  if (
    ts.isCallExpression(node) &&
    node.arguments.length === 1 &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "freeze"
  ) {
    return unwrapFreeze(node.arguments[0]!);
  }
  return node;
}

function matchesValueType(node: ts.Node, valueType: "boolean" | "number" | "string"): boolean {
  switch (valueType) {
    case "boolean":
      return node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword;
    case "number":
      return ts.isNumericLiteral(node);
    case "string":
      return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
  }
}

/* ────────────────────────────── target registry ────────────────────────────── */

/**
 * Collects one document's source targets.
 *
 * Registering a target resolves it immediately, so a locator that no longer matches fails at the point
 * of use, named by the claim that needed it, rather than as an anonymous count mismatch later.
 */
export class TargetRegistry {
  private readonly targets = new Map<string, MechanicSourceTarget>();
  private readonly ranges = new Map<string, ResolvedRange>();

  constructor(private readonly roles: ParsedRoles) {}

  add(id: string, bundle: BundleRole, locator: MechanicLocator): string {
    const existing = this.targets.get(id);
    if (existing) {
      if (canonicalJson(existing.locator as unknown as CanonicalJson) !== canonicalJson(locator as unknown as CanonicalJson)) {
        throw new MechanicExtractionError(
          `source target ${id} is registered twice with different locators`,
        );
      }
      return id;
    }
    const range = resolveLocator(this.roles, bundle, locator);
    this.targets.set(id, {
      id,
      bundle,
      locator,
      sha256: sha256Hex(canonicalSourceSlice(range.sourceText, range.start, range.end)),
    });
    this.ranges.set(id, range);
    return id;
  }

  /** The canonical text of a registered target, which is exactly what its hash covers. */
  text(id: string): string {
    const range = this.ranges.get(id);
    if (!range) throw new MechanicExtractionError(`source target ${id} is not registered`);
    return canonicalSourceText(range.sourceText, range.start, range.end);
  }

  /** The literal value of a string target, which is the game's own displayed wording. */
  stringValue(id: string): string {
    const parsed = parseJsLiteralString(this.text(id).trim());
    if (parsed === null) throw new MechanicExtractionError(`source target ${id} is not a string literal`);
    return parsed;
  }

  /** The `defaultValue` of a translation options object, which is the game's own label. */
  defaultValue(id: string): string {
    const source = ts.createSourceFile(
      "options.js",
      `(${this.text(id)})`,
      ts.ScriptTarget.ESNext,
      true,
      ts.ScriptKind.JS,
    );
    let found: string | null = null;
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAssignment(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "defaultValue" &&
        (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer))
      ) {
        found = node.initializer.text;
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(source, visit);
    if (found === null) throw new MechanicExtractionError(`source target ${id} has no defaultValue`);
    return found;
  }

  list(): MechanicSourceTarget[] {
    return [...this.targets.values()].sort((left, right) => (left.id < right.id ? -1 : 1));
  }

  has(id: string): boolean {
    return this.targets.has(id);
  }
}

function parseJsLiteralString(raw: string): string | null {
  const source = ts.createSourceFile("literal.js", `(${raw})`, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const statement = source.statements[0];
  if (!statement || !ts.isExpressionStatement(statement)) return null;
  const expression = ts.isParenthesizedExpression(statement.expression)
    ? statement.expression.expression
    : statement.expression;
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }
  return null;
}

/* ────────────────────────────── text construction ────────────────────────────── */

/**
 * Builds one `MechanicText` and attaches its live-probe obligations.
 *
 * The obligations are not chosen here. A claim binding in the core registry names the exact text ID, the
 * exact expected raw value, the exact source targets, and the exact derivation output a passing probe
 * supports; all four must match before the requirement attaches. That is what stops a copy change from
 * inheriting someone else's live evidence.
 */
export class TextBuilder {
  private readonly seen = new Set<string>();

  constructor(private readonly documentId: string) {}

  editorial(id: string, text: string): MechanicText {
    return this.make(id, text, "editorial", [], null, null);
  }

  gameAuthored(id: string, text: string, sourceTargetIds: string[]): MechanicText {
    return this.make(id, text, "game-authored", sourceTargetIds, text, null);
  }

  sourceDerived(
    id: string,
    text: string,
    sourceTargetIds: string[],
    rawValue: MechanicJson,
    derivationOutputId: string | null,
  ): MechanicText {
    return this.make(id, text, "source-derived", sourceTargetIds, rawValue, derivationOutputId);
  }

  ids(): readonly string[] {
    return [...this.seen];
  }

  private make(
    id: string,
    text: string,
    kind: MechanicEvidence["kind"],
    sourceTargetIds: string[],
    rawValue: MechanicJson | null,
    derivationOutputId: string | null,
  ): MechanicText {
    if (this.seen.has(id)) {
      throw new MechanicExtractionError(`document ${this.documentId} declares the text id ${id} twice`);
    }
    this.seen.add(id);
    if (kind !== "editorial" && sourceTargetIds.length === 0) {
      throw new MechanicExtractionError(`${kind} text ${id} cites no source target`);
    }
    if (kind === "editorial" && sourceTargetIds.length > 0) {
      throw new MechanicExtractionError(`editorial text ${id} must cite no source target`);
    }
    const requiredProbes: MechanicProbeRef[] = [];
    for (const { contract, binding } of claimBindingsForText(id)) {
      assertBindingMatches(id, contract, binding, sourceTargetIds, rawValue, derivationOutputId);
      requiredProbes.push({
        suite: contract.suite,
        id: contract.id,
        category: contract.category,
        contractSha256: contract.contractSha256,
        promotionEligible: binding.promotionEligible,
      });
    }
    return { id, text, evidence: { kind, sourceTargetIds, requiredProbes } };
  }
}

function assertBindingMatches(
  textId: string,
  contract: MechanicProbeContract,
  binding: MechanicProbeClaimBinding,
  sourceTargetIds: readonly string[],
  rawValue: MechanicJson | null,
  derivationOutputId: string | null,
): void {
  const expected = [...binding.sourceTargetIds].sort().join("|");
  const actual = [...sourceTargetIds].sort().join("|");
  if (expected !== actual) {
    throw new MechanicExtractionError(
      `claim ${textId} cites [${actual}] but contract ${contract.id} binds [${expected}]`,
    );
  }
  if (binding.derivationOutputId !== derivationOutputId) {
    throw new MechanicExtractionError(
      `claim ${textId} names derivation output ${String(derivationOutputId)} but contract ${contract.id} binds ${String(binding.derivationOutputId)}`,
    );
  }
  if (rawValue === null) {
    throw new MechanicExtractionError(
      `claim ${textId} has no raw value to compare with contract ${contract.id}`,
    );
  }
  if (JSON.stringify(binding.expectedRawValue) !== JSON.stringify(rawValue)) {
    throw new MechanicExtractionError(
      `claim ${textId} has raw value ${JSON.stringify(rawValue)} but contract ${contract.id} expects ${JSON.stringify(binding.expectedRawValue)}`,
    );
  }
}

/* ────────────────────────────── ordered traversal ────────────────────────────── */

/** Every rendered text field, in the order a page renders it. The browser suite compares this exactly. */
export function documentTexts(document: MechanicDocument): MechanicText[] {
  const texts: MechanicText[] = [document.title, document.summary];
  for (const section of document.sections) {
    texts.push(section.title, ...section.paragraphs, ...section.bullets);
    for (const formula of section.formulas) {
      texts.push(formula.label, formula.expression);
      if (formula.note) texts.push(formula.note);
    }
    for (const fact of section.facts) texts.push(fact.label, fact.value);
  }
  for (const related of document.related) texts.push(related.label);
  return texts;
}

/** The stable, deduplicated union of live-probe obligations across every text in a document. */
export function requiredProbes(document: MechanicDocument): MechanicProbeRef[] {
  const byTuple = new Map<string, MechanicProbeRef>();
  const consider = (ref: MechanicProbeRef): void => {
    const key = `${ref.suite}\u0000${ref.id}\u0000${ref.category ?? ""}\u0000${ref.contractSha256}`;
    const existing = byTuple.get(key);
    // Promotion eligibility belongs to the claim rather than to the execution, so the union keeps the
    // strongest standing any bound claim was granted.
    if (!existing) byTuple.set(key, { ...ref });
    else if (ref.promotionEligible) existing.promotionEligible = true;
  };
  for (const text of documentTexts(document)) {
    for (const ref of text.evidence.requiredProbes) consider(ref);
  }
  for (const related of document.related) {
    for (const ref of related.href.evidence.requiredProbes) consider(ref);
  }
  return [...byTuple.values()].sort((left, right) =>
    `${left.suite}/${left.id}` < `${right.suite}/${right.id}` ? -1 : 1,
  );
}

/* ────────────────────────────── shared locator helpers ────────────────────────────── */


/** The codex expression literal and its label options object, both located by translation key. */
function addCodexFormulaTargets(
  targets: TargetRegistry,
  key: string,
): { label: string; expression: string } {
  return {
    label: addCodexLabelTarget(targets, key),
    expression: targets.add(`codex.${key}.expression`, "gameView", {
      kind: "translation-call-argument",
      translationKey: `codex.math.${key}`,
      argumentIndex: 1,
      argumentKind: "string",
    }),
  };
}

/** A codex entry that carries prose rather than a formula, so only its options object exists. */
function addCodexLabelTarget(targets: TargetRegistry, key: string): string {
  return targets.add(`codex.${key}.label`, "gameView", {
    kind: "translation-call-argument",
    translationKey: `codex.math.${key}`,
    argumentIndex: 1,
    argumentKind: "object",
  });
}

/** The path from one node to a descendant, expressed in the child-field language locators use. */
function astPathBetween(root: ts.Node, target: ts.Node): { field: string; index: number }[] | null {
  if (root === target) return [];
  for (const [field, children] of childrenByField(root)) {
    for (const [index, child] of children.entries()) {
      const rest = astPathBetween(child, target);
      if (rest) return [{ field, index }, ...rest];
    }
  }
  return null;
}

function nodeForRange(roles: ParsedRoles, bundle: BundleRole, range: ResolvedRange): ts.Node {
  const source = roles.source[bundle];
  let best: ts.Node | null = null;
  let bestWidth = Number.POSITIVE_INFINITY;
  const visit = (node: ts.Node): void => {
    const begin = node.getStart(source, false);
    const finish = node.getEnd();
    if (begin === range.start && finish === range.end && finish - begin <= bestWidth) {
      best = node;
      bestWidth = finish - begin;
    }
    if (begin <= range.start && finish >= range.end) ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  if (!best) throw new MechanicExtractionError("no AST node covers the resolved range");
  return best;
}

/**
 * The minified helper one shipped function calls, cited without naming it.
 *
 * `getItemSellValue` reaches its rarity table through a single-letter alias the bundler chose. Storing
 * that letter would make the citation break on the next build for no reason, so the locator stores the
 * path to the *use* and lets the declaration be found by node kind and structural shape.
 */
function addMinifiedCalleeTarget(
  roles: ParsedRoles,
  targets: TargetRegistry,
  targetId: string,
  bundle: BundleRole,
  root: MechanicLocator,
  intrinsics: ReadonlySet<string>,
): string {
  const rootNode = nodeForRange(roles, bundle, resolveLocator(roles, bundle, root));
  const called: ts.Identifier[] = [];
  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && !intrinsics.has(node.expression.text)) {
      called.push(node.expression);
    }
    ts.forEachChild(node, walk);
  };
  walk(rootNode);
  if (called.length !== 1) {
    throw new MechanicExtractionError(
      `${targetId} expects one non-intrinsic callee inside its root, found ${called.length}`,
    );
  }
  const use = called[0]!;
  const referencePath = astPathBetween(rootNode, use);
  if (!referencePath) throw new MechanicExtractionError(`${targetId} cannot address its callee use`);
  const declaration = declarationNode(roles, bundle, use.text);
  return targets.add(targetId, bundle, {
    kind: "ast-reference",
    root,
    referencePath,
    declarationNodeKind: ts.SyntaxKind[declaration.kind]!,
    declarationShapeSha256: astShapeSha256(declaration),
  });
}

/* ────────────────────────────── document: combat mathematics ────────────────────────────── */

const INTRINSIC_CALLEES: ReadonlySet<string> = new Set([
  "Array",
  "Boolean",
  "Math",
  "Number",
  "Object",
  "String",
]);

const MITIGATION_DERIVATION_ID = "combat.defense.mitigation";
const CRIT_DERIVATION_ID = "combat.crit.overflow";
const XP_DERIVATION_ID = "skills.xp";
const SELL_DERIVATION_ID = "equipment.sell";
const BALANCE_DERIVATION_ID = "equipment.balance";
const ENDGAME_MITIGATION_DERIVATION_ID = "endgame.shared-defense.mitigation";

/** The example Combat level the equipment curve is interpolated at, chosen to fall between two points. */
const CURVE_EXAMPLE_LEVEL = 110;

/**
 * Registers the incoming-mitigation implementation closure.
 *
 * Ordinals are the derivation's addressing scheme, not a name: the function first, then the two
 * constants it reads. A minified rename cannot disturb them, and the core registry's claim bindings
 * name these exact IDs, so a changed closure is a contract mismatch rather than a silent substitution.
 */
function addMitigationClosure(targets: TargetRegistry, derivationId: string): string[] {
  return [
    targets.add(`derivation.${derivationId}.node.0`, "index", {
      kind: "named-declaration",
      name: "getIncomingDefenseMitigation",
    }),
    targets.add(`derivation.${derivationId}.node.1`, "index", {
      kind: "named-declaration",
      name: "INCOMING_DEFENSE_LEVEL_CAP",
    }),
    targets.add(`derivation.${derivationId}.node.2`, "index", {
      kind: "named-declaration",
      name: "INCOMING_DEFENSE_MITIGATION_CAP",
    }),
  ];
}

function mitigationDerivationRequest(
  targets: TargetRegistry,
  derivationId: string,
  nodes: readonly string[],
): MechanicDerivationRequest {
  return {
    id: derivationId,
    evaluator: "eval-composition",
    sources: nodes.map((id) => ({ sourceTargetId: id, text: targets.text(id) })),
    bindings: {},
    // Zero arguments against a constant declaration reads the game's own value rather than restating it.
    calls: [
      { sourceTargetId: nodes[2]!, args: [] },
      { sourceTargetId: nodes[1]!, args: [] },
    ],
    outputs: [
      {
        id: `${derivationId}.cap`,
        textId: `${derivationId === MITIGATION_DERIVATION_ID ? "combat.defense" : "endgame.shared-defense"}.mitigation-cap.value`,
        format: "percent-2",
        template: null,
      },
      {
        id: `${derivationId}.level-clamp`,
        textId: `${derivationId === MITIGATION_DERIVATION_ID ? "combat.defense" : "endgame.shared-defense"}.level-clamp.value`,
        format: "integer",
        template: null,
      },
    ],
  };
}

/** One formula built from a codex entry, with the game's own label and expression. */
function codexFormula(
  text: TextBuilder,
  targets: TargetRegistry,
  formulaId: string,
  textPrefix: string,
  key: string,
): MechanicFormula {
  const { label, expression } = addCodexFormulaTargets(targets, key);
  return {
    id: formulaId,
    label: text.gameAuthored(`${textPrefix}.label`, targets.defaultValue(label), [label]),
    expression: text.gameAuthored(`${textPrefix}.expression`, targets.stringValue(expression), [expression]),
    note: null,
  };
}

function relatedLink(text: TextBuilder, idBase: string, label: string, href: string): MechanicRelated {
  return {
    label: text.editorial(`${idBase}.label`, label),
    href: text.editorial(`${idBase}.href`, href),
  };
}

type BuildContext = {
  roles: ParsedRoles;
  runDerivation: (request: MechanicDerivationRequest) => MechanicDerivation;
};

function buildCombatMathematics(context: BuildContext): MechanicDocument {
  const targets = new TargetRegistry(context.roles);
  const text = new TextBuilder("combat-mathematics");
  const derivations: MechanicDerivation[] = [];

  const mitigationNodes = addMitigationClosure(targets, MITIGATION_DERIVATION_ID);
  const mitigation = context.runDerivation(
    mitigationDerivationRequest(targets, MITIGATION_DERIVATION_ID, mitigationNodes),
  );
  derivations.push(mitigation);

  const critNode = targets.add(`derivation.${CRIT_DERIVATION_ID}.node.0`, "index", {
    kind: "named-declaration",
    name: "getCritOverflowDamageBonus",
  });
  const crit = context.runDerivation({
    id: CRIT_DERIVATION_ID,
    evaluator: "eval-composition",
    sources: [{ sourceTargetId: critNode, text: targets.text(critNode) }],
    bindings: {},
    // Overflow at the soft cap and well past it, which is what shows the conversion rate without
    // restating either constant.
    calls: [
      { sourceTargetId: critNode, args: [0.3] },
      { sourceTargetId: critNode, args: [0.8] },
    ],
    outputs: [
      {
        id: `${CRIT_DERIVATION_ID}.at-soft-cap`,
        textId: "combat.critical.overflow-threshold.value",
        format: "percent-2",
        template: null,
      },
      {
        id: `${CRIT_DERIVATION_ID}.at-eighty`,
        textId: "combat.critical.overflow-converted.value",
        format: "percent-2",
        template: null,
      },
    ],
  });
  derivations.push(crit);

  const introTarget = addCodexLabelTarget(targets, "defenseIntro");
  const overflowNoteTarget = addCodexLabelTarget(targets, "critOverflowText");
  const varianceTarget = addCodexLabelTarget(targets, "varianceNote");

  const capOutput = mitigation.outputs[0]!;
  const clampOutput = mitigation.outputs[1]!;
  const critSoftCap = crit.outputs[0]!;
  const critConverted = crit.outputs[1]!;

  const sections: MechanicSection[] = [
    {
      id: "defense",
      title: text.editorial("combat.section.defense.title", "Defense and incoming damage"),
      paragraphs: [
        text.gameAuthored("combat.defense.intro", targets.defaultValue(introTarget), [introTarget]),
      ],
      bullets: [],
      formulas: [
        codexFormula(text, targets, "defense.normal-mitigation", "combat.defense.normal-mitigation", "normalMitigation"),
        codexFormula(text, targets, "defense.incoming-result", "combat.defense.incoming-result", "incomingResult"),
        codexFormula(text, targets, "defense.block-result", "combat.defense.block-result", "blockResult"),
      ],
      facts: [
        {
          label: text.editorial("combat.defense.mitigation-cap.label", "Mitigation cap above Level 256"),
          value: text.sourceDerived(
            "combat.defense.mitigation-cap.value",
            capOutput.formattedText,
            mitigationNodes,
            capOutput.rawValue,
            capOutput.id,
          ),
        },
        {
          label: text.editorial("combat.defense.level-clamp.label", "Mitigation level clamp"),
          value: text.sourceDerived(
            "combat.defense.level-clamp.value",
            clampOutput.formattedText,
            mitigationNodes,
            clampOutput.rawValue,
            clampOutput.id,
          ),
        },
      ],
    },
    {
      id: "offense",
      title: text.editorial("combat.section.offense.title", "Auto attacks and armor"),
      paragraphs: [],
      bullets: [],
      formulas: [
        codexFormula(text, targets, "offense.base-auto", "combat.offense.base-auto", "baseAuto"),
        codexFormula(text, targets, "offense.effective-armor", "combat.offense.effective-armor", "effectiveArmor"),
      ],
      facts: [],
    },
    {
      id: "critical",
      title: text.editorial("combat.section.critical.title", "Critical hits and overflow"),
      paragraphs: [
        text.gameAuthored(
          "combat.critical.overflow.note",
          targets.defaultValue(overflowNoteTarget),
          [overflowNoteTarget],
        ),
      ],
      bullets: [],
      formulas: [
        codexFormula(text, targets, "critical.crit-multiplier", "combat.critical.crit-multiplier", "critMultiplier"),
      ],
      facts: [
        {
          label: text.editorial(
            "combat.critical.overflow-threshold.label",
            "Overflow converted at 30% overflow chance",
          ),
          value: text.sourceDerived(
            "combat.critical.overflow-threshold.value",
            critSoftCap.formattedText,
            [critNode],
            critSoftCap.rawValue,
            critSoftCap.id,
          ),
        },
        {
          label: text.editorial(
            "combat.critical.overflow-converted.label",
            "Overflow converted at 80% overflow chance",
          ),
          value: text.sourceDerived(
            "combat.critical.overflow-converted.value",
            critConverted.formattedText,
            [critNode],
            critConverted.rawValue,
            critConverted.id,
          ),
        },
      ],
    },
    {
      id: "progression",
      title: text.editorial("combat.section.progression.title", "Progression, Hitpoints, and Magic"),
      paragraphs: [],
      bullets: [],
      formulas: [
        codexFormula(text, targets, "progression.coefficient", "combat.progression.coefficient", "progressionCoefficient"),
        codexFormula(text, targets, "progression.hitpoints", "combat.progression.hitpoints", "hitpointsFormula"),
        codexFormula(text, targets, "progression.intelligence", "combat.progression.intelligence", "intelligenceFormula"),
        codexFormula(text, targets, "progression.magic-damage", "combat.progression.magic-damage", "magicDamageFormula"),
      ],
      facts: [],
    },
    {
      id: "sustain",
      title: text.editorial("combat.section.sustain.title", "Life Steal, Poison, and Freeze"),
      paragraphs: [
        text.gameAuthored("combat.sustain.variance.note", targets.defaultValue(varianceTarget), [varianceTarget]),
      ],
      bullets: [],
      formulas: [
        codexFormula(text, targets, "sustain.lifesteal-heal", "combat.sustain.lifesteal-heal", "lifestealHeal"),
        codexFormula(text, targets, "sustain.lifesteal-cap", "combat.sustain.lifesteal-cap", "lifestealCap"),
        codexFormula(text, targets, "sustain.poison-tick", "combat.sustain.poison-tick", "poisonTick"),
        codexFormula(text, targets, "sustain.freeze-slow", "combat.sustain.freeze-slow", "freezeSlow"),
      ],
      facts: [],
    },
  ];

  return {
    id: "combat-mathematics",
    title: text.editorial("combat-mathematics.title", "Combat Mathematics"),
    category: "combat",
    summary: text.editorial(
      "combat-mathematics.summary",
      "Defense, damage, critical hits, Hitpoints, Life Steal, Poison, and Freeze.",
    ),
    sections,
    related: [
      relatedLink(text, "combat.related.ability", "Ability Calculations", "/mechanics/ability-calculations/"),
      relatedLink(text, "combat.related.equipment", "Equipment and Item Value", "/mechanics/equipment-and-value/"),
    ],
    sourceTargets: targets.list(),
    derivations,
  };
}

/* ────────────────────────────── document: ability calculations ────────────────────────────── */

function buildAbilityCalculations(context: BuildContext): MechanicDocument {
  const targets = new TargetRegistry(context.roles);
  const text = new TextBuilder("ability-calculations");

  const noteTarget = addCodexLabelTarget(targets, "abilityNote");
  const orderTitleTarget = addCodexLabelTarget(targets, "orderTitle");
  const orderKickerTarget = addCodexLabelTarget(targets, "orderKicker");
  const orderNoteTarget = addCodexLabelTarget(targets, "orderNote");
  const varianceTarget = addCodexLabelTarget(targets, "varianceNote");

  const sections: MechanicSection[] = [
    {
      id: "scaling",
      title: text.editorial("ability.section.scaling.title", "Ability scaling and Defense"),
      paragraphs: [
        text.gameAuthored("ability.scaling.note", targets.defaultValue(noteTarget), [noteTarget]),
      ],
      bullets: [],
      formulas: [
        codexFormula(text, targets, "scaling.level", "ability.scaling.level", "abilityLevelScale"),
        codexFormula(text, targets, "scaling.stat", "ability.scaling.stat", "abilityStatScale"),
        codexFormula(text, targets, "scaling.defense", "ability.scaling.defense", "abilityDefense"),
      ],
      facts: [],
    },
    {
      id: "order",
      // The game titles this section itself, so the compendium quotes it rather than inventing a heading.
      title: text.gameAuthored(
        "ability.section.order.title",
        targets.defaultValue(orderTitleTarget),
        [orderTitleTarget],
      ),
      paragraphs: [
        text.gameAuthored("ability.order.kicker", targets.defaultValue(orderKickerTarget), [orderKickerTarget]),
        text.gameAuthored("ability.order.note", targets.defaultValue(orderNoteTarget), [orderNoteTarget]),
        text.gameAuthored("ability.order.variance", targets.defaultValue(varianceTarget), [varianceTarget]),
      ],
      bullets: [],
      formulas: [],
      facts: [],
    },
  ];

  return {
    id: "ability-calculations",
    title: text.editorial("ability-calculations.title", "Ability Calculations"),
    category: "combat",
    summary: text.editorial(
      "ability-calculations.summary",
      "Ability level scaling, class stats, Armor Penetration, Defense, and conditional effects.",
    ),
    sections,
    related: [
      relatedLink(text, "ability.related.combat", "Combat Mathematics", "/mechanics/combat-mathematics/"),
      relatedLink(text, "ability.related.abilities", "Every ability", "/abilities/"),
    ],
    sourceTargets: targets.list(),
    derivations: [],
  };
}

/* ────────────────────────────── document: skills and crafting ────────────────────────────── */

/** The bonus entry shape the shipped XP method reads, so an example states real inputs. */
function xpBonus(target: string, value: number): MechanicJson {
  return { source: "vespera-compendium-probe", target, type: "multiplier", value };
}

const XP_EXAMPLES: { id: string; label: string; bonuses: MechanicJson[] }[] = [
  { id: "base", label: "101 base XP with no bonus", bonuses: [] },
  { id: "matching", label: "101 base XP with +10% Combat XP", bonuses: [xpBonus("combatXp", 0.1)] },
  { id: "global", label: "101 base XP with +20% global XP", bonuses: [xpBonus("xpBonus", 0.2)] },
  {
    id: "both",
    label: "101 base XP with +10% Combat XP and +20% global XP",
    bonuses: [xpBonus("combatXp", 0.1), xpBonus("xpBonus", 0.2)],
  },
  {
    id: "mismatched",
    label: "101 base XP with +50% Gathering XP on a Combat gain",
    bonuses: [xpBonus("gatheringXp", 0.5)],
  },
];

function buildSkillsAndCrafting(context: BuildContext): MechanicDocument {
  const targets = new TargetRegistry(context.roles);
  const text = new TextBuilder("skills-and-crafting");

  // The game keeps these methods in one contiguous run, and the run is what a reviewer reads, so the
  // region is cited whole rather than reassembled method by method.
  const region = targets.add("skills.region.gather-craft", "index", {
    kind: "bounded-region",
    start: "static calculateGatherTime",
    end: "static calculateGatherAmount",
    containsAll: [
      "static calculateCraftTime",
      "static calculateXpGain",
      "static rollDoubleResource",
      "static rollTripleResource",
      "static rollSaveMaterial",
      "static getBulkCraftLimit",
    ],
  });

  const xpNodes = [
    targets.add(`derivation.${XP_DERIVATION_ID}.node.0`, "index", {
      kind: "named-declaration",
      name: "calculateXpGain",
    }),
    targets.add(`derivation.${XP_DERIVATION_ID}.node.1`, "index", {
      kind: "named-declaration",
      name: "getBonusValue",
    }),
  ];

  const xp = context.runDerivation({
    id: XP_DERIVATION_ID,
    evaluator: "eval-composition",
    sources: xpNodes.map((id) => ({ sourceTargetId: id, text: targets.text(id) })),
    bindings: {},
    calls: XP_EXAMPLES.map((example) => ({
      sourceTargetId: xpNodes[0]!,
      args: [{ baseXp: 101, skillType: "combat", bonuses: example.bonuses }],
    })),
    outputs: XP_EXAMPLES.map((example) => ({
      id: `${XP_DERIVATION_ID}.${example.id}`,
      textId: `skills.xp.example.${example.id}.value`,
      format: "integer" as MechanicValueFormat,
      template: null,
    })),
  });

  const xpExpressionText = "XP = floor(Base XP × [1 + Skill XP bonus + Global XP bonus])";
  const sections: MechanicSection[] = [
    {
      id: "xp",
      title: text.editorial("skills.section.xp.title", "Skill XP"),
      paragraphs: [],
      bullets: [],
      formulas: [
        {
          id: "xp.multiplier",
          label: text.editorial("skills.xp.multiplier.label", "XP gain"),
          expression: text.sourceDerived(
            "skills.xp.multiplier.expression",
            xpExpressionText,
            [region, ...xpNodes],
            xpExpressionText,
            null,
          ),
          note: text.editorial(
            "skills.xp.multiplier.note",
            "A bonus applies only when it targets the skill that earned the XP, or when it targets global XP.",
          ),
        },
      ],
      facts: XP_EXAMPLES.map((example, index) => {
        const output = xp.outputs[index]!;
        return {
          label: text.editorial(`skills.xp.example.${example.id}.label`, example.label),
          value: text.sourceDerived(
            `skills.xp.example.${example.id}.value`,
            output.formattedText,
            xpNodes,
            output.rawValue,
            output.id,
          ),
        };
      }),
    },
    {
      id: "speed",
      title: text.editorial("skills.section.speed.title", "Gathering and crafting speed"),
      paragraphs: [],
      bullets: [],
      formulas: [
        {
          id: "speed.gather-time",
          label: text.editorial("skills.speed.gather-time.label", "Gather time"),
          expression: text.sourceDerived(
            "skills.speed.gather-time.expression",
            "Gather time = max(100 ms, Base time × [1 + Gather Speed bonus])",
            [region],
            "Gather time = max(100 ms, Base time × [1 + Gather Speed bonus])",
            null,
          ),
          note: null,
        },
        {
          id: "speed.craft-time",
          label: text.editorial("skills.speed.craft-time.label", "Craft time"),
          expression: text.sourceDerived(
            "skills.speed.craft-time.expression",
            "Craft time = max(100 ms, Base time × [1 + Craft Speed bonus])",
            [region],
            "Craft time = max(100 ms, Base time × [1 + Craft Speed bonus])",
            null,
          ),
          note: null,
        },
        {
          id: "speed.bulk-craft",
          label: text.editorial("skills.speed.bulk-craft.label", "Bulk craft limit"),
          expression: text.sourceDerived(
            "skills.speed.bulk-craft.expression",
            "Bulk craft limit = Bulk Craft unlock value when it is above zero, otherwise 1",
            [region],
            "Bulk craft limit = Bulk Craft unlock value when it is above zero, otherwise 1",
            null,
          ),
          note: null,
        },
        {
          id: "speed.gather-amount",
          label: text.editorial("skills.speed.gather-amount.label", "Gather amount"),
          expression: text.sourceDerived(
            "skills.speed.gather-amount.expression",
            "Gather amount = 1 + floor(Gather Amount stat bonus)",
            [region],
            "Gather amount = 1 + floor(Gather Amount stat bonus)",
            null,
          ),
          note: null,
        },
      ],
      facts: [],
    },
    {
      id: "rolls",
      title: text.editorial("skills.section.rolls.title", "Bonus resource and material rolls"),
      paragraphs: [
        text.sourceDerived(
          "skills.rolls.double-resource.note",
          "A double resource roll compares one random draw against the Double Resource Chance stat bonus.",
          [region],
          "A double resource roll compares one random draw against the Double Resource Chance stat bonus.",
          null,
        ),
        text.sourceDerived(
          "skills.rolls.triple-resource.note",
          "A triple resource roll compares one random draw against the Triple Resource Chance stat bonus.",
          [region],
          "A triple resource roll compares one random draw against the Triple Resource Chance stat bonus.",
          null,
        ),
        text.sourceDerived(
          "skills.rolls.save-material.note",
          "A material save roll compares one random draw against the Save Material Chance stat bonus.",
          [region],
          "A material save roll compares one random draw against the Save Material Chance stat bonus.",
          null,
        ),
        text.sourceDerived(
          "skills.rolls.double-craft.note",
          "A double craft roll compares one random draw against the Double Craft Chance stat bonus.",
          [region],
          "A double craft roll compares one random draw against the Double Craft Chance stat bonus.",
          null,
        ),
      ],
      bullets: [],
      formulas: [],
      facts: [],
    },
  ];

  return {
    id: "skills-and-crafting",
    title: text.editorial("skills-and-crafting.title", "Skills and Crafting"),
    category: "skills",
    summary: text.editorial(
      "skills-and-crafting.summary",
      "XP bonuses, gathering and crafting speed, resource rolls, and material saves.",
    ),
    sections,
    related: [
      relatedLink(text, "skills.related.recipes", "Every recipe", "/recipes/"),
      relatedLink(text, "skills.related.nodes", "Every gathering node", "/gathering-nodes/"),
    ],
    sourceTargets: targets.list(),
    derivations: [xp],
  };
}

/* ────────────────────────────── document: equipment and value ────────────────────────────── */

const SELL_RARITY_ORDER = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "living",
  "mythic",
  "legendary",
] as const;

const SELL_RARITY_LABELS: Record<(typeof SELL_RARITY_ORDER)[number], string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  epic: "Epic",
  living: "Living",
  mythic: "Mythic",
  legendary: "Legendary",
};

const SELL_EDGE_CASES: { id: string; label: string; args: MechanicJson[] }[] = [
  { id: "quantity-zero", label: "Common, base value 100, quantity 0", args: [{ value: 100 }, "common", 0] },
  { id: "rare-quantity-three", label: "Rare, base value 100, quantity 3", args: [{ value: 100 }, "rare", 3] },
  {
    id: "fractional-uncommon",
    label: "Uncommon, base value 10.5, quantity 3",
    args: [{ value: 10.5 }, "uncommon", 3],
  },
  {
    id: "unknown-rarity",
    label: "Unrecognised rarity, base value 100, quantity 1",
    args: [{ value: 100 }, "unknown", 1],
  },
];

function buildEquipmentAndValue(context: BuildContext): MechanicDocument {
  const targets = new TargetRegistry(context.roles);
  const text = new TextBuilder("equipment-and-value");

  const normalization = targets.add("equipment.region.complete-gear-normalization", "index", {
    kind: "bounded-region",
    start: "const CLASS_GEAR_SPECIAL_NIGHTMARE_RECIPE_PATTERN",
    end: "normalizeCompleteGearBalance();",
    containsAll: ["getCompleteGearBalanceLevel", "COMPLETE_GEAR_POWER_CURVE"],
  });

  const sellRoot: MechanicLocator = { kind: "named-declaration", name: "getItemSellValue" };
  const sellNodes = [
    targets.add(`derivation.${SELL_DERIVATION_ID}.node.0`, "index", sellRoot),
    addMinifiedCalleeTarget(
      context.roles,
      targets,
      `derivation.${SELL_DERIVATION_ID}.node.1`,
      "index",
      sellRoot,
      INTRINSIC_CALLEES,
    ),
  ];

  const sellCalls: { sourceTargetId: string; args: MechanicJson[] }[] = [
    ...SELL_RARITY_ORDER.map((rarity) => ({
      sourceTargetId: sellNodes[0]!,
      args: [{ value: 100 }, rarity, 1] as MechanicJson[],
    })),
    ...SELL_EDGE_CASES.map((edge) => ({ sourceTargetId: sellNodes[0]!, args: edge.args })),
  ];
  const sell = context.runDerivation({
    id: SELL_DERIVATION_ID,
    evaluator: "eval-composition",
    sources: sellNodes.map((id) => ({ sourceTargetId: id, text: targets.text(id) })),
    bindings: {},
    calls: sellCalls,
    outputs: [
      ...SELL_RARITY_ORDER.map((rarity) => ({
        id: `${SELL_DERIVATION_ID}.rarity.${rarity}`,
        textId: `equipment.sell.rarity.${rarity}.value`,
        format: "integer" as MechanicValueFormat,
        template: null,
      })),
      ...SELL_EDGE_CASES.map((edge) => ({
        id: `${SELL_DERIVATION_ID}.edge.${edge.id}`,
        textId: `equipment.sell.edge.${edge.id}.value`,
        format: "integer" as MechanicValueFormat,
        template: null,
      })),
    ],
  });

  const balanceNodes = [
    targets.add(`derivation.${BALANCE_DERIVATION_ID}.node.0`, "index", {
      kind: "named-declaration",
      name: "getCompleteGearCurveValue",
    }),
    targets.add(`derivation.${BALANCE_DERIVATION_ID}.node.1`, "index", {
      kind: "named-declaration",
      name: "COMPLETE_GEAR_POWER_CURVE",
    }),
  ];
  const balance = context.runDerivation({
    id: BALANCE_DERIVATION_ID,
    evaluator: "eval-composition",
    sources: balanceNodes.map((id) => ({ sourceTargetId: id, text: targets.text(id) })),
    bindings: {},
    calls: [
      { sourceTargetId: balanceNodes[1]!, args: [] },
      { sourceTargetId: balanceNodes[0]!, args: [CURVE_EXAMPLE_LEVEL, "offense"] },
      { sourceTargetId: balanceNodes[0]!, args: [CURVE_EXAMPLE_LEVEL, "health"] },
    ],
    outputs: [
      {
        id: `${BALANCE_DERIVATION_ID}.curve`,
        textId: "equipment.balance.curve.value",
        format: "json-grid",
        template: null,
      },
      {
        id: `${BALANCE_DERIVATION_ID}.offense`,
        textId: "equipment.balance.offense-example.value",
        format: "decimal-3",
        template: null,
      },
      {
        id: `${BALANCE_DERIVATION_ID}.health`,
        textId: "equipment.balance.health-example.value",
        format: "decimal-3",
        template: null,
      },
    ],
  });

  const sellExpressionText = "Sell = floor(Base value × Rarity multiplier × floor(Quantity))";
  const curveOutput = balance.outputs[0]!;
  const offenseOutput = balance.outputs[1]!;
  const healthOutput = balance.outputs[2]!;

  const sections: MechanicSection[] = [
    {
      id: "item-level",
      title: text.editorial("equipment.section.item-level.title", "Item level"),
      paragraphs: [
        text.sourceDerived(
          "equipment.item-level.balance",
          "For equipment the game computes a balance level and rescales the item's stats against it. World boss gear and one named item are excluded deliberately, so they carry no balance level.",
          [normalization],
          "For equipment the game computes a balance level and rescales the item's stats against it. World boss gear and one named item are excluded deliberately, so they carry no balance level.",
          null,
        ),
        text.sourceDerived(
          "equipment.item-level.other",
          "For every other item the published level is a property of the source that grants it, not a balance level.",
          [normalization],
          "For every other item the published level is a property of the source that grants it, not a balance level.",
          null,
        ),
      ],
      bullets: [],
      formulas: [],
      facts: [],
    },
    {
      id: "balance",
      title: text.editorial("equipment.section.balance.title", "The complete-gear power curve"),
      paragraphs: [
        text.sourceDerived(
          "equipment.balance.interpolation",
          "The curve fixes offense and health at named levels. Between two of them the game interpolates linearly, and beyond the last one it holds the final pair.",
          balanceNodes,
          "The curve fixes offense and health at named levels. Between two of them the game interpolates linearly, and beyond the last one it holds the final pair.",
          null,
        ),
      ],
      bullets: [],
      formulas: [],
      facts: [
        {
          label: text.editorial("equipment.balance.curve.label", "Offense and health at each curve level"),
          value: text.sourceDerived(
            "equipment.balance.curve.value",
            curveOutput.formattedText,
            balanceNodes,
            curveOutput.rawValue,
            curveOutput.id,
          ),
        },
        {
          label: text.editorial(
            "equipment.balance.offense-example.label",
            `Interpolated offense at balance level ${CURVE_EXAMPLE_LEVEL}`,
          ),
          value: text.sourceDerived(
            "equipment.balance.offense-example.value",
            offenseOutput.formattedText,
            balanceNodes,
            offenseOutput.rawValue,
            offenseOutput.id,
          ),
        },
        {
          label: text.editorial(
            "equipment.balance.health-example.label",
            `Interpolated health at balance level ${CURVE_EXAMPLE_LEVEL}`,
          ),
          value: text.sourceDerived(
            "equipment.balance.health-example.value",
            healthOutput.formattedText,
            balanceNodes,
            healthOutput.rawValue,
            healthOutput.id,
          ),
        },
      ],
    },
    {
      id: "sell",
      title: text.editorial("equipment.section.sell.title", "Sell value"),
      paragraphs: [],
      bullets: [],
      formulas: [
        {
          id: "sell.value",
          label: text.editorial("equipment.sell.label", "Sell value"),
          expression: text.sourceDerived(
            "equipment.sell.expression",
            sellExpressionText,
            sellNodes,
            sellExpressionText,
            null,
          ),
          note: text.editorial(
            "equipment.sell.note",
            "An unrecognised rarity falls back to the Common multiplier rather than failing.",
          ),
        },
      ],
      facts: [
        ...SELL_RARITY_ORDER.map((rarity, index) => {
          const output = sell.outputs[index]!;
          return {
            label: text.editorial(
              `equipment.sell.rarity.${rarity}.label`,
              `${SELL_RARITY_LABELS[rarity]}, base value 100, quantity 1`,
            ),
            value: text.sourceDerived(
              `equipment.sell.rarity.${rarity}.value`,
              output.formattedText,
              sellNodes,
              output.rawValue,
              output.id,
            ),
          };
        }),
        ...SELL_EDGE_CASES.map((edge, index) => {
          const output = sell.outputs[SELL_RARITY_ORDER.length + index]!;
          return {
            label: text.editorial(`equipment.sell.edge.${edge.id}.label`, edge.label),
            value: text.sourceDerived(
              `equipment.sell.edge.${edge.id}.value`,
              output.formattedText,
              sellNodes,
              output.rawValue,
              output.id,
            ),
          };
        }),
      ],
    },
  ];

  return {
    id: "equipment-and-value",
    title: text.editorial("equipment-and-value.title", "Equipment and Item Value"),
    category: "equipment",
    summary: text.editorial(
      "equipment-and-value.summary",
      "Item level, equipment balance curves, rarity, and sell value.",
    ),
    sections,
    related: [
      relatedLink(text, "equipment.related.items", "Every item", "/items/"),
      relatedLink(text, "equipment.related.gems", "Every gem", "/gems/"),
    ],
    sourceTargets: targets.list(),
    derivations: [sell, balance],
  };
}

/* ────────────────────────────── document: endgame systems ────────────────────────────── */

/** The anchors that identify the Endgame guide's own section array inside GameView. */
const ENDGAME_SECTIONS_LOCATOR: MechanicLocator = {
  kind: "declaration-shape",
  node: "array",
  containsAll: ['id: "route"', 'id: "tower-scaling"', 'id: "spire"'],
};

const ENDGAME_EXPECTED_SECTIONS = 11;
const ENDGAME_EXPECTED_BULLETS = 63;

type EndgameSection = { id: string; title: string; bullets: string[] };

function isEndgameSectionList(value: unknown): value is EndgameSection[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        entry !== null &&
        typeof entry === "object" &&
        "id" in entry &&
        typeof entry.id === "string" &&
        "title" in entry &&
        typeof entry.title === "string" &&
        "bullets" in entry &&
        Array.isArray(entry.bullets) &&
        entry.bullets.every((bullet: unknown) => typeof bullet === "string"),
    )
  );
}

function buildEndgameSystems(
  context: BuildContext,
  evaluateSections: (text: string, grandworksEnabled: boolean) => unknown,
): MechanicDocument {
  const targets = new TargetRegistry(context.roles);
  const text = new TextBuilder("endgame-systems");

  // The flag lives in the main document and is read by the index bundle, so both nodes control whether
  // three of the guide's bullets say what they say.
  const flagHtml = targets.add("endgame.flag.grandworks.html", "indexHtml", {
    kind: "html-assignment",
    name: "window.__VESPERA_FEATURE_FLAGS__.grandworks.enabled",
    valueType: "boolean",
  });
  const flagInitializer = targets.add("endgame.flag.grandworks.initializer", "index", {
    kind: "named-declaration",
    name: "GRANDWORKS_ENABLED",
  });
  const grandworksEnabled = targets.text(flagHtml).trim() === "true";

  const sectionsRange = resolveLocator(context.roles, "gameView", ENDGAME_SECTIONS_LOCATOR);
  const sectionsNode = nodeForRange(context.roles, "gameView", sectionsRange);
  const sectionsText = canonicalSourceText(sectionsRange.sourceText, sectionsRange.start, sectionsRange.end);
  const evaluated = evaluateSections(sectionsText, grandworksEnabled);
  if (!isEndgameSectionList(evaluated)) {
    throw new MechanicExtractionError("the Endgame section array did not evaluate to a section list");
  }
  if (evaluated.length !== ENDGAME_EXPECTED_SECTIONS) {
    throw new MechanicExtractionError(
      `the Endgame guide has ${evaluated.length} sections, expected ${ENDGAME_EXPECTED_SECTIONS}`,
    );
  }
  const bulletCount = evaluated.reduce((total, section) => total + section.bullets.length, 0);
  if (bulletCount !== ENDGAME_EXPECTED_BULLETS) {
    throw new MechanicExtractionError(
      `the Endgame guide has ${bulletCount} bullets, expected ${ENDGAME_EXPECTED_BULLETS}`,
    );
  }

  /**
   * The conditional expressions the feature flag controls, addressed by structural path.
   *
   * Three bullets read differently when Grandworks is on. Those three cite the flag and the conditional
   * as well as their own literal, because the literal alone would not explain why the compendium shows
   * this wording rather than the other one. The remaining sixty cite only their literal.
   */
  const controlPaths = new Map<string, { field: string; index: number }[]>();
  const collectControls = (node: ts.Node): void => {
    if (
      ts.isConditionalExpression(node) &&
      node.condition.getText(context.roles.source.gameView).includes("GRANDWORKS_ENABLED")
    ) {
      const branch = grandworksEnabled ? node.whenTrue : node.whenFalse;
      if (ts.isStringLiteral(branch) || ts.isNoSubstitutionTemplateLiteral(branch)) {
        const path = astPathBetween(sectionsNode, node);
        if (path) controlPaths.set(branch.text, path);
      }
    }
    ts.forEachChild(node, collectControls);
  };
  collectControls(sectionsNode);

  const sections: MechanicSection[] = evaluated.map((section) => {
    const titleTarget = targets.add(`endgame.section.${section.id}.title`, "gameView", {
      kind: "ast-string",
      declaration: { name: "sections", node: "array" },
      value: section.title,
      occurrence: 1,
    });
    if (targets.stringValue(titleTarget) !== section.title) {
      throw new MechanicExtractionError(`Endgame section ${section.id} title does not match its literal`);
    }
    const bullets = section.bullets.map((bullet, index) => {
      const bulletId = `endgame.section.${section.id}.bullet.${index}`;
      const bulletTarget = targets.add(bulletId, "gameView", {
        kind: "ast-string",
        declaration: { name: "sections", node: "array" },
        value: bullet,
        occurrence: 1,
      });
      if (targets.stringValue(bulletTarget) !== bullet) {
        throw new MechanicExtractionError(`Endgame bullet ${bulletId} does not match its literal`);
      }
      const controlPath = controlPaths.get(bullet);
      const cited = [bulletTarget];
      if (controlPath) {
        const controlNode = followPath(sectionsNode, controlPath, `${bulletId} control`);
        cited.push(
          targets.add(`${bulletId}.control`, "gameView", {
            kind: "ast-path",
            root: ENDGAME_SECTIONS_LOCATOR,
            childPath: controlPath,
            nodeKind: ts.SyntaxKind[controlNode.kind]!,
            shapeSha256: astShapeSha256(controlNode),
          }),
          flagInitializer,
          flagHtml,
        );
      }
      return text.gameAuthored(bulletId, bullet, cited);
    });
    return {
      id: section.id,
      title: text.gameAuthored(`endgame.section.${section.id}.title`, section.title, [titleTarget]),
      paragraphs: [],
      bullets,
      formulas: [],
      facts: [],
    };
  });

  // The shared Defense rule appears in the game's own prose and in the Combat codex, and its cap and
  // clamp are executed here rather than restated, so the Endgame guide carries the same standing as
  // Combat Mathematics for the same claim.
  const sharedMath = sections.find((section) => section.id === "shared-math");
  if (!sharedMath) throw new MechanicExtractionError("the Endgame guide has no shared-math section");

  const codexMitigation = targets.add("codex.normalMitigation.expression", "gameView", {
    kind: "translation-call-argument",
    translationKey: "codex.math.normalMitigation",
    argumentIndex: 1,
    argumentKind: "string",
  });
  const defenseBullet = "endgame.section.shared-math.bullet.1";
  if (!targets.has(defenseBullet)) {
    throw new MechanicExtractionError(`the Endgame shared-math section has no ${defenseBullet}`);
  }

  const mitigationNodes = addMitigationClosure(targets, ENDGAME_MITIGATION_DERIVATION_ID);
  const mitigation = context.runDerivation(
    mitigationDerivationRequest(targets, ENDGAME_MITIGATION_DERIVATION_ID, mitigationNodes),
  );
  const capOutput = mitigation.outputs[0]!;
  const clampOutput = mitigation.outputs[1]!;

  sharedMath.formulas.push({
    id: "shared-defense.normal-mitigation",
    label: text.editorial("endgame.shared-defense.normal-mitigation.label", "Incoming Defense mitigation"),
    expression: text.gameAuthored(
      "endgame.shared-defense.normal-mitigation.expression",
      targets.stringValue(codexMitigation),
      [codexMitigation, defenseBullet],
    ),
    note: null,
  });
  sharedMath.facts.push(
    {
      label: text.editorial("endgame.shared-defense.mitigation-cap.label", "Mitigation cap above Level 256"),
      value: text.sourceDerived(
        "endgame.shared-defense.mitigation-cap.value",
        capOutput.formattedText,
        mitigationNodes,
        capOutput.rawValue,
        capOutput.id,
      ),
    },
    {
      label: text.editorial("endgame.shared-defense.level-clamp.label", "Mitigation level clamp"),
      value: text.sourceDerived(
        "endgame.shared-defense.level-clamp.value",
        clampOutput.formattedText,
        mitigationNodes,
        clampOutput.rawValue,
        clampOutput.id,
      ),
    },
  );

  const document: MechanicDocument = {
    id: "endgame-systems",
    title: text.editorial("endgame-systems.title", "Endgame Systems"),
    category: "progression",
    summary: text.editorial(
      "endgame-systems.summary",
      "Nightmare, Tower, Corruption, Forge, Vanguards, Spire, Frontier, and Grandworks.",
    ),
    sections,
    related: [
      relatedLink(text, "endgame.related.progression", "The Combat progression route", "/progression/"),
      relatedLink(text, "endgame.related.combat", "Combat Mathematics", "/mechanics/combat-mathematics/"),
    ],
    sourceTargets: targets.list(),
    derivations: [mitigation],
  };

  // A target no claim references would be evidence the model does not actually rest on, so it is
  // refused rather than left as decoration.
  assertEveryTargetReferenced(document);
  return document;
}

function assertEveryTargetReferenced(document: MechanicDocument): void {
  const referenced = new Set<string>();
  for (const text of documentTexts(document)) {
    for (const id of text.evidence.sourceTargetIds) referenced.add(id);
  }
  for (const derivation of document.derivations) {
    for (const id of derivation.sourceTargetIds) referenced.add(id);
  }
  const orphans = document.sourceTargets.filter((target) => !referenced.has(target.id));
  if (orphans.length > 0) {
    throw new MechanicExtractionError(
      `document ${document.id} declares unreferenced source targets: ${orphans.map((target) => target.id).join(", ")}`,
    );
  }
}

/* ────────────────────────────── orchestration ────────────────────────────── */

export type ExtractionOutcome =
  | { status: "OK"; document: MechanicDocument }
  | { status: "UNRESOLVED"; diagnostics: string[] }
  | { status: "MODEL_CHANGED"; candidate: MechanicDocument | null; diagnostics: string[] };

const BUILDERS: Record<MechanicDocumentId, (context: BuildContext) => MechanicDocument> = {
  "combat-mathematics": buildCombatMathematics,
  "ability-calculations": buildAbilityCalculations,
  "skills-and-crafting": buildSkillsAndCrafting,
  "equipment-and-value": buildEquipmentAndValue,
  "endgame-systems": (context) =>
    buildEndgameSystems(context, (arrayText, grandworksEnabled) =>
      // The strict sandbox with the game's own flag, never a permissive stub: `tx` returns the default
      // the game passes it, which is exactly what an English client renders.
      evalComposition(`(()=>{ return ${arrayText}; })()`, {
        tx: (_key: unknown, value: unknown) => value,
        GRANDWORKS_ENABLED: grandworksEnabled,
      }),
    ),
};

/**
 * Every codex entry is consumed exactly once, across exactly two documents.
 *
 * The two guides split the codex by subject, so neither alone can prove the split is complete. Checking
 * the union here is what turns a codex the game quietly extended into a failure rather than a gap.
 */
function assertCodexInventory(documents: readonly MechanicDocument[]): void {
  const consumed: string[] = [];
  for (const document of documents) {
    if (document.id !== "combat-mathematics" && document.id !== "ability-calculations") continue;
    for (const target of document.sourceTargets) {
      const match = /^codex\.([A-Za-z0-9_]+)\.expression$/.exec(target.id);
      if (match) consumed.push(match[1]!);
    }
  }
  const expected: readonly string[] = [...CODEX_FORMULA_KEYS].sort();
  const actual = [...consumed].sort();
  const duplicates = actual.filter((key, index) => actual.indexOf(key) !== index);
  if (duplicates.length > 0) {
    throw new MechanicExtractionError(`codex keys consumed more than once: ${duplicates.join(", ")}`);
  }
  if (expected.join("|") !== actual.join("|")) {
    const missing = expected.filter((key) => !actual.includes(key));
    const extra = actual.filter((key) => !expected.includes(key));
    throw new MechanicExtractionError(
      `codex inventory mismatch (missing=${missing.join(",") || "none"} extra=${extra.join(",") || "none"})`,
    );
  }
  const abilityKeys = documents
    .filter((document) => document.id === "ability-calculations")
    .flatMap((document) =>
      document.sourceTargets
        .map((target) => /^codex\.([A-Za-z0-9_]+)\.expression$/.exec(target.id)?.[1])
        .filter((key): key is string => key !== undefined),
    )
    .sort();
  if (abilityKeys.join("|") !== [...ABILITY_CODEX_KEYS].sort().join("|")) {
    throw new MechanicExtractionError(
      `Ability Calculations consumes [${abilityKeys.join(",")}], expected [${[...ABILITY_CODEX_KEYS].sort().join(",")}]`,
    );
  }
}

/** The claim-to-target map extraction actually produced, for comparison with the reviewed contract. */
export function claimToTargetMap(documents: readonly MechanicDocument[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const document of documents) {
    for (const text of documentTexts(document)) map[text.id] = [...text.evidence.sourceTargetIds].sort();
    for (const related of document.related) map[related.href.id] = [...related.href.evidence.sourceTargetIds];
  }
  return map;
}

/** The claim-to-probe map, without contract hashes, which move whenever the executor is re-approved. */
export function claimToProbeMap(
  documents: readonly MechanicDocument[],
): Record<string, { suite: string; id: string; category: string | null; promotionEligible: boolean }[]> {
  const map: Record<string, { suite: string; id: string; category: string | null; promotionEligible: boolean }[]> = {};
  const project = (text: MechanicText): void => {
    map[text.id] = text.evidence.requiredProbes.map((ref) => ({
      suite: ref.suite,
      id: ref.id,
      category: ref.category,
      promotionEligible: ref.promotionEligible,
    }));
  };
  for (const document of documents) {
    for (const text of documentTexts(document)) project(text);
    for (const related of document.related) project(related.href);
  }
  return map;
}

function assertSameStringLists(label: string, expected: readonly string[], actual: readonly string[]): void {
  if (expected.length === actual.length && expected.every((value, index) => value === actual[index])) return;
  const missing = expected.filter((value) => !actual.includes(value));
  const extra = actual.filter((value) => !expected.includes(value));
  throw new MechanicExtractionError(
    `${label} differs from the reviewed contract (missing=${missing.join(",") || "none"} extra=${extra.join(",") || "none"}${
      missing.length === 0 && extra.length === 0 ? " order changed" : ""
    })`,
  );
}

/**
 * Compares the extracted model with the separately reviewed contract.
 *
 * Every difference is a `MODEL_CHANGED` finding rather than a warning. The contract is the thing a human
 * read, so extraction disagreeing with it means either the game moved or the extractor did, and both
 * deserve a fresh review.
 */
export function assertContractFixture(
  documents: readonly MechanicDocument[],
  fixture: MechanicsContractFixture,
): void {
  assertSameStringLists(
    "the document id list",
    fixture.documentIds,
    documents.map((document) => document.id),
  );

  const codexEntries = new Map(fixture.codexKeys.map((entry) => [entry.key, entry]));
  assertSameStringLists(
    "the codex key list",
    fixture.codexKeys.map((entry) => entry.key),
    [...CODEX_FORMULA_KEYS],
  );

  const byId = new Map(documents.map((document) => [document.id, document]));
  for (const [documentId, expectedIds] of Object.entries(fixture.textIds)) {
    const document = byId.get(documentId as MechanicDocumentId);
    if (!document) throw new MechanicExtractionError(`the contract names an unknown document ${documentId}`);
    const actual = [
      ...documentTexts(document).map((text) => text.id),
      ...document.related.map((related) => related.href.id),
    ];
    assertSameStringLists(`document ${documentId} text ids`, expectedIds, actual);
  }

  const targetMap = claimToTargetMap(documents);
  const probeMap = claimToProbeMap(documents);
  assertSameStringLists(
    "the claim-to-target key set",
    Object.keys(fixture.claimToTargets).sort(),
    Object.keys(targetMap).sort(),
  );
  for (const [textId, expected] of Object.entries(fixture.claimToTargets)) {
    assertSameStringLists(`claim ${textId} source targets`, expected, targetMap[textId] ?? []);
  }
  assertSameStringLists(
    "the claim-to-probe key set",
    Object.keys(fixture.claimToProbes).sort(),
    Object.keys(probeMap).sort(),
  );
  for (const [textId, expected] of Object.entries(fixture.claimToProbes)) {
    const actual = probeMap[textId] ?? [];
    assertSameStringLists(
      `claim ${textId} probe obligations`,
      expected.map((ref) => `${ref.suite}/${ref.id}/${ref.category ?? ""}/${ref.promotionEligible}`),
      actual.map((ref) => `${ref.suite}/${ref.id}/${ref.category ?? ""}/${ref.promotionEligible}`),
    );
  }

  const derivations = new Map(
    documents.flatMap((document) => document.derivations.map((derivation) => [derivation.id, derivation])),
  );
  assertSameStringLists(
    "the derivation id set",
    Object.keys(fixture.derivations).sort(),
    [...derivations.keys()].sort(),
  );
  for (const [derivationId, expected] of Object.entries(fixture.derivations)) {
    const actual = derivations.get(derivationId)!;
    if (actual.evaluator !== expected.evaluator) {
      throw new MechanicExtractionError(
        `derivation ${derivationId} uses the ${actual.evaluator} evaluator, the contract expects ${expected.evaluator}`,
      );
    }
    assertSameStringLists(`derivation ${derivationId} source targets`, expected.sourceTargetIds, actual.sourceTargetIds);
    assertSameStringLists(
      `derivation ${derivationId} calls`,
      // Canonical rather than `JSON.stringify`, because the reviewed fixture is stored with sorted keys
      // while extraction builds its argument objects in declaration order.
      expected.calls.map((call) => `${call.sourceTargetId}(${canonicalJson(call.args)})`),
      actual.calls.map((call) => `${call.sourceTargetId}(${canonicalJson(call.args)})`),
    );
    assertSameStringLists(
      `derivation ${derivationId} outputs`,
      expected.outputs.map((output) => `${output.id}->${output.textId}:${output.format}:${output.template ?? ""}`),
      actual.outputs.map((output) => `${output.id}->${output.textId}:${output.format}:${output.template ?? ""}`),
    );
  }

  const endgame = byId.get("endgame-systems");
  if (!endgame) throw new MechanicExtractionError("the Endgame document is missing");
  assertSameStringLists(
    "the Endgame section id list",
    fixture.endgame.sections.map((section) => section.id),
    endgame.sections.map((section) => section.id),
  );
  for (const [index, expected] of fixture.endgame.sections.entries()) {
    const actual = endgame.sections[index]!;
    if (actual.title.text !== expected.title) {
      throw new MechanicExtractionError(
        `Endgame section ${expected.id} title is ${JSON.stringify(actual.title.text)}, the contract expects ${JSON.stringify(expected.title)}`,
      );
    }
    assertSameStringLists(
      `Endgame section ${expected.id} bullets`,
      expected.bullets,
      actual.bullets.map((bullet) => bullet.text),
    );
  }

  // The codex entries the contract fixes are compared against the model's own displayed strings, so a
  // reworded formula in the game fails here rather than reaching a page.
  for (const document of documents) {
    for (const text of documentTexts(document)) {
      const expressionMatch = /^codex\.([A-Za-z0-9_]+)\.expression$/.exec(
        text.evidence.sourceTargetIds[0] ?? "",
      );
      if (!expressionMatch || text.evidence.sourceTargetIds.length !== 1) continue;
      const entry = codexEntries.get(expressionMatch[1]!);
      if (entry && entry.expression !== null && entry.expression !== text.text) {
        throw new MechanicExtractionError(
          `codex ${expressionMatch[1]} expression is ${JSON.stringify(text.text)}, the contract expects ${JSON.stringify(entry.expression)}`,
        );
      }
    }
  }
}

/** Cross-document invariants no single builder can see. */
function assertCrossDocumentInvariants(documents: readonly MechanicDocument[]): void {
  const ids = documents.map((document) => document.id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length > 0) {
    throw new MechanicExtractionError(`duplicate document ids: ${duplicates.join(", ")}`);
  }
  for (const document of documents) {
    const declared = new Set(document.sourceTargets.map((target) => target.id));
    for (const text of documentTexts(document)) {
      for (const id of text.evidence.sourceTargetIds) {
        if (!declared.has(id)) {
          throw new MechanicExtractionError(
            `claim ${text.id} in ${document.id} cites the undeclared source target ${id}`,
          );
        }
      }
    }
    const outputIds = new Set<string>();
    const referencedOutputs = new Set<string>();
    for (const derivation of document.derivations) {
      for (const output of derivation.outputs) {
        if (outputIds.has(output.id)) {
          throw new MechanicExtractionError(`document ${document.id} declares output ${output.id} twice`);
        }
        outputIds.add(output.id);
      }
      for (const id of derivation.sourceTargetIds) {
        if (!declared.has(id)) {
          throw new MechanicExtractionError(
            `derivation ${derivation.id} cites the undeclared source target ${id}`,
          );
        }
      }
    }
    for (const text of documentTexts(document)) {
      if (text.evidence.kind !== "source-derived") continue;
      for (const derivation of document.derivations) {
        for (const output of derivation.outputs) {
          if (output.textId !== text.id) continue;
          referencedOutputs.add(output.id);
          if (output.formattedText !== text.text) {
            throw new MechanicExtractionError(
              `claim ${text.id} shows ${JSON.stringify(text.text)} but its derivation formatted ${JSON.stringify(output.formattedText)}`,
            );
          }
        }
      }
    }
    const unreferenced = [...outputIds].filter((id) => !referencedOutputs.has(id));
    if (unreferenced.length > 0) {
      throw new MechanicExtractionError(
        `document ${document.id} has unreferenced derivation outputs: ${unreferenced.join(", ")}`,
      );
    }
    for (const section of document.sections) {
      if (
        section.paragraphs.length === 0 &&
        section.bullets.length === 0 &&
        section.formulas.length === 0 &&
        section.facts.length === 0
      ) {
        throw new MechanicExtractionError(`section ${document.id}/${section.id} is empty`);
      }
    }
    assertEveryTargetReferenced(document);
  }
  assertCodexInventory(documents);
}

/**
 * Extracts each document independently and reports one outcome per document.
 *
 * Independence matters for review: a locator that broke in the Endgame guide must not hide the fact that
 * the other four are still exactly what was approved.
 */
export function tryExtractMechanics(
  input: MechanicsExtractionInput,
): Record<MechanicDocumentId, ExtractionOutcome> {
  const roles = parseRoles(input);
  const context: BuildContext = { roles, runDerivation: evaluateMechanicDerivation };
  const outcomes: Partial<Record<MechanicDocumentId, ExtractionOutcome>> = {};
  const built: MechanicDocument[] = [];

  for (const id of MECHANIC_DOCUMENT_IDS) {
    try {
      const document = BUILDERS[id](context);
      outcomes[id] = { status: "OK", document };
      built.push(document);
    } catch (error) {
      outcomes[id] = {
        status: "UNRESOLVED",
        diagnostics: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  if (built.length === MECHANIC_DOCUMENT_IDS.length) {
    const contractFailures: string[] = [];
    try {
      assertCrossDocumentInvariants(built);
    } catch (error) {
      contractFailures.push(error instanceof Error ? error.message : String(error));
    }
    try {
      assertContractFixture(built, parseMechanicsContract(input.contractFixtureBytes));
    } catch (error) {
      contractFailures.push(error instanceof Error ? error.message : String(error));
    }
    if (contractFailures.length > 0) {
      // A cross-document or contract failure implicates every document, because none of them can be
      // published while the set disagrees with what was reviewed.
      for (const [index, id] of MECHANIC_DOCUMENT_IDS.entries()) {
        outcomes[id] = {
          status: "MODEL_CHANGED",
          candidate: built[index] ?? null,
          diagnostics: contractFailures,
        };
      }
    }
  }

  return outcomes as Record<MechanicDocumentId, ExtractionOutcome>;
}

/** The strict wrapper publish and sync use. It collects every diagnostic before it throws. */
export function extractMechanics(input: MechanicsExtractionInput): MechanicDocument[] {
  const outcomes = tryExtractMechanics(input);
  const failures: string[] = [];
  const documents: MechanicDocument[] = [];
  for (const id of MECHANIC_DOCUMENT_IDS) {
    const outcome = outcomes[id];
    if (outcome.status === "OK") documents.push(outcome.document);
    else for (const diagnostic of outcome.diagnostics) failures.push(`${id}: ${diagnostic}`);
  }
  if (failures.length > 0) {
    throw new MechanicExtractionError(`mechanics extraction failed\n${[...new Set(failures)].join("\n")}`);
  }
  return documents;
}
