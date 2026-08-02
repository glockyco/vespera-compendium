<script lang="ts">
  import { resolve } from "$app/paths";
  import Art from "$lib/components/Art.svelte";
  import ClassPlate from "$lib/components/ClassPlate.svelte";
  import HeroArt from "$lib/components/HeroArt.svelte";
  import Search from "$lib/components/Search.svelte";
  import { VERIFICATION_LABEL } from "$lib/mechanics-verification";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const n = (value: number) => value.toLocaleString("en-US");

  /** Numbers chapters with the ledger's marks instead of browser list markers. */
  const CHAPTER_MARKS = ["I", "II", "III"];
</script>

<svelte:head>
  <title>Vespera Compendium</title>
  <meta
    name="description"
    content="Game systems, items, enemies, quests, recipes, abilities, and progression in Vespera. The compendium uses shipped game data and logic. Selected formulas and records pass live-game checks."
  />
</svelte:head>

<!--
  The hero puts provenance and search on the left and one painted place on the right.
  Guides start below. Visitors can search first or read the systems before the database.
-->
<section class="hero">
  <div class="hero-ledger">
    <span class="kicker">EXPEDITION LEDGER</span>
    <h1>Find your way through Vespera</h1>
    <p class="lede">
      The compendium checks every game claim across {n(data.recordCount)} records and {data.mechanicCount} system
      guides against shipped logic. The game also checks selected formulas and facts live.
      The compendium marks headings and labels separately, so you can see which words come from the game.
    </p>
    <div class="hero-search">
      <Search
        idBase="home-search"
        size="lg"
        placeholder="Search a system, item, enemy, quest, recipe or zone…"
        narrowPlaceholder="Search the compendium…"
      />
      <p class="hero-hint">Press <kbd>/</kbd> to search from any page.</p>
    </div>
  </div>

  {#if data.heroPlace}
    <figure class="hero-plate">
      <HeroArt src={data.heroPlace.image} alt={data.heroPlace.name} />
      <figcaption>
        <span class="plate-name">{data.heroPlace.name}</span>
        {#if data.heroPlace.level !== null}
          <span class="plate-level">Combat {data.heroPlace.level}</span>
        {/if}
      </figcaption>
    </figure>
  {/if}
</section>

<!--
  Guides follow search. Three treatments avoid five identical cards.
  The combat guide leads with a computed formula. The endgame guide follows its route.
  The other three use field-manual rows.
-->
<section class="band">
  <h2>Understand the game</h2>
  <p class="band-line">
    Before you choose a class, build gear, or enter endgame, read the rules and formulas.
  </p>

  <div class="guides">
    <article class="guide-lead">
      <span class="entry-mark">Start here</span>
      <h3 class="guide-title">
        <a href={resolve(`/mechanics/${data.leadGuide.id}/`)}>{data.leadGuide.title}</a>
      </h3>
      <p class="guide-summary">{data.leadGuide.summary}</p>

      <div class="formula-plate">
        <span
          class="formula-label"
          data-mechanic-text={data.featuredFormula.label.id}
          data-verification={data.featuredFormula.label.status}
        >{data.featuredFormula.label.text}</span>
        <code
          class="formula-expression"
          data-mechanic-text={data.featuredFormula.expression.id}
          data-verification={data.featuredFormula.expression.status}
        >{data.featuredFormula.expression.text}</code>
        <span class="stamp" data-verification-label>
          {VERIFICATION_LABEL[data.featuredFormula.expression.status]}
        </span>
        {#if data.featuredFormula.note}
          <p
            class="formula-note"
            data-mechanic-text={data.featuredFormula.note.id}
            data-verification={data.featuredFormula.note.status}
          >{data.featuredFormula.note.text}</p>
        {/if}
      </div>

      <span class="entry-stamp">{data.leadGuide.contentLabel}</span>
    </article>

    <div class="guide-rows">
      {#each data.fieldGuides as guide (guide.id)}
        <a class="guide-row" href={resolve(`/mechanics/${guide.id}/`)}>
          <span class="guide-row-title">{guide.title}</span>
          <span class="guide-row-summary">{guide.summary}</span>
          <span class="entry-stamp">{guide.contentLabel}</span>
        </a>
      {/each}
    </div>

    <article class="guide-route">
      <span class="entry-mark">The long way up</span>
      <h3 class="guide-title">
        <a href={resolve(`/mechanics/${data.routeGuide.id}/`)}>{data.routeGuide.title}</a>
      </h3>
      <p class="guide-summary">{data.routeGuide.summary}</p>
      <ol class="route-steps">
        {#each data.routeGuide.steps as step (step.id)}
          <li data-mechanic-text={step.id} data-verification={step.status}>{step.text}</li>
        {/each}
      </ol>
      <span class="entry-stamp">{data.routeGuide.contentLabel}</span>
    </article>
  </div>
</section>

<!--
  The class hall uses game-authored portraits, titles, world roles, and traits.
  The shared plate also appears on `/classes/`.
-->
<section class="band">
  <h2>Choose your class</h2>
  <p class="band-line">
    Read every ability and every piece of class-restricted gear that the game defines for all four classes.
  </p>
  <div class="hall">
    {#each data.classes as entry (entry.id)}
      <ClassPlate {...entry} />
    {/each}
  </div>
  <p class="band-foot">
    Read <a href={resolve("/mechanics/combat-mathematics/")}>Combat Mathematics</a> for the damage
    and Defense rules, and
    <a href={resolve("/mechanics/ability-calculations/")}>Ability Calculations</a> for how a class stat
    reaches an ability.
  </p>
</section>

<!--
  This route follows the game's three stretches.
  The old thirty-two-row list showed sort order, not the journey.
  Each chapter now has a painted place, Combat range, and three stops.
-->
<section class="band">
  <h2>Follow Combat progression</h2>
  <p class="band-line">
    Zones and dungeons appear in the order you meet them. Each one lists its expected level.
  </p>
  <ol class="chapters">
    {#each data.chapters as chapter, index (chapter.id)}
      <li class="chapter">
        <Art
          kind="zone"
          variant="wide"
          box="panorama"
          src={chapter.panorama.image}
          alt={chapter.panorama.name}
        />
        <div class="chapter-head">
          <span class="entry-mark">{CHAPTER_MARKS[index] ?? index + 1}</span>
          <h3>{chapter.label}</h3>
          <span class="chapter-range">Combat {chapter.from}–{chapter.to}</span>
        </div>
        <p class="chapter-line">{chapter.blurb}</p>
        <ul class="stops">
          {#each chapter.stops as stop (stop.id)}
            <li>
              <a href={resolve(`/zones-dungeons/${stop.id}/`)}>
                <span class="stop-name">{stop.name}</span>
                <span class="stop-level">{stop.level ?? "—"}</span>
              </a>
            </li>
          {/each}
        </ul>
        <span class="chapter-count">{chapter.count} places in this chapter</span>
      </li>
    {/each}
  </ol>
  <p class="band-foot">
    <a href={resolve("/progression/")}>See every place, band by band</a>, including the
    {n(data.endgamePlaces)} heroic and nightmare places up to Combat {data.levelCeiling}. What waits after
    them is in <a href={resolve("/mechanics/endgame-systems/")}>Endgame Systems</a>.
  </p>
</section>

<!--
  The index appears last and stays quiet.
  It lists each record type, its count, and its entry link.
-->
<section class="band">
  <h2>Compendium index</h2>
  <p class="band-line">Open an index to browse its records.</p>
  <ul class="ledger">
    {#each data.indexTables as entry (entry.name)}
      <li>
        <a href={resolve(`/${entry.slug}/`)}>
          <span class="ledger-label">{entry.label}</span>
          <span class="ledger-rule" aria-hidden="true"></span>
          <span class="ledger-count">{n(entry.rows)}</span>
        </a>
      </li>
    {/each}
  </ul>
  <p class="ledger-note">
    The model cannot name a source for {n(data.unmodelledItems)} items. This does not mean that the items
    are unobtainable.
    <a href={resolve("/sources/")}>Read the model limits.</a>
  </p>
</section>

<section class="band tools">
  <a class="tool" href={resolve("/query/")}>
    <span class="tool-name">Query</span>
    <span class="tool-line">Run read-only SQL queries.</span>
  </a>
  <a class="tool" href={resolve("/sheets/")}>
    <span class="tool-name">Sheets</span>
    <span class="tool-line">Download a spreadsheet feed for each published table.</span>
  </a>
</section>

<style>
  /* ---- Hero ------------------------------------------------------------------------------- */

  .hero {
    display: grid;
    gap: clamp(1.2rem, 3vw, 2.2rem);
    align-items: start;
  }

  @media (min-width: 54rem) {
    .hero {
      grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
    }
  }

  .hero-ledger {
    min-inline-size: 0;
  }

  .lede {
    max-inline-size: 40rem;
    margin-block-end: 0;
    color: var(--lavender-grey);
    font-size: var(--text-lead);
    text-wrap: pretty;
  }

  .hero-search {
    margin-block-start: 1.5rem;
    max-inline-size: 40rem;
  }

  .hero-hint {
    margin: 0.55rem 0 0;
    color: var(--lavender-grey);
    font-size: var(--text-xs);
  }

  kbd {
    padding: 0.1rem 0.4rem;
    border: 1px solid var(--line-soft);
    border-radius: var(--radius-control);
    background: var(--panel-hover);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
  }

  .hero-plate {
    display: grid;
    gap: 0.5rem;
    margin: 0;
    min-inline-size: 0;
  }

  .hero-plate figcaption {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.3rem 1rem;
    padding-block-start: 0.4rem;
    border-block-start: 1px solid var(--line);
  }

  .plate-name {
    color: var(--parchment);
    font-size: var(--text-sm);
    font-weight: 700;
  }

  .plate-level {
    color: var(--kicker);
    font-size: var(--text-2xs);
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  /* ---- Bands ------------------------------------------------------------------------------ */

  .band {
    margin-block-start: clamp(2.4rem, 5vw, 3.6rem);
  }

  .band h2 {
    margin: 0;
    padding-block-end: 0.5rem;
    border-block-end: 1px solid var(--line);
    color: var(--parchment);
    font-size: var(--text-title);
    font-weight: 800;
  }

  .band-line {
    margin: 0.6rem 0 1.1rem;
    max-inline-size: 68ch;
    color: var(--lavender-grey);
    font-size: var(--text-sm);
  }

  .band-foot {
    margin: 1.1rem 0 0;
    max-inline-size: 68ch;
    color: var(--lavender-grey);
    font-size: var(--text-sm);
  }

  /*
   * Band links and ledger notes act as touch targets, not citations.
   * They use the same 2.75rem row height as stops, index rows, and tools.
   * A shorter row lets targets overlap and sends clicks to the wrong link.
   * No side padding keeps the comma and link in the same text flow.
   */
  .band-foot,
  .ledger-note {
    line-height: 2.75rem;
  }

  .band-foot a,
  .ledger-note a {
    display: inline-flex;
    align-items: center;
    min-block-size: 2.75rem;
    min-inline-size: 2.75rem;
  }

  /*
   * Each ledger entry opens with a tracked mark and closes with a dotted provenance stamp.
   * Both repeat because a ledger is read by its rulings.
   */
  .entry-mark {
    display: block;
    color: var(--kicker);
    font-size: var(--text-kicker);
    font-weight: 800;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }

  .entry-stamp {
    display: block;
    margin-block-start: auto;
    padding-block-start: 0.55rem;
    border-block-start: 1px dotted var(--hairline);
    color: var(--text-muted);
    font-size: var(--text-2xs);
    letter-spacing: 0.04em;
  }

  /* ---- Guides ----------------------------------------------------------------------------- */

  .guides {
    display: grid;
    gap: 0.9rem;
  }

  @media (min-width: 62rem) {
    .guides {
      grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
    }

    .guide-lead {
      grid-column: 1 / -1;
    }
  }

  .guide-lead,
  .guide-route,
  .guide-row {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: clamp(0.9rem, 2vw, 1.3rem);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: linear-gradient(145deg, var(--panel-top), var(--panel-bottom) 72%);
  }

  .guide-title {
    margin: 0;
    font-size: var(--text-title);
  }

  .guide-title a {
    display: inline-flex;
    align-items: center;
    min-block-size: 2.75rem;
    color: var(--parchment);
  }

  .guide-title a:hover {
    color: var(--brass-warm);
    text-decoration: none;
  }

  .guide-summary {
    margin: 0;
    max-inline-size: 68ch;
    color: var(--lavender-grey);
    font-size: var(--text-sm);
  }

  /*
   * The worked formula proves that guides use shipped logic instead of memory.
   * Put it on a plate instead of folding it into prose.
   */
  .formula-plate {
    display: grid;
    gap: 0.35rem;
    margin-block: 0.6rem 0.2rem;
    padding: 0.75rem 0.85rem;
    border: 1px solid var(--line-soft);
    border-radius: var(--radius-field);
    background: var(--panel-sunken);
  }

  .formula-label {
    color: var(--kicker);
    font-size: var(--text-kicker);
    font-weight: 800;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  /* A formula alone can scroll sideways because wrapping changes its meaning.
     `min-inline-size` keeps the scroll inside the plate. */
  .formula-expression {
    min-inline-size: 0;
    overflow-x: auto;
    color: var(--parchment);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: 1.6;
  }

  .formula-note {
    margin: 0;
    color: var(--lavender-grey);
    font-size: var(--text-xs);
  }

  .stamp {
    justify-self: start;
    padding: 0.1rem 0.45rem;
    border: 1px solid var(--brass-edge);
    border-radius: var(--radius-chip);
    /* One provenance vocabulary uses one color on every surface.
       This matches the guides' "Source checked" stamp. */
    color: var(--brass-deep);
    font-size: var(--text-2xs);
    font-weight: 700;
    letter-spacing: 0.06em;
  }

  .guide-rows {
    display: grid;
    gap: 0.9rem;
    align-content: start;
  }

  .guide-row {
    gap: 0.25rem;
    color: inherit;
    text-decoration: none;
  }

  .guide-row:hover,
  .guide-row:focus-visible {
    border-color: var(--brass);
    text-decoration: none;
  }

  .guide-row-title {
    color: var(--parchment);
    font-size: var(--text-lead);
    font-weight: 700;
  }

  .guide-row:hover .guide-row-title {
    color: var(--brass-warm);
  }

  .guide-row-summary {
    max-inline-size: 68ch;
    color: var(--lavender-grey);
    font-size: var(--text-sm);
  }

  /*
   * The endgame guide follows its route: one ruled column with one system per stop.
   * A summary card flattens eleven ordered systems into one sentence.
   */
  .route-steps {
    display: grid;
    gap: 0.3rem;
    margin: 0.5rem 0 0;
    padding-inline-start: 1.1rem;
    border-inline-start: 1px solid var(--line);
    list-style: none;
    counter-reset: route;
  }

  .route-steps li {
    position: relative;
    color: var(--parchment);
    font-size: var(--text-sm);
  }

  .route-steps li::before {
    position: absolute;
    inset-inline-start: calc(-1.1rem - 5px);
    inset-block-start: 0.45rem;
    display: block;
    inline-size: 0.5rem;
    block-size: 0.5rem;
    border: 1px solid var(--brass-deep);
    border-radius: 999px;
    background: var(--painted-indigo);
    content: "";
  }

  /* ---- Class hall ------------------------------------------------------------------------- */

  .hall {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.9rem;
  }

  @media (min-width: 38rem) {
    .hall {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (min-width: 58rem) {
    .hall {
      grid-template-columns: repeat(4, 1fr);
    }
  }

  /* ---- Route chapters --------------------------------------------------------------------- */

  .chapters {
    display: grid;
    gap: 1rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  @media (min-width: 58rem) {
    .chapters {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  .chapter {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-inline-size: 0;
  }

  .chapter-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: baseline;
    gap: 0.2rem 0.7rem;
  }

  .chapter-head .entry-mark {
    grid-column: 1 / -1;
  }

  .chapter-head h3 {
    margin: 0;
    color: var(--parchment);
    font-size: var(--text-lead);
    font-weight: 800;
  }

  .chapter-range {
    color: var(--brass-warm);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .chapter-line {
    margin: 0;
    color: var(--lavender-grey);
    font-size: var(--text-sm);
  }

  .stops {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .stops a {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.7rem;
    min-block-size: 2.75rem;
    padding-block: 0.3rem;
    border-block-end: 1px dotted var(--hairline);
    color: inherit;
    text-decoration: none;
  }

  .stops a:hover .stop-name {
    color: var(--brass-warm);
  }

  .stop-name {
    color: var(--cyan);
    font-size: var(--text-sm);
  }

  .stop-level {
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .chapter-count {
    color: var(--text-muted);
    font-size: var(--text-2xs);
    font-variant-numeric: tabular-nums;
  }

  /* ---- Compendium index ------------------------------------------------------------------- */

  .ledger {
    margin: 0;
    padding: 0;
    max-inline-size: 44rem;
    list-style: none;
  }

  .ledger a {
    display: grid;
    grid-template-columns: auto minmax(1.5rem, 1fr) auto;
    align-items: center;
    gap: 0.7rem;
    min-block-size: 2.75rem;
    padding-inline: 0.2rem;
    border-block-end: 1px dotted var(--hairline);
    color: inherit;
    text-decoration: none;
  }

  .ledger a:hover {
    background: var(--panel-hover);
    text-decoration: none;
  }

  .ledger a:hover .ledger-label {
    color: var(--brass-warm);
  }

  .ledger-label {
    color: var(--parchment);
    font-size: var(--text-body);
  }

  /* A leader rule connects each name to its count and gives the index its ledger form. */
  .ledger-rule {
    block-size: 0;
    border-block-end: 1px dotted var(--hairline-faint);
  }

  .ledger-count {
    color: var(--lavender-grey);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }

  .ledger-note {
    margin: 1rem 0 0;
    max-inline-size: 68ch;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  /* ---- Tools ------------------------------------------------------------------------------ */

  .tools {
    display: flex;
    flex-wrap: wrap;
    gap: 0.7rem;
  }

  .tool {
    display: flex;
    flex: 1 1 16rem;
    flex-direction: column;
    gap: 0.15rem;
    min-block-size: 2.75rem;
    padding: 0.7rem 0.9rem;
    border: 1px solid var(--line-soft);
    border-radius: var(--radius-field);
    color: inherit;
    text-decoration: none;
  }

  .tool:hover {
    border-color: var(--brass);
    text-decoration: none;
  }

  .tool-name {
    color: var(--brass-warm);
    font-size: var(--text-kicker);
    font-weight: 800;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .tool-line {
    color: var(--lavender-grey);
    font-size: var(--text-sm);
  }
</style>
