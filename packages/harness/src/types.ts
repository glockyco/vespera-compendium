import type { BundleFingerprints, BundleRole } from "@vespera/core";
import type { MechanicDocument, MechanicProbeRef } from "@vespera/pipeline";
import type { MechanicProbeExecutionCase } from "@vespera/core";

export type ProbeStatus = "PASS" | "FAIL" | "SKIPPED" | "UNRESOLVED";

export type ProbeResult = {
  buildId: string;
  id: string;
  suite: string;
  status: ProbeStatus;
  category?: string | null;
  detail: string;
  observed?: unknown;
  expected?: unknown;
  resolver?: "function" | "method";
  bundle?: BundleRole;
  contractSha256?: string;
  scriptId?: string;
  boundModuleSha256?: string;
  invocationResourceUrl?: string;
  cleanResourceUrl?: string;
  cleanModuleSha256?: string;
  servedResourceUrl?: string;
  servedResourceSha256?: string;
  bridgeSuffixSha256?: string;
  cases?: MechanicProbeExecutionCase[];
};

export type RuntimeVersions = { bun: string; node: string; chrome: string };
export type PlatformArtifact = {
  role: "bun" | "node" | "game-runtime" | "crossover-launcher";
  sha256: string;
};
export type ExternalLeafCoverage = {
  id: string;
  status: "PASS" | "FAIL" | "SKIPPED";
  detail: string;
};

export type EvidenceReport = {
  schemaVersion: 2;
  buildId: string;
  ranAt: string;
  extractedBundles: BundleFingerprints;
  runtimeBundles: BundleFingerprints | null;
  probeRuntimeSha256: string;
  mechanicsSourceApprovalSha256: string;
  runtimeVersions: RuntimeVersions;
  platformArtifacts: PlatformArtifact[];
  externalLeafCoverage: ExternalLeafCoverage[];
  mechanics: { id: string; requiredProbes: MechanicProbeRef[]; passedProbes: MechanicProbeRef[] }[];
  results: ProbeResult[];
};

/** The only input that the harness execution boundary accepts. */
export type PreparedHarnessRun = {
  readonly buildId: string;
  readonly extractedSnapshotPath: string;
  readonly extractedBundles: BundleFingerprints;
  readonly mechanicsSourceApprovalSha256: string;
  readonly documents: readonly MechanicDocument[];
  readonly mechanics: readonly { id: string; requiredProbes: readonly MechanicProbeRef[] }[];
  readonly outputRoot?: string;
  readonly expectedProbeRuntimeSha256?: string;
};
