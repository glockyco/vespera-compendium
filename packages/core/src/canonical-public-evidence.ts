/**
 * Canonical serialization shared by the pipeline and the browser.
 *
 * This module contains every value that the site must derive again. It does not use Node or Bun.
 * The published pages compute the evidence hash and mechanics approval hash from the same bytes as the pipeline.
 * Both runtimes must use the same preimage bytes. The shared module lets both tests check the expected hex values.
 */

/** JSON that canonical serialization accepts. It excludes `undefined` and non-finite numbers. */
export type CanonicalJson =
  | string
  | number
  | boolean
  | null
  | CanonicalJson[]
  | { [key: string]: CanonicalJson };

/**
 * Sorted-key JSON text with no insignificant whitespace.
 *
 * JSON leaves object key order free. A hash inherits that freedom, so this function sorts object keys.
 * Array order has meaning in this repository, so this function preserves array order.
 */
export function canonicalJson(value: CanonicalJson): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`canonical JSON cannot encode the non-finite number ${String(value)}`);
    }
    // `-0` and `0` have the same value to a reader. They must not produce two preimages.
    return JSON.stringify(value === 0 ? 0 : value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  if (typeof value !== "object") {
    throw new Error(`canonical JSON cannot encode ${typeof value}`);
  }
  const record = value as { [key: string]: CanonicalJson };
  const keys = Object.keys(record).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const entry = record[key];
    if (entry === undefined) {
      throw new Error(`canonical JSON cannot encode the undefined member ${JSON.stringify(key)}`);
    }
    parts.push(`${JSON.stringify(key)}:${canonicalJson(entry)}`);
  }
  return `{${parts.join(",")}}`;
}

/** UTF-8 bytes of {@link canonicalJson}. Both runtimes hash these bytes. */
export function canonicalJsonBytes(value: CanonicalJson): Uint8Array {
  return new TextEncoder().encode(canonicalJson(value));
}

/** Lowercase hex of a byte sequence, shared by both hash paths. */
export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

export type BundleRole = "indexHtml" | "index" | "gameView";

export const BUNDLE_ROLES: readonly BundleRole[] = ["indexHtml", "index", "gameView"] as const;

/** Byte identity of one bundle role. Filenames are diagnostic and never enter a hash. */
export type BundleIdentity = { role: BundleRole; bytes: number; sha256: string };

export type PublicProbeCase = {
  id: string;
  input: CanonicalJson;
  expected: CanonicalJson;
};

/**
 * The part of a probe contract that the site can show.
 *
 * Source locators stay private. A visitor can check the arithmetic without a map of the game's internals.
 */
export type PublicProbeContract = {
  suite: string;
  id: string;
  category: string | null;
  resolver: "function" | "method";
  bundle: BundleRole;
  methodName: string | null;
  bridgeSuffix: string | null;
  expression: string;
/** How a case input becomes the shipped function's arguments. A visitor can check the call. */
  argumentTemplate: CanonicalJson[];
  cases: PublicProbeCase[];
  claimBindings: {
    textId: string;
    expectedRawValue: CanonicalJson;
    derivationOutputId: string | null;
    promotionEligible: boolean;
  }[];
  executorSha256: string;
  contractSha256: string;
};

export type NormalizedProbeCase = {
  id: string;
  input: CanonicalJson;
  expected: CanonicalJson;
  firstObserved: CanonicalJson;
  secondObserved: CanonicalJson;
};

export type NormalizedProbeResult = {
  suite: string;
  id: string;
  category: string | null;
  status: "PASS" | "FAIL" | "SKIPPED" | "UNRESOLVED";
  contractSha256: string | null;
  resolver: "function" | "method" | null;
  bundle: BundleRole | null;
  boundModuleSha256: string | null;
  /** Canonical binding token, never a raw URL. See {@link bindingToken}. */
  invocationBinding: string | null;
  cleanBinding: string | null;
  cleanModuleSha256: string | null;
  servedResourceSha256: string | null;
  bridgeSuffixSha256: string | null;
  cases: NormalizedProbeCase[];
};

/**
 * The canonical stand-in for a resource URL.
 *
 * A URL contains a hashed filename and a cache-busting query. The game changes both between builds.
 * Hashing the URL rejects a correct approval after a rename.
 * The semantic role matters. For the instrumented Defense session, the served bytes must contain the clean module and the one canonical suffix.
 */
export function bindingToken(role: BundleRole): string {
  return role;
}

/** The bridged index module's binding token. */
export function bridgedBindingToken(bridgeSuffixSha256: string, servedResourceSha256: string): string {
  return `index-bridged:${bridgeSuffixSha256}:${servedResourceSha256}`;
}

