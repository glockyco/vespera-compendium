# Vespera Compendium

A searchable compendium for Vespera’s items, enemies, quests, recipes, and more.

The project uses a build-aware extraction and verification workspace to reconstruct the game's runtime data tables from the shipped Electron bundles, then checks those results against the running game through the Chrome DevTools Protocol.

The current repository contains the typed composition pipeline and runtime verification harness. Publishing surfaces such as versioned JSON, CSV, SQLite, the compendium website, and the SQL playground are tracked in the [active data-platform plan](docs/plans/2026-07-30-vespera-data-platform.md).

## Requirements

- [Bun](https://bun.sh/) 1.3.14
- An extracted Vespera build at `extracted/` for static composition
- Vespera installed in the CrossOver `Steam` bottle for live runtime verification

Extracted game files and generated datasets are local artifacts and are not committed.

## Quick start

```bash
bun install
bunx tsc --noEmit
bun run verify extracted
```

Run the opt-in live verification harness when the game and CrossOver are available:

```bash
bun run harness --dir extracted
```

The harness uses an isolated `Vespera Harness` user-data profile. It writes build-stamped evidence to `data/<buildId>/runtime-evidence.json` and `docs/RUNTIME-EVIDENCE-<buildId>.md`.

## Commands

| Command | Purpose |
|---|---|
| `bunx tsc --noEmit` | Typecheck every workspace package |
| `bun run verify extracted` | Verify composed tables and consume existing runtime evidence |
| `bun run harness --dir extracted` | Launch the isolated game harness and regenerate runtime evidence |
| `bun run harness --dir extracted --only parity` | Compare static and live table cardinalities |
| `bun run harness --dir extracted --only records` | Compare deterministic record samples field by field |
| `bun run harness --dir extracted --only formulas` | Exercise live formula contracts |
| `bun run harness --dir extracted --only save` | Verify encrypted save creation and decryption |

## Architecture

- `packages/core` resolves build-specific bundles, balances JavaScript literals, and provides separate discovery and strict composition evaluators.
- `packages/pipeline` reconstructs post-declaration mutations and verifies build-stamped evidence.
- `packages/harness` launches Vespera through CrossOver, identifies runtime tables by shape, probes live state, and emits evidence reports.
- `tools` contains build-diff and focused research utilities that have not yet moved into the typed publishing pipeline.
- `docs` contains the current build audit, build diffs, and generated runtime evidence.

Runtime aliases and hashed bundle names are intentionally not treated as stable identifiers. Extraction and runtime identification use content shape and anchors instead.

## Project status

Build `24460838` currently passes all runtime probes. See [the evidence report](docs/RUNTIME-EVIDENCE-24460838.md) for the exact table, record, formula, and save checks.

The repository does not claim that items without a modelled source are unobtainable. Empirical item reachability requires broader runtime instrumentation and remains outside the current harness.

## Plans

Current and archived plans are indexed in [`docs/plans/INDEX.md`](docs/plans/INDEX.md).
