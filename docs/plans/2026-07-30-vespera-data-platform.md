---
title: Vespera Data Platform
type: plan
status: active
created: 2026-07-30
parent:
superseded_by:
archived:
---

# Vespera Data Platform

Build versioned machine-readable datasets and player-facing presentation surfaces on the verified composition pipeline.

## File map

- Modify `package.json`: expose publishing, data-sync, site, and deploy commands.
- Create `packages/core/src/build.ts`: own the installed build-id lookup for every package.
- Create `packages/pipeline/src/anchors.ts`: share the content-shape anchor helpers.
- Create `packages/pipeline/src/gear.ts`: run the shipped gear-balance passes instead of restating them.
- Create `packages/pipeline/src/schema.ts`: define the stable schema version and normalized entity and join-table rows.
- Create `packages/pipeline/src/project.ts`: flatten composed tables into deterministic rows.
- Create `packages/pipeline/src/invariants.ts`: validate columns, ids, references, cardinality, and metadata before publishing.
- Create `packages/pipeline/src/csv.ts`, `packages/pipeline/src/sqlite.ts`, `packages/pipeline/src/publish.ts`: emit build-versioned JSON, CSV, and SQLite artifacts plus `latest` copies.
- Create `site/`: build the SvelteKit entity browser, SQL playground, Sheets page, and static deployment output.
- Create `site/wrangler.jsonc` and `site/src/worker.ts`: configure the custom-domain Cloudflare Worker for `vespera.compendiums.org`.
- Modify `README.md`: document publishing and site commands after they exist.

## Tasks

### Task 1: Restore live fidelity and the published schema

**Files:**
- Create `packages/core/src/build.ts`
- Create `packages/pipeline/src/anchors.ts`
- Create `packages/pipeline/src/gear.ts`
- Create `packages/pipeline/src/schema.ts`
- Modify `packages/core/src/index.ts`, `packages/pipeline/src/compose.ts`, `packages/pipeline/src/verify.ts`, `packages/pipeline/src/index.ts`, `packages/harness/src/launch.ts`, `packages/harness/src/identify.ts`, `packages/harness/src/probes/parity.ts`, `packages/harness/src/probes/records.ts`

- [x] Own the Steam manifest build-id lookup in `@vespera/core` and delete the pipeline and harness copies, keeping the harness error type its report layer branches on.
  Verification: `grep -rn "readBuildId\|installedBuildId" packages` and `bunx tsc --noEmit`
  Expected: one implementation, one harness wrapper, no diagnostics.
- [x] Bring achievements under the live parity and record probes, publishing only the player-visible set rather than the raw bundle list.
  Verification: `bun run harness --dir extracted --only parity --only records`
  Expected: `parity.achievements` matches live and static at the visible count, and record sampling covers achievements.
- [x] Publish equipment stats and achievement rewards by running the bundle's own module-scope passes, not restated constants, and discover the minified symbols they need by the content they declare.
  Verification: `bun run harness --dir extracted`
  Expected: every probe passes, including record samples for items and achievements.
- [x] Define schema version `1` and normalized rows for the twelve entity tables, sixteen join tables, and metadata table, with canonical column order.
  Verification: `bunx tsc --noEmit`
  Expected: no diagnostics and every row type exported from `@vespera/pipeline`.
- [x] Commit.
  Message: `feat(pipeline): define published data schema`

### Task 2: Publish JSON, CSV, and SQLite

**Files:**
- Create `packages/pipeline/src/project.ts`
- Create `packages/pipeline/src/invariants.ts`
- Create `packages/pipeline/src/csv.ts`
- Create `packages/pipeline/src/sqlite.ts`
- Create `packages/pipeline/src/publish.ts`
- Modify `packages/pipeline/src/cli.ts`
- Modify `package.json`

- [x] Emit `data/<buildId>/` and `data/latest/` with one JSON and CSV file per table, `vespera.sqlite`, and `index.json` carrying `buildId` and `schemaVersion`, ordering every table by its primary key so republishing one build is byte-stable.
  Verification: `bun run publish extracted`
  Expected: both directories carry twenty-nine table files in each text format, one SQLite database with no journal sidecars, and one index.
- [x] Reject missing or extra columns, duplicate ids, dangling join references, and row counts disagreeing with the composed tables, writing nothing when a check fails.
  Verification: disable the item-source filter, run `bun run publish extracted`, then restore it.
  Expected: exit code `1`, a named `references` failure, and unchanged output files.
- [x] Quote commas, double quotes, CR, and LF according to RFC 4180 and use stable column order from `schema.ts`.
  Verification: parse every emitted CSV through the publisher's CSV reader and compare against its JSON.
  Expected: every row and scalar value round-trips.
