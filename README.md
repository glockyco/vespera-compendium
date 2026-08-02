# Vespera Compendium

A searchable compendium for Vespera’s items, enemies, quests, recipes, and more.

The project reconstructs the game's runtime data tables from the shipped Electron bundles, extracts the game's own mechanics guides and formulas from the same bundles, verifies both against the running game through the Chrome DevTools Protocol, then publishes build-versioned JSON, CSV, and SQLite datasets, five source-locked system guides, and a static site that browses them.

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

The harness uses an isolated `Vespera Harness` user-data profile. It writes build-stamped evidence to `evidence/<buildId>/runtime-evidence.json` and `docs/RUNTIME-EVIDENCE-<buildId>.md`.

## The mechanics review workflow

Records are checked against the running game. Explanations need a second guarantee, because an extractor can
keep producing plausible prose after the code it describes has changed. Two tracked locks provide it.

`mechanics-source.lock.json` approves the *code* that decides an approval: five source closures covering the
review inspector, the approval gate, the derivation executor, the probe executor, and the harness runtime
transport. `mechanics.lock.json` approves the *data*: each guide's normalized model, the exact bytes of every
cited source range, the bundle byte identities, and the live evidence that corroborates it.

Nothing publishes unless both agree with the working tree.

```bash
# 1. Approve the code, whenever a reviewed closure changes.
bun run inspector-source:diff   --out inspector-source-review.json
bun run approval-gate:diff      --out approval-gate-review.json
bun run derivation-source:diff  --out derivation-source-review.json
bun run probe-executor:diff     --out probe-executor-review.json
bun run probe-runtime:diff      --out probe-runtime-review.json
# Read every changed slice, set the four constants in
# packages/core/src/execution-source-hashes/, regenerate, then:
bun run mechanics-sources:inspect --reviews <five paths> --attest-out mechanics-source-attestation.json
bun run mechanics-sources:sync    --reviews <five paths> --attestation mechanics-source-attestation.json --reviewed <five hashes>

# 2. Produce live evidence and bind the platform it ran on.
bun run harness --dir extracted
bun run external-leaves:test-node --out evidence/external-leaves-node.json
bun run external-leaves:verify --node evidence/external-leaves-node.json \
  --harness evidence/<buildId>/runtime-evidence.json \
  --out evidence/<buildId>/external-leaves-approved.json

# 3. Approve the data.
bun run mechanics:diff    extracted --out mechanics-review.json
bun run mechanics:inspect --assert mechanics-review.json --attest-out mechanics-inspect-attestation.json
bun run mechanics:prove   extracted mechanics-review.json --attestation mechanics-inspect-attestation.json --out mechanics-proof.json
bun run mechanics:sync    extracted --proof mechanics-proof.json --reviewed <reviewSha256>

# 4. Confirm and publish.
bun run mechanics:check extracted
bun run publish extracted
bun run verify-published data/latest mechanics.lock.json
```

`mechanics:diff` writes a bounded review artifact holding every displayed claim, its provenance, the exact
canonical bytes of every cited range, and its live-probe obligations. `mechanics:inspect` renders that
artifact and nothing else, so what a reviewer reads is exactly what the proof binds. `mechanics:prove` reruns
every locator, slice, dependency closure, derivation, and formatter through the production APIs and compares
the result with the artifact and with the separately reviewed contract in
`packages/pipeline/testdata/mechanics-contract-v1.json`.

The automated gate proves byte binding, repeatability, and agreement between the code and a contract reviewed
apart from it. It does not prove that a shared specification defect is impossible, and an attestation records
which approved inspector rendered a review rather than that a human read it. Semantic review stays a human
responsibility.

A source change blocks publication even when the rendered page is identical, because an extractor can miss a
semantic effect. When the game updates, regenerate the evidence: a filename is not a content hash, and
Vespera reuses one across builds.

## Refreshing `extracted/`

The game ships its renderer inside an Electron archive, so a build refresh means unpacking that archive rather than copying a directory:

```bash
bunx @electron/asar extract \
  "$HOME/Library/Application Support/CrossOver/Bottles/Steam/drive_c/Program Files (x86)/Steam/steamapps/common/Vespera/resources/app.asar" \
  extracted
```

Keep the previous extraction as `extracted-<buildId>/` when you want to diff two builds with `tools/diff-builds.mjs`. Composition reads the bundle filenames out of `index.html`, so the hashed asset names never need updating by hand. Do not read those names as content hashes: the game reuses a filename across builds, so compare bytes rather than names when checking whether an extraction is current.

When a parity probe reports a count mismatch, `bun tools/diff-live-tables.mjs extracted items,gems` names the rows the live game has and the composed dataset does not, which is what turns a count into a traceable pass.

## Commands

