/**
 * The separately reviewed declarative contract.
 *
 * Extraction reads this fixture and never generates it.
 * This separation matters.
 * If extractor and expectations shared one module, one bug can change both and pass its own review.
 * The canonical hash is stored in the lock, review artifact, and proof.
 * An edited fixture cannot silently redefine "unchanged".
 *
 * This module is separate so the inspector closure can parse it without the extractor or TypeScript compiler.
 * A changing inspector hash can make rotation routine.
 * Routine rotation is not a trust root.
 */

import type { CanonicalJson } from "@vespera/core";

/** How a derived raw value becomes the text that a page shows. */
export type MechanicValueFormat =
  | "identity"
  | "integer"
  | "decimal-3"
  | "percent-2"
  | "json-grid"
  | "template";

export type MechanicsContractFixture = {
  version: 1;
  documentIds: string[];
  codexKeys: { key: string; label: string; expression: string | null }[];
  textIds: Record<string, string[]>;
  claimToTargets: Record<string, string[]>;
  claimToProbes: Record<
    string,
    { suite: string; id: string; category: string | null; promotionEligible: boolean }[]
  >;
  derivations: Record<
    string,
    {
      evaluator: "eval-composition" | "gear-balance";
      sourceTargetIds: string[];
      calls: { sourceTargetId: string; args: CanonicalJson[] }[];
      outputs: { id: string; textId: string; format: MechanicValueFormat; template: string | null }[];
    }
  >;
  endgame: { sections: { id: string; title: string; bullets: string[] }[] };
};

/**
 * Parse the fixture bytes.
 *
 * Keep this parser shallow.
 * The fixture is a tracked repository file, not untrusted input.
 * The real check is that each extracted claim matches it exactly.
 * A schema library adds another description of the same shape without a new guarantee.
 */
export function parseMechanicsContract(bytes: Uint8Array): MechanicsContractFixture {
  const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("the mechanics contract fixture is not a JSON object");
  }
  if (!("version" in parsed) || parsed.version !== 1) {
    throw new Error("the mechanics contract fixture must be version 1");
  }
  return parsed as MechanicsContractFixture;
}
