/**
 * The reviewed hash of the harness runtime-transport source closure.
 *
 * The harness writes this value as `probeRuntimeSha256` in every evidence report.
 * The pipeline compares the report, mechanics lock, and this constant.
 * A mismatch changes every document model because the lock approves one complete evidence object, not a per-document slice.
 */
export const PROBE_RUNTIME_SHA256 =
  "fa27c0487f1e9438e407a2415f0c8652c9d41d6dd781ce361a01b16db9008ad0";
