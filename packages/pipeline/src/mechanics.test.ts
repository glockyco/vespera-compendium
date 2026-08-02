import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import ts from "typescript";
import {
  claimBindingsForText,
  probeContract,
} from "@vespera/core";
import {
  ABILITY_CODEX_KEYS,
  CODEX_FORMULA_KEYS,
  COMBAT_CODEX_KEYS,
  TextBuilder,
  TargetRegistry,
  assertContractFixture,
  astShapeSha256,
  childrenByField,
  declarationNode,
  documentTexts,
  parseMechanicsContract,
  parseRoles,
  requiredProbes,
  resolveLocator,
  type MechanicDocument,
  type MechanicDocumentId,
  type MechanicJson,
  type MechanicProbeRef,
  type MechanicSection,
  type MechanicText,
  type MechanicsContractFixture,
  type ParsedRoles,
} from "./mechanics.ts";
import {
  evaluateMechanicDerivation,
  formatDerivedValue,
  type MechanicDerivationRequest,
} from "./mechanic-derivation-executor.ts";

const fixtureBytes = new TextEncoder().encode("{}");
const hex = (character: string): string => character.repeat(64);

function roles(indexHtml = "", index = "", gameView = ""): ParsedRoles {
  return parseRoles({
    bundleText: { indexHtml, index, gameView },
    contractFixtureBytes: fixtureBytes,
  });
}

function childPath(root: ts.Node, target: ts.Node): { field: string; index: number }[] | null {
  if (root === target) return [];
  for (const [field, children] of childrenByField(root)) {
    for (const [index, child] of children.entries()) {
      const rest = childPath(child, target);
      if (rest !== null) return [{ field, index }, ...rest];
    }
  }
  return null;
}

function requiredChildPath(root: ts.Node, target: ts.Node): { field: string; index: number }[] {
  const path = childPath(root, target);
  if (path === null) throw new Error("target is not a child of root");
  return path;
}

function identifierIn(root: ts.Node, name: string): ts.Identifier {
  let found: ts.Identifier | null = null;
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === name && !found) found = node;
    ts.forEachChild(node, visit);
  };
  visit(root);
  if (!found) throw new Error(`missing identifier ${name}`);
  return found;
}

function documentId(id: string): MechanicDocumentId {
  switch (id) {
    case "combat-mathematics":
    case "ability-calculations":
    case "skills-and-crafting":
    case "equipment-and-value":
    case "endgame-systems":
      return id;
    default:
      throw new Error(`unknown mechanic document ${id}`);
  }
}

function derivation(overrides: Partial<MechanicDerivationRequest> = {}): MechanicDerivationRequest {
  return {
    id: "synthetic",
    evaluator: "eval-composition",
    sources: [{ sourceTargetId: "root", text: "function root(value) { return value + 1; }" }],
    bindings: {},
    calls: [{ sourceTargetId: "root", args: [1] }],
    outputs: [{ id: "value", textId: "synthetic.value", format: "integer", template: null }],
    ...overrides,
  };
}

function text(id: string, kind: MechanicText["evidence"]["kind"], refs: MechanicProbeRef[] = []): MechanicText {
  return {
    id,
    text: id,
    evidence: { kind, sourceTargetIds: kind === "editorial" ? [] : ["target"], requiredProbes: refs },
  };
}

function fixtureClaimText(fixture: MechanicsContractFixture, id: string): MechanicText {
  const sourceTargetIds = fixture.claimToTargets[id] ?? [];
  const requiredProbes = (fixture.claimToProbes[id] ?? []).map((entry) => {
    const contract = probeContract(entry.suite, entry.id);
    if (!contract) throw new Error(`missing fixture contract ${entry.suite}/${entry.id}`);
    return { suite: entry.suite, id: entry.id, category: entry.category, contractSha256: contract.contractSha256, promotionEligible: entry.promotionEligible };
  });
  let value = id;
  const codex = /^codex\.([A-Za-z0-9_]+)\.expression$/.exec(sourceTargetIds[0] ?? "");
  if (codex) value = fixture.codexKeys.find((entry) => entry.key === codex[1])?.expression ?? value;
  const endgameTitle = /^endgame\.section\.([^.]+)\.title$/.exec(id);
  if (endgameTitle) {
    const section = fixture.endgame.sections.find((entry) => entry.id === endgameTitle[1]);
    if (section) value = section.title;
  }
  const endgameTarget = /^endgame\.section\.([^.]+)\.bullet\.(\d+)$/.exec(id);
  if (endgameTarget) {
    const section = fixture.endgame.sections.find((entry) => entry.id === endgameTarget[1]);
    if (section) value = section.bullets[Number(endgameTarget[2])] ?? value;
  }
  return { id, text: value ?? id, evidence: { kind: sourceTargetIds.length > 0 ? "source-derived" : "editorial", sourceTargetIds: [...sourceTargetIds], requiredProbes } };
}