| Command | Purpose |
|---|---|
| `bunx tsc --noEmit` | Typecheck every workspace package |
| `bun run verify extracted` | Verify composed tables and consume existing runtime evidence |
| `bun run mechanics:check extracted` | Report one approval status per mechanics guide |
| `bun run mechanics:sequence-gate extracted` | Run the real CLI sequence against scratch inputs, including its negatives |
| `bun run verify-published data/latest mechanics.lock.json` | Re-verify emitted artifacts against the approved lock |
| `bun run check:inputs` | Prove every protected read and write enters through the prepared-input contract |
| `bun run check:lock-order` | Prove no path acquires a lease out of rank order |
| `bun run check:manifest` | Inventory every site manifest reader and raw I/O callsite |
| `bun run check:art` | Prove every Art and HeroArt callsite uses an allowed kind and variant |
| `bun run site:browser-check --url <base>` | Run the browser assertion suite against a served build |
| `bun run publish extracted` | Emit `data/<buildId>/` and `data/latest/` after checking every invariant |
| `bun run data:sync` | Copy `data/latest/` and the sql.js wasm into the site's static directory |
| `bun run site:dev` | Run the site against the synced dataset |
| `bun run site:build` | Sync the dataset, then prerender the whole site into `site/build` |
| `bun run site:typecheck` | Typecheck the site |
| `bun run cf-deploy` | Deploy `site/build` to `vespera.compendiums.org` |
| `bun tools/serve-build.mjs` | Serve `site/build` locally with CDN-like compression, for measuring page weight |
| `bun run harness --dir extracted` | Launch the isolated game harness and regenerate runtime evidence |
| `bun run harness --dir extracted --only parity` | Compare static and live table cardinalities |
| `bun run harness --dir extracted --only records` | Compare deterministic record samples field by field |
| `bun run harness --dir extracted --only formulas` | Exercise live formula contracts |
| `bun run harness --dir extracted --only save` | Verify encrypted save creation and decryption |

## Architecture

- `packages/core` resolves build-specific bundles, reads the installed build id, balances JavaScript literals, and provides separate discovery and strict composition evaluators.
- `packages/pipeline` reconstructs post-declaration mutations, runs the game's own gear-balance passes, extracts and locks the five mechanics guides, projects the result into the published schema, checks invariants, and emits the artifacts.
- `packages/harness` launches Vespera through CrossOver, identifies runtime tables by shape, probes live state, and emits evidence reports.
- `site` is a prerendered SvelteKit app organised by the questions players ask rather than by the schema: a searchable shell, twelve entity browsers, one answer-first page per published record, a level-by-level progression spine, per-class ability and gear hubs, an acquisition overview, an in-browser SQL playground over the published SQLite file, and copy-ready spreadsheet formulas.
- `tools` contains build-diff, community-evidence and focused research utilities that have not yet moved into the typed publishing pipeline.
- `docs` contains the current build audit, build diffs, and generated runtime evidence.

Runtime aliases and hashed bundle names are intentionally not treated as stable identifiers. Extraction and runtime identification use content shape and anchors instead.

## Published data

`bun run publish` writes thirty tables as both JSON and CSV, plus the game's own artwork, one SQLite database and an `index.json` manifest describing the schema. Twelve tables are entities (items, enemies, recipes, gathering nodes, quests, abilities, affixes, gems, shop listings, zones and dungeons, achievements, world bosses), sixteen are joins, and two carry metadata: `meta` for the build stamp and row counts, and `search_index` for one flattened row per record. The search index is the only file emitted with abbreviated JSON keys, which the manifest maps back to column names.

Every record that has artwork carries one normalised `image` column, and the referenced files are republished beside the tables — 1326 images, 21.4 MiB. Published art paths carry a content hash so they can be served immutable; the game's own filenames cannot, because it reuses a name and busts the cache with a query string.

The three level scales the game gates are published under names that say which skill they gate: `recipes.crafting_level`, `gathering_nodes.gathering_level`, and `combat_level` on quests, zones, shop listings and abilities. They are distinct skills and must never be merged in display. `items.level` is the game's own balance level for equipment and a property of the source otherwise, with `items.level_source` naming which of the seven provenances it came from.

The datasets are stamped with the Steam build id, and `data/latest/` always mirrors the newest publish. Column order is canonical and rows are sorted by primary key, so republishing one build produces comparable bytes.

`item_sources` is the inverse lookup the game has no screen for: the six modelled ways an item can be obtained, each carrying the level and display name of what it points at. The repository does not claim that items without a modelled source are unobtainable. Empirical item reachability requires broader runtime instrumentation and remains outside the current harness.

## Project status

Build `24510288` passes all 37 runtime probes, including the four live formula contracts that corroborate
the published Defense, XP, and sell claims across 34 cases. All three bundle roles matched byte for byte
between the extraction and the running game. See [the evidence report](docs/RUNTIME-EVIDENCE-24510288.md).

The site is verified separately: 80 browser assertions pass against the prerendered build, and
`bun run mechanics:sequence-gate extracted` proves the approval chain refuses all eight out-of-order
mutations.

Four findings from this build are worth keeping.

The game reuses its bundle filenames across builds. Build `24503450` and build `24510288` both ship
`index-D6527GFL.js` and `GameView-Bdbw4Cpc.js`, and in both cases the bytes differ. A filename is not a
content hash here, and treating one as evidence would have approved stale explanations.

Byte parity caught a real extraction bug that produced files of exactly the right length and the wrong
content, because an asar header is padded to a four byte boundary and the extractor skipped the padding.
Nothing downstream would have noticed: the files parsed, the locators resolved, and the guides rendered.

A bridged session can serve one asset twice, so role resolution collapses byte-identical candidates and
fails only when two different byte sequences claim one role. Treating a repeated response as ambiguous
rejected a role that was in fact perfectly determined.

Defense corroboration is deliberately not promoted to `Live checked`. The bridged session serves the clean
index module plus one canonical assignment, so the bytes that ran are not the shipped bytes. The report
records the corroboration and the pages still say `Source checked`.

## Plans

Current and archived plans are indexed in [`docs/plans/INDEX.md`](docs/plans/INDEX.md).
