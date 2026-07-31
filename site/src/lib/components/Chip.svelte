<script lang="ts">
  /**
   * One labelled fact. The three level scales get their own tones, and a scale chip always prints
   * its scale name beside the number: the game's own quest guidance distinguishes Gathering 10 from
   * Crafting 10 from combat level 10, and a bare `10` would silently merge them.
   */
  type Tone = "combat" | "gathering" | "crafting" | "rarity" | "neutral";

  let {
    tone = "neutral",
    label,
    value = undefined,
    rarity = null,
  }: { tone?: Tone; label: string; value?: string | number; rarity?: string | null } = $props();
</script>

<span class="chip chip-{tone}" class:rarity-tinted={tone === "rarity"} data-rarity={rarity}>
  <span class="chip-label">{label}</span>
  {#if value !== undefined && value !== null && value !== ""}
    <span class="chip-value">{value}</span>
  {/if}
</span>

<style>
  .chip {
    display: inline-flex;
    align-items: baseline;
    gap: 0.4ch;
    padding: 0.18rem 0.5rem;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: var(--panel-raised);
    font-size: var(--text-xs);
    line-height: 1.35;
    white-space: nowrap;
  }

  .chip-label {
    color: var(--text-muted);
    font-size: var(--text-2xs);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .chip-value {
    color: var(--parchment);
    font-variant-numeric: tabular-nums;
    font-weight: 700;
  }

  /* Each level scale carries its own hue as a second signal; the label already names the scale. */
  .chip-combat {
    border-color: color-mix(in srgb, var(--ember) 50%, transparent);
    background: color-mix(in srgb, var(--ember) 14%, transparent);
  }

  .chip-gathering {
    border-color: color-mix(in srgb, var(--green) 45%, transparent);
    background: color-mix(in srgb, var(--green) 12%, transparent);
  }

  .chip-crafting {
    border-color: color-mix(in srgb, var(--cyan) 45%, transparent);
    background: color-mix(in srgb, var(--cyan) 12%, transparent);
  }

  .rarity-tinted[data-rarity="common"] .chip-value {
    color: var(--rarity-common);
  }
  .rarity-tinted[data-rarity="uncommon"] .chip-value {
    color: var(--rarity-uncommon);
  }
  .rarity-tinted[data-rarity="rare"] .chip-value {
    color: var(--rarity-rare);
  }
  .rarity-tinted[data-rarity="epic"] .chip-value {
    color: var(--rarity-epic);
  }
  .rarity-tinted[data-rarity="legendary"] .chip-value {
    color: var(--rarity-legendary);
  }
  .rarity-tinted[data-rarity="mythic"] .chip-value {
    color: var(--rarity-mythic);
  }
  .rarity-tinted[data-rarity="living"] .chip-value {
    color: var(--rarity-living);
  }
</style>
