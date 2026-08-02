import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { checkInputCallers } from "./check-input-callers";

function fixture(): string {
  return mkdtempSync(path.join(os.tmpdir(), "vespera-input-callers-"));
}
function put(root: string, file: string, text: string): void {
  const target = path.join(root, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, text);
}

function codes(root: string): Set<string> {
  return new Set(checkInputCallers(root).map((item) => item.code));
}

describe("checkInputCallers", () => {
  test("rejects direct, aliased, wrapped, re-exported, and computed protected reads", () => {
    const root = fixture();
    try {
      put(root, "direct.ts", `import { readFileSync as load } from "node:fs";
const extractedDir = "extracted";
load(extractedDir + "/index.html");
const read = load;
read(path.join(extractedDir, "game.js"));
function readEvidence(evidencePath: string) { return load(evidencePath); }
readEvidence("evidence/report.json");
`);
      put(root, "reexport.ts", `export { readFileSync as load } from "node:fs";`);
      put(root, "use-reexport.ts", `import { load } from "./reexport"; load("mechanics.lock.json");`);
      const found = codes(root);
      expect(found.has("TAINTED_READ")).toBe(true);
      expect(found.has("TAINTED_WRAPPER_CALL")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("fails closed for unsupported executables, opaque scripts, and tainted pipeline calls", () => {
    const root = fixture();
    try {
      put(root, "unknown.sh", "#!/usr/bin/python3\ncat evidence/report.json\n");
      put(root, "package.json", JSON.stringify({ scripts: { check: "eval $CHECK", bad: "mystery-tool evidence/report.json" } }));
      put(root, "caller.ts", `import { fingerprintBundles } from "./pipeline";
export function run(extractedDir: string) { return fingerprintBundles(extractedDir); }
`);
      const found = codes(root);
      expect(found.has("UNSUPPORTED_EXECUTABLE")).toBe(true);
      expect(found.has("OPAQUE_COMMAND")).toBe(true);
      expect(found.has("UNRESOLVED_EXECUTABLE")).toBe(true);
      expect(found.has("TAINTED_PIPELINE_INPUT")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("allows prepared snapshot reads but rejects an argv path bypass", () => {
    const root = fixture();
    try {
      put(root, "prepared.ts", `import { readFileSync } from "node:fs"; import path from "node:path";
function readPrepared(prepared: { extractedSnapshotPath: string }) { return readFileSync(path.join(prepared.extractedSnapshotPath, "index.html")); }
function readUnprepared(pathName: string) { return readFileSync(pathName); }
const prepared = { extractedSnapshotPath: "/tmp/snapshot" }; readPrepared(prepared); readUnprepared(process.argv[2]!);
`);
      const found = checkInputCallers(root);
      expect(found.some((item) => item.code === "TAINTED_READ" && item.file === "prepared.ts")).toBe(true);
      expect(found.filter((item) => item.code === "TAINTED_READ").some((item) => item.line === 3)).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("limits the browser verifier to build reads and evidence writes", () => {
    const root = fixture();
    try {
      put(root, "tools/verify-site-browser.ts", `import { readFileSync, writeFileSync } from "node:fs";
function htmlFiles(buildRoot: string) { return readFileSync(buildRoot); }
function atomicWrite(file: string) { writeFileSync("/tmp/not-evidence.json", "bad"); }
`);
      put(root, "tools/other.ts", `import { readFileSync } from "node:fs"; export function read(path: string) { return readFileSync(path); } read("evidence/site-browser-checks.json");`);
      const found = checkInputCallers(root);
      expect(found.some((item) => item.code === "BROWSER_WRITE_DESTINATION")).toBe(true);
      expect(found.some((item) => item.file === "tools/other.ts" && item.code === "TAINTED_READ")).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  test("treats binary and generated inputs as inventory-only", () => {
    const root = fixture();
    try {
      mkdirSync(path.join(root, "extracted"), { recursive: true });
      writeFileSync(path.join(root, "extracted", "bad.ts"), "readFileSync('evidence/x')");
      writeFileSync(path.join(root, "blob.bin"), new Uint8Array([0, 159, 146, 150]));
      expect(checkInputCallers(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
