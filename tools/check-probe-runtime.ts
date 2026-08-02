import {
  EXECUTION_SOURCE_SELF_TOKENS,
  MECHANIC_RUNTIME_ROOTS,
  SOURCE_CLOSURE_DECLARED_LEAVES,
  PROBE_RUNTIME_SHA256,
  hashSourceClosure,
} from "@vespera/core";

export function checkProbeRuntime(workspaceRoot: string, expectedSha = PROBE_RUNTIME_SHA256): string {
  const closure = hashSourceClosure(workspaceRoot, MECHANIC_RUNTIME_ROOTS, {
    closure: "runtime",
    selfTokens: EXECUTION_SOURCE_SELF_TOKENS,
    declaredLeafTokens: SOURCE_CLOSURE_DECLARED_LEAVES.runtime,
  });
  if (closure.sha256 !== expectedSha) {
    throw new Error(`probe runtime source hash mismatch: expected ${expectedSha}, actual ${closure.sha256}`);
  }
  return closure.sha256;
}

if (import.meta.main) {
  const workspaceRoot = process.argv[2] ?? process.cwd();
  console.log(checkProbeRuntime(workspaceRoot));
}
