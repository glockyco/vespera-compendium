<script lang="ts">
  /**
   * Shows one guide summary.
   *
   * The row uses a field-manual form instead of a grid card.
   * It has a brass rule, guide name, one-line scope, and provenance stamp.
   * The stamp names the checked content. It does not claim a live probe for the whole guide.
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
    /* A brass rule marks the ledger entry. */
    padding: 0.75rem 0.9rem 0.8rem;
    border: 1px solid var(--line-soft);
    border-inline-start: 2px solid var(--brass-deep);
    border-radius: 0 var(--radius-control) var(--radius-control) 0;
    background: var(--panel-raised);
    color: var(--parchment);
    /* Exponential easing lets the row settle instead of snapping. */
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

  /* The provenance stamp stays quiet below the summary. It marks the exception without repeating the rule. */
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