- [x] Populate inverse-source joins for recipes, enemy drops, gathering drops, shops, quests, and world-boss rewards without labelling missing rows unobtainable.
  Verification: query `item_sources` in `data/latest/vespera.sqlite` grouped by `source_kind`.
  Expected: non-zero recipe, enemy, gathering, shop, quest, and world-boss groups over the current build's item rows.
- [x] Commit.
  Message: `feat(pipeline): emit versioned json csv and sqlite`

### Task 3: Build the compendium and query surfaces

**Files:**
- Create `site/package.json`, `site/svelte.config.js`, `site/vite.config.ts`, `site/tsconfig.json`
- Create `site/src/app.html`, `site/src/app.css`, `site/src/lib/labels.ts`
- Create `site/src/lib/server/dataset.ts`, `site/src/lib/server/related.ts`, `site/src/lib/client/sql.ts`
- Create `site/src/routes/+layout.svelte`, `site/src/routes/+layout.ts`, `site/src/routes/+page.server.ts`, `site/src/routes/+page.svelte`
- Create `site/src/routes/[table]/+page.server.ts`, `site/src/routes/[table]/+page.svelte`
- Create `site/src/routes/[table]/[id]/+page.server.ts`, `site/src/routes/[table]/[id]/+page.svelte`
- Create `site/src/routes/query/+page.svelte`, `site/src/routes/sheets/+page.server.ts`, `site/src/routes/sheets/+page.svelte`, `site/src/routes/404/+page.svelte`
- Modify `package.json`

- [x] Configure SvelteKit with `@sveltejs/adapter-static`, whole-route prerendering, canonical trailing slashes, and strict fallback-free output in `site/build`.
  Verification: `bun run site:build` and `bun run site:typecheck`
  Expected: the build completes with no server-only routes or fallback HTML, and no type diagnostics.
- [x] Generate one index and detail page per published entity table, taking each key column from the manifest rather than assuming `id`, with plain text for references that name no entity.
  Verification: `bun run site:build`
  Expected: one detail page per entity row, including `site/build/shop-listings/bar_copper_vs/index.html`, and `site/build/items/sword_bronze_vs/index.html` carrying links derived from `item_sources`.
- [x] Dress the site in the game's own palette, panel treatment, kicker typography and rarity colours, read out of the shipped stylesheets and with the game's font self-hosted.
  Verification: grep the emitted stylesheet for the game's surface and rarity values, then load `/items/` in a browser.
  Expected: those values appear in the emitted CSS, and the page renders dark indigo with brass-bordered panels, a tracked kicker, and rarity-coloured rows.
- [x] Add the in-browser `sql.js` console with inline errors, elapsed query time, row count, schema inspection, five example queries, and base64url `#q=` sharing, loading the database on arrival and running the editor's SQL once it is ready.
  Verification: open `/query`, watch the network panel, then exercise an empty result, an unknown table, a shared link, and a blocked database fetch.
  Expected: one database request per session, `Run` never disabled while loading, zero rows reported as such, SQL errors shown inline with the query kept, a shared link repopulating and running itself, and a retry that recovers.
- [x] Add copy-ready `IMPORTDATA` formulas for every published CSV and state that missing modelled sources do not prove unobtainability.
  Verification: load the Sheets page and confirm every formula targets an emitted CSV path.
  Expected: one formula and copy button per published table, all pointing at the deployed data URLs.
- [x] Commit.
  Message: `feat(site): add compendium data browser`

### Task 4: Configure and verify deployment

**Files:**
- Create `site/wrangler.jsonc`
- Create `site/src/worker.ts`
- Create `site/static/_headers`
- Modify `README.md`
- Modify `package.json`

- [x] Configure a custom-domain Worker serving `site/build` at `vespera.compendiums.org` with no workers.dev hostname and no automated deploy workflow, passing every request straight to the assets binding.
  Verification: `bun run --cwd site deploy:check`
  Expected: Wrangler accepts the configuration, reports the assets binding, and prints no workers.dev hostname.
- [x] Cache hashed assets and the wasm immutably while leaving the published data revalidating, and allow cross-origin reads so spreadsheets can fetch the CSVs.
  Verification: `curl -I` the deployed CSV and a hashed asset.
  Expected: `access-control-allow-origin: *` with a revalidating cache on the data, and a one-year immutable cache on hashed assets.
- [x] Deploy and confirm the live hostname serves the compendium.
  Verification: `bun run cf-deploy`, then resolve the hostname and request the home page, an entity page, a CSV, and an unknown path.
  Expected: the custom domain creates its own DNS record, pages return `200`, and an unknown path returns the prerendered 404.
- [x] Document the publish, build, and manual deploy commands in `README.md`.
  Verification: every documented command exists in `package.json` and every linked path exists.
- [x] Commit.
  Message: `feat(site): add sheets page and worker config`
