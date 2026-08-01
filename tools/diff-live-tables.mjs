/**
 * Names the records the live game has and the composed dataset does not.
 *
 * `parity.probe` reports only a count mismatch, which says a gap exists but never which rows are in
 * it. This launches the same isolated harness session, reads the identified runtime tables by their
 * exported alias, and diffs the id sets against the composed tables so the missing rows can be
 * traced back to whichever pass drops them.
 *
 * Read-only and self-contained: it takes the harness's own launch and identification, and tears the
 * session down in a finally.
 */

import { resolveBundles } from "../packages/core/src/index.ts";
import { composeAll } from "../packages/pipeline/src/compose.ts";
import { identifyTables } from "../packages/harness/src/identify.ts";
import { launchGame } from "../packages/harness/src/launch.ts";

/** Composed tables store rows either as an array or keyed by id. */
function ids(value) {
  const list = Array.isArray(value) ? value : Object.values(value ?? {});
  return new Set(
    list
      .map((row) => (row && typeof row === "object" ? String(row.id ?? "") : ""))
      .filter((id) => id.length > 0),
  );
}

const dir = process.argv[2] ?? "extracted";
const tablesToDiff = process.argv[3]?.split(",") ?? ["items", "gems", "recipes"];

const bundles = resolveBundles(dir);
const composed = composeAll(dir);

let session;
try {
  session = await launchGame({ port: 9222 });
  const identified = await identifyTables(session.client, bundles.index);
  const byId = new Map(identified.map((table) => [table.id, table]));

  for (const name of tablesToDiff) {
    const runtime = byId.get(name);
    if (!runtime) {
      console.log(`\n### ${name}: no runtime table identified`);
      continue;
    }

    // The alias is the bundle-local export name identification resolved, so the live rows are
    // reachable by re-importing the module namespace and reading that key back.
    const moduleUrl = JSON.stringify(`./assets/${bundles.index}`);
    const liveIds = await session.client.evaluate(
      `(async () => {
        const ns = await import(new URL(${moduleUrl}, location.href).href);
        const t = ns[${JSON.stringify(runtime.alias)}];
        const list = Array.isArray(t) ? t : Object.values(t ?? {});
        return list.map((row) => String(row?.id ?? "")).filter(Boolean);
      })()`,
      120_000,
    );

    const staticIds = ids(composed[name]?.value);
    const onlyLive = liveIds.filter((id) => !staticIds.has(id));
    const onlyStatic = [...staticIds].filter((id) => !liveIds.includes(id));

    console.log(`\n### ${name}  live=${liveIds.length} static=${staticIds.size}`);
    if (onlyLive.length > 0) console.log(`  only live   (${onlyLive.length}): ${onlyLive.join(", ")}`);
    if (onlyStatic.length > 0) console.log(`  only static (${onlyStatic.length}): ${onlyStatic.join(", ")}`);
    if (onlyLive.length === 0 && onlyStatic.length === 0) console.log("  id sets match");
  }
} finally {
  await session?.stop();
}
