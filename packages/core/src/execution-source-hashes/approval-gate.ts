/**
 * The reviewed hash of the approval-gate source closure.
 *
 * This module holds one constant and nothing else. Every closure that reaches it serializes the fixed
 * token `<APPROVAL_GATE_SELF>` instead of this value, which is what makes the constant's own hash
 * reachable a fixed point: setting the constant to the reviewed candidate does not change the
 * candidate again.
 *
 * Updating it by hand does not approve anything. `mechanics-sources:sync` requires the fresh
 * candidate, this constant, and `mechanics-source.lock.json` to agree, so an edit here without a
 * reviewed diff simply moves the failure.
 */
export const MECHANICS_APPROVAL_GATE_SHA256 =
  "1ff5794df5a6d78ce7d65f07cbd22e86d4e910e6db6fb1168421562e94acf32f";
