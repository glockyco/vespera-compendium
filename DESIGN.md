---
name: Vespera Compendium
description: The player's question answered in one page, dressed in the game's own painted-indigo and brass.
colors:
  obsidian: "#030813"
  painted-indigo: "#071426"
  painted-surface: "#0d1c32"
  painted-elevated: "#132640"
  brass: "#d6a94f"
  brass-warm: "#f0c76a"
  brass-deep: "#9b6f24"
  parchment: "#f1e6c8"
  lavender-grey: "#aeb9c8"
  text-muted: "#718095"
  royal-blue: "#3b5980"
  teal-dust: "#4c6f9a"
  lilac-painted: "#8f7aa5"
  ember: "#b86638"
  teal: "#5fc6b6"
  cyan: "#65b9dd"
  green: "#8ed5a4"
  red: "#dc806e"
  kicker: "#91c9bf"
  line: "rgba(185, 151, 86, 0.34)"
  line-soft: "rgba(146, 180, 176, 0.18)"
  rarity-common: "#9088a8"
  rarity-uncommon: "#84a56e"
  rarity-rare: "#7dd3fc"
  rarity-epic: "#a98bc9"
  rarity-legendary: "#d9b881"
  rarity-mythic: "#f0445e"
  rarity-living: "#78d7d0"
typography:
  display:
    fontFamily: "Source Sans 3 Variable, Source Sans 3, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.6rem, 3.4vw, 2.3rem)"
    fontWeight: 800
    lineHeight: 1.15
  title:
    fontFamily: "{typography.display.fontFamily}"
    fontSize: "1.1rem"
    fontWeight: 800
    lineHeight: 1.15
  body:
    fontFamily: "{typography.display.fontFamily}"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "{typography.display.fontFamily}"
    fontSize: "9px"
    fontWeight: 800
    letterSpacing: "0.15em"
    lineHeight: 1.2
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace"
    fontSize: "0.9rem"
    fontWeight: 400
rounded:
  chip: "999px"
  control: "5px"
  field: "6px"
  art: "8px"
  panel: "12px"
spacing:
  xs: "0.2rem"
  sm: "0.35rem"
  md: "0.6rem"
  lg: "0.9rem"
  xl: "1.4rem"
components:
  panel:
    backgroundColor: "linear-gradient(145deg, #07131e, #030a11 72%)"
    rounded: "{rounded.panel}"
    padding: "clamp(0.9rem, 2vw, 1.4rem)"
  button:
    backgroundColor: "linear-gradient(180deg, rgba(212, 173, 98, 0.11), rgba(212, 173, 98, 0.04))"
    textColor: "{colors.brass-warm}"
    rounded: "{rounded.control}"
    padding: "0.38rem 0.7rem"
    typography: "{typography.label}"
  button-active:
    backgroundColor: "color-mix(in srgb, #d6a94f 22%, transparent)"
    textColor: "{colors.parchment}"
    rounded: "{rounded.control}"
    padding: "0.38rem 0.7rem"
  field:
    backgroundColor: "rgba(3, 10, 17, 0.72)"
    textColor: "{colors.parchment}"
    rounded: "{rounded.field}"
    padding: "0.45rem 0.6rem"
  chip:
    backgroundColor: "rgba(19, 38, 64, 0.5)"
    textColor: "{colors.parchment}"
    rounded: "{rounded.chip}"
    padding: "0.18rem 0.5rem"
  chip-combat:
    backgroundColor: "color-mix(in srgb, #b86638 14%, transparent)"
    textColor: "{colors.parchment}"
    rounded: "{rounded.chip}"
    padding: "0.18rem 0.5rem"
  chip-gathering:
    backgroundColor: "color-mix(in srgb, #8ed5a4 12%, transparent)"
    textColor: "{colors.parchment}"
    rounded: "{rounded.chip}"
    padding: "0.18rem 0.5rem"
  chip-crafting:
    backgroundColor: "color-mix(in srgb, #65b9dd 12%, transparent)"
    textColor: "{colors.parchment}"
    rounded: "{rounded.chip}"
    padding: "0.18rem 0.5rem"
---

# Design

## Overview

**The Quartermaster's Provenance Ledger.** Every record is a requisition entry that answers where a
thing comes from and at what level it becomes reachable, and the page is laid out as that ledger:
brass hairline panels on painted indigo, small tracked labels above each section, tabular figures,
and separately ruled gutters for quantities that must never be added together.

The palette, panel treatment, kicker typography, rarity hues and typeface are not chosen — they are
Vespera's own, read out of the game's shipped stylesheets (`index-TpX1HTVU.css` for surfaces and
brass, `GameView-V33hRMR7.css` for rarity, `mercenary-war-table.css` for the panel and kicker idiom)
so the compendium reads as an extension of the game rather than a third-party table dump. Treat that
inheritance as fixed: new surfaces extend this vocabulary, they do not restyle it.

