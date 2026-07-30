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

- Modify `package.json`: expose extraction, publishing, site, and deploy commands.
- Create `packages/core/src/anchors.ts`: own the twelve content-shape extraction specifications.
- Create `packages/pipeline/src/extract.ts`: expose base-table extraction without CLI side effects.
- Create `packages/pipeline/src/schema.ts`: define the stable schema version and normalized entity and join-table rows.
- Create `packages/pipeline/src/publish.ts`: emit build-versioned JSON, CSV, and SQLite artifacts plus `latest` copies.
- Create `packages/pipeline/src/diff.ts`: compare published build metadata and entity ids.
- Create `packages/pipeline/src/invariants.ts`: validate ids, references, cardinality, and build metadata before publishing.
- Create `site/`: build the Astro entity browser, SQL playground, Sheets page, and static deployment output.
- Create `wrangler.toml`: configure the assets-only Cloudflare Worker for `vespera.compendiums.org`.
- Modify `README.md`: document publishing and site commands after they exist.

## Tasks

### Task 1: Stabilize extraction and published schema

**Files:**
- Create `packages/core/src/anchors.ts`
- Create `packages/pipeline/src/extract.ts`
- Create `packages/pipeline/src/schema.ts`
- Create `packages/pipeline/src/invariants.ts`
- Modify `packages/core/src/index.ts`
- Modify `packages/pipeline/src/index.ts`
- Modify `package.json`

- [ ] Move the twelve base-table specifications into typed content anchors with no hashed filenames or minified aliases.
  Verification: `bun run extract extracted`
  Expected: reports base counts for items, enemies, recipes, gathering nodes, quests, abilities, affixes, gems, shop listings, achievements, zones/dungeons, and world bosses.
- [ ] Define schema version `1` and normalized rows for the twelve entity tables, seven join tables, and metadata table.
  Verification: `bunx tsc --noEmit`
  Expected: no diagnostics and every row type exported from `@vespera/pipeline`.
- [ ] Reject duplicate ids, dangling join references, missing build metadata, and unresolved strict-composition dependencies.
  Verification: `bun run verify extracted`
  Expected: all static invariants and build-matching runtime evidence pass.
- [ ] Commit.
  Message: `feat(pipeline): define published data schema`

### Task 2: Publish JSON, CSV, and SQLite

**Files:**
- Create `packages/pipeline/src/publish.ts`
- Create `packages/pipeline/src/csv.ts`
- Create `packages/pipeline/src/sqlite.ts`
- Create `packages/pipeline/src/diff.ts`
- Modify `packages/pipeline/src/cli.ts`
- Modify `package.json`

- [ ] Emit `data/<buildId>/` and `data/latest/` with one JSON and CSV file per table, `vespera-latest.sqlite`, and `index.json` carrying `buildId` and `schemaVersion`.
  Verification: `bun run publish extracted`
  Expected: both directories contain twenty table files in each text format, one SQLite database, and one index.
- [ ] Quote commas, double quotes, CR, and LF according to RFC 4180 and use stable column order from `schema.ts`.
  Verification: parse `data/latest/items.csv` through the publisher's CSV reader and compare it to `items.json`.
  Expected: every row and scalar value round-trips.
- [ ] Populate inverse-source joins for recipes, enemy drops, gathering drops, shops, quests, achievements, and world-boss rewards without labelling missing rows unobtainable.
  Verification: query `item_sources` in `vespera-latest.sqlite` grouped by `source_kind`.
  Expected: non-zero recipe, enemy, gathering, and shop groups, with `936` current-build item rows.
- [ ] Commit.
  Message: `feat(publish): emit versioned datasets`

### Task 3: Build the compendium and query surfaces

**Files:**
- Create `site/package.json`
- Create `site/astro.config.mjs`
- Create `site/src/lib/data.ts`
- Create `site/src/layouts/Layout.astro`
- Create `site/src/pages/index.astro`
- Create `site/src/pages/[table]/index.astro`
- Create `site/src/pages/[table]/[id].astro`
- Create `site/src/pages/query.astro`
- Create `site/src/pages/sheets.astro`
- Create `site/src/styles/global.css`
- Modify `package.json`

- [ ] Generate one index and detail page per published entity table with raw-id fallback text for unresolved references.
  Verification: `bun run site:build`
  Expected: `site/dist/items/sword_bronze_vs/index.html` exists and contains links derived from `item_sources`.
- [ ] Add the in-browser `sql.js` console with inline errors, elapsed time, row count, schema inspection, five example queries, and base64url `#q=` sharing.
  Verification: run the built site in a browser, execute the enemy-drop example, reload its shared URL, and observe the same SQL and results.
- [ ] Add copy-ready `IMPORTDATA` formulas for every published CSV and state that missing modelled sources do not prove unobtainability.
  Verification: inspect the built Sheets page and confirm every formula targets an emitted CSV path.
- [ ] Commit.
  Message: `feat(site): add compendium data browser`

### Task 4: Configure and verify deployment

**Files:**
- Create `wrangler.toml`
- Modify `README.md`
- Modify `package.json`

- [ ] Configure an assets-only Worker serving `site/dist` at `vespera.compendiums.org` without an automated deploy workflow.
  Verification: `bunx wrangler deploy --dry-run`
  Expected: Wrangler accepts the configuration and packages only static assets.
- [ ] Document the publish, build, and manual deploy commands in `README.md`.
  Verification: every documented command exists in `package.json` and every linked path exists.
- [ ] Commit.
  Message: `chore(deploy): configure compendium worker`
