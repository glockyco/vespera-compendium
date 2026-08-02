import {
  CANONICAL_BRIDGE_SUFFIX_SHA256,
  MECHANIC_PROBE_CONTRACTS,
  MECHANIC_PROBE_SUITE,
  materializeProbeArguments,
  runMechanicProbeContract,
  skippedMechanicProbeExecution,
  sha256Hex,
  type BundleRole,
  type CanonicalJson,
  type MechanicProbeContract,
  type MechanicProbeExecution,
  type MechanicProbeExecutionCase,
} from "@vespera/core";
import type {
  CdpClient,
  CdpFunctionLocation,
  CdpPropertyDescriptor,
  CdpRemoteObject,
  CdpScriptParsed,
} from "../cdp.ts";
import type { ProbeResult } from "../types.ts";

export type RuntimeResource = {
  url: string;
  bytes: Uint8Array;
  sha256?: string;
};

export type RuntimeBinding = {
  objectId: string;
  kind: "function" | "method";
  methodName: string | null;
  scriptId: string;
  resourceUrl: string;
  moduleSha256: string;
  cleanResourceUrl?: string;
  cleanModuleSha256?: string;
  servedResourceUrl?: string;
  servedResourceSha256?: string;
  bridgeSuffixSha256?: string;
};

export type RuntimeResolverContext = {
  indexBundle?: string;
  /**
   * The exact URL that the runtime served for the index module.
   *
   * A reconstructed `./assets/<file>` path creates a second script for the same module. Its script ID maps to no Network response, so the byte binding fails.
   * The captured URL keeps the resolved function on the response that the harness observed.
   */
  indexResourceUrl?: string;
  resources?: readonly RuntimeResource[];
  scripts?: readonly CdpScriptParsed[];
  cleanResources?: readonly RuntimeResource[];
  cleanResourceUrl?: string;
  cleanModuleSha256?: string;
  servedResourceUrl?: string;
  servedResourceSha256?: string;
  bridgeSuffixSha256?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function canonicalValue(value: unknown): CanonicalJson {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("runtime returned a non-finite number");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (isRecord(value)) {
    const result: { [key: string]: CanonicalJson } = {};
    for (const [key, entry] of Object.entries(value)) result[key] = canonicalValue(entry);
    return result;
  }
  throw new Error(`runtime returned unsupported ${typeof value}`);
}

function remoteObject(value: unknown): CdpRemoteObject {
  if (!isRecord(value)) throw new Error("CDP did not return a remote object");
  const outer = value.result;
  const nested = isRecord(outer) && isRecord(outer.result) ? outer.result : outer;
  if (isRecord(nested) && (nested.objectId !== undefined || nested.type !== undefined || nested.value !== undefined)) {
    return nested as CdpRemoteObject;
  }
  return value as CdpRemoteObject;
}

function locationFromProperties(properties: readonly CdpPropertyDescriptor[]): CdpFunctionLocation {
  const descriptor = properties.find((property) => property.name === "[[FunctionLocation]]");
  const value = descriptor?.value;
  if (!value || !isRecord(value.value)) throw new Error("runtime function has no [[FunctionLocation]]");
  const location = value.value;
  const scriptId = location.scriptId;
  if (typeof scriptId !== "string") throw new Error("runtime function location has no scriptId");
  return {
    scriptId,
    lineNumber: typeof location.lineNumber === "number" ? location.lineNumber : undefined,
    columnNumber: typeof location.columnNumber === "number" ? location.columnNumber : undefined,
  };
}

function clientResources(client: CdpClient, context: RuntimeResolverContext): readonly RuntimeResource[] {
  if (context.resources) return context.resources;
  const captured = client.getNetworkResponses?.() ?? [];
  return captured.flatMap((resource) => {
    if (!resource.body || resource.base64Encoded === undefined) return [];
    const bytes = resource.base64Encoded
      ? Uint8Array.from(atob(resource.body), (character) => character.charCodeAt(0))
      : new TextEncoder().encode(resource.body);
    return [{ url: resource.url, bytes, sha256: resourceHash(bytes) }];
  });
}

function resourceHash(bytes: Uint8Array): string {
  return sha256Hex(bytes);
}

function scriptRecords(client: CdpClient, context: RuntimeResolverContext): readonly CdpScriptParsed[] {
  return context.scripts ?? client.getScriptsParsed?.() ?? [];
}

function resolveResource(
  client: CdpClient,
  objectId: string,
  context: RuntimeResolverContext,
): Promise<{ location: CdpFunctionLocation; resource: RuntimeResource }> {
  return client.getProperties(objectId).then((properties) => {
    const location = locationFromProperties(properties);
    const scripts = scriptRecords(client, context).filter((script) => script.scriptId === location.scriptId);
    if (scripts.length !== 1) {
      throw new Error(`scriptId ${location.scriptId} resolved to ${scripts.length} Debugger.scriptParsed records`);
    }
    const resources = clientResources(client, context).filter((resource) => resource.url === scripts[0]!.url);
    if (resources.length !== 1) {
      throw new Error(`script URL ${scripts[0]!.url} resolved to ${resources.length} final Network responses`);
    }
    return { location, resource: resources[0]! };
  });
}

async function evaluateFunction(client: CdpClient, expression: string): Promise<string> {
  const response = await client.send<unknown>("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: false,
  });
  const object = remoteObject(response);
  if (typeof object.objectId !== "string") throw new Error("runtime expression did not return an objectId");
  return object.objectId;
}

