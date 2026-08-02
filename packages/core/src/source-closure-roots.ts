/**
 * The exhaustive registry of reviewed source closures.
 *
 * Five closures decide whether this repository may publish a claim about the game:
 *
 * - `inspector` renders review artifacts and writes attestations. It is the trust root, so it has no
 *   source constant: its only approved value lives in the source lock and rotating it is an explicit
 *   operator act.
 * - `approvalGate` is every command that reads a protected input, decides an approval, or writes an
 *   emitted artifact. A change here invalidates old approvals before that code may publish again.
 * - `derivation` executes shipped functions to produce published values.
 * - `probeExecutor` runs a probe contract against an observation callback.
 * - `runtime` is the harness transport that produces live evidence.
 *
 * Keeping the root lists here, rather than beside each implementation, is what makes "unmapped
 * command" and "root outside the registry" checkable failures instead of judgement calls.
 */

import type { SourceClosureName } from "./source-package-leaves.ts";
import type { SourceClosureRoot } from "./source-hash.ts";
import { SOURCE_CLOSURE_EXTERNAL_LEAVES, externalLeafToken } from "./external-leaves.ts";

/** Reviewed constant modules. Reaching one serializes its token instead of its value. */
export const EXECUTION_SOURCE_SELF_TOKENS: Readonly<Record<string, string>> = Object.freeze({
  "packages/core/src/execution-source-hashes/approval-gate.ts": "<APPROVAL_GATE_SELF>",
  "packages/core/src/execution-source-hashes/derivation.ts": "<MECHANIC_DERIVATION_SELF>",
  "packages/core/src/execution-source-hashes/probe-executor.ts": "<MECHANIC_EXECUTOR_SELF>",
  "packages/core/src/execution-source-hashes/probe-runtime.ts": "<PROBE_RUNTIME_SELF>",
});

const PIPELINE = "packages/pipeline/src";
const HARNESS = "packages/harness/src";
const CORE = "packages/core/src";

/**
 * The harness transport that produces live evidence.
 *
 * Published as its own named list because the plan-level guarantee is about these exact entry points:
 * command orchestration, launch and cache setup, byte parity before dispatch, runtime resolution,
 * CDP invocation, and bridge serving. Their transitive closure covers the lower-level helpers.
 */
export const MECHANIC_RUNTIME_ROOTS: readonly SourceClosureRoot[] = Object.freeze([
  { module: `${HARNESS}/probes/formulas.ts`, symbol: "resolveSellRuntimeBinding" },
  { module: `${HARNESS}/probes/formulas.ts`, symbol: "resolveXpRuntimeBinding" },
  { module: `${HARNESS}/probes/formulas.ts`, symbol: "resolveDefenseRuntimeBinding" },
  { module: `${HARNESS}/probes/formulas.ts`, symbol: "invokeRuntimeBinding" },
  { module: `${HARNESS}/run.ts`, symbol: "runEvidenceCommand" },
  { module: `${HARNESS}/run.ts`, symbol: "runAll" },
  { module: `${HARNESS}/run.ts`, symbol: "captureRuntimeBundleSources" },
  { module: `${HARNESS}/report.ts`, symbol: "writeReports" },
  { module: `${HARNESS}/bridge.ts`, symbol: "serveWithBridge" },
  { module: `${HARNESS}/cdp.ts`, symbol: "connect" },
]);

/** Every closure's exact root list. */
export const SOURCE_CLOSURE_ROOTS: Readonly<Record<SourceClosureName, readonly SourceClosureRoot[]>> =
  Object.freeze({
    inspector: Object.freeze([
      { module: `${PIPELINE}/mechanics-inspect.ts`, symbol: "inspectMechanicsReview" },
      { module: `${PIPELINE}/mechanics-inspect.ts`, symbol: "inspectMechanicsSourceReviews" },
      { module: `${PIPELINE}/mechanics-inspect.ts`, symbol: "writeInspectAttestation" },
    ]),
    approvalGate: Object.freeze([
      { module: `${PIPELINE}/inputs.ts`, symbol: "prepareMechanicsInputs" },
      { module: `${PIPELINE}/inputs.ts`, symbol: "snapshotPublishedInputs" },
      { module: `${PIPELINE}/inputs.ts`, symbol: "prepareStagedPublishedInputs" },
      { module: `${PIPELINE}/inputs.ts`, symbol: "prepareMechanicsSourceReviewInputs" },
      { module: `${PIPELINE}/inputs.ts`, symbol: "prepareReviewInputs" },
      { module: `${PIPELINE}/inputs.ts`, symbol: "commitAtomicFile" },
      { module: `${PIPELINE}/mechanics-lock.ts`, symbol: "validateMechanicsProof" },
      { module: `${PIPELINE}/mechanics-lock.ts`, symbol: "checkMechanics" },
      { module: `${PIPELINE}/mechanics-lock.ts`, symbol: "syncMechanicsLock" },
      { module: `${PIPELINE}/mechanics-lock.ts`, symbol: "recoverMechanicsLock" },
      { module: `${PIPELINE}/mechanics-source.ts`, symbol: "bootstrapMechanicsSourceApproval" },
      { module: `${PIPELINE}/mechanics-source.ts`, symbol: "syncMechanicsSourceApproval" },
      { module: `${PIPELINE}/mechanics-source.ts`, symbol: "rotateInspectorApproval" },
      { module: `${PIPELINE}/mechanics-source.ts`, symbol: "rotateGateApproval" },
      { module: `${PIPELINE}/external-leaf-evidence.ts`, symbol: "verifyExternalLeafEvidence" },
      { module: `${PIPELINE}/publish.ts`, symbol: "publish" },
      { module: `${PIPELINE}/verify.ts`, symbol: "verifyPublished" },
      { module: `${PIPELINE}/site-data.ts`, symbol: "syncSiteData" },
      { module: `${PIPELINE}/site-data.ts`, symbol: "verifySiteData" },
    ]),
    derivation: Object.freeze([
      { module: `${PIPELINE}/mechanic-derivation-executor.ts`, symbol: "evaluateMechanicDerivation" },
      { module: `${CORE}/sandbox.ts`, symbol: "evalComposition" },
      { module: `${PIPELINE}/gear.ts`, symbol: "applyGearBalance" },
    ]),
    probeExecutor: Object.freeze([
      { module: `${CORE}/mechanic-probe-executor.ts`, symbol: "runMechanicProbeContract" },
    ]),
    runtime: MECHANIC_RUNTIME_ROOTS,
  });

