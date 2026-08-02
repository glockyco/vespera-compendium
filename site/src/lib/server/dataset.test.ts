import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "bun:test";

/**
 * Exercises the published-snapshot capability.
 *
 * A build reads one checked tree. Each case runs in its own process.
 * The module accepts one capability per process, so shared module state cannot hide a rejection.
 */

const HERE = path.dirname(new URL(import.meta.url).pathname);
const DATASET = path.join(HERE, "dataset.ts");

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const MANIFEST = {
  schemaVersion: 3,
  buildId: "24503450",
  generatedAt: "2026-08-01T08:38:45.657Z",
  sqlite: "vespera.sqlite",
  mechanics: "mechanics.json",
  mechanicCount: 5,
  mechanicsApprovalSha256: "a".repeat(64),
  images: {
    canonicalRoot: "images",
    canonicalCount: 2,
    variantIndex: "images/variants.json",
    variantCount: 4,
    configSha256: "b".repeat(64),
    variants: { thumb: 64, card: 192, portrait: 384, wide: 640, hero: 1280 },
  },
  tables: [
    {
      name: "items",
      slug: "items",
      kind: "entity",
      rows: 1,
      primaryKey: ["id"],
      columns: [{ name: "id", type: "text" }],
      json: "items.json",
      csv: "items.csv",
    },
  ],
};

function snapshot(): { root: string; manifestSha256: string } {
  const root = mkdtempSync(path.join(tmpdir(), "vespera-dataset-"));
  roots.push(root);
  const bytes = Buffer.from(`${JSON.stringify(MANIFEST)}\n`);
  writeFileSync(path.join(root, "index.json"), bytes);
  writeFileSync(path.join(root, "items.json"), JSON.stringify([{ id: "ember_shard" }]));
  mkdirSync(path.join(root, "images"), { recursive: true });
  writeFileSync(path.join(root, "images", "secret.json"), JSON.stringify({ nested: true }));
  return { root, manifestSha256: createHash("sha256").update(bytes).digest("hex") };
}

function capabilityFor(root: string, manifestSha256: string): string {
  return JSON.stringify({ buildToken: randomBytes(24).toString("hex"), manifestSha256, root, version: 1 });
}

