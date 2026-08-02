/**
 * The reviewed hash of the approval-gate source closure.
 *
 * This module holds one constant. Every closure that reaches it serializes `<APPROVAL_GATE_SELF>` instead of this value.
 * The token lets the constant's own hash reach a fixed point. Setting the constant to the reviewed candidate does not change the candidate again.
 *
 * A manual update does not grant approval. `mechanics-sources:sync` requires the fresh candidate, this constant, and `mechanics-source.lock.json` to match.
 * An edit without a reviewed diff only moves the failure.
 */
export const MECHANICS_APPROVAL_GATE_SHA256 =
  "6bd9b97ecd9762ff28860021e6f30218f32818afeefb4823718b171d8bae5f23";
