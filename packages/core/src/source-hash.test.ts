import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  canonicalSha256,
  canonicalSourceSlice,
  canonicalSourceText,
  diffSourceClosures,
  hashSourceClosure,
} from "./source-hash.ts";
import type { ClosureNodeRecord, SourceClosure } from "./source-hash.ts";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
  temporaryRoots.length = 0;
});

function workspace(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "vespera-source-hash-"));
  temporaryRoots.push(root);
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "synthetic-root", private: true, workspaces: ["packages/*"] }),
  );
  mkdirSync(path.join(root, "packages", "member"), { recursive: true });
  writeFileSync(
    path.join(root, "packages", "member", "package.json"),
    JSON.stringify({ name: "@synthetic/member", main: "src/index.ts" }),
  );
  writeFileSync(path.join(root, "bun.lock"), JSON.stringify({ lockfileVersion: 1 }));
  for (const [relative, source] of Object.entries(files)) {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, source);
  }
  return root;
}

function hashRoot(root: string, options: { selfTokens?: Readonly<Record<string, string>> } = {}) {
  return hashSourceClosure(
    root,
    [{ module: "src/root.ts", symbol: "root" }],
    { closure: "probeExecutor", ...options },
  );
}

function record(ordinal: number, nodeKind: string, canonicalSource: string): ClosureNodeRecord {
  return { ordinal, nodeKind, canonicalSource };
}
const REJECTION_CASES: { label: string; source: string; pattern: RegExp }[] = [
  {
    label: "computed namespace access",
    source: 'import * as ns from "./dep.ts"; export function root(key: string): number { return ns[key]; }',
    pattern: /computed access on namespace import/,
  },
  {
    label: "dynamic import",
    source: 'export async function root(): Promise<unknown> { return import("./dep.ts"); }',
    pattern: /dynamic import/,
  },
  {
    label: "require call",
    source: 'export function root(): unknown { return require("./dep.ts"); }',
    pattern: /require\(\)/,
  },
  { label: "unresolved free identifier", source: "export function root(): number { return missingValue; }", pattern: /unresolved free identifier/ },
  {
    label: "unreviewed platform symbol",
    source: 'import { notReviewed } from "node:crypto"; export function root(): number { return notReviewed; }',
    pattern: /notReviewed is not a reviewed leaf/,
  },
  {
    label: "unreviewed package",
    source: 'import { value } from "not-reviewed-package"; export function root(): number { return value; }',
    pattern: /not-reviewed-package is not a reviewed leaf/,
  },
];


describe("canonical source slices", () => {
  test("normalizes CRLF and per-line trailing spaces without outer trimming", () => {
    const source = "  first \t\r\nsecond \t  \r\n  third  \n";
    expect(canonicalSourceText(source, 0, source.length)).toBe("  first\nsecond\n  third\n");
    expect([...canonicalSourceSlice(source, 0, source.length)]).toEqual([
      ...new TextEncoder().encode("  first\nsecond\n  third\n"),
    ]);
  });

  test("rejects an out-of-range or inverted range", () => {
    expect(() => canonicalSourceSlice("abc", -1, 2)).toThrow(/invalid canonical source range/);
    expect(() => canonicalSourceSlice("abc", 2, 1)).toThrow(/invalid canonical source range/);
    expect(() => canonicalSourceSlice("abc", 0, 4)).toThrow(/exceeds/);
  });

  test("pins a canonical SHA-256 vector", () => {
    expect(canonicalSha256({ zulu: 1, alpha: { nested: true, Alpha: false }, "": null })).toBe(
      "2f7855956e266762745aabe72097dd9d2908f79e46c2a6ad38adc1e92e441b74",
    );
  });
});