function fixtureDocuments(fixture: MechanicsContractFixture): MechanicDocument[] {
  const allDerivations = new Map(Object.entries(fixture.derivations));
  return fixture.documentIds.map((rawId) => {
    const id = documentId(rawId);
    const ids = fixture.textIds[id] ?? [];
    const title = fixtureClaimText(fixture, ids[0] ?? `${id}.title`);
    const summary = fixtureClaimText(fixture, ids[1] ?? `${id}.summary`);
    const sections: MechanicSection[] = [];
    const relatedLabels: MechanicText[] = [];
    const relatedHrefs: MechanicText[] = [];
    let current: MechanicSection | null = null;
    for (let index = 2; index < ids.length; index++) {
      const textId = ids[index]!;
      if (textId.includes(".related.") && textId.endsWith(".label")) {
        relatedLabels.push(fixtureClaimText(fixture, textId));
        continue;
      }
      if (textId.includes(".related.") && textId.endsWith(".href")) {
        relatedHrefs.push(fixtureClaimText(fixture, textId));
        continue;
      }
      const sectionTitle = /\.section\.([^.]+)\.title$/.exec(textId);
      if (sectionTitle) {
        current = { id: sectionTitle[1]!, title: fixtureClaimText(fixture, textId), paragraphs: [], bullets: [], formulas: [], facts: [] };
        sections.push(current);
        continue;
      }
      if (!current) throw new Error(`fixture text ${textId} appears before a section`);
      if (/\.section\.[^.]+\.bullet\.\d+$/.test(textId)) {
        current.bullets.push(fixtureClaimText(fixture, textId));
      } else if (id === "endgame-systems") {
        const label = fixtureClaimText(fixture, textId);
        const nextId = ids[index + 1];
        if (textId.endsWith(".label") && nextId && (nextId.endsWith(".expression") || nextId.endsWith(".value"))) {
          const next = fixtureClaimText(fixture, nextId);
          if (nextId.endsWith(".expression")) current.formulas.push({ id: textId, label, expression: next, note: null });
          else current.facts.push({ label, value: next });
          index++;
        } else current.paragraphs.push(label);
      } else {
        current.paragraphs.push(fixtureClaimText(fixture, textId));
      }
    }
    const related = relatedLabels.map((label, index) => {
      const href = relatedHrefs[index];
      if (!href) throw new Error(`fixture related label ${label.id} has no href`);
      return { label, href };
    });

    const targets = new Set<string>();
    for (const textId of ids) for (const target of fixture.claimToTargets[textId] ?? []) targets.add(target);
    for (const derivation of Object.values(fixture.derivations)) for (const target of derivation.sourceTargetIds) targets.add(target);
    const derivations = [...allDerivations.entries()]
      .filter(([derivationId]) => derivationId.startsWith(id === "combat-mathematics" ? "combat." : id === "skills-and-crafting" ? "skills." : id === "equipment-and-value" ? "equipment." : id === "endgame-systems" ? "endgame." : "__none__"))
      .map(([derivationId, expected]) => ({
        id: derivationId,
        derivationExecutorSha256: hex("d"),
        executionTraceSha256: hex("t"),
        evaluator: expected.evaluator,
        outputs: expected.outputs.map((output) => ({ id: output.id, textId: output.textId, rawValue: 0, format: output.format, template: output.template, formattedText: "0" })),
        sourceTargetIds: [...expected.sourceTargetIds],
        bindings: {},
        calls: expected.calls.map((call) => ({ sourceTargetId: call.sourceTargetId, args: call.args as MechanicJson[] })),
        resultSha256: hex("q"),
      }));
    return {
      id,
      title,
      category: id === "skills-and-crafting" ? "skills" : id === "equipment-and-value" ? "equipment" : id === "endgame-systems" ? "progression" : "combat",
      summary,
      sections,
      related,
      sourceTargets: [...targets].map((target) => ({ id: target, bundle: "index", locator: { kind: "named-declaration", name: "root" }, sha256: hex("a") })),
      derivations,
    };
  });
}
function syntheticDocument(id: MechanicDocumentId = "combat-mathematics"): MechanicDocument {
  return {
    id,
    title: text(`${id}.title`, "editorial"),
    category: "combat",
    summary: text(`${id}.summary`, "editorial"),
    sections: [{
      id: "section",
      title: text(`${id}.section.title`, "editorial"),
      paragraphs: [text(`${id}.paragraph`, "source-derived")],
      bullets: [text(`${id}.bullet`, "game-authored")],
      formulas: [{
        id: "formula",
        label: text(`${id}.formula.label`, "editorial"),
        expression: text(`${id}.formula.expression`, "source-derived"),
        note: text(`${id}.formula.note`, "editorial"),
      }],
      facts: [{ label: text(`${id}.fact.label`, "editorial"), value: text(`${id}.fact.value`, "source-derived") }],
    }],
    related: [{ label: text(`${id}.related.label`, "editorial"), href: text(`${id}.related.href`, "editorial") }],
    sourceTargets: [{ id: "target", bundle: "index", locator: { kind: "named-declaration", name: "root" }, sha256: "hash" }],
    derivations: [],
  };
}

