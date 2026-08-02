---
name: Vespera Compendium
description: The player's question answered in one page, dressed in the game's own painted-indigo and brass.
colors:
  obsidian: "#030813"
  painted-indigo: "#071426"
  painted-elevated: "#132640"
  brass: "#d6a94f"
  brass-warm: "#f0c76a"
  brass-deep: "#b4812a"
  parchment: "#f1e6c8"
  lavender-grey: "#aeb9c8"
  text-muted: "#7d8da5"
  teal-dust: "#4c6f9a"
  lilac-painted: "#8f7aa5"
  ember: "#b86638"
  teal: "#5fc6b6"
  cyan: "#65b9dd"
  green: "#8ed5a4"
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
    fontSize: "clamp(2rem, 4vw, 3rem)"
    fontWeight: 800
    lineHeight: 1.15
  title:
    fontFamily: "{typography.display.fontFamily}"
    fontSize: "1.25rem"
    fontWeight: 800
    lineHeight: 1.15
  lead:
    fontFamily: "{typography.display.fontFamily}"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.5
  body:
    fontFamily: "{typography.display.fontFamily}"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.5
  sm:
    fontFamily: "{typography.display.fontFamily}"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
  xs:
    fontFamily: "{typography.display.fontFamily}"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  2xs:
    fontFamily: "{typography.display.fontFamily}"
    fontSize: "0.75rem"
    fontWeight: 700
    letterSpacing: "0.06em"
    lineHeight: 1.35
  kicker:
    fontFamily: "{typography.display.fontFamily}"
    fontSize: "0.75rem"
    fontWeight: 800
    letterSpacing: "0.15em"
    lineHeight: 1.2
  control:
    fontFamily: "{typography.display.fontFamily}"
    fontSize: "0.875rem"
    fontWeight: 800
    letterSpacing: "0.08em"
    lineHeight: "normal"
  panel-title:
    fontFamily: "{typography.display.fontFamily}"
    fontSize: "1.125rem"
    fontWeight: 800
    letterSpacing: "0.13em"
    lineHeight: 1.15
  panel-sub:
    fontFamily: "{typography.display.fontFamily}"
    fontSize: "1rem"
    fontWeight: 800
    letterSpacing: "0.11em"
    lineHeight: 1.15
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace"
    fontSize: "0.875rem"
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
    padding: "0.5rem 0.85rem"
    height: "2.75rem"
    typography: "{typography.control}"
  button-active:
    backgroundColor: "color-mix(in srgb, {colors.brass} 22%, transparent)"
    textColor: "{colors.parchment}"
    rounded: "{rounded.control}"
    padding: "0.5rem 0.85rem"
    height: "2.75rem"
  button-primary:
    backgroundColor: "linear-gradient(180deg, {colors.confirm-top}, {colors.confirm-bottom})"
    textColor: "{colors.confirm-ink}"
    rounded: "{rounded.control}"
    padding: "0.5rem 0.85rem"
    height: "2.75rem"
  field:
    backgroundColor: "{colors.panel-inset}"
    textColor: "{colors.parchment}"
    rounded: "{rounded.field}"
    padding: "0.55rem 0.7rem"
    height: "2.75rem"
    typography: "{typography.sm}"
  chip:
    backgroundColor: "{colors.panel-raised}"
    textColor: "{colors.parchment}"
    rounded: "{rounded.chip}"
    padding: "0.18rem 0.5rem"
    typography: "{typography.xs}"
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
  stamp:
    textColor: "{colors.brass-deep}"
    rounded: "{rounded.chip}"
    padding: "0.1rem 0.45rem"
    typography: "{typography.2xs}"
---

# Design

## Overview

**The Quartermaster's Provenance Ledger.** Each record is a requisition entry. It answers where a thing comes from and at what level it becomes reachable.

The page follows that ledger pattern. Brass hairline panels sit on painted indigo. Tracked labels sit above each section. Tabular figures use separate gutters for quantities that must not be added together.

The palette, panel treatment, kicker typography, rarity hues, and typeface come from Vespera. The compendium takes them from the shipped stylesheets.

`index-TpX1HTVU.css` defines surfaces and brass. `GameView-V33hRMR7.css` defines rarity. `mercenary-war-table.css` defines the panel and kicker idiom.

The compendium reads as an extension of the game, not a third-party table dump.

The game fixes this inheritance. New surfaces extend this vocabulary. They do not restyle it.

The game supplies weight, tracking, case, colour, and surface treatment. It does not supply size.

The game uses HUD sizes for a fixed client viewport. This page is for reading, not operation. Every size in this system uses the rem ramp below.

The mood is a lit reading table in a dark room. Ink is warm. The ground is cold. Brass is the only saturated accent.

