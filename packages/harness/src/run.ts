import { composeAll } from "../../pipeline/src/compose.ts";
import {
  cdpResponseBytes,
  fingerprintBundleSources,
  fingerprintBundles,
  resolveBundles,
  sameBundleIdentities,
  sha256Hex,
  type BundleFingerprints,
} from "@vespera/core";
import { serveWithBridge, type BridgeServer } from "./bridge.ts";
import { identifyTables } from "./identify.ts";
import { HarnessUnavailableError, launchGame, type Session } from "./launch.ts";
import {
  runFormulaProbes,
  skippedFormulaResults,
  type RuntimeResource,
  type RuntimeResolverContext,
} from "./probes/formulas.ts";
import { runParityProbes, TABLE_IDS } from "./probes/parity.ts";
import { runRecordProbes } from "./probes/records.ts";
import { runSaveProbe } from "./probes/save.ts";
import { writeReports, type ReportWriteResult } from "./report.ts";
import type { CdpClient } from "./cdp.ts";
import type { PreparedHarnessRun, ProbeResult } from "./types.ts";

export type ProbeSuite = "parity" | "records" | "formulas" | "save";
export type RunOptions = {
  extractedDir: string;
  buildId: string;
  port?: number;
  only?: Iterable<ProbeSuite>;
};

export type HarnessRunResult = {
  results: ProbeResult[];
  runtimeBundles: BundleFingerprints | null;
  /** External-leaf coverage IDs the CDP transport actually exercised across every session. */
  executedTransportOperations: ReadonlySet<string>;
};
const ALL_SUITES: ProbeSuite[] = ["parity", "records", "formulas", "save"];
const CAPTURES = new WeakMap<CdpClient, { fingerprints: BundleFingerprints; resources: RuntimeResource[] }>();

function skippedResults(buildId: string, suites: Set<ProbeSuite>, reason: string): ProbeResult[] {
  const results: ProbeResult[] = [];
  if (suites.has("parity")) results.push(...TABLE_IDS.map((id) => ({ buildId, id, suite: "parity", status: "SKIPPED" as const, detail: reason })));
  if (suites.has("records")) results.push(...TABLE_IDS.map((id) => ({ buildId, id, suite: "records", status: "SKIPPED" as const, detail: reason })));
  if (suites.has("formulas")) results.push(...skippedFormulaResults(buildId, reason));
  if (suites.has("save")) results.push({ buildId, id: "saveEnvelope", suite: "save", status: "SKIPPED", detail: reason });
  return results;
}

function skippedBridgeResults(buildId: string, suites: Set<ProbeSuite>, reason: string): ProbeResult[] {
  const results: ProbeResult[] = [];
  if (suites.has("formulas")) results.push(...skippedFormulaResults(buildId, reason).filter((result) => result.id === "mitigationCap" || result.id === "mitigationLevelClamp"));
  if (suites.has("save")) results.push({ buildId, id: "saveEnvelope", suite: "save", status: "SKIPPED", detail: reason });
  return results;
}