describe("mechanics locators and text construction", () => {
  test("resolves every locator variant and rejects ambiguous or invalid matches", () => {
    const index = `
      const labels = Object.freeze({ first: "same", second: "same", third: "other" });
      const firstArray = ["array-marker", 1];
      const secondArray = ["array-marker", 2];
      function helper(value) { return value + 1; }
      function root(value) { return helper(value); }
      function outer() { return { marker: "outer", child: { marker: "inner" } }; }
      function callOne() { return tx("codex.key", "same"); }
      function callTwo() { return tx("codex.key", "same"); }
      function optionsOne() { return tx("codex.options", { defaultValue: "Game label" }); }
      `;
    const parsed = roles(undefined, index);
    expect(resolveLocator(parsed, "index", { kind: "named-declaration", name: "root" }).sourceText).toContain("function root");
    const innermost = resolveLocator(parsed, "index", {
      kind: "declaration-shape",
      node: "object",
      containsAll: ["marker", "inner"],
    });
    expect(parsed.text.index.slice(innermost.start, innermost.end)).toBe('{ marker: "inner" }');
    expect(() => resolveLocator(parsed, "index", {
      kind: "declaration-shape",
      node: "array",
      containsAll: ["array-marker"],
    })).toThrow(/resolved 2 distinct matches/);
    expect(resolveLocator(parsed, "index", {
      kind: "bounded-region",
      start: "function root",
      end: "helper(value)",
      containsAll: ["return"],
    }).sourceText).toContain("function root");
    expect(() => resolveLocator(parsed, "index", {
      kind: "bounded-region", start: "function", end: "root", containsAll: [],
    })).toThrow(/start .* occurs/);
    expect(() => resolveLocator(parsed, "index", {
      kind: "bounded-region", start: "function root", end: "not-after", containsAll: [],
    })).toThrow(/does not follow/);
    expect(resolveLocator(parsed, "index", {
      kind: "ast-string",
      declaration: { name: "labels", node: "object" },
      value: "same",
      occurrence: 2,
    }).sourceText).toContain("same");
    expect(() => resolveLocator(parsed, "index", {
      kind: "ast-string", declaration: { name: "labels", node: "object" }, value: "same", occurrence: 4,
    })).toThrow(/not 4/);
    const stringTarget = resolveLocator(parsed, "index", {
      kind: "translation-call-argument", translationKey: "codex.key", argumentIndex: 1, argumentKind: "string",
    });
    expect(parsed.text.index.slice(stringTarget.start, stringTarget.end)).toBe('"same"');
    const objectTarget = resolveLocator(parsed, "index", {
      kind: "translation-call-argument", translationKey: "codex.options", argumentIndex: 1, argumentKind: "object",
    });
    expect(parsed.text.index.slice(objectTarget.start, objectTarget.end)).toContain("defaultValue");

    const html = `<script>globalThis.__VESPERA_FEATURE_FLAGS__ = Object.freeze({ config: Object.freeze({ GRANDWORKS_ENABLED: true }) });</script>`;
    const htmlRoles = roles(html, "", "");
    const flag = resolveLocator(htmlRoles, "indexHtml", {
      kind: "html-assignment", name: "globalThis.__VESPERA_FEATURE_FLAGS__.config.GRANDWORKS_ENABLED", valueType: "boolean",
    });
    expect(htmlRoles.text.indexHtml.slice(flag.start, flag.end)).toBe("true");
    expect(() => resolveLocator(htmlRoles, "indexHtml", {
      kind: "html-assignment", name: "globalThis.__VESPERA_FEATURE_FLAGS__.config.GRANDWORKS_ENABLED", valueType: "number",
    })).toThrow(/not a number/);

    const root = declarationNode(parsed, "index", "root");
    const helperUse = identifierIn(root, "helper");
    const reference = {
      kind: "ast-reference" as const,
      root: { kind: "named-declaration" as const, name: "root" },
      referencePath: requiredChildPath(root, helperUse),
      declarationNodeKind: "FunctionDeclaration",
      declarationShapeSha256: astShapeSha256(declarationNode(parsed, "index", "helper")),
    };
    const referenceRange = resolveLocator(parsed, "index", reference);
    expect(parsed.text.index.slice(referenceRange.start, referenceRange.end)).toContain("function helper");
    expect(() => resolveLocator(parsed, "index", { ...reference, declarationShapeSha256: "wrong" })).toThrow(/distinct matches|resolved zero/);
    const callRoot = declarationNode(parsed, "index", "callOne");
    const call = (() => {
      let found: ts.CallExpression | null = null;
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "tx") found = node;
        ts.forEachChild(node, visit);
      };
      visit(callRoot);
      if (!found) throw new Error("missing call");
      return found;
    })();
    const path = requiredChildPath(callRoot, call);
    const callPath = {
      kind: "ast-path" as const,
      root: { kind: "named-declaration" as const, name: "callOne" },
      childPath: path,
      nodeKind: "CallExpression",
      shapeSha256: astShapeSha256(call),
    };
    expect(resolveLocator(parsed, "index", callPath).sourceText).toContain("tx");
    expect(() => resolveLocator(parsed, "index", { ...callPath, nodeKind: "Identifier" })).toThrow(/expected Identifier/);
    expect(() => resolveLocator(parsed, "index", { ...callPath, shapeSha256: "wrong" })).toThrow(/shape hash/);
    expect(() => resolveLocator(parsed, "index", {
      kind: "ast-path", root: callPath, childPath: [], nodeKind: "FunctionDeclaration", shapeSha256: astShapeSha256(callRoot),
    })).toThrow(/nested ast-path/);
    expect(() => resolveLocator(parsed, "index", {
      kind: "ast-reference", root: reference, referencePath: [], declarationNodeKind: "FunctionDeclaration", declarationShapeSha256: "wrong",
    })).toThrow(/nested ast-reference/);
  });

  test("collapses byte-identical translation arguments into one target", () => {
    const parsed = roles("", `function one() { return tx("same.key", { defaultValue: "Label" }); }
      function two() { return tx("same.key", { defaultValue: "Label" }); }`, "");
    const range = resolveLocator(parsed, "index", {
      kind: "translation-call-argument", translationKey: "same.key", argumentIndex: 1, argumentKind: "object",
    });
    expect(parsed.text.index.slice(range.start, range.end)).toBe('{ defaultValue: "Label" }');
  });

  test("TargetRegistry enforces identity and exposes the game's wording", () => {
    const parsed = roles("", `const labels = Object.freeze({ label: "Game wording" });
      function translated() { return tx("key", { defaultValue: "Game label" }); }`, "");
    const registry = new TargetRegistry(parsed);
    registry.add("label", "index", { kind: "ast-string", declaration: { name: "labels", node: "object" }, value: "Game wording", occurrence: 1 });
    expect(registry.stringValue("label")).toBe("Game wording");
    registry.add("options", "index", { kind: "translation-call-argument", translationKey: "key", argumentIndex: 1, argumentKind: "object" });
    expect(registry.defaultValue("options")).toBe("Game label");
    registry.add("label", "index", { kind: "ast-string", declaration: { name: "labels", node: "object" }, value: "Game wording", occurrence: 1 });
    expect(() => registry.add("label", "index", { kind: "named-declaration", name: "translated" })).toThrow(/different locators/);
    expect(() => registry.text("missing")).toThrow(/not registered/);
  });

  test("TextBuilder enforces provenance and exact claim bindings", () => {
    const builder = new TextBuilder("skills-and-crafting");
    expect(() => builder.editorial("same", "one") && builder.editorial("same", "two")).toThrow(/twice/);
    expect(() => new TextBuilder("synthetic").gameAuthored("missing-source", "text", [])).toThrow(/cites no source/);
    expect(() => new TextBuilder("synthetic").editorial("cited", "text")).not.toThrow();
    const valid = claimBindingsForText("skills.xp.multiplier.expression")[0]?.binding;
    if (!valid) throw new Error("missing XP binding");
    const claimed = new TextBuilder("skills-and-crafting");
    expect(claimed.sourceDerived("skills.xp.multiplier.expression", "XP", [...valid.sourceTargetIds], valid.expectedRawValue, valid.derivationOutputId).evidence.requiredProbes[0]?.id).toBe("xpGainMultiplier");
    expect(() => new TextBuilder("skills-and-crafting").sourceDerived("skills.xp.multiplier.expression", "XP", ["wrong"], valid.expectedRawValue, valid.derivationOutputId)).toThrow(/contract xpGainMultiplier/);
    expect(() => new TextBuilder("skills-and-crafting").sourceDerived("skills.xp.multiplier.expression", "XP", [...valid.sourceTargetIds], 0, valid.derivationOutputId)).toThrow(/contract xpGainMultiplier/);
    expect(() => new TextBuilder("skills-and-crafting").sourceDerived("skills.xp.multiplier.expression", "XP", [...valid.sourceTargetIds], valid.expectedRawValue, "wrong-output")).toThrow(/contract xpGainMultiplier/);
    expect(() => new TextBuilder("synthetic").editorial("editorial-citation", "x")).not.toThrow();
  });
});

