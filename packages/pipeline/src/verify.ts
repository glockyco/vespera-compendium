import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { composeAll } from "./compose.ts";

export type VerificationCheck = {
  id: string;
  status: "PASS" | "FAIL" | "SKIPPED";
  detail: string;
};

function installedBuildId(): string {
  const manifest = path.join(
    os.homedir(),
    "Library/Application Support/CrossOver/Bottles/Steam/drive_c/Program Files (x86)/Steam/steamapps/appmanifest_4824420.acf",
  );
  const source = readFileSync(manifest, "utf8");
  const match = source.match(/"buildid"\s+"(\d+)"/);
  if (!match) throw new Error(`buildid not found in ${manifest}`);
  return match[1]!;
}

export function runtimeEvidenceCheck(buildId: string): VerificationCheck {
  const file = path.join("data", buildId, "runtime-evidence.json");
  if (!existsSync(file)) {
    return {
      id: "runtimeEvidence",
      status: "SKIPPED",
      detail: `no runtime evidence for build ${buildId}`,
    };
  }
  try {
    const evidence = JSON.parse(readFileSync(file, "utf8")) as {
      buildId?: unknown;
      results?: Array<{ status?: unknown }>;
    };
    const findings = Array.isArray(evidence.results)
      ? evidence.results.filter((result) => result.status === "FAIL" || result.status === "UNRESOLVED")
      : [];
    const valid = evidence.buildId === buildId && Array.isArray(evidence.results);
    return {
      id: "runtimeEvidence",
      status: valid && findings.length === 0 ? "PASS" : "FAIL",
      detail: valid
        ? `${findings.length} FAIL/UNRESOLVED runtime findings for build ${buildId}`
        : `invalid runtime evidence for build ${buildId}`,
    };
  } catch (error) {
    return {
      id: "runtimeEvidence",
      status: "FAIL",
      detail: `runtime evidence unreadable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function verify(extractedDir = "extracted"): VerificationCheck[] {
  const tables = composeAll(extractedDir);
  const checks: VerificationCheck[] = Object.entries(tables).map(([id, table]) => ({
    id,
    status: table.live > 0 ? "PASS" : "FAIL",
    detail: `base=${table.base} live=${table.live}`,
  }));
  let buildId: string;
  try {
    buildId = installedBuildId();
  } catch (error) {
    checks.push({
      id: "runtimeEvidence",
      status: "SKIPPED",
      detail: `build id unavailable: ${error instanceof Error ? error.message : String(error)}`,
    });
    return checks;
  }
  checks.push(runtimeEvidenceCheck(buildId));
  return checks;
}
