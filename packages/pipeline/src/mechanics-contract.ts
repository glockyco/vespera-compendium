/**
 * The separately reviewed declarative contract.
 *
 * Extraction reads this fixture and never generates it. That separation is the whole point: if the
 * extractor and its expectations lived in one place, a bug that changed both would agree with itself and
 * no review would notice. Its canonical hash is stored in the lock, the review artifact, and the proof, so
 * an edited fixture cannot silently redefine what "unchanged" means.
 *
 * It lives in its own module so the inspector closure can parse it without reaching the extractor, and
 * therefore without reaching the TypeScript compiler. An inspector whose hash moved every time the
 * extractor changed would make rotation routine, and a routine rotation is not a trust root.
 */

import type { CanonicalJson } from "@vespera/core";

/** How a derived raw value becomes the text a page renders. */
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
 * Parses the fixture bytes.
 *
 * Deliberately shallow: the fixture is a tracked repository file rather than untrusted input, and the real
 * check is that every extracted claim matches it exactly. A schema library here would add a second
 * description of the same shape without adding a guarantee.
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