describe("synthetic source closure resolution", () => {
  test("follows named and default imports in a workspace module", () => {
    const root = workspace({
      "src/root.ts": 'import make, { named } from "./dep.ts";\nexport function root(): number { return make() + named; }\n',
      "src/dep.ts": "export const named = 2;\nexport default function make(): number { return 3; }\n",
    });
    const closure = hashRoot(root);
    expect(Object.keys(closure.modules)).toEqual(["src/dep.ts", "src/root.ts"]);
    expect(closure.entries).toEqual([{ module: "src/root.ts", symbol: "root" }]);
    expect(closure.modules["src/dep.ts"]!.map((node) => node.nodeKind)).toEqual([
      "FirstStatement",
      "FunctionDeclaration",
    ]);
  });

  test("follows a static namespace property access", () => {
    const root = workspace({
      "src/root.ts": 'import * as ns from "./dep.ts";\nexport function root(): number { return ns.named; }\n',
      "src/dep.ts": "export const named = 7;\n",
    });
    expect(Object.keys(hashRoot(root).modules)).toEqual(["src/dep.ts", "src/root.ts"]);
  });

  test("includes a side-effect import and detects initializer-only changes", () => {
    const root = workspace({
      "src/root.ts": 'import "./side-effect.ts";\nimport { multiplier } from "./state.ts";\nexport function root(): number { return multiplier; }\n',
      "src/side-effect.ts": "export const registration = 1;\n",
      "src/state.ts": "export const multiplier = 2;\n",
    });
    const before = hashRoot(root);
    expect(Object.keys(before.modules)).toContain("src/side-effect.ts");
    writeFileSync(path.join(root, "src", "state.ts"), "export const multiplier = 99;\n");
    const after = hashRoot(root);
    expect(after.sha256).not.toBe(before.sha256);
    expect(after.modules["src/state.ts"]?.[0]?.canonicalSource).toContain("99");
  });

  test("retains overload declarations and implementation in the module closure", () => {
    const root = workspace({
      "src/root.ts": "export function overloaded(value: string): string;\nexport function overloaded(value: number): number;\nexport function overloaded(value: string | number): string | number { return value; }\nexport function root(): number { return overloaded(1); }\n",
    });
    const closure = hashRoot(root);
    const sources = closure.modules["src/root.ts"]!.map((node) => node.canonicalSource);
    expect(sources.filter((source) => source.includes("overloaded")).length).toBe(4);
    expect(sources.some((source) => source.includes("return value"))).toBe(true);
  });

  test("excludes type-only imports and declarations", () => {
    const root = workspace({
      "src/root.ts": 'import type { Shape } from "./types.ts";\ninterface Local { value: number }\nexport function root(): number { const shape: Shape = { value: 4 }; return shape.value; }\n',
      "src/types.ts": "export interface Shape { value: number }\nexport type Alias = Shape;\n",
    });
    const closure = hashRoot(root);
    expect(Object.keys(closure.modules)).toEqual(["src/root.ts"]);
    expect(closure.modules["src/root.ts"]!.every((node) => !node.canonicalSource.includes("interface Local"))).toBe(true);
  });

  test("emits reviewed external leaf tokens", () => {
    const root = workspace({
      "src/root.ts": 'import { createHash } from "node:crypto";\nexport function root(): number { return createHash("sha256").digest().byteLength; }\n',
    });
    const closure = hashRoot(root);
    expect(closure.externalTokens).toContain("node:crypto#createHash");
  });

  test("substitutes a declared self-token module without hashing its nodes", () => {
    const root = workspace({
      "src/root.ts": 'import { approved } from "./approval.ts";\nexport function root(): string { return approved; }\n',
      "src/approval.ts": 'export const approved = "old-value";\n',
    });
    const options = { selfTokens: { "src/approval.ts": "<SELF_APPROVAL>" } };
    const before = hashRoot(root, options);
    expect(before.selfTokens).toEqual(["<SELF_APPROVAL>"]);
    expect(before.modules).not.toHaveProperty("src/approval.ts");
    writeFileSync(path.join(root, "src", "approval.ts"), 'export const approved = "new-value";\n');
    const after = hashRoot(root, options);
    expect(after.sha256).toBe(before.sha256);
  });

  for (const fixture of REJECTION_CASES) {
    test(`rejects ${fixture.label}`, () => {
      const root = workspace({
        "src/root.ts": fixture.source,
        "src/dep.ts": "export const value = 1;\n",
      });
      expect(() => hashRoot(root)).toThrow(fixture.pattern);
    });
  }


  test("rejects a relative module outside the workspace root", () => {
    const root = workspace({ "src/root.ts": 'import { outside } from "../../outside.ts"; export function root(): number { return outside; }' });
    writeFileSync(path.join(path.dirname(root), "outside.ts"), "export const outside = 1;\n");
    expect(() => hashRoot(root)).toThrow(/outside the workspace root/);
    rmSync(path.join(path.dirname(root), "outside.ts"), { force: true });
  });
});

describe("source closure diffs", () => {
  test("reports added, removed, and changed nodes as fixed entries", () => {
    const approved: Omit<SourceClosure, "sha256"> = {
      entries: [{ module: "src/root.ts", symbol: "root" }],
      modules: {
        "src/changed.ts": [record(0, "VariableStatement", "const value = 1;")],
        "src/removed.ts": [record(0, "ExpressionStatement", "register();")],
      },
      externalTokens: [],
      selfTokens: [],
      packageLeaves: [],
    };
    const candidate: Omit<SourceClosure, "sha256"> = {
      entries: [{ module: "src/root.ts", symbol: "root" }],
      modules: {
        "src/added.ts": [record(0, "FunctionDeclaration", "function added() {}")],
        "src/changed.ts": [record(0, "VariableStatement", "const value = 2;")],
      },
      externalTokens: [],
      selfTokens: [],
      packageLeaves: [],
    };
    expect(diffSourceClosures(approved, candidate)).toEqual([
      {
        field: "modules.src/added.ts[0]",
        kind: "added",
        approved: null,
        candidate: "function added() {}",
      },
      {
        field: "modules.src/changed.ts[0]",
        kind: "changed",
        approved: "const value = 1;",
        candidate: "const value = 2;",
      },
      {
        field: "modules.src/removed.ts[0]",
        kind: "removed",
        approved: "register();",
        candidate: null,
      },
    ]);
  });
});