The mood is a lit reading table in a dark room. Ink is warm, ground is cold, and the one saturated
accent is brass. The anti-reference is the generic data browser this replaced: `snake_case` headers,
one wide table per page, and a home page whose first line was schema metadata.

## Colors

Painted indigo is the ground and obsidian the recess; surfaces step up through `painted-surface` and
`painted-elevated` rather than through shadow. Brass is the only accent that carries emphasis, and it
is rationed: the wordmark, a quantity, a hovered border, an active filter. Parchment is body ink,
`lavender-grey` is secondary prose, `text-muted` is metadata.

Two colour families are semantic and must never be repurposed for decoration:

- **Rarity** — the seven hues are the game's own and always mean rarity. They tint a name, an art
  frame or a chip value, never a background or an unrelated accent.
- **The three level scales** — ember for Combat, green for Gathering, cyan for Crafting. These exist
  because the game gates three different skills and its own quest guidance keeps them apart. A hue
  never carries a scale on its own: the chip prints the scale's name beside the number, and the
  progression gutters are labelled as well as tinted.

## Typography

One family, Source Sans 3, the game's own. Hierarchy comes from weight and tracking rather than from
a second face. Headings are 800 weight and tight; body is 1.5 line-height at normal weight.

The kicker is the signature: 9px, 800 weight, `0.15em` tracking, uppercase, in `kicker` teal, sitting
above a page title or as a section heading inside a panel. It is what makes a panel read as a ledger
entry. Monospace is reserved for identifiers a reader may need to copy — a record's raw id, SQL —
and never for prose or figures.

Every figure that can be compared down a column uses `font-variant-numeric: tabular-nums`.

## Layout

A 76rem centred column, with the top bar and footer spanning it. Content grids are intrinsic rather
than breakpoint-driven: `repeat(auto-fit, minmax(<floor>, 1fr))` with the floor set by what the
content needs to stay legible — 20rem for record blocks, 16rem for card grids, 15rem for slot groups.
This is why there is almost no media-query logic; the one bar that needs it is the top bar, which
stacks its search field below the wordmark under 54rem.

Density is high by intent. A compendium is read by scanning, so rows are tight, separators are dotted
hairlines rather than full rules, and long lists scroll inside their panel rather than lengthening
the page.

## Elevation & Depth

Tonal, not lifted. Depth comes from the brass hairline and the panel's own gradient, plus a single
shared shadow that reads as the page's ambient recess rather than as a raised card. There is exactly
one shadow token and no elevation scale; a surface that needs to feel closer gets a lighter ground,
not a bigger shadow. The body carries the game's own radial vignette so the page is never a flat slab.

## Shapes

Radius is functional and steps with the element's size: 999px for chips, 5px for controls, 6px for
fields, 8px for art frames, 12px for panels. Borders are single-pixel and low-contrast — warm brass
for a panel edge, cool `line-soft` for an internal division. Art sits in a fixed square frame whose
border takes the rarity tint.

## Components

- **Panel** — the ledger entry. Brass hairline, gradient ground, one shared shadow. Every record
  section, every browse group and every band on the spine is one.
- **AnswerBlock** — a panel with a kicker heading and a hairline rule. All twelve record types use it,
  so a reader learns the page shape once. Its empty state is a sentence, never a dash: "No source is
  modelled for this item yet" is information, and callers pass emptiness explicitly because a snippet
  that renders nothing is still a snippet.
- **Chip** — one labelled fact, label above value in miniature. The three level-scale tones are the
  only coloured variants.
- **Art** — the game's own picture in a fixed box per size (2rem / 3.5rem / 6rem / full). The box is
  reserved before load so grids never reflow, the image is decorative because a name always sits
  beside it, and a record with no art gets its first two letters rather than an empty frame.
- **EntityLink** — the single way one record points at another: thumbnail, name in rarity colour,
  optional sub-line. Names wrap rather than truncate.
- **Bar** — a proportion with its figure printed beside it, never width alone.
- **Button** — small, uppercase, tracked, brass on a faint brass wash. The active filter state fills
  with brass at 22% and switches ink to parchment.

## Do's and Don'ts

- **Do** state which level scale a number belongs to, every time. A bare `10` is ambiguous between
  three skills the game deliberately separates.
- **Do** lead a record with the answer. The first block is what the reader came for; the table is the
  fallback.
- **Do** say when the model does not know something, in words. Absence of a modelled source is a
  boundary of this dataset, never evidence an item cannot be obtained.
- **Do** reserve layout before art loads, and lazy-load below the fold.
- **Don't** signal rarity or level scale by colour alone; the label always carries it too.
- **Don't** introduce a colour literal. Everything comes from the tokens above, which come from the
  game.
- **Don't** render a `snake_case` column name, a raw asset path, or a bare enum token to a player.
- **Don't** add a second shadow step or a card that floats. Depth here is tonal.
- **Don't** put schema metadata in a page's opening. The build stamp lives in the footer.
