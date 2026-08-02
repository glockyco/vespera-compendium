/**
 * The reviewed hash of the probe-executor source closure.
 *
 * Each probe contract hash is `hash({ executorSha256, contractWithoutHashes })`, so this constant is
 * computed first and neither preimage contains its own output. Changing execution logic, a case, or an
 * expectation therefore changes every affected contract hash and makes older evidence ineligible.
 */
export const MECHANIC_PROBE_EXECUTOR_SHA256 =
  "645e904a795117373c91986161d534c29653890ff6c6d258043057d4ec470d0d";
