import { composeAll } from "@vespera/pipeline";
import { resolveBundles } from "@vespera/core";
import { serveWithBridge } from "./bridge.ts";
import { identifyTables } from "./identify.ts";
import { HarnessUnavailableError, launchGame, type Session } from "./launch.ts";
import { runBridgeFormulaProbes, runImportFormulaProbes } from "./probes/formulas.ts";
import { runParityProbes, TABLE_IDS } from "./probes/parity.ts";
import { runRecordProbes } from "./probes/records.ts";
import { runSaveProbe } from "./probes/save.ts";
import type { ProbeResult } from "./types.ts";

export type ProbeSuite = "parity" | "records" | "formulas" | "save";
export type RunOptions = {
  extractedDir: string;
  buildId: string;
  port?: number;
  only?: Iterable<ProbeSuite>;
};

const ALL_SUITES: ProbeSuite[] = ["parity", "records", "formulas", "save"];

function skippedResults(buildId: string, suites: Set<ProbeSuite>, reason: string): ProbeResult[] {
  const results: ProbeResult[] = [];
  if (suites.has("parity")) {
    results.push(
      ...TABLE_IDS.map((id) => ({
        buildId,
        id,
        suite: "parity",
        status: "SKIPPED" as const,
        detail: reason,
      })),
    );
  }
  if (suites.has("records")) {
    results.push(
      ...TABLE_IDS.map((id) => ({
        buildId,
        id,
        suite: "records",
        status: "SKIPPED" as const,
        detail: reason,
      })),
    );
  }
  if (suites.has("formulas")) {
    for (const id of [
      "sellValueRarityMultipliers",
      "xpGainMultiplier",
      "mitigationCap",
      "mitigationLevelClamp",
      "achievementActiveSplit",
    ]) {
      results.push({ buildId, id, suite: "formulas", status: "SKIPPED", detail: reason });
    }
  }
  if (suites.has("save")) {
    results.push({ buildId, id: "saveEnvelope", suite: "save", status: "SKIPPED", detail: reason });
  }
  return results;
}

function skippedBridgeResults(buildId: string, suites: Set<ProbeSuite>, reason: string): ProbeResult[] {
  const results: ProbeResult[] = [];
  if (suites.has("formulas")) {
    for (const id of ["mitigationCap", "mitigationLevelClamp", "achievementActiveSplit"]) {
      results.push({ buildId, id, suite: "formulas", status: "SKIPPED", detail: reason });
    }
  }
  if (suites.has("save")) {
    results.push({ buildId, id: "saveEnvelope", suite: "save", status: "SKIPPED", detail: reason });
  }
  return results;
}

function assertSessionBuild(session: Session, expectedBuildId: string): void {
  if (session.buildId !== expectedBuildId) {
    throw new Error(`game build changed: expected ${expectedBuildId}, launched ${session.buildId}`);
  }
}

export async function runAll(opts: RunOptions): Promise<ProbeResult[]> {
  const suites = new Set(opts.only ?? ALL_SUITES);
  const port = opts.port ?? 9222;
  const bundles = resolveBundles(opts.extractedDir);
  const composed = composeAll(opts.extractedDir);
  const results: ProbeResult[] = [];
  const cleanSuites = new Set(
    [...suites].filter((suite) => suite === "parity" || suite === "records" || suite === "formulas"),
  );

  if (cleanSuites.size > 0) {
    let session: Session | undefined;
    try {
      session = await launchGame({ port });
      assertSessionBuild(session, opts.buildId);
      const needsTables = suites.has("parity") || suites.has("records");
      const tables = needsTables ? await identifyTables(session.client, bundles.index) : [];
      if (suites.has("parity")) {
        results.push(...runParityProbes(opts.buildId, opts.extractedDir, tables, composed));
      }
      if (suites.has("records")) {
        results.push(
          ...(await runRecordProbes(opts.buildId, session.client, bundles.index, tables, composed)),
        );
      }
      if (suites.has("formulas")) {
        results.push(...(await runImportFormulaProbes(opts.buildId, session.client, bundles.index)));
      }
    } catch (error) {
      if (error instanceof HarnessUnavailableError) {
        return skippedResults(opts.buildId, suites, error.message);
      }
      throw error;
    } finally {
      await session?.stop();
    }
  }

  const bridgeSuites = new Set(
    [...suites].filter((suite) => suite === "formulas" || suite === "save"),
  );
  if (bridgeSuites.size === 0) return results;

  let bridge: Awaited<ReturnType<typeof serveWithBridge>> | undefined;
  let session: Session | undefined;
  try {
    bridge = await serveWithBridge(opts.extractedDir, port + 1);
    session = await launchGame({
      devUrl: bridge.url,
      port,
      userDataName: "Vespera Harness",
    });
    assertSessionBuild(session, opts.buildId);
    if (suites.has("formulas")) {
      results.push(...(await runBridgeFormulaProbes(opts.buildId, session.client, composed)));
    }
    if (suites.has("save")) {
      results.push(await runSaveProbe(opts.buildId, session.client, bundles.index));
    }
  } catch (error) {
    if (error instanceof HarnessUnavailableError) {
      results.push(...skippedBridgeResults(opts.buildId, bridgeSuites, error.message));
      return results;
    }
    const detail = error instanceof Error ? error.message : String(error);
    for (const result of skippedBridgeResults(opts.buildId, bridgeSuites, detail)) {
      results.push({ ...result, status: "FAIL" });
    }
  } finally {
    await session?.stop();
    bridge?.stop();
  }
  return results;
}

export type { ProbeResult } from "./types.ts";
