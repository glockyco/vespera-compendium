<script lang="ts">
  import type { Snippet } from "svelte";

/**
   * Shows one section of a record page.
   * Every record type uses the same section chrome, so readers learn the page shape once.
   *
   * `empty` is a sentence, not a dash. An empty block can state that no source is modelled.
   * Callers pass `isEmpty` because an empty `children` snippet still exists.
   */
  let {
    title,
    empty = undefined,
    isEmpty = false,
    count = undefined,
    children,
  }: { title: string; empty?: string; isEmpty?: boolean; count?: number; children?: Snippet } = $props();
</script>

<section class="panel pad answer">
  <header class="answer-head">
    <h2>{title}</h2>
    {#if count !== undefined}<span class="answer-count">{count}</span>{/if}
  </header>
  {#if isEmpty || !children}
    <p class="answer-empty">{empty ?? "Nothing modelled here yet."}</p>
  {:else}
    {@render children()}
  {/if}
</section>

<style>
  .answer {
    display: flow-root;
  }

  .answer-head {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    margin-bottom: 0.7rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--line-soft);
  }

  .answer-head h2 {
    margin: 0;
    color: var(--kicker);
    font-size: var(--text-panel-title);
    font-weight: 800;
    letter-spacing: 0.13em;
    text-transform: uppercase;
  }

  .answer-count {
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .answer-empty {
    margin: 0;
    color: var(--text-muted);
  }
</style>
