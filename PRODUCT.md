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

Answer a player's question about Vespera in one page, from data verified against the running game. No
Vespera wiki or guide hub exists, so the compendium is the only place these answers are assembled.
Success is a player arriving from a search or a Discord link, getting the answer without reading a
schema, and trusting it.

## Positioning

The dataset is reconstructed from the shipped game bundles and then verified against the live game over
the Chrome DevTools Protocol, with the game's own composition passes executed rather than restated. Item
stats and levels are the game's own numbers, not a contributor's transcription, and the build id is
published beside them. A hand-edited wiki cannot make that claim.

## Operating Context

Players are in-game or beside it, often on a phone, and want one lookup. Reachable systems in the
published data are combat and zones, dungeons, quests, crafting, gathering, items, abilities, gems,
shops and achievements. The game also ships Talents, Elements, Factions, Mercenaries, Bank, Caravans,
Dominion, the Tower, the Spire, the Celestial Forge, Tower Vanguards, the Veiled Reliquary, Reliquary
Expeditions, the Frontier, Leaderboards and Event Calendar, which the pipeline does not model.

## Capabilities and Constraints

Thirty published tables, twelve of them entities; the site is fully prerendered static output with
no server at request time, so every surface must be derivable at build time. The game's own three level
scales are distinct and must never be merged in display: Gathering skill, Crafting skill and Combat
level. Item level for equipment is the game's own balance level; for other items it is stated as a
property of the source. Sixty-five items have no level and 153 have no modelled source, both because
the endgame systems above are not modelled.

Those unmodelled systems are a named gap, not an oversight to be papered over. Measured against the
official Discord, questions about them are the second-largest shape players ask (20.2% of classified
questions), behind only questions about how a mechanic works. The compendium answers neither, and it
must never ship a stub for a system it has no data for. Two further shapes are permanently out of
reach for a data compendium: how a formula behaves, because the dataset publishes values rather than
the rules that combine them, and how to operate the game's interface. Together these are the majority
of community demand, so the compendium's honest claim is that it answers a real minority slice well.

## Brand Commitments

The name is Vespera Compendium. The visual system is the game's own shipped palette, panel treatment,
kicker typography, rarity colours and Source Sans 3 typeface, read out of the game's stylesheets so the
compendium reads as an extension of Vespera.

## Evidence on Hand

`data/latest/` holds the published tables and `index.json` manifest; `extracted/assets` holds the game's
own art, of which the compendium references 1326 images totalling 21.4 MiB. Runtime verification lives
in `docs/RUNTIME-EVIDENCE-<buildId>.md`. Community demand is measured from a local capture of the
official Discord in `research/discord/`, which is gitignored and never quoted. There are no user
counts, testimonials, reviews or traffic figures, and none may be invented.

## Product Principles

- Answer the question first; the table is a fallback, never the opening.
- Publish the game's numbers, never a plausible substitute, and say where each one came from.
- Absence of a modelled source is a boundary of this model, never evidence an item is unobtainable.
- Keep the three level scales distinct and always labelled.
- The compendium looks like the game because the tokens are the game's.

## Accessibility & Inclusion

Keyboard reachable throughout, visible focus, and text contrast holding on the game's dark surfaces.
Rarity and skill are never signalled by colour alone.
