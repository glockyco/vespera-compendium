# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Casual Vespera players use the compendium during a session. Each player has one concrete question about the game.

They can ask where an item comes from. They can ask what to do at their level. They can ask what their class wears and casts. They can ask what a zone contains.

A much smaller audience consists of data-literate players and modders. They query the published dataset directly.

## Product Purpose

The compendium answers a player's question about Vespera on one page. It uses checked records and source-locked game logic.

The compendium checks selected formulas against the live game. No Vespera wiki or guide hub exists. The compendium assembles these answers in one place.

A successful visit starts from a search or a Discord link. The player gets the answer without reading a schema. The player trusts the answer.

## Provenance Classes

Every published mechanics claim has one of three gameplay provenance classes.

1. Game-authored guide or codex text comes verbatim from the shipped bundles.
2. Structured values come from shipped logic. The game's own functions produce these values.
3. Compendium-authored explanations use `source-derived` provenance and locked source regions.

Editorial headings, labels, and navigation use a separate non-gameplay class. The compendium marks them as compendium wording.

The compendium never shows this wording as source checked.

## Positioning

The dataset comes from the shipped game bundles. The compendium checks it against the live game over the Chrome DevTools Protocol.

The compendium runs the game's own composition passes. It does not restate them. Item stats and levels are the game's own numbers, not a contributor's transcription.

The compendium publishes the build id beside the numbers. A hand-edited wiki cannot make the same claim.

Mechanics use the same standard. Each explanation links to the shipped code that produces it.

A source change blocks publication until the compendium reviews the claim again. Pure or observable mechanics are in scope when the pipeline can link their implementation to shipped logic.

The pipeline must also run these mechanics statically or probe them in the live game.

## Operating Context

Players are in the game or beside it. They often use a phone and want one lookup.

System coverage and record coverage are separate claims.

System coverage shows what the compendium can explain. The mechanics guides explain Combat mathematics, ability calculations, skills and crafting, and equipment value.

They also explain the endgame rules for Nightmare, the Tower, Corruption, the Celestial Forge, Tower Vanguards, the Spire, the Frontier, and Grandworks.

Record coverage shows what the compendium can enumerate. Reachable record systems in the published data include combat and zones, dungeons, quests, crafting, gathering, items, abilities, gems, shops, and achievements.

The game also ships Talents, Elements, Factions, Mercenaries, Bank, Caravans, Dominion, the Veiled Reliquary, Reliquary Expeditions, Leaderboards, and Event Calendar.

The pipeline does not model records for these systems. An explanation of an endgame system does not claim complete records or complete acquisition paths for that system.

## Capabilities and Constraints

The site publishes thirty tables. Twelve tables are entities. It also publishes five mechanics guides.

The site uses fully prerendered static output with no server at request time. Every surface must come from data available at build time.

The game's three level scales are distinct. The site must never merge them in output: Gathering skill, Crafting skill, and Combat level.

For equipment, item level is the game's own balance level. For other items, the source states item level as a property.

Some items have no level. Some items have no modelled source. The pipeline does not model the related record systems.

Generated pages report the counts for the current build. This document does not repeat those counts because they change with the build.

These unmodelled record systems are a named gap, not an oversight. In the official Discord, questions about them form the second-largest question group at 20.2% of classified questions.

Questions about how a mechanic works form the largest group. The compendium answers that group for systems that it can link to shipped logic.

The compendium must never publish a stub for a system without data. It cannot explain how to operate the game's interface.

The honest claim is that the compendium explains systems linked to shipped logic. It also exhausts the records that the pipeline can model.

## Brand Commitments

The name is Vespera Compendium. The visual system uses the game's shipped palette, panel treatment, kicker typography, rarity colours, and Source Sans 3 typeface.

The compendium reads as an extension of Vespera because the game supplies these elements.

## Evidence on Hand

`data/latest/` holds the published tables, the `mechanics.json` guide artifact, and the `index.json` manifest.

`extracted/assets` holds the game's own art. The compendium republishes this art as canonical files and generated responsive variants.

Runtime checks live in `docs/RUNTIME-EVIDENCE-<buildId>.md`. `mechanics.lock.json` and `mechanics-source.lock.json` hold the reviewed data and source-closure baselines.

A local capture in `research/discord/` measures community demand from the official Discord. Git ignores the directory, and the compendium never quotes it.

There are no user counts, testimonials, reviews, or traffic figures. Do not invent any.

## Product Principles

- Explain the system. Then exhaust the records.
- Answer the question first. Use the table as a fallback, never as the opening.
- Publish the game's numbers, never a plausible substitute. State the source for each number.
- Treat the absence of a modelled source as a boundary of this model, never as evidence that an item is unobtainable.
- Keep the three level scales distinct and label each one.
- Make the compendium look like the game because the tokens come from the game.

## Accessibility & Inclusion

The interface is keyboard reachable throughout. Focus is visible. Text contrast holds on the game's dark surfaces.

Use labels with rarity and skill. Do not signal either by colour alone.