export type RuntimeEvidenceInput = {
  schemaVersion: number;
  buildId: string;
  ranAt: string;
  extractedBundles: Record<BundleRole, { filename: string; bytes: number; sha256: string }>;
  runtimeBundles: Record<BundleRole, { filename: string; bytes: number; sha256: string }> | null;
  probeRuntimeSha256: string;
  mechanicsSourceApprovalSha256: string;
  runtimeVersions: { bun: string; node: string; chrome: string };
  platformArtifacts: { role: string; sha256: string }[];
  externalLeafCoverage: { id: string; status: string; detail: string }[];
  mechanics: {
    id: string;
    requiredProbes: CanonicalJson;
    passedProbes: CanonicalJson;
  }[];
  results: unknown[];
};

/** Byte identity of every role, in fixed role order, with filenames removed. */
function identities(
  bundles: Record<BundleRole, { bytes: number; sha256: string }>,
): BundleIdentity[] {
  return BUNDLE_ROLES.map((role) => {
    const entry = bundles[role];
    if (!entry) throw new Error(`runtime evidence is missing the ${role} bundle identity`);
    return { role, bytes: entry.bytes, sha256: entry.sha256 };
  });
}

/**
 * The semantic projection of a runtime evidence report.
 *
 * Diagnostic filenames and raw URLs become canonical binding tokens. A renamed bundle then keeps the approval.
 * A byte identity, probe case, or observation change invalidates the approval.
 */
export function normalizeRuntimeEvidenceForApproval(
  evidence: RuntimeEvidenceInput,
  normalizedResults: NormalizedProbeResult[],
): CanonicalJson {
  if (evidence.schemaVersion !== 2) {
    throw new Error(`runtime evidence schema version 2 required, found ${String(evidence.schemaVersion)}`);
  }
  if (!evidence.runtimeBundles) {
    throw new Error("runtime evidence without runtime bundle identities cannot be approved");
  }
  return {
    schemaVersion: 2,
    buildId: evidence.buildId,
    ranAt: evidence.ranAt,
    extractedBundles: identities(evidence.extractedBundles) as unknown as CanonicalJson,
    runtimeBundles: identities(evidence.runtimeBundles) as unknown as CanonicalJson,
    probeRuntimeSha256: evidence.probeRuntimeSha256,
    mechanicsSourceApprovalSha256: evidence.mechanicsSourceApprovalSha256,
    runtimeVersions: { ...evidence.runtimeVersions },
    platformArtifacts: [...evidence.platformArtifacts]
      .map((entry) => ({ role: entry.role, sha256: entry.sha256 }))
      .sort((left, right) => (left.role < right.role ? -1 : left.role > right.role ? 1 : 0)),
    externalLeafCoverage: [...evidence.externalLeafCoverage]
      .map((entry) => ({ id: entry.id, status: entry.status }))
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
    mechanics: evidence.mechanics.map((entry) => ({
      id: entry.id,
      requiredProbes: entry.requiredProbes,
      passedProbes: entry.passedProbes,
    })),
    results: normalizedResults as unknown as CanonicalJson,
  };
}

export type MechanicsApprovalInput = {
  buildId: string;
  bundles: BundleIdentity[];
  evidenceRanAt: string;
  evidenceSha256: string;
  externalLeafEvidenceSha256: string;
  contractFixtureSha256: string;
  mechanicsSourceApprovalSha256: string;
  approvalGateSha256: string;
  derivationExecutorSha256: string;
  probeExecutorSha256: string;
  probeRuntimeSha256: string;
  inspectorSha256: string;
  probeContracts: PublicProbeContract[];
  documents: { id: string; modelSha256: string; verifiedProbes: CanonicalJson }[];
};

/**
 * The canonical `approval` object published inside `mechanics.json`.
 *
 * This object is the complete claim in one hashable shape. It contains the build, bytes, evidence, reviewed source closures, probe contracts, and document models.
 * A visitor recomputes this hash in the browser. If it differs from `approvalSha256`, the page cannot show an approval label.
 */
export function mechanicsApprovalPreimage(input: MechanicsApprovalInput): CanonicalJson {
  return {
    buildId: input.buildId,
    bundles: input.bundles as unknown as CanonicalJson,
    evidenceRanAt: input.evidenceRanAt,
    evidenceSha256: input.evidenceSha256,
    externalLeafEvidenceSha256: input.externalLeafEvidenceSha256,
    contractFixtureSha256: input.contractFixtureSha256,
    mechanicsSourceApprovalSha256: input.mechanicsSourceApprovalSha256,
    approvalGateSha256: input.approvalGateSha256,
    derivationExecutorSha256: input.derivationExecutorSha256,
    probeExecutorSha256: input.probeExecutorSha256,
    probeRuntimeSha256: input.probeRuntimeSha256,
    inspectorSha256: input.inspectorSha256,
    probeContracts: input.probeContracts as unknown as CanonicalJson,
    documents: input.documents as unknown as CanonicalJson,
  };
}

/** Removes one member without mutating the input, for hashes that omit their own field. */
export function withoutMember<T extends Record<string, unknown>>(value: T, member: keyof T & string): CanonicalJson {
  const copy: Record<string, unknown> = { ...value };
  delete copy[member];
  return copy as CanonicalJson;
}
