/**
 * The generic probe executor.
 *
 * It receives one fully materialized contract and one observation callback, and it knows nothing else:
 * not the registry, not the contract hashes, not its own approved source hash. That ignorance is the
 * point. `executorSha256 -> contractSha256` must be acyclic, so the module whose source feeds every
 * contract hash cannot read a contract hash.
 *
 * The callback is the only way a value enters. No probe API accepts a Node or Bun function, so a local
 * mirror of the game's arithmetic cannot be mistaken for the game: whatever the callback returns is
 * whatever the browser realm returned.
 */

import { canonicalJson, type BundleRole, type CanonicalJson } from "./canonical-public-evidence.ts";

/** One declared case: an exact input and the exact value the game must return for it. */
export type MechanicProbeCase = {
  id: string;
  input: CanonicalJson;
  expected: CanonicalJson;
};

/**
 * One published claim this contract is allowed to support.
 *
 * A text that is not named here cannot require this probe, which is what stops a copy change from
 * quietly inheriting someone else's live evidence.
 */
export type MechanicProbeClaimBinding = {
  textId: string;
  expectedRawValue: CanonicalJson;
  sourceTargetIds: string[];
  derivationOutputId: string | null;
  /**
   * Whether a pass may promote its claim to `live-verified`.
   *
   * False for every Defense binding: the served module carries a bridge suffix, so the browser realm
   * corroborates the arithmetic without being the shipped bytes. Recording that honestly is worth more
   * than a badge.
   */
  promotionEligible: boolean;
};

/**
 * How one case input becomes the shipped function's real arguments.
 *
 * The game's functions take positional arguments of their own shapes: Defense takes two numbers, sell takes
 * an item record plus a rarity and a quantity, and XP takes one options object. A case input is a flat
 * record, so the mapping between them is contract knowledge and belongs inside the contract hash. Passing
 * the record straight through is exactly the bug this exists to prevent: `Number({defense: 100}) || 0` is
 * zero, and a probe would then confirm a formula that never ran.
 *
 * A string of the form `$.name` substitutes that member of the case input, and `$` substitutes the whole
 * input. Anything else is a literal.
 */
export type MechanicProbeArgumentTemplate = readonly CanonicalJson[];

/** A materialized contract. Identical in shape to a registry entry, minus the registry's knowledge. */
export type MechanicProbeContract = {
  suite: string;
  id: string;
  category: string | null;
  /** How the runtime binding is invoked: a plain function or a method on its owner. */
  resolver: "function" | "method";
  /** Which semantic bundle role must have produced the function's script. */
  bundle: BundleRole;
  methodName: string | null;
  /** The exact source appended to the served module, when this probe needs a bridged session. */
  bridgeSuffix: string | null;
  /** The game-authored or source-derived expression this contract corroborates, for the report. */
  expression: string;
  argumentTemplate: MechanicProbeArgumentTemplate;
  cases: readonly MechanicProbeCase[];
  claimBindings: readonly MechanicProbeClaimBinding[];
  executorSha256: string;
  contractSha256: string;
};

export type MechanicProbeExecutionCase = {
  id: string;
  input: CanonicalJson;
  expected: CanonicalJson;
  firstObserved: CanonicalJson;
  secondObserved: CanonicalJson;
};

export type MechanicProbeExecution = {
  status: "PASS" | "FAIL";
  detail: string;
  cases: MechanicProbeExecutionCase[];
};

/** Deep equality by canonical serialization, so key order never decides a probe result. */
export function sameCanonicalValue(left: CanonicalJson, right: CanonicalJson): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export type MechanicProbeObservation = (input: CanonicalJson) => Promise<CanonicalJson>;

/**
 * Substitutes a case input into a contract's argument template.
 *
 * Exported so the harness builds the runtime call from the hashed template rather than from its own idea of
 * the shape, and so a test can pin the substitution without a browser.
 */
export function materializeProbeArguments(
  template: MechanicProbeArgumentTemplate,
  input: CanonicalJson,
): CanonicalJson[] {
  const substitute = (node: CanonicalJson): CanonicalJson => {
    if (typeof node === "string" && node.startsWith("$")) {
      if (node === "$") return input;
      const member = node.slice(2);
      if (!node.startsWith("$.") || member.length === 0) {
        throw new Error(`argument template reference ${node} is malformed`);
      }
      if (input === null || typeof input !== "object" || Array.isArray(input)) {
        throw new Error(`argument template reference ${node} needs a record input`);
      }
      if (!Object.hasOwn(input, member)) {
        throw new Error(`argument template reference ${node} names no member of the case input`);
      }
      return input[member]!;
    }
    if (Array.isArray(node)) return node.map(substitute);
    if (node !== null && typeof node === "object") {
      return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, substitute(value)]));
    }
    return node;
  };
  return template.map(substitute);
}

/**
 * Runs every declared case twice and reports one result for the whole contract.
 *
 * Twice, because a formula that returns a different value on a second call is not a formula, and the
 * cheapest place to catch state leaking into the game's own arithmetic is here. A single differing
 * observation fails the contract rather than being averaged away.
 */
export async function runMechanicProbeContract(
  contract: MechanicProbeContract,
  observe: MechanicProbeObservation,
): Promise<MechanicProbeExecution> {
  if (contract.cases.length === 0) {
    return { status: "FAIL", detail: `${contract.id}: contract declares no case`, cases: [] };
  }
  const cases: MechanicProbeExecutionCase[] = [];
  const failures: string[] = [];

  for (const declared of contract.cases) {
    let firstObserved: CanonicalJson;
    let secondObserved: CanonicalJson;
    try {
      firstObserved = await observe(declared.input);
      secondObserved = await observe(declared.input);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        status: "FAIL",
        detail: `${contract.id}: case ${declared.id} could not be observed: ${detail}`,
        cases,
      };
    }
    cases.push({
      id: declared.id,
      input: declared.input,
      expected: declared.expected,
      firstObserved,
      secondObserved,
    });
    if (!sameCanonicalValue(firstObserved, secondObserved)) {
      failures.push(
        `${declared.id} is not repeatable (${canonicalJson(firstObserved)} then ${canonicalJson(secondObserved)})`,
      );
      continue;
    }
    if (!sameCanonicalValue(firstObserved, declared.expected)) {
      failures.push(
        `${declared.id} expected ${canonicalJson(declared.expected)} but observed ${canonicalJson(firstObserved)}`,
      );
    }
  }

  if (failures.length > 0) {
    return { status: "FAIL", detail: `${contract.id}: ${failures.join("; ")}`, cases };
  }
  return {
    status: "PASS",
    detail: `${contract.id}: ${cases.length} cases matched on two consecutive observations`,
    cases,
  };
}

/**
 * A skipped execution, shaped exactly like a real one.
 *
 * The report must be able to say which cases were declared even when the game could not be launched,
 * because a report that lists fewer cases when it skips would let a skip look like a narrower contract.
 */
export function skippedMechanicProbeExecution(
  contract: MechanicProbeContract,
  reason: string,
): MechanicProbeExecution {
  return {
    status: "FAIL",
    detail: `${contract.id}: ${reason}`,
    cases: contract.cases.map((declared) => ({
      id: declared.id,
      input: declared.input,
      expected: declared.expected,
      firstObserved: null,
      secondObserved: null,
    })),
  };
}
