# Vespera Compendium

A searchable compendium for Vespera’s items, enemies, quests, recipes, and more.

The project reconstructs the game's runtime data tables from the shipped Electron bundles, verifies that reconstruction against the running game through the Chrome DevTools Protocol, then publishes build-versioned JSON, CSV, and SQLite datasets and a static site that browses them.

Live at [vespera.compendiums.org](https://vespera.compendiums.org).

## Requirements

- [Bun](https://bun.sh/) 1.3.14
- An extracted Vespera build at `extracted/` for static composition
- Vespera installed in the CrossOver `Steam` bottle for live runtime verification
- A Cloudflare account holding `compendiums.org` for deployment

Extracted game files and generated datasets are local artifacts and are not committed.

## Quick start

```bash
bun install
bunx tsc --noEmit
bun run verify extracted
bun run publish extracted
bun run site:build
```

Run the opt-in live verification harness when the game and CrossOver are available:

```bash
bun run harness --dir extracted
```

The harness uses an isolated `Vespera Harness` user-data profile. It writes build-stamped evidence to `data/<buildId>/runtime-evidence.json` and `docs/RUNTIME-EVIDENCE-<buildId>.md`.

## Refreshing `extracted/`

The game ships its renderer inside an Electron archive, so a build refresh means unpacking that archive rather than copying a directory:

```bash
bunx @electron/asar extract \
  "$HOME/Library/Application Support/CrossOver/Bottles/Steam/drive_c/Program Files (x86)/Steam/steamapps/common/Vespera/resources/app.asar" \
  extracted
```

Keep the previous extraction as `extracted-<buildId>/` when you want to diff two builds with `tools/diff-builds.mjs`. Composition reads the bundle filenames out of `index.html`, so the hashed asset names never need updating by hand.

## Commands

| Command | Purpose |
|---|---|
| `bunx tsc --noEmit` | Typecheck every workspace package |
| `bun run verify extracted` | Verify composed tables and consume existing runtime evidence |
| `bun run publish extracted` | Emit `data/<buildId>/` and `data/latest/` after checking every invariant |
| `bun run data:sync` | Copy `data/latest/` and the sql.js wasm into the site's static directory |
| `bun run site:dev` | Run the site against the synced dataset |
| `bun run site:build` | Sync the dataset, then prerender the whole site into `site/build` |
| `bun run site:typecheck` | Typecheck the site |
| `bun run cf-deploy` | Deploy `site/build` to `vespera.compendiums.org` |
| `bun run harness --dir extracted` | Launch the isolated game harness and regenerate runtime evidence |
| `bun run harness --dir extracted --only parity` | Compare static and live table cardinalities |
| `bun run harness --dir extracted --only records` | Compare deterministic record samples field by field |
| `bun run harness --dir extracted --only formulas` | Exercise live formula contracts |
| `bun run harness --dir extracted --only save` | Verify encrypted save creation and decryption |

## Architecture

- `packages/core` resolves build-specific bundles, reads the installed build id, balances JavaScript literals, and provides separate discovery and strict composition evaluators.
- `packages/pipeline` reconstructs post-declaration mutations, runs the game's own gear-balance passes, projects the result into the published schema, checks invariants, and emits the artifacts.
- `packages/harness` launches Vespera through CrossOver, identifies runtime tables by shape, probes live state, and emits evidence reports.
- `site` is a prerendered SvelteKit app: one page per published record, an in-browser SQL playground over the published SQLite file, and copy-ready spreadsheet formulas.
- `tools` contains build-diff and focused research utilities that have not yet moved into the typed publishing pipeline.
- `docs` contains the current build audit, build diffs, and generated runtime evidence.

Runtime aliases and hashed bundle names are intentionally not treated as stable identifiers. Extraction and runtime identification use content shape and anchors instead.

## Published data

`bun run publish` writes twenty-nine tables as both JSON and CSV, plus one SQLite database and an `index.json` manifest describing the schema. Twelve tables are entities (items, enemies, recipes, gathering nodes, quests, abilities, affixes, gems, shop listings, zones and dungeons, achievements, world bosses), sixteen are joins, and one carries build metadata.

The datasets are stamped with the Steam build id, and `data/latest/` always mirrors the newest publish. Column order is canonical and rows are sorted by primary key, so republishing one build produces comparable bytes.

`item_sources` is the inverse lookup the game has no screen for: the six modelled ways an item can be obtained. The repository does not claim that items without a modelled source are unobtainable. Empirical item reachability requires broader runtime instrumentation and remains outside the current harness.

## Project status

Build `24482455` passes all runtime probes. See [the evidence report](docs/RUNTIME-EVIDENCE-24482455.md) for the exact table, record, formula, and save checks.

## Plans

Current and archived plans are indexed in [`docs/plans/INDEX.md`](docs/plans/INDEX.md).