The anti-reference is the generic data browser that this design replaced. It used `snake_case` headers, one wide table per page, and schema metadata as the first line on the home page.

**Key Characteristics:**

- One family, one accent, one shadow.
- Tonal depth. A closer surface gets a lighter ground, never a bigger shadow.
- Semantic colour. Rarity and level scale always carry a word beside the hue.
- Dense rows, bounded prose. A 76rem page column and a 68ch reading measure are two different caps.

## Colors

Painted indigo is the ground. Obsidian is the darkest value. The sticky top bar sits on it at 88% behind a blur.

Surfaces step up through the alpha-composited panel tokens. `painted-elevated` is the only opaque lifted plane. It serves the sticky table header and the skip link.

Brass is the only accent that carries emphasis. Use it for the wordmark, a quantity, a hovered border, an active filter, and a provenance mark.

Parchment is body ink. `lavender-grey` is secondary prose. `text-muted` is metadata.

The surface, hairline, control, and error values are also tokens (`panel-*`, `hairline*`,
`brass-*`, `confirm-*`, `error-*`). They use alpha composition over the ground rather than opaque fills.

A panel inside a panel therefore becomes darker instead of flat. Every value comes from the game.

Three declarations in `:root` have no role in this build: `--painted-surface`, `--royal-blue`, and `--red`.

The build inherits these values, but no caller uses them. They are not part of this system. Do not use them to solve a new problem.

### Primary

- **Brass** (`brass`): the wordmark, an emphasized figure, a hovered panel border, an active filter.
- **Warm Brass** (`brass-warm`): hover and focus ink for links, control labels, and the focus ring.
- **Deep Brass** (`brass-deep`): the provenance mark. It is the darkest brass step and the only one used as small text on a panel.

Measured against every ground where it can appear, it holds 5.45:1 on `panel-top` and 4.97:1 on `panel-raised`.

It holds 4.76:1 on `panel-hover`.

It holds 4.60:1 on `panel-hover-strong` and 5.71:1 on `panel-inset`. Each result clears the 4.5:1 AA floor for small text.

### Neutral

- **Parchment** (`parchment`): body ink and every heading. It measures 14.86:1 on the page ground.
- **Lavender Grey** (`lavender-grey`): paragraph prose and secondary lines. It measures 9.3:1 on the page ground.
- **Muted Slate** (`text-muted`): chip labels, guide stamps, counts, breadcrumbs, and placeholder text.

It holds 5.55:1 on `panel-top`, 5.07:1 on `panel-raised`, and 4.85:1 on `panel-hover`.

It holds 4.68:1 on `panel-hover-strong` and 5.81:1 on `panel-inset`. Each result clears the 4.5:1 AA floor.

Placeholder text uses `text-muted` with `opacity: 1`. The browser default is dimmer than every token here and misses the floor.

Placeholder text names what a field accepts, so it must be legible. It measures 5.80:1 or better on every field in the build.

It appears at 18px on the home page and 15px on inner pages.

### Semantic

Two colour families have semantic meaning. Do not reuse them for decoration.

- **Rarity**: the seven hues come from the game and always mean rarity. They tint a name, an art frame, or a chip value.

They never tint a background or an unrelated accent.

- **The three level scales**: ember means Combat, green means Gathering, and cyan means Crafting.

The game gates three different skills. Its quest guidance keeps those skills apart.

A hue never carries a scale by itself. The chip prints the scale name beside the number. The progression gutters also have labels and tints.

### Named Rules

**The One Status One Colour Rule.** A provenance status uses one colour on every surface.

"Source checked" is deep brass wherever it appears. The home page's formula stamp once used `brass-warm`, while the same status used deep brass elsewhere.

That difference made one status look like two. The stamp now uses `brass-deep`. Each new provenance surface uses the same colour for the same status.

**The Rationed Brass Rule.** Brass marks the thing that the reader seeks.

If a screen has more than a few brass elements, the accent loses meaning. Change some elements to parchment or lavender.

## Typography

**Display and Body Font:** Source Sans 3 (with `ui-sans-serif`, `system-ui`, `sans-serif`)
**Mono Font:** `ui-monospace` (with SFMono-Regular, Menlo, Monaco, Consolas)

**Character:** one family, the game's own. Hierarchy comes from size, weight, and tracking rather than a second face.

Headings use 800 weight and tight 1.15 line-height. Body text uses 1.5 line-height at normal weight.

The ramp has eleven `--text-*` custom properties. Nothing outside it can declare a literal size.

Sizes that differ by a fraction of a step add noise instead of hierarchy. Readers cannot tell them apart. Contributors cannot tell which one to use.

### Hierarchy

