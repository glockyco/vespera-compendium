<script lang="ts">
  import type { Snippet } from "svelte";

  /**
   * One section of a record page. Every block on every record type uses this, so section chrome is
   * identical across all twelve and a reader learns the page shape once.
   *
   * `empty` is a sentence, not a dash. A block with nothing in it is usually saying something real
   * — that no source is modelled for an item, say — and that is worth stating in words. Callers pass
   * `isEmpty` explicitly because a snippet that renders nothing is still a snippet, so the presence
   * of `children` cannot be used to detect it.
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
    font-size: var(--text-xs);
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
