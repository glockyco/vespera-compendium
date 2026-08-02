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
  "78bc0cf4ad0630a24a301ae6c710180b68b693d141088802980901f88ed9deb0";
