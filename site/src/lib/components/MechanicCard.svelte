<script lang="ts">
  /**
   * One guide, summarised.
   *
   * The row is a field-manual entry rather than a card in a grid: a brass rule, the guide's name,
   * the one line it covers, and the provenance stamp. The stamp is scoped on purpose — a guide is
   * never live-verified as a whole, so the card states what was checked rather than implying the
   * whole page passed a runtime probe.
   */
  import { resolve } from "$app/paths";

  let {
    id,
    title,
    summary,
    label,
    live = false,
    kicker = null,
  }: {
    id: string;
    title: string;
    summary: string;
    label: string;
    live?: boolean;
    kicker?: string | null;
  } = $props();
</script>

<a class="guide" href={resolve(`/mechanics/${id}/`)} data-mechanic-card={id}>
  {#if kicker}<span class="kicker">{kicker}</span>{/if}
  <span class="guide-title">{title}</span>
  <span class="guide-summary">{summary}</span>
  <span class="guide-stamp" class:guide-stamp-live={live}>{label}</span>
</a>

<style>
  .guide {
    display: grid;
    gap: 0.2rem;
    /* A brass rule down the left, which is the ledger's own way of marking an entry. */
    padding: 0.75rem 0.9rem 0.8rem;
    border: 1px solid var(--line-soft);
    border-inline-start: 2px solid var(--brass-deep);
    border-radius: 0 var(--radius-control) var(--radius-control) 0;
    background: var(--panel-raised);
    color: var(--parchment);
    /* Exponential easing: the row settles rather than snapping. */
    transition:
      border-color 180ms cubic-bezier(0.16, 1, 0.3, 1),
      background-color 180ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  .guide:hover,
  .guide:focus-visible {
    border-color: var(--line);
    border-inline-start-color: var(--brass);
    background: var(--panel-hover);
    text-decoration: none;
  }

  .guide-title {
    font-size: var(--text-title);
    font-weight: 800;
    line-height: 1.2;
  }

  .guide:hover .guide-title {
    color: var(--brass-warm);
  }

  .guide-summary {
    max-inline-size: 68ch;
    color: var(--lavender-grey);
    font-size: var(--text-sm);
  }

  /*
   * The provenance stamp sits below the summary, quiet by default. Almost every guide reads the
   * same, so the eye should catch the exception rather than re-read the rule.
   */
  .guide-stamp {
    margin-block-start: 0.35rem;
    padding-inline-start: 0.5rem;
    border-inline-start: 2px solid var(--line-soft);
    color: var(--text-muted);
    font-size: var(--text-2xs);
    letter-spacing: 0.04em;
  }

  .guide-stamp-live {
    border-inline-start-color: var(--teal);
    color: var(--kicker);
  }
</style>
