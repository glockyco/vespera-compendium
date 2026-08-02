/**
 * The reviewed hash of the probe-executor source closure.
 *
 * Each probe contract hash is `hash({ executorSha256, contractWithoutHashes })`.
 * This constant is computed first, so neither preimage contains its own output.
 * A change to execution logic, a case, or an expectation changes every affected contract hash and makes old evidence ineligible.
 */
export const MECHANIC_PROBE_EXECUTOR_SHA256 =
  "1707587f161410cc0d50699ff045faedaf92b5c8741268262a52ae93318bfe8f";
