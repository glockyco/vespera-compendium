<script lang="ts">
  import { resolve } from "$app/paths";
  import { VERIFICATION_LABEL } from "$lib/mechanics-verification";
  import type { MechanicVerificationStatus } from "$lib/mechanics-verification";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  /**
   * Shows the guide as a ledger.
   * The claim sits left and its source note sits in the right gutter.
   * Provenance stays per string because a game formula can sit under an editorial label.
   * A shared badge gives the label a claim that the game never made.
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
      The game ran each line marked Live checked.
    {:else}
      The game has not run a line on this page yet.
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
                <!-- The ID names the table below it. A fact without a table needs no ID. -->
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
    <h2 id="related-head" class="related-head">Related guides</h2>
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
  /* Navigation targets for this guide. Breadcrumbs get their touch floor from the shared shell. */
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
   * The scoped provenance line states what was checked.
   * It does not claim a live check for the whole guide.
   * Probes cover four formulas, so a page-wide claim exceeds the evidence.
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

  /* Each claim puts content first and its source note second.
     The gutter lets the eye skip provenance without a badge in every sentence. */
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
   * Cap prose width, not the claim grid.
   * The 64rem grid aligns the provenance gutter.
   * A 100ch line is hard to read.
   * Formulas keep their own overflow so arithmetic does not change.
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

  /* This rare mark alone has extra weight because it marks the only exception. */
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
   * Do not use `.formula`. The shared stylesheet uses that name for a flex utility.
   * That utility puts the label, expression, and provenance marks on one line.
   * A rule keeps the formula out of nested panels and aligns its marks with other claims.
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

  /* Keep a shipped formula on one line. Scroll it inside its box instead of wrapping arithmetic. */
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
   * Show a uniform record array as rows across the fact grid.
   * An 18rem column wraps every heading.
   * One mark covers the array because it is one published string.
   * A mark per row claims a separate check that never happened.
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

  /* Rounding the last digit keeps the curve shape legible down the column. */
  .fact-table .numeric {
    font-variant-numeric: tabular-nums;
    text-align: end;
  }

  /* Put one mark below the table at the same measure. It annotates without overlap. */
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

    /* Keep the mark end-aligned after the gutter collapses.
       It annotates the claim above instead of opening the next block. */
    .mark {
      padding-block-end: 0.2rem;
    }

    .facts {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
