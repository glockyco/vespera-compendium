# Vespera Compendium

A searchable compendium for Vespera items, enemies, quests, recipes, and more.

The project rebuilds the game's runtime data tables from the shipped Electron bundles. It also extracts the game's mechanics guides and formulas from those bundles.

The project checks both data sources against the running game through the Chrome DevTools Protocol. It then publishes build-versioned JSON, CSV, and SQLite datasets.

The project also publishes five source-locked system guides and a static site that browses the datasets.

Live at [vespera.compendiums.org](https://vespera.compendiums.org).

## Requirements

- [Bun](https://bun.sh/) 1.3.14
- An extracted Vespera build at `extracted/` for static composition
- Vespera installed in the CrossOver `Steam` bottle for live runtime checks
- A Cloudflare account holding `compendiums.org` for deployment

The project stores extracted game files and generated datasets as local artifacts. It does not commit these artifacts.

## Quick start

Run the commands in order:

```bash
bun install
bunx tsc --noEmit
bun run verify extracted
bun run publish extracted
bun run site:build
```

Run the live check harness when the game and CrossOver are available:

```bash
bun run harness --dir extracted
```

The harness uses an isolated `Vespera Harness` user-data profile. It writes build-stamped evidence to `evidence/<buildId>/runtime-evidence.json` and `docs/RUNTIME-EVIDENCE-<buildId>.md`.

## The mechanics review workflow

The workflow checks records against the running game. An extractor can produce plausible prose after its source code changes.

Two tracked locks prevent this error.

`mechanics-source.lock.json` approves the *code* that decides an approval. It covers five source closures.

The closures cover the review inspector, the approval gate, the derivation executor, the probe executor, and the harness runtime transport.

`mechanics.lock.json` approves the *data*. It covers each guide's normalized model, every cited source range, the bundle byte identities, and the live evidence.

Both locks must agree with the working tree before publication.

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

`mechanics:diff` writes a bounded review artifact. The artifact holds every shown claim, its provenance, each cited range, and its live-probe obligations.

`mechanics:inspect` shows only that artifact. The proof binds exactly what a reviewer reads.

`mechanics:prove` reruns every locator, slice, dependency closure, derivation, and formatter through the production APIs. It compares the result with the artifact and the separately reviewed contract in `packages/pipeline/testdata/mechanics-contract-v1.json`.

The automated gate proves byte binding, repeatability, and agreement between the code and an independently reviewed contract.

It does not prove that a shared specification defect is impossible. An attestation records which approved inspector rendered a review.

It does not prove that a human read the review. Semantic review remains a human responsibility.

A source change blocks publication even when the rendered page is identical. An extractor can miss a semantic effect.

When the game updates, regenerate the evidence. A filename is not a content hash. Vespera reuses one filename across builds.

## Refreshing `extracted/`

Refresh a build by unpacking the Electron archive that contains the renderer. Do not copy a directory:

```bash
bunx @electron/asar extract \
  "$HOME/Library/Application Support/CrossOver/Bottles/Steam/drive_c/Program Files (x86)/Steam/steamapps/common/Vespera/resources/app.asar" \
  extracted
```

Keep the previous extraction as `extracted-<buildId>/` when you want to compare two builds with `tools/diff-builds.mjs`.

Composition reads bundle filenames from `index.html`. Do not update the hashed asset names by hand.

Do not treat those names as content hashes. The game reuses one filename across builds. Compare bytes to determine whether an extraction is current.

If a parity probe reports a count mismatch, run `bun tools/diff-live-tables.mjs extracted items,gems`.

The command names rows that the live game has but the composed dataset lacks. This result makes the count traceable.

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

- `packages/core` resolves build-specific bundles and reads the installed build id. It balances JavaScript literals and provides discovery and strict composition evaluators.
- `packages/pipeline` reconstructs post-declaration mutations and runs the game's gear-balance passes. It extracts and locks five mechanics guides, projects the result into the published schema, checks invariants, and emits artifacts.
- `packages/harness` runs Vespera through CrossOver and identifies runtime tables by shape. It probes live state and emits evidence reports.
- `site` is a prerendered SvelteKit app organized around player questions instead of the schema. It provides a searchable shell, twelve entity browsers, and one answer-first page for each published record.
  It provides a level-by-level progression spine and per-class ability and gear hubs. It provides an acquisition overview, an in-browser SQL playground over the published SQLite file, and copy-ready spreadsheet formulas.
- `tools` contains build-diff, community-evidence, and focused research utilities. These utilities have not moved into the typed publishing pipeline.
- `docs` contains the current build audit, build diffs, and generated runtime evidence.

Runtime aliases and hashed bundle names are not stable identifiers. Extraction and runtime identification use content shape and anchors instead.

## Published data

`bun run publish` writes thirty tables in JSON and CSV. It also writes the game's artwork, one SQLite database, and an `index.json` manifest that describes the schema.

Twelve tables are entities: items, enemies, recipes, gathering nodes, quests, abilities, affixes, gems, shop listings, zones and dungeons, achievements, and world bosses. Sixteen tables are joins. Two tables carry metadata.

`meta` stores the build stamp and row counts. `search_index` stores one flattened row for each record. Only the search index uses abbreviated JSON keys. The manifest maps those keys to column names.

Every record with artwork has one normalized `image` column. The referenced files are republished beside the tables.

The publish contains 1326 images with a total size of 21.4 MiB. Published art paths carry a content hash, so servers can treat them as immutable.

The game filenames cannot carry this hash because the game reuses each name and busts the cache with a query string.

The game gates three level scales. Their published names identify the skills they gate: `recipes.crafting_level`, `gathering_nodes.gathering_level`, and `combat_level` on quests, zones, shop listings and abilities.

These scales represent distinct skills. The published output must never merge them. `items.level` is the game's balance level for equipment and a property of the source otherwise.

`items.level_source` names which of the seven provenances supplied the equipment level.

The datasets use the Steam build id. `data/latest/` always mirrors the newest publish.

Column order is canonical, and rows are sorted by primary key. Republish one build to produce comparable bytes.

`item_sources` is the inverse lookup for items. The game has no screen for this lookup.

The table stores six modeled ways to obtain an item. Each row carries the level and name of its target.

The repository does not claim that an item without a modeled source is unobtainable. Empirical item reachability requires broader runtime instrumentation and remains outside the current harness.

## Project status

Build `24510288` passes all 37 runtime probes. The probes include four live formula contracts.

The contracts corroborate the published Defense, XP, and sell claims across 34 cases. All three bundle roles matched byte for byte between the extraction and the running game. See [the evidence report](docs/RUNTIME-EVIDENCE-24510288.md).

The site passes 80 browser assertions against the prerendered build. `bun run mechanics:sequence-gate extracted` proves that the approval chain refuses all eight out-of-order mutations.

Four findings from this build remain important.

The game reuses its bundle filenames across builds. Builds `24503450` and `24510288` both ship
`index-D6527GFL.js` and `GameView-Bdbw4Cpc.js`. In both cases, the bytes differ.

A filename is not a content hash here. A filename used as evidence approves stale explanations.

Byte parity found an extraction error that produced files of the correct length but wrong content. An asar header is padded to a four-byte boundary. The extractor skipped the padding.

Nothing downstream detected the error. The files parsed, the locators resolved, and the guides rendered.

A bridged session can serve one asset twice. Role resolution collapses byte-identical candidates.

It fails only when two different byte sequences claim one role. The system rejected a role because it treated a repeated response as ambiguous.

Defense corroboration is not promoted to `Live checked`. The bridged session serves the clean index module and one canonical assignment.

The bytes that ran are not the shipped bytes. The report records the corroboration. The pages still say `Source checked`.

## Plans

Current and archived plans are indexed in [`docs/plans/INDEX.md`](docs/plans/INDEX.md).
