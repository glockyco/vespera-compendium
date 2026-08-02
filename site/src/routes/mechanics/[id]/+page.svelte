<script lang="ts">
  import { resolve } from "$app/paths";
  import { VERIFICATION_LABEL } from "$lib/mechanics-verification";
  import type { MechanicVerificationStatus } from "$lib/mechanics-verification";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  /**
   * The guide reads as a ledger: the claim on the left, where it came from in the right-hand
   * gutter. Provenance is per string because that is how it was established — a game-authored
   * formula can sit under a compendium-written label, and a shared badge would let the label
   * inherit a claim the game never made.
   */
  const CATEGORY_KICKER: Record<PageData["category"], string> = {
    combat: "COMBAT SYSTEMS",
    skills: "SKILL SYSTEMS",
    equipment: "EQUIPMENT SYSTEMS",
    progression: "PROGRESSION SYSTEMS",
  };
</script>

{#snippet mark(status: MechanicVerificationStatus)}
  <span class="mark mark-{status}" data-verification-label>{VERIFICATION_LABEL[status]}</span>
{/snippet}

<svelte:head>
  <title>{data.title.text} — Vespera Compendium</title>
  <meta name="description" content={data.summary.text} />
</svelte:head>

<nav class="crumbs" aria-label="Breadcrumb">
  <a href={resolve("/")}>Home</a>
  <span aria-hidden="true"> / </span>
  <a href={resolve("/mechanics/")}>Game systems</a>
  <span aria-hidden="true"> / </span>
  {data.title.text}
</nav>

<header class="guide-head">
  <span class="kicker">{CATEGORY_KICKER[data.category]}</span>

  <div class="claim claim-title">
    <h1 data-mechanic-text={data.title.id} data-verification={data.title.status}>{data.title.text}</h1>
    {@render mark(data.title.status)}
  </div>

  <div class="claim">
    <p class="lede" data-mechanic-text={data.summary.id} data-verification={data.summary.status}>
      {data.summary.text}
    </p>
    {@render mark(data.summary.status)}
  </div>

  <p class="scope" class:scope-live={data.live}>{data.label}</p>
  <p class="legend">
    Every line carries its own note. The game wrote the lines marked Source checked. The compendium
    wrote the lines marked Compendium wording.
    {#if data.live}
      A line marked Live checked also ran in the game.
    {:else}
      No line on this page has run in the live game yet.
    {/if}
  </p>
</header>

{#if data.sections.length > 1}
  <nav class="toc" aria-label="Sections in this guide">
    <ol>
      {#each data.sections as section (section.id)}
        <li><a href="#section-{section.id}">{section.title.text}</a></li>
      {/each}
    </ol>
  </nav>
{/if}

<div class="sections">
  {#each data.sections as section (section.id)}
    <section id="section-{section.id}" class="section" aria-labelledby="head-{section.id}">
      <div class="claim claim-head">
        <h2 id="head-{section.id}" data-mechanic-section-title data-mechanic-text={section.title.id} data-verification={section.title.status}>{section.title.text}</h2>
        {@render mark(section.title.status)}
      </div>

      {#each section.paragraphs as paragraph (paragraph.id)}
        <div class="claim">
          <p data-mechanic-text={paragraph.id} data-verification={paragraph.status}>{paragraph.text}</p>
          {@render mark(paragraph.status)}
        </div>
      {/each}

      {#if section.bullets.length > 0}
        <ul class="bullets">
          {#each section.bullets as bullet (bullet.id)}
            <li class="claim">
              <span data-game-bullet data-mechanic-text={bullet.id} data-verification={bullet.status}>{bullet.text}</span>
              {@render mark(bullet.status)}
            </li>
          {/each}
        </ul>
      {/if}

      {#each section.formulas as formula (formula.id)}
        <div class="formula-block" data-formula={formula.id}>
          <div class="claim">
            <var data-mechanic-text={formula.label.id} data-verification={formula.label.status}>{formula.label.text}</var>
            {@render mark(formula.label.status)}
          </div>
          <div class="claim">
            <code class="formula-expression" data-mechanic-text={formula.expression.id} data-verification={formula.expression.status}>{formula.expression.text}</code>
            {@render mark(formula.expression.status)}
          </div>
          {#if formula.note}
            <div class="claim">
              <p class="formula-note" data-mechanic-text={formula.note.id} data-verification={formula.note.status}>{formula.note.text}</p>
              {@render mark(formula.note.status)}
            </div>
          {/if}
        </div>
      {/each}

      {#if section.facts.length > 0}
        <dl class="facts">
          {#each section.facts as fact (fact.label.id)}
            <div class="fact" class:fact-tabular={fact.table}>
              <dt class="claim">
                <!-- The id exists only to name the table below it. A fact with no table needs none. -->
                <span
                  id={fact.table ? `fact-${fact.label.id}` : undefined}
                  data-mechanic-text={fact.label.id}
                  data-verification={fact.label.status}
                >{fact.label.text}</span>
                {@render mark(fact.label.status)}
              </dt>
              {#if fact.table}
                <dd class="fact-tabular-value">
                  <table
                    class="fact-table"
                    aria-labelledby="fact-{fact.label.id}"
                    data-mechanic-table
                    data-mechanic-text={fact.value.id}
                    data-verification={fact.value.status}
                  >
                    <thead>
                      <tr>
                        {#each fact.table.columns as column (column.key)}
                          <th scope="col" class:numeric={column.numeric} data-fact-column={column.key}>{column.heading}</th>
                        {/each}
                      </tr>
                    </thead>
                    <tbody>
                      {#each fact.table.rows as row, index (index)}
                        <tr>
                          {#each row as cell (cell.key)}
                            <td class:numeric={cell.numeric} data-fact-cell={cell.key} data-fact-value={cell.raw}>{cell.text}</td>
                          {/each}
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                  {@render mark(fact.value.status)}
                </dd>
              {:else}
                <dd class="claim">
                  <span class="fact-value" data-mechanic-text={fact.value.id} data-verification={fact.value.status}>{fact.value.text}</span>
                  {@render mark(fact.value.status)}
                </dd>
              {/if}
            </div>
          {/each}
        </dl>
      {/if}
    </section>
  {/each}
</div>

{#if data.related.length > 0}
  <section class="related" aria-labelledby="related-head">
    <h2 id="related-head" class="related-head">Go on from here</h2>
    <ul>
      {#each data.related as entry (entry.href.id)}
        <li class="claim">
          <a
            href={entry.href.text}
            data-mechanic-href={entry.href.id}
            data-href-verification="editorial"
            data-mechanic-text={entry.label.id}
            data-verification={entry.label.status}
          >{entry.label.text}</a>
          {@render mark(entry.label.status)}
        </li>
      {/each}
    </ul>
  </section>
{/if}

<p class="back"><a href={resolve("/mechanics/")}>All game systems</a></p>

<style>
  /* The guide's own navigation targets. Breadcrumbs get their floor from the shared shell. */
  .back a,
  .toc a,
  .related a {
    display: inline-flex;
    align-items: center;
    min-block-size: 44px;
    min-inline-size: 44px;
    padding-inline: 0.2rem;
  }

  .crumbs {
    margin-block-end: 0.3rem;
  }

  .guide-head {
    max-inline-size: 64rem;
    margin-block-end: 1.6rem;
  }

  .guide-head h1 {
    overflow-wrap: break-word;
  }

  .lede {
    margin: 0;
    color: var(--parchment);
    font-size: var(--text-lead);
  }

  /*
   * The scoped provenance line. It states what was checked, never that the guide as a whole ran in
   * the game: probes cover four formulas, and a page-wide claim would outrun the evidence.
   */
  .scope {
    margin-block: 1rem 0.3rem;
    padding-inline-start: 0.6rem;
    border-inline-start: 2px solid var(--brass-deep);
    color: var(--brass);
    font-size: var(--text-sm);
    font-weight: 700;
  }

  .scope-live {
    border-inline-start-color: var(--teal);
    color: var(--kicker);
  }

  .legend {
    max-inline-size: 68ch;
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .toc {
    margin-block-end: 1.4rem;
    padding-block: 0.4rem;
    border-block: 1px solid var(--line);
  }

  .toc ol {
    display: flex;
    flex-wrap: wrap;
    gap: 0 1.2rem;
    margin: 0;
    padding: 0;
    list-style: none;
    counter-reset: toc;
  }

  .toc li {
    counter-increment: toc;
  }

  .toc a::before {
    content: counter(toc, decimal-leading-zero) " ";
    color: var(--brass-deep);
    font-variant-numeric: tabular-nums;
  }

  .toc a {
    gap: 0.4rem;
    color: var(--lavender-grey);
    font-size: var(--text-sm);
  }

  .toc a:hover {
    color: var(--brass-warm);
  }

  .sections {
    display: grid;
    gap: 2rem;
    max-inline-size: 64rem;
  }

  .section {
    scroll-margin-block-start: 1rem;
  }

  /*
   * One claim: the content, then where it came from. The gutter turns provenance into a column the
   * eye can skim past, instead of a badge interrupting every sentence.
   */
  .claim {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 8rem;
    gap: 0.2rem 1.2rem;
    align-items: baseline;
    padding-block: 0.15rem;
  }

  .claim > :first-child {
    min-inline-size: 0;
  }

  /*
   * The measure cap sits on the prose, not on the column: the 64rem claim grid is what keeps the
   * provenance gutter aligned down the page, while a 100ch line is what makes a paragraph hard to
   * read. Only running text is capped, so a formula keeps its own overflow behaviour and is never
   * reflowed into arithmetic that reads differently.
   */
  .claim p {
    max-inline-size: 68ch;
    margin: 0;
    color: var(--parchment);
  }

  .claim-head {
    margin-block-end: 0.5rem;
    padding-block-end: 0.35rem;
    border-block-end: 1px solid var(--line);
  }

  .claim-head h2 {
    overflow-wrap: break-word;
  }

  .mark {
    color: var(--text-muted);
    font-size: var(--text-2xs);
    letter-spacing: 0.05em;
    text-align: end;
    white-space: nowrap;
  }

  .mark-source-verified {
    color: var(--brass-deep);
  }

  /* The rare one. It is the only mark allowed any weight, because it is the only exception. */
  .mark-live-verified {
    color: var(--teal);
    font-weight: 700;
  }

  .bullets {
    margin: 0.4rem 0 0;
    padding: 0;
    list-style: none;
  }

  .bullets li {
    padding-inline-start: 0.9rem;
  }

  .bullets li > :first-child {
    position: relative;
    max-inline-size: 68ch;
    color: var(--parchment);
  }

  .bullets li > :first-child::before {
    content: "";
    position: absolute;
    inset-block-start: 0.62em;
    inset-inline-start: -0.9rem;
    inline-size: 4px;
    block-size: 4px;
    border-radius: 50%;
    background: var(--brass-deep);
  }

  /*
   * Deliberately not `.formula`: the shared stylesheet already owns that name as a flex utility, and
   * inheriting it laid the label, the expression and both provenance marks out on one line.
   *
   * A rule rather than a panel, so the formula does not become a card inside a card and its marks
   * stay in the same gutter column as every other claim on the page.
   */
  .formula-block {
    display: grid;
    margin-block: 0.7rem;
    padding-block: 0.5rem 0.6rem;
    border-block-start: 1px solid var(--hairline);
  }

  .formula-block var {
    color: var(--kicker);
    font-size: var(--text-2xs);
    font-style: normal;
    font-weight: 800;
    letter-spacing: 0.09em;
    text-transform: uppercase;
  }

  /*
   * A shipped formula is one long line and must not be reflowed into arithmetic that reads
   * differently, so the expression scrolls inside its own box rather than wrapping.
   */
  .formula-expression {
    display: block;
    overflow-x: auto;
    max-inline-size: 100%;
    padding: 0.3rem 0.55rem;
    border-inline-start: 2px solid var(--brass-deep);
    background: var(--panel-inset);
    color: var(--parchment);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    white-space: pre;
  }

  .formula-block .formula-note {
    margin-block-start: 0.3rem;
    color: var(--lavender-grey);
    font-size: var(--text-sm);
  }

  .facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
    gap: 0.3rem 2rem;
    margin: 0.7rem 0 0;
  }

  .fact {
    padding-block: 0.3rem;
    border-block-start: 1px dotted var(--hairline);
  }

  .fact dt {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .fact dd {
    margin: 0;
  }

  .fact-value {
    color: var(--parchment);
    font-variant-numeric: tabular-nums;
    font-weight: 700;
  }

  /*
   * A value published as a uniform array of records reads as rows. It spans the fact grid, because
   * a table squeezed into an 18rem column wraps every heading, and it carries one mark for the
   * whole table: the array is one published string with one provenance, and a mark per row would
   * claim a separate check for every row that was never made.
   */
  .fact-tabular {
    grid-column: 1 / -1;
    min-inline-size: 0;
  }

  .fact-tabular-value {
    --fact-table-measure: 30rem;
    overflow-x: auto;
    margin: 0;
  }

  .fact-table {
    inline-size: 100%;
    max-inline-size: var(--fact-table-measure);
    margin-block-start: 0.35rem;
    border-collapse: collapse;
  }

  .fact-table th,
  .fact-table td {
    padding: 0.3rem 1.4rem 0.3rem 0;
    text-align: start;
  }

  .fact-table th:last-child,
  .fact-table td:last-child {
    padding-inline-end: 0;
  }

  .fact-table thead th {
    padding-block-end: 0.35rem;
    border-block-end: 1px solid var(--line);
    color: var(--kicker);
    font-size: var(--text-2xs);
    font-weight: 800;
    letter-spacing: 0.09em;
    text-transform: uppercase;
  }

  .fact-table tbody tr + tr td {
    border-block-start: 1px dotted var(--hairline);
  }

  .fact-table td {
    color: var(--parchment);
    font-size: var(--text-sm);
  }

  /* Ranged on the last digit, so the shape of the curve is legible down the column and not only row by row. */
  .fact-table .numeric {
    font-variant-numeric: tabular-nums;
    text-align: end;
  }

  /* The one mark, set below the table and to the same measure, so it annotates and never overlaps. */
  .fact-tabular-value .mark {
    display: block;
    max-inline-size: var(--fact-table-measure);
    margin-block-start: 0.45rem;
  }

  .related {
    max-inline-size: 64rem;
    margin-block-start: 2.2rem;
    padding-block-start: 0.9rem;
    border-block-start: 1px solid var(--line);
  }

  .related-head {
    color: var(--brass);
    font-size: var(--text-2xs);
    font-weight: 800;
    letter-spacing: 0.13em;
    text-transform: uppercase;
  }

  .related ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .back {
    margin-block-start: 1.6rem;
  }

  @media (max-width: 62rem) {
    .claim {
      grid-template-columns: minmax(0, 1fr);
    }

    /*
     * Still end-aligned once the gutter collapses, so a mark reads as an annotation of the claim
     * above it rather than as the opening words of the block below it.
     */
    .mark {
      padding-block-end: 0.2rem;
    }

    .facts {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