function descriptorObjectId(properties: readonly CdpPropertyDescriptor[], name: string): string {
  const descriptor = properties.find((property) => property.name === name);
  const objectId = descriptor?.value?.objectId;
  if (typeof objectId !== "string") throw new Error(`runtime property ${name} has no objectId`);
  return objectId;
}
function resourceMetadata(
  client: CdpClient,
  objectId: string,
  context: RuntimeResolverContext,
): Promise<{ objectId: string; location: CdpFunctionLocation; resource: RuntimeResource }> {
  return resolveResource(client, objectId, context).then(({ location, resource }) => ({
    objectId,
    location,
    resource,
  }));
}

function moduleExpression(indexBundle: string, body: string, resourceUrl?: string): string {
  const modulePath = JSON.stringify(resourceUrl ?? `./assets/${indexBundle}`);
  return `(async () => { const namespace = await import(new URL(${modulePath}, location.href).href); ${body} })()`;
}

export async function resolveSellRuntimeBinding(
  client: CdpClient,
  indexBundleOrContext: string | RuntimeResolverContext,
  resourceContext?: RuntimeResolverContext,
): Promise<RuntimeBinding> {
  const context = typeof indexBundleOrContext === "string"
    ? { ...(resourceContext ?? {}), indexBundle: indexBundleOrContext }
    : indexBundleOrContext;
  if (!context.indexBundle) throw new Error("index bundle is required to resolve sell runtime binding");
  const objectId = await evaluateFunction(
    client,
    moduleExpression(context.indexBundle, "return namespace.getItemSellValue;", context.indexResourceUrl),
  );
  const metadata = await resourceMetadata(client, objectId, context);
  return {
    objectId,
    kind: "function",
    methodName: null,
    scriptId: metadata.location.scriptId!,
    resourceUrl: metadata.resource.url,
    moduleSha256: metadata.resource.sha256 ?? resourceHash(metadata.resource.bytes),
  };
}

export async function resolveXpRuntimeBinding(
  client: CdpClient,
  indexBundleOrContext: string | RuntimeResolverContext,
  resourceContext?: RuntimeResolverContext,
): Promise<RuntimeBinding> {
  const context = typeof indexBundleOrContext === "string"
    ? { ...(resourceContext ?? {}), indexBundle: indexBundleOrContext }
    : indexBundleOrContext;
  if (!context.indexBundle) throw new Error("index bundle is required to resolve XP runtime binding");
  const pairId = await evaluateFunction(
    client,
    moduleExpression(
      context.indexBundle,
      "const owner = Object.values(namespace).find((value) => value !== null && (typeof value === 'object' || typeof value === 'function') && typeof value.calculateXpGain === 'function'); if (!owner) throw new Error('calculateXpGain owner not found'); return { owner, method: owner.calculateXpGain };",
      context.indexResourceUrl,
    ),
  );
  const pairProperties = await client.getProperties(pairId);
  const ownerObjectId = descriptorObjectId(pairProperties, "owner");
  const methodObjectId = descriptorObjectId(pairProperties, "method");
  const metadata = await resourceMetadata(client, methodObjectId, context);
  return {
    objectId: ownerObjectId,
    kind: "method",
    methodName: "calculateXpGain",
    scriptId: metadata.location.scriptId!,
    resourceUrl: metadata.resource.url,
    moduleSha256: metadata.resource.sha256 ?? resourceHash(metadata.resource.bytes),
  };
}

export async function resolveDefenseRuntimeBinding(
  client: CdpClient,
  context: RuntimeResolverContext = {},
): Promise<RuntimeBinding> {
  const objectId = await evaluateFunction(
    client,
    "globalThis.__VESPERA_DEFENSE_BRIDGE__",
  );
  const metadata = await resourceMetadata(client, objectId, context);
  if (!context.cleanResourceUrl || !context.cleanModuleSha256) {
    throw new Error("clean Defense resource metadata is required");
  }
  if (metadata.resource.sha256 && metadata.resource.sha256 !== context.servedResourceSha256) {
    throw new Error("served Defense resource hash does not match bridge metadata");
  }
  if (context.bridgeSuffixSha256 !== CANONICAL_BRIDGE_SUFFIX_SHA256) {
    throw new Error("Defense bridge suffix is not canonical");
  }
  return {
    objectId,
    kind: "function",
    methodName: null,
    scriptId: metadata.location.scriptId!,
    resourceUrl: metadata.resource.url,
    moduleSha256: metadata.resource.sha256 ?? resourceHash(metadata.resource.bytes),
    cleanResourceUrl: context.cleanResourceUrl,
    cleanModuleSha256: context.cleanModuleSha256,
    servedResourceUrl: context.servedResourceUrl,
    servedResourceSha256: context.servedResourceSha256,
    bridgeSuffixSha256: context.bridgeSuffixSha256,
  };
}