describe("mechanic derivations", () => {
  test("evaluates helpers, constants, and static methods from cited slices", () => {
    const helper = evaluateMechanicDerivation(derivation({
      id: "helper",
      sources: [
        { sourceTargetId: "helper", text: "function hidden(value) { return value * 2; }" },
        { sourceTargetId: "root", text: "function root(value) { return hidden(value) + 1; }" },
      ],
      calls: [{ sourceTargetId: "root", args: [3] }],
    }));
    expect(helper.outputs[0]?.rawValue).toBe(7);
    const constant = evaluateMechanicDerivation(derivation({
      id: "constant",
      sources: [{ sourceTargetId: "constant", text: "CAP = 256" }],
      calls: [{ sourceTargetId: "constant", args: [] }],
    }));
    expect(constant.outputs[0]?.rawValue).toBe(256);
    const method = evaluateMechanicDerivation(derivation({
      id: "method",
      sources: [{ sourceTargetId: "method", text: "static calculateXpGain(value) { return value + 5; }" }],
      calls: [{ sourceTargetId: "method", args: [2] }],
    }));
    expect(method.outputs[0]?.rawValue).toBe(7);
  });

  test("rejects unresolved, random, non-repeatable, and malformed output programs", () => {
    expect(() => evaluateMechanicDerivation(derivation({
      sources: [{ sourceTargetId: "root", text: "function root() { return missing(); }" }],
      calls: [{ sourceTargetId: "root", args: [] }],
    }))).toThrow();
    expect(() => evaluateMechanicDerivation(derivation({
      sources: [{ sourceTargetId: "root", text: "function root() { return Math.random(); }" }],
      calls: [{ sourceTargetId: "root", args: [] }],
    }))).toThrow();
    expect(() => evaluateMechanicDerivation(derivation({
      outputs: [
        { id: "one", textId: "one", format: "integer", template: null },
        { id: "two", textId: "two", format: "integer", template: null },
      ],
    }))).toThrow(/produced 1 values for 2 outputs/);
  });

  test("covers every derived formatter and rejects malformed templates", () => {
    expect(formatDerivedValue("plain", "identity", null)).toBe("plain");
    expect(formatDerivedValue({ b: 2, a: 1 }, "identity", null)).toBe('{"a":1,"b":2}');
    expect(formatDerivedValue(3, "integer", null)).toBe("3");
    expect(formatDerivedValue(1.2, "decimal-3", null)).toBe("1.200");
    expect(formatDerivedValue(0.125, "percent-2", null)).toBe("12.50%");
    expect(formatDerivedValue([2, 1], "json-grid", null)).toBe("[2,1]");
    expect(formatDerivedValue(5, "template", "Value {value}!")).toBe("Value 5!");
    expect(() => formatDerivedValue(1.2, "integer", null)).toThrow(/integer format/);
    expect(() => formatDerivedValue("x", "decimal-3", null)).toThrow(/decimal-3/);
    expect(() => formatDerivedValue("x", "percent-2", null)).toThrow(/percent-2/);
    expect(() => formatDerivedValue(1, "template", null)).toThrow(/requires a template/);
    expect(() => formatDerivedValue(1, "template", "no placeholder")).toThrow(/no \{value\}/);
  });
});

