/**
 * The reviewed hash of the harness runtime-transport source closure.
 *
 * The harness writes this value into every evidence report as `probeRuntimeSha256`, and the pipeline
 * compares the report, the mechanics lock, and this constant. A mismatch is a model change for every
 * document, because the lock approves one complete evidence object rather than a per-document slice.
 */
export const PROBE_RUNTIME_SHA256 =
  "88520cc9f5cc9cf212f222e7a28571336a45c674ac23b7a56d52336e5da89a1f";