/** Runs one snippet against `dataset.ts` in a fresh process with the given environment. */
async function run(
  body: string,
  env: Record<string, string | undefined>,
): Promise<{ ok: boolean; out: string }> {
  // Use a dynamic import in the child to create a fresh module registry.
  // A static import shares the one-capability process state.
  const source = `
    const dataset = await import(${JSON.stringify(DATASET)});
    const out = await (async () => { ${body} })();
    console.log(JSON.stringify(out));
  `;
  const child = Bun.spawn(["bun", "-e", source], {
    env: { ...process.env, VESPERA_DATA_SNAPSHOT: undefined, VESPERA_DATA_SNAPSHOT_CAPABILITY: undefined, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { ok: code === 0, out: code === 0 ? stdout.trim() : stderr };
}

describe("published snapshot capability", () => {
  test("serves reads from the snapshot the wrapper verified", async () => {
    const { root, manifestSha256 } = snapshot();
    const result = await run("return dataset.manifest().buildId;", {
      VESPERA_DATA_SNAPSHOT: root,
      VESPERA_DATA_SNAPSHOT_CAPABILITY: capabilityFor(root, manifestSha256),
    });
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.out)).toBe("24503450");
  });

  test("reads a table from the snapshot rather than site/static/data", async () => {
    const { root, manifestSha256 } = snapshot();
    const result = await run("return dataset.table('items')[0].id;", {
      VESPERA_DATA_SNAPSHOT: root,
      VESPERA_DATA_SNAPSHOT_CAPABILITY: capabilityFor(root, manifestSha256),
    });
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.out)).toBe("ember_shard");
  });

  test("a snapshot root without a capability is a hard error", async () => {
    const { root } = snapshot();
    const result = await run("return dataset.manifest().buildId;", { VESPERA_DATA_SNAPSHOT: root });
    expect(result.ok).toBe(false);
    expect(result.out).toContain("VESPERA_DATA_SNAPSHOT is set without");
  });

  test("a capability naming another directory is rejected", async () => {
    const first = snapshot();
    const second = snapshot();
    const result = await run("return dataset.manifest().buildId;", {
      VESPERA_DATA_SNAPSHOT: first.root,
      VESPERA_DATA_SNAPSHOT_CAPABILITY: capabilityFor(second.root, second.manifestSha256),
    });
    expect(result.ok).toBe(false);
    expect(result.out).toContain("must equal");
  });

  test("a manifest that changed under the build is detected at the first read", async () => {
    const { root, manifestSha256 } = snapshot();
    const capability = capabilityFor(root, manifestSha256);
    writeFileSync(path.join(root, "index.json"), `${JSON.stringify({ ...MANIFEST, buildId: "24503451" })}\n`);
    const result = await run("return dataset.manifest().buildId;", {
      VESPERA_DATA_SNAPSHOT: root,
      VESPERA_DATA_SNAPSHOT_CAPABILITY: capability,
    });
    expect(result.ok).toBe(false);
    expect(result.out).toContain("changed under the build");
  });

  test("a second, different capability is refused", async () => {
    const first = snapshot();
    const second = snapshot();
    const result = await run(
      `dataset.manifest();
       try {
         dataset.readPublishedSnapshotFile(${JSON.stringify(JSON.parse(capabilityFor(second.root, second.manifestSha256)))}, 'index.json');
         return 'accepted';
       } catch (error) { return String(error.message); }`,
      {
        VESPERA_DATA_SNAPSHOT: first.root,
        VESPERA_DATA_SNAPSHOT_CAPABILITY: capabilityFor(first.root, first.manifestSha256),
      },
    );
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.out)).toContain("a second published snapshot capability");
  });

  test("refuses a malformed or under-specified capability", async () => {
    const { root, manifestSha256 } = snapshot();
    const cases: [string, string][] = [
      ["{not json", "is not JSON"],
      [JSON.stringify({ buildToken: "x".repeat(48), manifestSha256, root, version: 2 }), "version must be 1"],
      [JSON.stringify({ buildToken: "x".repeat(48), manifestSha256, root: "data", version: 1 }), "absolute path"],
      [JSON.stringify({ buildToken: "x".repeat(48), manifestSha256: "nope", root, version: 1 }), "hex digest"],
      [JSON.stringify({ buildToken: "short", manifestSha256, root, version: 1 }), "at least 32 characters"],
    ];
    for (const [capability, expected] of cases) {
      const result = await run("return dataset.manifest().buildId;", {
        VESPERA_DATA_SNAPSHOT: root,
        VESPERA_DATA_SNAPSHOT_CAPABILITY: capability,
      });
      expect(result.ok).toBe(false);
      expect(result.out).toContain(expected);
    }
  });

  test("only path-safe names beneath the root resolve", async () => {
    const { root, manifestSha256 } = snapshot();
    const env = {
      VESPERA_DATA_SNAPSHOT: root,
      VESPERA_DATA_SNAPSHOT_CAPABILITY: capabilityFor(root, manifestSha256),
    };
    const nested = await run("return dataset.readDataFile('images/secret.json').nested;", env);
    expect(nested.ok).toBe(true);
    expect(JSON.parse(nested.out)).toBe(true);

    for (const name of ["../index.json", "images/../../index.json", "/etc/hosts", "./index.json", ""]) {
      const result = await run(
        `try { dataset.readDataFile(${JSON.stringify(name)}); return 'accepted'; } catch (error) { return String(error.message); }`,
        env,
      );
      expect(result.ok).toBe(true);
      expect(JSON.parse(result.out)).toMatch(/unsafe published data filename|escapes the snapshot/);
    }
  });

  test("parses each file once, however many pages read it", async () => {
    const { root, manifestSha256 } = snapshot();
    const result = await run(
      "const a = dataset.table('items'); const b = dataset.table('items'); return a === b;",
      {
        VESPERA_DATA_SNAPSHOT: root,
        VESPERA_DATA_SNAPSHOT_CAPABILITY: capabilityFor(root, manifestSha256),
      },
    );
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.out)).toBe(true);
  });
});
