<script lang="ts">
  /**
   * A proportion shown as both a bar and a printed figure.
   *
   * The number is never encoded in width alone: a 3% and a 6% drop chance are visually almost
   * identical at this size, and the figure is the thing a player is actually reading.
   */
  let {
    value,
    max = 1,
    label,
  }: { value: number; max?: number; label: string } = $props();

  let fraction = $derived(max > 0 ? Math.min(1, Math.max(0, value / max)) : 0);
</script>

<span class="bar" role="img" aria-label="{label} of {max === 1 ? 'certain' : max}">
  <span class="bar-track">
    <span class="bar-fill" style="inline-size: {(fraction * 100).toFixed(2)}%"></span>
  </span>
  <span class="bar-label">{label}</span>
</span>

<style>
  .bar {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    min-inline-size: 8rem;
  }

  .bar-track {
    flex: 1 1 4rem;
    block-size: 0.4rem;
    overflow: hidden;
    border-radius: var(--radius-chip);
    background: var(--panel-sunken);
    box-shadow: inset 0 0 0 1px var(--line-soft);
  }

  .bar-fill {
    display: block;
    block-size: 100%;
    border-radius: var(--radius-chip);
    background: linear-gradient(90deg, var(--teal-dust), var(--teal));
  }

  .bar-label {
    color: var(--parchment);
    font-variant-numeric: tabular-nums;
    font-size: var(--text-sm);
    font-weight: 700;
  }
</style>
