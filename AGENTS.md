# Vespera data platform

This repository reconstructs Vespera's shipped runtime data and verifies it against the running game.

## Commands

- Install: `bun install`
- Typecheck: `bunx tsc --noEmit`
- Static verification: `bun run verify extracted`
- Full live gate: `bun run harness --dir extracted`
- Focused live suite: `bun run harness --dir extracted --only <parity|records|formulas|save>`
- Planning checks: `omp-plans index && omp-plans check`

Run the full live gate only when CrossOver and the game are available. A missing game is a supported `SKIPPED` result, not a publishing failure.

## Architecture

- `packages/core` owns bundle resolution, balanced literal extraction, permissive discovery evaluation, and strict composition evaluation.
- `packages/pipeline` owns post-declaration composition and verification. Published values must come from strict evaluation with explicit helper dependencies.
- `packages/harness` owns isolated CrossOver launch, CDP access, shape-based runtime identification, live probes, and evidence reports.
- `tools` contains focused research and build-diff utilities pending migration into the typed pipeline.
- Start multi-session work from `docs/plans/INDEX.md` and the active data-platform plan.

## Boundaries

| Don't | Instead |
|---|---|
| Edit `extracted/` or `extracted-*` | Treat extracted builds as immutable local inputs |
| Hardcode minified aliases or hashed bundle filenames | Resolve bundles and identify tables by content anchors or shape |
| Use permissive VM stubs for composed output | Use `evalComposition` with real helper bodies and explicit bindings |
| Launch against the real `Vespera` user-data profile | Keep the harness profile named `Vespera Harness` |
| Leave a harness-launched game running after a probe | Call session teardown from `finally` |
| Present missing modelled sources as unobtainable items | Say `no modelled source` until reachability is empirically verified |
| Treat evidence from one build as current after an update | Regenerate build-stamped runtime evidence |

`data/` is generated and ignored. The Markdown runtime report under `docs/` is the reviewable evidence surface.

Use `skill://commit` for Conventional Commits. Do not push without an explicit request and configured remote.