describe("mechanic document traversal and contract checks", () => {
  test("requiredProbes deduplicates execution tuples and keeps promotion eligibility", () => {
    const contract = probeContract("formulas", "xpGainMultiplier");
    if (!contract) throw new Error("missing XP contract");
    const ref = (promotionEligible: boolean): MechanicProbeRef => ({ suite: contract.suite, id: contract.id, category: contract.category, contractSha256: contract.contractSha256, promotionEligible });
    const document = syntheticDocument();
    const promoted = { ...document, title: { ...document.title, evidence: { ...document.title.evidence, requiredProbes: [ref(false)] } }, summary: { ...document.summary, evidence: { ...document.summary.evidence, requiredProbes: [ref(true)] } } };
    expect(requiredProbes(promoted)).toEqual([ref(true)]);
  });

  test("documentTexts follows the rendered document order", () => {
    const document = syntheticDocument();
    expect(documentTexts(document).map((entry) => entry.id)).toEqual([
      "combat-mathematics.title", "combat-mathematics.summary", "combat-mathematics.section.title",
      "combat-mathematics.paragraph", "combat-mathematics.bullet", "combat-mathematics.formula.label",
      "combat-mathematics.formula.expression", "combat-mathematics.formula.note", "combat-mathematics.fact.label",
      "combat-mathematics.fact.value", "combat-mathematics.related.label",
    ]);
  });

  test("the reviewed fixture rejects changed document, codex, probe, derivation, and Endgame fields", () => {
    const fixture = parseMechanicsContract(readFileSync("packages/pipeline/testdata/mechanics-contract-v1.json"));
    const documents = fixtureDocuments(fixture);
    expect(() => assertContractFixture(documents, fixture)).not.toThrow();
    const changedDocumentIds = { ...fixture, documentIds: ["changed-document", ...fixture.documentIds.slice(1)] };
    expect(() => assertContractFixture(documents, changedDocumentIds)).toThrow(/document id list/);
    const changedCodex = { ...fixture, codexKeys: fixture.codexKeys.map((entry, index) => index === 0 ? { ...entry, expression: "changed expression" } : entry) };
    expect(() => assertContractFixture(documents, changedCodex)).toThrow(/codex normalMitigation expression/);
    const movedProbe = { ...fixture, claimToProbes: { ...fixture.claimToProbes, "combat.defense.normal-mitigation.expression": [], "combat.defense.mitigation-cap.value": fixture.claimToProbes["combat.defense.normal-mitigation.expression"] } };
    expect(() => assertContractFixture(documents, movedProbe)).toThrow(/claim combat\.defense\..*probe obligations/);
    const changedDerivation = { ...fixture, derivations: { ...fixture.derivations, "skills.xp": { ...fixture.derivations["skills.xp"], calls: [] } } };
    expect(() => assertContractFixture(documents, changedDerivation)).toThrow(/derivation skills\.xp calls/);
    const omittedEndgame = { ...fixture, endgame: { sections: fixture.endgame.sections.slice(1) } };
    expect(() => assertContractFixture(documents, omittedEndgame)).toThrow(/Endgame section id list/);
    const reorderedEndgame = { ...fixture, endgame: { sections: [fixture.endgame.sections[1]!, fixture.endgame.sections[0]!, ...fixture.endgame.sections.slice(2)] } };
    expect(() => assertContractFixture(documents, reorderedEndgame)).toThrow(/Endgame section id list/);
    const editedBullet = { ...fixture, endgame: { sections: fixture.endgame.sections.map((section, index) => index === 0 ? { ...section, bullets: section.bullets.map((bullet, bulletIndex) => bulletIndex === 0 ? "changed bullet" : bullet) } : section) } };
    expect(() => assertContractFixture(documents, editedBullet)).toThrow(/Endgame section route bullets/);
    expect(CODEX_FORMULA_KEYS).toHaveLength(17);
    expect(new Set([...COMBAT_CODEX_KEYS, ...ABILITY_CODEX_KEYS])).toEqual(new Set(CODEX_FORMULA_KEYS));
    expect(new Set(COMBAT_CODEX_KEYS).size + new Set(ABILITY_CODEX_KEYS).size).toBe(CODEX_FORMULA_KEYS.length);
  });
});
