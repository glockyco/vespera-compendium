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
  hairline: "rgba(146, 180, 176, 0.14)"
  hairline-faint: "rgba(146, 180, 176, 0.12)"
  panel-top: "#07131e"
  panel-bottom: "#030a11"
  panel-inset: "rgba(3, 10, 17, 0.72)"
  panel-raised: "rgba(19, 38, 64, 0.5)"
  panel-hover: "rgba(19, 38, 64, 0.7)"
  panel-hover-strong: "rgba(19, 38, 64, 0.85)"
  panel-sunken: "rgba(3, 8, 19, 0.8)"
  art-top: "rgba(19, 38, 64, 0.9)"
  art-bottom: "rgba(3, 8, 19, 0.9)"
  zebra: "rgba(19, 38, 64, 0.35)"
  vignette: "rgba(68, 127, 126, 0.12)"
  brass-edge: "rgba(212, 173, 98, 0.4)"
  brass-wash-top: "rgba(212, 173, 98, 0.11)"
  brass-wash-bottom: "rgba(212, 173, 98, 0.04)"
  confirm-edge: "#80d7c2"
  confirm-top: "#9ae9d4"
  confirm-bottom: "#67c6ae"
  confirm-ink: "#07141b"
  error-edge: "rgba(220, 128, 110, 0.52)"
  error-surface: "rgba(113, 42, 37, 0.28)"
  error-ink: "#f0c0b6"
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
  lead:
    fontFamily: "{typography.display.fontFamily}"
    fontSize: "1.05rem"
    fontWeight: 400
    lineHeight: 1.5
  body:
    fontFamily: "{typography.display.fontFamily}"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  sm:
    fontFamily: "{typography.display.fontFamily}"
    fontSize: "0.88rem"
    fontWeight: 400
    lineHeight: 1.45
  xs:
    fontFamily: "{typography.display.fontFamily}"
    fontSize: "0.8rem"
    fontWeight: 400
    lineHeight: 1.4
  2xs:
    fontFamily: "{typography.display.fontFamily}"
    fontSize: "0.72rem"
    fontWeight: 700
    letterSpacing: "0.06em"
    lineHeight: 1.35
  kicker:
    fontFamily: "{typography.display.fontFamily}"
    fontSize: "9px"
    fontWeight: 800
    letterSpacing: "0.15em"
    lineHeight: 1.2
  control:
    fontFamily: "{typography.display.fontFamily}"
    fontSize: "11px"
    fontWeight: 800
    letterSpacing: "0.08em"
    lineHeight: 1.2
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace"
    fontSize: "0.8rem"
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
    backgroundColor: "linear-gradient(145deg, {colors.panel-top}, {colors.panel-bottom} 72%)"
    rounded: "{rounded.panel}"
    padding: "clamp(0.9rem, 2vw, 1.4rem)"
  button:
    backgroundColor: "linear-gradient(180deg, {colors.brass-wash-top}, {colors.brass-wash-bottom})"
    textColor: "{colors.brass-warm}"
    rounded: "{rounded.control}"
    padding: "0.38rem 0.7rem"
    typography: "{typography.control}"
  button-active:
    backgroundColor: "color-mix(in srgb, {colors.brass} 22%, transparent)"
    textColor: "{colors.parchment}"
    rounded: "{rounded.control}"
    padding: "0.38rem 0.7rem"
  button-primary:
    backgroundColor: "linear-gradient(180deg, {colors.confirm-top}, {colors.confirm-bottom})"
    textColor: "{colors.confirm-ink}"
    rounded: "{rounded.control}"
    padding: "0.38rem 0.7rem"
  field:
    backgroundColor: "{colors.panel-inset}"
    textColor: "{colors.parchment}"
    rounded: "{rounded.field}"
    padding: "0.45rem 0.6rem"
  chip:
    backgroundColor: "{colors.panel-raised}"
    textColor: "{colors.parchment}"
    rounded: "{rounded.chip}"
    padding: "0.18rem 0.5rem"
    typography: "{typography.2xs}"
  chip-combat:
    backgroundColor: "color-mix(in srgb, {colors.ember} 14%, transparent)"
    textColor: "{colors.parchment}"
    rounded: "{rounded.chip}"
    padding: "0.18rem 0.5rem"
  chip-gathering:
    backgroundColor: "color-mix(in srgb, {colors.green} 12%, transparent)"
    textColor: "{colors.parchment}"
    rounded: "{rounded.chip}"
    padding: "0.18rem 0.5rem"
  chip-crafting:
    backgroundColor: "color-mix(in srgb, {colors.cyan} 12%, transparent)"
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

The surface, hairline, control, confirm and error values are all tokens too (`panel-*`, `hairline*`,
`brass-*`, `confirm-*`, `error-*`). They are alpha-composited over the ground rather than opaque, so
a panel inside a panel deepens instead of flattening, and every one of them is the game's own value.

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

The ramp is nine steps, exposed as `--text-*` custom properties, and nothing outside it may declare a
literal size. Before it existed the codebase carried twenty-two distinct font sizes, eight of them
between 0.76rem and 0.88rem, which is not a hierarchy but noise: no reader can tell those apart, and
no contributor could tell which one to reach for.

| Token | Size | Job |
|---|---|---|
| `--text-display` | `clamp(1.6rem, 3.4vw, 2.3rem)` | page title |
| `--text-title` | `1.1rem` | section and card titles |
| `--text-lead` | `1.05rem` | the opening sentence of a page |
| `--text-body` | `1rem` | body prose |
| `--text-sm` | `0.88rem` | secondary prose, descriptions, list rows |
| `--text-xs` | `0.8rem` | metadata, counts, sub-lines |
| `--text-2xs` | `0.72rem` | chip labels and fact labels |
| `--text-kicker` | `9px` | the tracked uppercase kicker |
| `--text-control` | `11px` | buttons |

The last two are pixel values because they are the game's own: its kicker is 9px and its buttons
11px, and rounding them onto the rem scale would break the inheritance that makes this read as part
of Vespera. The one deliberate exception to the ramp is the lettered art fallback, which sizes in
`em` so the initials scale with whichever art box holds them.

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
- **Don't** write a literal colour or font size. Every value comes from a `--` token in `app.css`,
  and those come from the game. A value that genuinely has no token is a missing token, not an
  exception: add it here and in `:root` in the same change.
- **Don't** render a `snake_case` column name, a raw asset path, or a bare enum token to a player.
- **Don't** add a second shadow step or a card that floats. Depth here is tonal.
- **Don't** put schema metadata in a page's opening. The build stamp lives in the footer.