function assertSessionBuild(session: Session, expectedBuildId: string): void {
  if (session.buildId !== expectedBuildId) throw new Error(`game build changed: expected ${expectedBuildId}, launched ${session.buildId}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function responseBody(value: unknown): { body: string; base64Encoded: boolean } {
  if (!isRecord(value) || typeof value.body !== "string" || typeof value.base64Encoded !== "boolean") {
    throw new Error("Network.getResponseBody returned an invalid body");
  }
  return { body: value.body, base64Encoded: value.base64Encoded };
}

/**
 * Captures every final response body and resolves the same semantic roles the disk inputs use.
 *
 * The harness attaches after the game has already loaded, and Chromium retains a response body only for a
 * bounded window, so asking for the initial load's bodies fails with "No resource with given identifier
 * found". The fix is to observe a load rather than to ask about one that is over: cache is disabled, the
 * page is navigated to its own URL, and each body is fetched the moment its request finishes.
 *
 * Fetching inside the completion handler matters. Collecting every request first and then fetching would
 * reintroduce exactly the eviction window this exists to avoid.
 */
export async function captureRuntimeBundleSources(client: CdpClient): Promise<BundleFingerprints> {
  const pending = new Map<string, { url: string; redirect: boolean }>();
  const captured = new Map<string, RuntimeResource>();
  const inFlight: Promise<void>[] = [];

  const fetchBody = async (requestId: string, url: string): Promise<void> => {
    try {
      const bodyValue = await client.send<unknown>("Network.getResponseBody", { requestId });
      const body = responseBody(bodyValue);
      const bytes = cdpResponseBytes(body.body, body.base64Encoded);
      captured.set(requestId, { url, bytes, sha256: sha256Hex(bytes) });
    } catch {
      // A body Chromium has already evicted cannot become a role. Missing bytes are handled by the role
      // resolver below, which fails when a role has no candidate, rather than by guessing here.
    }
  };

  const unsubscribeResponse = client.on("Network.responseReceived", (value) => {
    if (!isRecord(value) || typeof value.requestId !== "string" || !isRecord(value.response)) return;
    if (typeof value.response.url !== "string") return;
    const status = typeof value.response.status === "number" ? value.response.status : 0;
    pending.set(value.requestId, { url: value.response.url, redirect: status >= 300 && status < 400 });
  });
  const unsubscribeFinished = client.on("Network.loadingFinished", (value) => {
    if (!isRecord(value) || typeof value.requestId !== "string") return;
    const response = pending.get(value.requestId);
    if (!response || response.redirect) return;
    inFlight.push(fetchBody(value.requestId, response.url));
  });

  try {
    await client.send("Network.setCacheDisabled", { cacheDisabled: true });
    const href = await client.evaluate<string>("location.href", 30_000);
    await client.send("Page.navigate", { url: href });

    // The game initializes several megabytes of module before it settles, so the wait is generous and ends
    // as soon as all three roles resolve rather than after a fixed delay.
    const deadline = Date.now() + 180_000;
    let resolved: BundleFingerprints | null = null;
    let lastError = "no finished Network responses yet";
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await Promise.all([...inFlight]);
      const resources = [...captured.values()];
      if (resources.length > 0) {
        try {
          resolved = fingerprintBundleSources(resources);
          break;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }
    }
    if (!resolved) {
      throw new Error(`the runtime did not serve all three bundle roles: ${lastError}`);
    }
    CAPTURES.set(client, { fingerprints: resolved, resources: [...captured.values()] });
    return resolved;
  } finally {
    unsubscribeResponse();
    unsubscribeFinished();
  }
}

function resolverContext(client: CdpClient, extra: RuntimeResolverContext = {}): RuntimeResolverContext {
  const capture = CAPTURES.get(client);
  return capture ? { ...extra, resources: capture.resources } : extra;
}

export async function runAll(opts: RunOptions): Promise<HarnessRunResult> {
  const suites = new Set(opts.only ?? ALL_SUITES);
  const port = opts.port ?? 9222;
  const bundles = resolveBundles(opts.extractedDir);
  const extractedFingerprints = fingerprintBundles(opts.extractedDir);
  const needsComposedTables = suites.has("parity") || suites.has("records");
  const composed = needsComposedTables ? composeAll(opts.extractedDir) : undefined;
  const results: ProbeResult[] = [];
  const cleanSuites = new Set([...suites].filter((suite) => suite === "parity" || suite === "records" || suite === "formulas"));
  let runtimeBundles: BundleFingerprints | null = null;
  // Collected before each session stops, because a closed transport can no longer report what it ran.
  const executed = new Set<string>();
  let cleanIndexResourceUrl: string | null = null;

  if (cleanSuites.size > 0) {
    let session: Session | undefined;
    try {
      session = await launchGame({ port });
      assertSessionBuild(session, opts.buildId);
      runtimeBundles = await captureRuntimeBundleSources(session.client);
      if (!sameBundleIdentities(extractedFingerprints, runtimeBundles)) throw new Error("runtime bundle identities do not match extracted bundle identities");
      cleanIndexResourceUrl = runtimeBundles.index.filename;
      const needsTables = suites.has("parity") || suites.has("records");
      const tables = needsTables ? await identifyTables(session.client, bundles.index) : [];
      if (suites.has("parity")) {
        if (!composed) throw new Error("parity suite requires composed tables");
        results.push(...runParityProbes(opts.buildId, opts.extractedDir, tables, composed));
      }
      if (suites.has("records")) {
        if (!composed) throw new Error("records suite requires composed tables");
        results.push(...(await runRecordProbes(opts.buildId, session.client, bundles.index, tables, composed)));
      }
      if (suites.has("formulas")) {
        // The captured URL, not a reconstructed `./assets/<file>` path: importing a second spelling of the
        // same module creates a second script that no Network response ever answered, and the scriptId
        // would then map to nothing.
        const context = resolverContext(session.client, {
          indexBundle: bundles.index,
          indexResourceUrl: cleanIndexResourceUrl ?? undefined,
        });
        const formulaResults = await runFormulaProbes(opts.buildId, session.client, context, ["xpGainMultiplier", "sellValueRarityMultipliers"]);
        results.push(...formulaResults);
      }
    } catch (error) {
      if (error instanceof HarnessUnavailableError) {
        return {
          results: skippedResults(opts.buildId, suites, error.message),
          runtimeBundles: null,
          executedTransportOperations: executed,
        };
      }
      throw error;
    } finally {
      for (const operation of session?.client.executedOperations() ?? []) executed.add(operation);
      await session?.stop();
    }
  }

  const bridgeSuites = new Set([...suites].filter((suite) => suite === "formulas" || suite === "save"));
  if (bridgeSuites.size === 0) return { results, runtimeBundles, executedTransportOperations: executed };
  let bridge: BridgeServer | undefined;
  let session: Session | undefined;
  try {
    bridge = await serveWithBridge(opts.extractedDir, port + 1);
    session = await launchGame({ devUrl: bridge.url, port, userDataName: "Vespera Harness" });
    assertSessionBuild(session, opts.buildId);
    if (suites.has("formulas")) {
      const bridgeRuntimeBundles = await captureRuntimeBundleSources(session.client);
      const context = resolverContext(session.client, {
        indexBundle: bridge.indexBundle,
        cleanResourceUrl: cleanIndexResourceUrl ?? `./assets/${bridge.indexBundle}`,
        cleanModuleSha256: runtimeBundles?.index.sha256 ?? bridge.cleanModuleSha256,
        servedResourceUrl: bridgeRuntimeBundles.index.filename,
        servedResourceSha256: bridge.servedResourceSha256,
        bridgeSuffixSha256: bridge.bridgeSuffixSha256,
      });
      const bridgeResults = await runFormulaProbes(opts.buildId, session.client, context, ["mitigationCap", "mitigationLevelClamp"]);
      results.push(...bridgeResults);
    }
    if (suites.has("save")) results.push(await runSaveProbe(opts.buildId, session.client, bundles.index));
  } catch (error) {
    if (error instanceof HarnessUnavailableError) {
      results.push(...skippedBridgeResults(opts.buildId, bridgeSuites, error.message));
      return { results, runtimeBundles, executedTransportOperations: executed };
    }
    const detail = error instanceof Error ? error.message : String(error);
    for (const result of skippedBridgeResults(opts.buildId, bridgeSuites, detail)) results.push({ ...result, status: "FAIL" });
  } finally {
    for (const operation of session?.client.executedOperations() ?? []) executed.add(operation);
    await session?.stop();
    bridge?.stop();
  }
  return { results, runtimeBundles, executedTransportOperations: executed };
}

export type RunEvidenceOptions = Omit<RunOptions, "extractedDir" | "buildId"> & { outputRoot?: string };

export async function runEvidenceCommand(input: PreparedHarnessRun, options: RunEvidenceOptions = {}): Promise<ReportWriteResult> {
  const run = await runAll({ extractedDir: input.extractedSnapshotPath, buildId: input.buildId, port: options.port, only: options.only });
  return writeReports(
    {
      ...input,
      runtimeBundles: run.runtimeBundles,
      executedTransportOperations: run.executedTransportOperations,
      outputRoot: options.outputRoot ?? input.outputRoot,
    },
    run.results,
  );
}

export type { ProbeResult } from "./types.ts";
