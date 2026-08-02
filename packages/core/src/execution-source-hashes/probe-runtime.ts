/**
 * The reviewed hash of the harness runtime-transport source closure.
 *
 * The harness writes this value as `probeRuntimeSha256` in every evidence report.
 * The pipeline compares the report, mechanics lock, and this constant.
 * A mismatch changes every document model because the lock approves one complete evidence object, not a per-document slice.
 */
export const PROBE_RUNTIME_SHA256 =
  "cf8dc3a7a468e801108ac900508894a6595ceb35ea92379f3714a2a80bd3e5cb";