/**
 * Tokens a closure declares rather than discovers.
 *
 * The CDP operations are string literals sent over a socket, so no import mentions them. Declaring
 * them keeps the capability list reviewable: removing one is a hash change even though the type
 * checker would never notice.
 */
export const SOURCE_CLOSURE_DECLARED_LEAVES: Readonly<Record<SourceClosureName, readonly string[]>> =
  Object.freeze({
    approvalGate: Object.freeze([]),
    derivation: Object.freeze([]),
    inspector: Object.freeze([]),
    probeExecutor: Object.freeze([]),
    runtime: Object.freeze(
      SOURCE_CLOSURE_EXTERNAL_LEAVES.cdp!.map((operation) => externalLeafToken("cdp", operation)),
    ),
  });

/**
 * Every protected command and the single closure root that owns it.
 *
 * The caller checker rejects a protected command whose handler is not mapped here, and a root that is
 * not in {@link SOURCE_CLOSURE_ROOTS}. That pairing is what stops a new command from quietly reading
 * an approval input through a path no closure covers.
 */
export const PROTECTED_CLI_COMMANDS: Readonly<Record<string, SourceClosureRoot>> = Object.freeze({
  "external-leaves:verify": { module: `${PIPELINE}/external-leaf-evidence.ts`, symbol: "verifyExternalLeafEvidence" },
  "mechanics-sources:bootstrap": { module: `${PIPELINE}/mechanics-source.ts`, symbol: "bootstrapMechanicsSourceApproval" },
  "mechanics-sources:inspect": { module: `${PIPELINE}/mechanics-inspect.ts`, symbol: "inspectMechanicsSourceReviews" },
  "mechanics-sources:rotate-gate": { module: `${PIPELINE}/mechanics-source.ts`, symbol: "rotateGateApproval" },
  "mechanics-sources:rotate-inspector": { module: `${PIPELINE}/mechanics-source.ts`, symbol: "rotateInspectorApproval" },
  "mechanics-sources:sync": { module: `${PIPELINE}/mechanics-source.ts`, symbol: "syncMechanicsSourceApproval" },
  "mechanics:check": { module: `${PIPELINE}/mechanics-lock.ts`, symbol: "checkMechanics" },
  "mechanics:diff": { module: `${PIPELINE}/inputs.ts`, symbol: "prepareMechanicsInputs" },
  "mechanics:inspect": { module: `${PIPELINE}/mechanics-inspect.ts`, symbol: "inspectMechanicsReview" },
  "mechanics:prove": { module: `${PIPELINE}/mechanics-lock.ts`, symbol: "validateMechanicsProof" },
  "mechanics:sync": { module: `${PIPELINE}/mechanics-lock.ts`, symbol: "syncMechanicsLock" },
  publish: { module: `${PIPELINE}/publish.ts`, symbol: "publish" },
  "sync-site": { module: `${PIPELINE}/site-data.ts`, symbol: "syncSiteData" },
  "verify-published": { module: `${PIPELINE}/verify.ts`, symbol: "verifyPublished" },
  "verify-site-data": { module: `${PIPELINE}/site-data.ts`, symbol: "verifySiteData" },
});

/** Every closure name, in the fixed order the source lock and review artifacts use. */
export const SOURCE_CLOSURE_ORDER: readonly SourceClosureName[] = Object.freeze([
  "inspector",
  "approvalGate",
  "derivation",
  "probeExecutor",
  "runtime",
]);
