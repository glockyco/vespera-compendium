import { describe, expect, test } from "bun:test";
import { lockedModelFromPublished, publishMechanicDocument } from "./publish.ts";
import type {
  MechanicEvidence,
  MechanicLockedModel,
  MechanicProbeRef,
  MechanicText,
} from "./mechanics.ts";

const probe = (id: string, promotionEligible: boolean): MechanicProbeRef => ({
  suite: "formulas",
  id,
  category: null,
  contractSha256: `${id}-contract`,
  promotionEligible,
});

const editorial = (id: string, text: string): MechanicText => ({
  id,
  text,
  evidence: { kind: "editorial", sourceTargetIds: [], requiredProbes: [] },
});
const source = (id: string, text: string, requiredProbes: MechanicProbeRef[]): MechanicText => ({
  id,
  text,
  evidence: { kind: "source-derived", sourceTargetIds: ["source"], requiredProbes },
});

function model(): MechanicLockedModel {
  return {
    id: "combat-mathematics",
    title: editorial("synthetic.title", "Synthetic"),
    category: "combat",
    summary: editorial("synthetic.summary", "Synthetic summary"),
    sections: [{
      id: "one",
      title: editorial("synthetic.one.title", "One"),
      paragraphs: [source("synthetic.paragraph", "Paragraph", [probe("first", true), probe("second", true)])],
      bullets: [],
      formulas: [{
        id: "formula",
        label: editorial("synthetic.formula.label", "Formula"),
        expression: source("synthetic.formula.expression", "a + b", [probe("first", true)]),
        note: editorial("synthetic.formula.note", "Note"),
      }],
      facts: [],
    }],
    related: [],
    sourceTargets: [{ id: "source", bundle: "index", locator: { kind: "named-declaration", name: "synthetic" }, sha256: "source-hash" }],
    derivations: [],
    derivationExecutorSha256: "derivation-hash",
    mechanicsSourceApprovalSha256: "source-approval",
  };
}

describe("published mechanics verification projection", () => {
  test("marks only fully passed promotable text live", () => {
    const document = publishMechanicDocument(model(), "build", "2026-08-01T18:30:00.000Z", [probe("first", true)]);
    expect(document.title.verification.status).toBe("editorial");
    expect(document.sections[0]?.paragraphs[0]?.verification.status).toBe("source-verified");
    expect(document.sections[0]?.formulas[0]?.expression.verification.status).toBe("live-verified");
    expect(document.sections[0]?.formulas[0]?.label.verification.status).toBe("editorial");
    expect(document.sections[0]?.formulas[0]?.note?.verification.status).toBe("editorial");
  });

  test("strips exactly text verification fields for the locked model", () => {
    const original = model();
    const published = publishMechanicDocument(original, "build", "2026-08-01T18:30:00.000Z", []);
    expect(lockedModelFromPublished(published)).toEqual(original);
    const tampered = { ...published, title: { ...published.title, verification: published.title.verification, extra: true } };
    expect(() => lockedModelFromPublished(tampered)).toThrow("unexpected structure");
  });
});
