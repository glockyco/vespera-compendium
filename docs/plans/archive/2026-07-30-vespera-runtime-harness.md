---
title: Vespera Runtime Harness
type: plan
status: implemented
created: 2026-07-30
parent:
superseded_by:
archived: 2026-07-30
---

# Vespera Runtime Harness

The implemented harness validates statically composed Vespera data against the running game without modifying the installed build.

## Implemented scope

- `packages/harness/src/cdp.ts` provides timeout-bound CDP evaluation with exception propagation.
- `packages/harness/src/launch.ts` launches the CrossOver game with the isolated `Vespera Harness` profile and tears down the Wine process tree.
- `packages/harness/src/identify.ts` identifies exported tables by value shape rather than minified aliases.
- `packages/harness/src/bridge.ts` serves an unmodified extracted tree except for an in-memory bridge appended to the index bundle response.
- `packages/harness/src/probes/` verifies cardinality, deterministic scalar record samples, formulas, achievements, and encrypted-save behavior.
- `packages/harness/src/report.ts` emits build-stamped JSON and Markdown evidence with transformation-category summaries.
- `packages/pipeline/src/verify.ts` consumes existing evidence without launching the game.

## Verification contract

- `bunx tsc --noEmit` completes without diagnostics.
- `bun run harness --dir extracted` returns no `FAIL` or `UNRESOLVED` results for a supported installed build.
- A missing game records every selected probe as `SKIPPED` and exits successfully.
- `bun run verify extracted` reports runtime evidence as `PASS` after a successful harness run and `SKIPPED` when no build-matching evidence exists.
- The mitigation formula preserves calculated values through attacker level 256 and applies the `0.75` cap only above that threshold.