| Token | Size | Shows at | Job |
|---|---|---|---|
| `--text-display` | `clamp(2rem, 4vw, 3rem)` | 32-48px | the page title, one per page |
| `--text-title` | `1.25rem` | 20px | card and band titles outside the panel-heading system |
| `--text-lead` | `1.125rem` | 18px | the opening sentence of a page |
| `--text-body` | `1.0625rem` | 17px | body prose, and the document base size |
| `--text-sm` | `0.9375rem` | 15px | secondary prose, descriptions, table cells, field text |
| `--text-xs` | `0.875rem` | 14px | metadata, counts, sub-lines, monospace identifiers |
| `--text-2xs` | `0.75rem` | 12px | chip labels, provenance stamps, fact labels |
| `--text-kicker` | `0.75rem` | 12px | the tracked uppercase kicker and table column headers |
| `--text-control` | `0.875rem` | 14px | interactive labels on buttons |
| `--text-panel-title` | `1.125rem` | 18px | the h2 heading of a panel |
| `--text-panel-sub` | `1rem` | 16px | the h3 heading inside a panel |

Eleven tokens resolve to eight distinct sizes. Three pairs have one value with two names:

- `--text-2xs` and `--text-kicker` are both 12px.
- `--text-xs` and `--text-control` are both 14px.
- `--text-lead` and `--text-panel-title` are both 18px.

Each name in a pair keeps a distinct job. The job decides which name to write.

A chip label is `--text-2xs`. A tracked uppercase mark is `--text-kicker`.

A metadata line is `--text-xs`. A button label is `--text-control`.

An opening sentence is `--text-lead`. A panel heading is `--text-panel-title`.

The names stay apart because the jobs differ. A future change to one name does not change the other.

`--text-kicker` and `--text-control` use the rem ramp, not the game's pixel values.

The shipped client sets its kicker at 9px and its button label at 11px. These are HUD sizes for a fixed client viewport.

They were unreadable as page furniture on a browser page read at arm's length and on a phone.

The rem ramp keeps the game's weight, tracking, case, and colour. These properties carry the inheritance. Size does not.

The one deliberate exception to the ramp is the lettered art fallback. It uses `em` so the initials scale with each art box.

It is the only literal font size in the build.

The kicker is the signature: 12px, 800 weight, `0.15em` tracking, uppercase, in `kicker` teal.

It sits above a page title and marks a table column header. It gives a panel the character of a ledger entry.

Reserve monospace for identifiers that a reader can copy, such as a record's raw id or a SQL string.

It is never used for prose or figures.

Every figure that readers can compare down a column uses `font-variant-numeric: tabular-nums`.

### Named Rules

**The One Level One Size Rule.** A semantic heading level shows at one size on a page.

A panel h2 is `--text-panel-title`. A panel h3 is `--text-panel-sub`.

Before this build, one level showed at three sizes on one page. Panel headings were smaller than the body copy that they introduced.

This difference inverted the hierarchy. Every panel h2 on `/classes/arcanist/` and `/items/eclipse_gem_ruby/` now measures 18px.

Every panel h3 on `/classes/arcanist/` measures 16px. A panel heading keeps the tracked uppercase ledger character at both levels.

**The Ramp Rule.** No file declares a literal font size. A size without a token is a missing token, not an exception.

**The Measure Rule.** Use body prose with a 68ch cap. Tables, chip rows, and record lists keep the full column width.

Readers scan a fact list down rather than read it across. The cap sits on the paragraph, not on the column.

A 20rem claim grid keeps the provenance gutter aligned. A 98-character line makes a paragraph hard to read.

## Layout

The centred column is 76rem wide. The top bar and footer span it.

The page cap is separate from the 68ch prose measure. The column sets page width. The measure sets the length of each running-text line.

The two values never replace each other. The home hero keeps its lede and hint at 40rem. Its route list uses 44rem.

Content grids are intrinsic first: `repeat(auto-fit, minmax(<floor>, 1fr))`. The floor keeps the content legible.

The floors are 20rem for record blocks, 18rem for mechanics facts, and 16rem for browse card grids.

They are 15rem for slot groups, 13rem for the shared card grid, and 11rem for a paired fact list.

A named breakpoint appears only when a two-column composition must collapse to one. The build has thirteen such queries at 38, 40, 48, 52, 54, 58, and 62rem.

The top bar is one of these queries. It places the search field below the wordmark under 54rem.

Density is high by intent. A compendium supports quick reading, so rows are tight and separators are dotted hairlines instead of full rules.

A wide join table scrolls sideways inside its own frame. It does not break the mobile viewport.

The two longest lists are search results and the class gear list. Each list has a height cap and scrolls inside its panel instead of making the page longer.

