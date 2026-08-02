import { describe, expect, test } from "bun:test";
import {
  CANONICAL_BRIDGE_SUFFIX,
  CANONICAL_BRIDGE_SUFFIX_SHA256,
  claimBindingsForText,
  checkProbeContractHashes,
  MECHANIC_PROBE_CONTRACTS,
  probeContractPreimage,
  publicProbeContract,
} from "./mechanic-probes.ts";
import {
  runMechanicProbeContract,
  skippedMechanicProbeExecution,
} from "./mechanic-probe-executor.ts";
import type { CanonicalJson } from "./canonical-public-evidence.ts";
import { canonicalJson } from "./canonical-public-evidence.ts";
import { sha256Hex } from "./source-hash.ts";

const EXPECTED_CONTRACT_HASHES: Record<string, string> = {
  mitigationCap: "389be6e3b6aa80e26329dc3622d67816827167d966e695e98d6d636f7e95b2e7",
  mitigationLevelClamp: "61d19a58366ab68a8fbfc5027e5da72db30a3750e07d16374b58c36a65a84683",
  xpGainMultiplier: "8e34608cb47614397ba906a33b01ad42bbcde42a8b8314e29e32d266d73d4b9d",
  sellValueRarityMultipliers: "1096504e5bca09ac4ea2e09b0c82370426a69ebdbcdb3c096d77eabae7205740",
};

describe("mechanic probe contracts", () => {
  test("pins every canonical contract hash and recomputation", () => {
    expect(MECHANIC_PROBE_CONTRACTS.map((contract) => contract.id)).toEqual([
      "mitigationCap",
      "mitigationLevelClamp",
      "xpGainMultiplier",
      "sellValueRarityMultipliers",
    ]);
    for (const contract of MECHANIC_PROBE_CONTRACTS) {
      expect(contract.contractSha256).toBe(EXPECTED_CONTRACT_HASHES[contract.id]);
      expect(sha256Hex(new TextEncoder().encode(canonicalJson(probeContractPreimage(contract)))))
        .toBe(contract.contractSha256);
    }
    expect(checkProbeContractHashes()).toEqual(
      MECHANIC_PROBE_CONTRACTS.map((contract) => ({
        id: contract.id,
        expected: contract.contractSha256,
        actual: contract.contractSha256,
      })),
    );
  });

  test("execution tuples are unique", () => {
    const tuples = MECHANIC_PROBE_CONTRACTS.map(
      (contract) => `${contract.suite}\u0000${contract.id}\u0000${contract.category ?? "null"}\u0000${contract.contractSha256}`,
    );
    expect(new Set(tuples).size).toBe(tuples.length);
  });

  test("claim bindings are exact and unbound text has none", () => {
    expect(claimBindingsForText("combat.defense.normal-mitigation.expression")).toHaveLength(2);
    expect(claimBindingsForText("combat.defense.mitigation-cap.value")).toHaveLength(1);
    expect(claimBindingsForText("skills.xp.example.base.value")).toHaveLength(1);
    expect(claimBindingsForText("equipment.sell.rarity.rare.value")).toHaveLength(1);
    expect(claimBindingsForText("unbound.text.id")).toEqual([]);
  });

  test("public contracts preserve all cases but omit source target ids", () => {
    for (const contract of MECHANIC_PROBE_CONTRACTS) {
      const publicContract = publicProbeContract(contract);
      expect(publicContract.cases).toEqual(
        contract.cases.map((declared) => ({
          id: declared.id,
          input: declared.input,
          expected: declared.expected,
        })),
      );
      expect(publicContract).not.toHaveProperty("sourceTargetIds");
      for (const binding of publicContract.claimBindings) expect(binding).not.toHaveProperty("sourceTargetIds");
    }
  });

  test("the bridge suffix is one exact assignment and has a fixed digest", () => {
    expect(CANONICAL_BRIDGE_SUFFIX).toBe(
      "\n;globalThis.__VESPERA_DEFENSE_BRIDGE__ = getIncomingDefenseMitigation;\n",
    );
    expect(CANONICAL_BRIDGE_SUFFIX.trim().split("\n")).toHaveLength(1);
    expect(CANONICAL_BRIDGE_SUFFIX_SHA256).toBe(
      "99adcaa63ab117bcc0c7ed24b595a4c533ed7d9f987a57a5467c87aa62b171f2",
    );
    expect(CANONICAL_BRIDGE_SUFFIX_SHA256).toBe(
      sha256Hex(new TextEncoder().encode(CANONICAL_BRIDGE_SUFFIX)),
    );
  });
});

describe("generic mechanic probe executor", () => {
  const contract = MECHANIC_PROBE_CONTRACTS.find((entry) => entry.id === "sellValueRarityMultipliers")!;

  test("passes a complete grid when both observations equal each expected value", async () => {
    const execution = await runMechanicProbeContract(contract, async (input: CanonicalJson) => {
      const declared = contract.cases.find((candidate) => canonicalJson(candidate.input) === canonicalJson(input));
      if (!declared) throw new Error("unexpected case");
      return declared.expected;
    });
    expect(execution.status).toBe("PASS");
    expect(execution.cases).toHaveLength(contract.cases.length);
    expect(execution.cases.every((entry) => canonicalJson(entry.firstObserved) === canonicalJson(entry.secondObserved))).toBe(true);
  });

  test("fails when the observation returns a wrong value", async () => {
    const execution = await runMechanicProbeContract(contract, async () => 0);
    expect(execution.status).toBe("FAIL");
    expect(execution.detail).toContain("expected");
    expect(execution.cases).toHaveLength(contract.cases.length);
  });

  test("fails when a repeated observation is not stable", async () => {
    let calls = 0;
    const execution = await runMechanicProbeContract(contract, async () => (calls++ % 2 === 0 ? 0 : 1));
    expect(execution.status).toBe("FAIL");
    expect(execution.detail).toContain("not repeatable");
  });

  test("turns a throwing observation into a failed execution", async () => {
    const execution = await runMechanicProbeContract(contract, async () => {
      throw new Error("transport down");
    });
    expect(execution.status).toBe("FAIL");
    expect(execution.detail).toContain("transport down");
    expect(execution.cases).toEqual([]);
  });

  test("skipped execution preserves every declared case", () => {
    const skipped = skippedMechanicProbeExecution(contract, "browser unavailable");
    expect(skipped.status).toBe("FAIL");
    expect(skipped.detail).toContain("browser unavailable");
    expect(skipped.cases).toEqual(
      contract.cases.map((declared) => ({
        id: declared.id,
        input: declared.input,
        expected: declared.expected,
        firstObserved: null,
        secondObserved: null,
      })),
    );
  });
});
