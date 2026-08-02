/**
 * The generic probe executor.
 *
 * It receives one materialized contract and one observation callback. It knows nothing about the registry, contract hashes, or approved source hash.
 * This separation keeps `executorSha256 -> contractSha256` acyclic. The module that feeds every contract hash cannot read a contract hash.
 * The callback is the only input path. No probe API accepts a Node or Bun function.
 * A local arithmetic mirror therefore cannot replace the game. The callback result is the browser realm result.
 */

import { canonicalJson, type BundleRole, type CanonicalJson } from "./canonical-public-evidence.ts";

/** One declared case: an exact input and the exact value that the game must return. */
export type MechanicProbeCase = {
  id: string;
  input: CanonicalJson;
  expected: CanonicalJson;
};

/**
 * One published claim that this contract can support.
 *
 * A text ID not named here cannot require this probe. This prevents a copy change from inheriting another claim's live evidence.
 */
export type MechanicProbeClaimBinding = {
  textId: string;
  expectedRawValue: CanonicalJson;
  sourceTargetIds: string[];
  derivationOutputId: string | null;
  /**
   * Whether a pass can promote its claim to `live-verified`.
   *
   * Every Defense binding has a bridge suffix in the served module. The browser realm checks the arithmetic, but it does not run the shipped bytes.
   * This record reports that fact instead of granting a badge.
   */
  promotionEligible: boolean;
};

/**
 * How one case input becomes the shipped function's arguments.
 *
 * The game functions take positional arguments with different shapes. Defense takes two numbers.
 * Sell takes an item record, a rarity, and a quantity. XP takes one options object.
 * A case input is a flat record, so the contract hash must contain this mapping.
 * Passing the record directly is the bug that this mapping prevents. `Number({defense: 100}) || 0` is zero, so the probe checks a formula that never ran.
 *
 * A string in the form `$.name` substitutes that case-input member. `$` substitutes the whole input.
 * Every other value is a literal.
 */
export type MechanicProbeArgumentTemplate = readonly CanonicalJson[];

/** A materialized contract. It has a registry entry's shape without registry knowledge. */
export type MechanicProbeContract = {
  suite: string;
  id: string;
  category: string | null;
/** How the runtime binding is called: as a plain function or as a method on its owner. */
  resolver: "function" | "method";
/** Which semantic bundle role produced the function's script. */
  bundle: BundleRole;
  methodName: string | null;
/** The exact source appended to the served module when this probe needs a bridged session. */
  bridgeSuffix: string | null;
/** The game-authored or source-derived expression that this contract supports, for the report. */
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

/** Deep equality by canonical serialization. Key order never decides a probe result. */
export function sameCanonicalValue(left: CanonicalJson, right: CanonicalJson): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export type MechanicProbeObservation = (input: CanonicalJson) => Promise<CanonicalJson>;

/**
 * Substitutes a case input into a contract's argument template.
 *
 * The harness uses this hashed template for the runtime call. It does not use its own idea of the shape.
 * A test can check the substitution without a browser.
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
 * A formula that returns a different value on the second call is not a formula.
 * The executor catches state that leaks into the game's arithmetic at the lowest cost.
 * One differing observation fails the contract. The executor does not average the values.
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
 * A skipped execution with the same shape as a real execution.
 *
 * The report must list every declared case when the game cannot start.
 * A report with fewer cases makes a skip look like a narrower contract.
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