Every control that a thumb must hit is at least 44px. This includes the search field, buttons, the sort control in a table header, and the breadcrumb link out of a record.

## Elevation & Depth

The design is tonal, not lifted. Depth comes from the brass hairline and the panel gradient.

A single shared shadow reads as the page's ambient recess rather than as a raised card. The build has exactly one shadow token, `--panel-shadow`, and no elevation scale.

A surface that needs to feel closer gets a lighter ground, not a bigger shadow.

The only other shadow is the inset hairline ring on the Bar track. It is a border drawn with a shadow, not an elevation step.

The body carries the game's radial vignette. The page is never a flat slab.

### Named Rules

**The Flat Ledger Rule.** Surfaces do not float. If a new surface seems to need a second shadow step, give it a lighter ground token instead.

## Shapes

Radius has a function. It steps with element size: 999px for chips, 5px for controls, and 6px for fields.

It uses 8px for art frames and 12px for panels.

Borders are single-pixel and low-contrast. Warm brass marks a panel edge. Cool `line-soft` marks an internal division.

Art sits in a fixed square frame. The border uses the rarity tint.

## Components

- **Panel** - the ledger entry. It has a brass hairline, gradient ground, 12px radius, one shared shadow, and a `clamp(0.9rem, 2vw, 1.4rem)` pad.
  Every record section, browse group, and spine band uses it.
- **AnswerBlock** - a panel section with a tracked uppercase h2 in `--text-panel-title`, an optional count in `--text-xs`, and a `line-soft` rule under the head.
  All twelve record types use it, so a reader learns the page shape once. Its empty state is a sentence, never a dash.
  The default reads "Nothing modelled here yet". A caller can pass a sharper sentence such as "No source is modelled for this item yet".
  Callers pass emptiness explicitly because a snippet that shows nothing is still a snippet.
- **Chip** - one labelled fact with the label above the value in miniature. The chip is `--text-xs` and the label is `--text-2xs` uppercase in `text-muted`.
  The three level-scale tones are the only coloured variants. Each tints its border and ground.
- **Stamp** - the provenance mark. It is a pill with a brass hairline and `--text-2xs` at 700 weight in `brass-deep`.
  It states what was checked, never that a whole page passed a probe.
- **Art** - the game's own picture in a fixed box per size (2rem, 3.5rem, 6rem, or full).
  The layout reserves the box before image load, so grids never reflow. The image is decorative because a name always sits beside it.
  A record without art gets its first two letters instead of an empty frame. Thumbnails load lazily.
  The one hero panorama loads eagerly because it is in the first viewport.
- **EntityLink** - the single way for one record to point at another: thumbnail, name in rarity colour, and optional sub-line.
  Names wrap rather than truncate.
- **ClassPlate** - a panel whose ground uses the class's own hue at 11-15% over `panel-top`.
  The tint is a portrait frame, not a status colour.
- **Bar** - a proportion with its figure printed beside it, never width alone.
- **Button** - small, uppercase, tracked, and brass on a faint brass wash. It has a 5px radius and is 44px tall.
  The active filter state fills with brass at 22% and switches ink to parchment.
  The facet variant is the one denser button. It uses `--text-xs` and a 0.15rem pad.
- **Field** - a sunken `panel-inset` ground behind a brass hairline. It has a 6px radius, is 44px tall, and uses text at `--text-sm`.
  Its placeholder uses `text-muted`.

## Do's and Don'ts

### Do:

- **Do** state which level scale a number belongs to every time. A bare `10` is ambiguous between three skills that the game separates.
- **Do** lead a record with the answer. The first block gives the requested information, and the table is the fallback.
- **Do** say when the model does not know something. The absence of a modelled source is a boundary of this dataset, never evidence that an item cannot be obtained.
- **Do** cap running prose at 68ch. Leave tables, chip rows, and record lists at full width.
- **Do** give one provenance status one colour on every surface.
- **Do** reserve layout before art loads. Load content below the fold lazily.
- **Do** keep a thumb target at 44px or more.

### Don't:

- **Don't** signal rarity or level scale by colour alone. The label carries the meaning too.
- **Don't** write a literal colour or font size. Every value comes from a `--` token in `app.css`, and those tokens come from the game.
  A value without a token is a missing token, not an exception. Add it here and in `:root` in the same change.
- **Don't** size a label from the game's pixel values. The game supplies weight, tracking, case, and colour, but not size.
- **Don't** show a `snake_case` column name, a raw asset path, or a bare enum token to a player.
- **Don't** add a second shadow step or a card that floats. Depth here is tonal.
- **Don't** put schema metadata in a page opening. The build stamp lives in the footer.
- **Don't** show one semantic heading level at two sizes on one page.
