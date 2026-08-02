/**
 * The reviewed hash of the derivation-executor source closure.
 *
 * Covers `evaluateMechanicDerivation`, its formatter and template helpers, the core composition
 * evaluator, and the gear-balance evaluator. Every published `MechanicDerivation` carries this value,
 * so changing how a shipped function is executed or formatted makes older models ineligible before
 * they can be republished.
 */
export const MECHANIC_DERIVATION_EXECUTOR_SHA256 =
  "78a3ce686678be8b8bca37c9d8687c8a71cf2f2b19dd1f1e296efadd2ca53967";
