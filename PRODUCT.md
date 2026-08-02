# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Casual Vespera players, mid-session, holding one concrete question about the game: where a specific
item comes from, what they should be doing at their current level, what their class wears and casts, or
what a zone contains. A second, much smaller audience is data-literate players and modders who query
the published dataset directly.

## Product Purpose

Answer a player's question about Vespera in one page, from verified records plus source-locked game
logic, with selected formulas checked against the running game. No Vespera wiki or guide hub exists, so
the compendium is the only place these answers are assembled. Success is a player arriving from a search
or a Discord link, getting the answer without reading a schema, and trusting it.

## Provenance Classes

Every published mechanics claim carries one of three gameplay provenance classes.

1. Game-authored guide or codex text, extracted verbatim from the shipped bundles.
2. Structured values derived from shipped logic, produced by executing the game's own functions.
3. Compendium-authored explanatory wording with `source-derived` provenance and locked source regions.

Editorial headings, labels, and navigation carry a separate non-gameplay class. They are marked as
compendium wording and never presented as source checked.

## Positioning

The dataset is reconstructed from the shipped game bundles and then verified against the live game over
the Chrome DevTools Protocol, with the game's own composition passes executed rather than restated. Item
stats and levels are the game's own numbers, not a contributor's transcription, and the build id is
published beside them. A hand-edited wiki cannot make that claim.

Mechanics carry the same standard. Each explanation is anchored to the shipped code that produces it, and
a source change blocks publication until the claim is reviewed again. Pure or observable mechanics are in
scope when the pipeline can anchor their implementation and either run them statically or probe them in
the live game.

## Operating Context

Players are in-game or beside it, often on a phone, and want one lookup.

System coverage and record coverage are separate claims.

System coverage is what the compendium can explain. The mechanics guides explain Combat mathematics,
ability calculations, skills and crafting, equipment value, and the endgame rules for Nightmare, the
Tower, Corruption, the Celestial Forge, Tower Vanguards, the Spire, the Frontier, and Grandworks.

Record coverage is what the compendium can enumerate. Reachable record systems in the published data are
combat and zones, dungeons, quests, crafting, gathering, items, abilities, gems, shops and achievements.
The game also ships Talents, Elements, Factions, Mercenaries, Bank, Caravans, Dominion, the Veiled
Reliquary, Reliquary Expeditions, Leaderboards and Event Calendar, whose records the pipeline does not
model. Explaining an endgame system is not a claim of complete records or complete acquisition paths for
it.

## Capabilities and Constraints

Thirty published tables, twelve of them entities, plus five mechanics guides; the site is fully
prerendered static output with no server at request time, so every surface must be derivable at build
time. The game's own three level scales are distinct and must never be merged in display: Gathering
skill, Crafting skill and Combat level. Item level for equipment is the game's own balance level; for
other items it is stated as a property of the source. Some items have no level and some have no modelled
source, both because the record systems above are not modelled. Generated pages report the current
build's counts; this document does not restate them, because they change with the build.

Those unmodelled record systems are a named gap, not an oversight to be papered over. Measured against
the official Discord, questions about them are the second-largest shape players ask (20.2% of classified
questions), behind only questions about how a mechanic works. The compendium now answers that largest
shape for the systems it can anchor in shipped logic, and it must never ship a stub for a system it has
no data for. One further shape stays out of reach: how to operate the game's interface. The compendium's
honest claim is that it explains the systems it can anchor and exhausts the records it can model.

## Brand Commitments

The name is Vespera Compendium. The visual system is the game's own shipped palette, panel treatment,
kicker typography, rarity colours and Source Sans 3 typeface, read out of the game's stylesheets so the
compendium reads as an extension of Vespera.

## Evidence on Hand

`data/latest/` holds the published tables, the `mechanics.json` guide artifact, and the `index.json`
manifest; `extracted/assets` holds the game's own art, which the compendium republishes as canonical
files plus generated responsive variants. Runtime verification lives in
`docs/RUNTIME-EVIDENCE-<buildId>.md`, and `mechanics.lock.json` plus `mechanics-source.lock.json` hold the
reviewed data and source-closure baselines. Community demand is measured from a local capture of the
official Discord in `research/discord/`, which is gitignored and never quoted. There are no user
counts, testimonials, reviews or traffic figures, and none may be invented.

## Product Principles

- Explain the system, then exhaust the records.
- Answer the question first; the table is a fallback, never the opening.
- Publish the game's numbers, never a plausible substitute, and say where each one came from.
- Absence of a modelled source is a boundary of this model, never evidence an item is unobtainable.
- Keep the three level scales distinct and always labelled.
- The compendium looks like the game because the tokens are the game's.

## Accessibility & Inclusion

Keyboard reachable throughout, visible focus, and text contrast holding on the game's dark surfaces.
Rarity and skill are never signalled by colour alone.
