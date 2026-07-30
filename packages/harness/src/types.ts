export type ProbeStatus = "PASS" | "FAIL" | "SKIPPED" | "UNRESOLVED";

export type ProbeResult = {
  buildId: string;
  id: string;
  suite: string;
  status: ProbeStatus;
  category?: string;
  detail: string;
  observed?: unknown;
  expected?: unknown;
};