/**
 * Calls the resolved runtime function with the contract's argument shape.
 *
 * The arguments come from the hashed `argumentTemplate`, not from this module's idea of the signature.
 * A flat input makes `Number({defense: 100}) || 0` return zero. The probe then records a formula that never ran.
 */
export async function invokeRuntimeBinding(
  client: CdpClient,
  binding: RuntimeBinding,
  input: CanonicalJson,
  argumentTemplate: readonly CanonicalJson[],
  timeoutMs = 120_000,
): Promise<CanonicalJson> {
  const materialized = materializeProbeArguments(argumentTemplate, input);
  const parameters = materialized.map((_value, index) => `a${index}`).join(", ");
  const functionDeclaration =
    binding.kind === "method"
      ? `function(${parameters}) { return this[${JSON.stringify(binding.methodName)}](${parameters}); }`
      : `function(${parameters}) { return this(${parameters}); }`;
  const observed = await client.callFunctionOn(
    binding.objectId,
    functionDeclaration,
    materialized.map((value) => ({ value })),
    timeoutMs,
  );
  return canonicalValue(observed);
}

function resolverForContract(
  contract: MechanicProbeContract,
  client: CdpClient,
  context: RuntimeResolverContext,
): Promise<RuntimeBinding> {
  if (contract.id === "xpGainMultiplier") return resolveXpRuntimeBinding(client, context);
  if (contract.id === "sellValueRarityMultipliers") return resolveSellRuntimeBinding(client, context);
  return resolveDefenseRuntimeBinding(client, context);
}

function resultFromExecution(
  buildId: string,
  contract: MechanicProbeContract,
  execution: MechanicProbeExecution,
  binding?: RuntimeBinding,
): ProbeResult {
  const result: ProbeResult = {
    buildId,
    id: contract.id,
    suite: MECHANIC_PROBE_SUITE,
    status: execution.status,
    category: contract.category,
    detail: execution.detail,
    contractSha256: contract.contractSha256,
    cases: execution.cases,
  };
  if (!binding) return result;
  result.resolver = binding.kind;
  result.bundle = contract.bundle;
  result.scriptId = binding.scriptId;
  result.boundModuleSha256 = binding.moduleSha256;
  if (contract.id === "mitigationCap" || contract.id === "mitigationLevelClamp") {
    result.cleanResourceUrl = binding.cleanResourceUrl;
    result.cleanModuleSha256 = binding.cleanModuleSha256;
    result.servedResourceUrl = binding.servedResourceUrl;
    result.servedResourceSha256 = binding.servedResourceSha256;
    result.bridgeSuffixSha256 = binding.bridgeSuffixSha256;
  } else {
    result.invocationResourceUrl = binding.resourceUrl;
  }
  return result;
}

export async function runFormulaProbes(
  buildId: string,
  client: CdpClient,
  context: RuntimeResolverContext,
  onlyIds?: readonly string[],
): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  const selected = onlyIds ? new Set(onlyIds) : null;
  for (const contract of MECHANIC_PROBE_CONTRACTS) {
    if (selected && !selected.has(contract.id)) continue;
    try {
      const binding = await resolverForContract(contract, client, context);
      const execution = await runMechanicProbeContract(contract, (input) =>
        invokeRuntimeBinding(client, binding, input, contract.argumentTemplate),
      );
      results.push(resultFromExecution(buildId, contract, execution, binding));
    } catch (error) {
      const execution: MechanicExecution = {
        ...skippedMechanicProbeExecution(contract, error instanceof Error ? error.message : String(error)),
        status: "FAIL",
      };
      results.push(resultFromExecution(buildId, contract, execution));
    }
  }
  return results;
}

type MechanicExecution = MechanicProbeExecution;

export function skippedFormulaResults(buildId: string, reason: string): ProbeResult[] {
  return MECHANIC_PROBE_CONTRACTS.map((contract) =>
    resultFromExecution(buildId, contract, {
      ...skippedMechanicProbeExecution(contract, reason),
      status: "FAIL",
    }),
  ).map((result) => ({ ...result, status: "SKIPPED" as const }));
}

export function formulaContractIds(): readonly string[] {
  return MECHANIC_PROBE_CONTRACTS.map((contract) => contract.id);
}

export function formulaResultCases(result: ProbeResult): readonly MechanicProbeExecutionCase[] {
  return result.cases ?? [];
}

export function formulaBundleRole(result: ProbeResult): BundleRole | null {
  return result.bundle ?? null;
}
