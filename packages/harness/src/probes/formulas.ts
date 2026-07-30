import type { ComposedTables } from "@vespera/pipeline";
import type { CdpClient } from "../cdp.ts";
import type { ProbeResult } from "../types.ts";

type Assertion = (observed: any) => { ok: boolean; detail: string; expected?: unknown };

async function runPureProbe(
  buildId: string,
  client: CdpClient,
  id: string,
  expression: string,
  assertion: Assertion,
): Promise<ProbeResult> {
  try {
    const first = await client.evaluate(expression, 120_000);
    const second = await client.evaluate(expression, 120_000);
    if (JSON.stringify(first) !== JSON.stringify(second)) {
      return {
        buildId,
        id,
        suite: "formulas",
        status: "FAIL",
        detail: `${id}: pure probe returned different results on repeated evaluation`,
        observed: { first, second },
      };
    }
    const checked = assertion(first);
    return {
      buildId,
      id,
      suite: "formulas",
      status: checked.ok ? "PASS" : "FAIL",
      detail: checked.detail,
      observed: first,
      expected: checked.expected,
    };
  } catch (error) {
    return {
      buildId,
      id,
      suite: "formulas",
      status: "FAIL",
      detail: `${id}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function runImportFormulaProbes(
  buildId: string,
  client: CdpClient,
  indexBundle: string,
): Promise<ProbeResult[]> {
  const moduleImport = `await import(new URL(${JSON.stringify(`./assets/${indexBundle}`)}, location.href).href)`;
  const sellExpression = `(async () => {
    const namespace = ${moduleImport};
    const rarities = ["common", "uncommon", "rare", "epic", "legendary", "mythic", "living"];
    const values = rarities.map((rarity) => namespace.getItemSellValue({ value: 100 }, rarity, 1));
    return { rarities, values, ratios: values.map((value) => value / values[0]) };
  })()`;
  const expectedRatios = [1, 1.1, 1.22, 1.36, 1.52, 1.7, 1.52];

  const xpExpression = `(async () => {
    const namespace = ${moduleImport};
    const holder = Object.values(namespace).find((value) =>
      typeof value === "function" && typeof value.calculateXpGain === "function"
    );
    if (!holder) throw new Error("calculateXpGain export not identifiable by shape");
    return holder.calculateXpGain({ baseXp: 100, bonuses: [], skillType: "combat" });
  })()`;

  return Promise.all([
    runPureProbe(buildId, client, "sellValueRarityMultipliers", sellExpression, (observed) => {
      const ok = JSON.stringify(observed?.ratios) === JSON.stringify(expectedRatios);
      return {
        ok,
        detail: ok
          ? `sellValueRarityMultipliers: ratios=${JSON.stringify(observed.ratios)}`
          : `sellValueRarityMultipliers: observed grid=${JSON.stringify(observed)}`,
        expected: expectedRatios,
      };
    }),
    runPureProbe(buildId, client, "xpGainMultiplier", xpExpression, (observed) => ({
      ok: observed === 100,
      detail:
        observed === 100
          ? "xpGainMultiplier: base XP 100 returned 100"
          : `xpGainMultiplier: observed=${JSON.stringify(observed)}`,
      expected: 100,
    })),
  ]);
}

export async function runBridgeFormulaProbes(
  buildId: string,
  client: CdpClient,
  composed: ComposedTables,
): Promise<ProbeResult[]> {
  const deadline = Date.now() + 120_000;
  let bridgeReady = false;
  while (Date.now() < deadline) {
    try {
      bridgeReady = await client.evaluate<boolean>("Boolean(globalThis.__VESPERA_BRIDGE__)", 2_000);
      if (bridgeReady) break;
    } catch {
      // The renderer can block briefly while the large module initializes.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!bridgeReady) {
    return ["mitigationCap", "mitigationLevelClamp", "achievementActiveSplit"].map((id) => ({
      buildId,
      id,
      suite: "formulas",
      status: "FAIL",
      detail: `${id}: bridge did not initialize within 120000ms`,
    }));
  }
  const mitigationGridExpression = `(async () => {
    const fn = globalThis.__VESPERA_BRIDGE__?.incomingDefenseMitigation;
    if (typeof fn !== "function") throw new Error("incomingDefenseMitigation bridge is unavailable");
    const defenses = [0, 100, 1000, 100000];
    const levels = [1, 50, 256, 10000];
    return { defenses, levels, values: defenses.map((defense) => levels.map((level) => fn(defense, level))) };
  })()`;
  const clampExpression = `(async () => {
    const fn = globalThis.__VESPERA_BRIDGE__?.incomingDefenseMitigation;
    if (typeof fn !== "function") throw new Error("incomingDefenseMitigation bridge is unavailable");
    return { level256: fn(1000, 256), level10000: fn(1000, 10000) };
  })()`;
  const achievementExpression = `(async () => {
    const achievements = globalThis.__VESPERA_BRIDGE__?.achievements;
    if (!Array.isArray(achievements)) throw new Error("achievements bridge is unavailable");
    return achievements.length;
  })()`;

  const rawAchievements = composed.achievements?.base;
  return Promise.all([
    runPureProbe(buildId, client, "mitigationCap", mitigationGridExpression, (observed) => {
      const values = observed?.values as number[][] | undefined;
      const cappedLevel = values?.map((row) => row[3]) ?? [];
      const capAppliesAboveClamp =
        cappedLevel.length === 4 && cappedLevel.every((value) => value <= 0.75) && values?.[3]?.[3] === 0.75;
      const uncappedAtLowLevel = (values?.[3]?.[0] ?? 0) > 0.75;
      const monotonic = (observed?.levels ?? []).every((_: unknown, levelIndex: number) =>
        values!.every((row, defenseIndex) => defenseIndex === 0 || row[levelIndex]! >= values![defenseIndex - 1]![levelIndex]!),
      );
      const ok = capAppliesAboveClamp && uncappedAtLowLevel && monotonic;
      return {
        ok,
        detail: ok
          ? `mitigationCap: low-level=${values![3]![0]} capped-level=${values![3]![3]}; grid=${JSON.stringify(observed)}`
          : `mitigationCap: observed grid=${JSON.stringify(observed)}`,
        expected: {
          capAboveLevel256: 0.75,
          atDefense100000Level10000: 0.75,
          lowLevelsUncapped: true,
          monotonicInDefense: true,
        },
      };
    }),
    runPureProbe(buildId, client, "mitigationLevelClamp", clampExpression, (observed) => ({
      ok: observed?.level256 === observed?.level10000,
      detail:
        observed?.level256 === observed?.level10000
          ? `mitigationLevelClamp: level256=${observed.level256} level10000=${observed.level10000}`
          : `mitigationLevelClamp: observed=${JSON.stringify(observed)}`,
      expected: "level256 === level10000",
    })),
    runPureProbe(buildId, client, "achievementActiveSplit", achievementExpression, (observed) => ({
      ok: observed === rawAchievements,
      detail:
        observed === rawAchievements
          ? `achievementActiveSplit: runtime raw=${observed} static raw=${rawAchievements}`
          : `achievementActiveSplit: observed=${JSON.stringify(observed)} static raw=${rawAchievements}`,
      expected: rawAchievements,
    })),
  ]);
}
