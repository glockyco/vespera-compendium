import { verify } from "./verify.ts";

const [command = "verify", dir = "extracted"] = process.argv.slice(2);
if (command !== "verify") throw new Error(`unsupported pipeline command: ${command}`);
const checks = verify(dir);
for (const check of checks) console.log(`${check.status} ${check.id}: ${check.detail}`);
if (checks.some((check) => check.status === "FAIL")) process.exitCode = 1;
