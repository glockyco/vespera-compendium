<script lang="ts">
  import { resolve } from "$app/paths";
  import Art from "./Art.svelte";

  /**
   * Links one record to another.
   * Every cross-reference uses this component, so art, rarity color, and the sub-line stay consistent.
   */
  let {
    slug,
    id,
    name,
    image = null,
    rarity = null,
    sub = null,
    size = "sm",
  }: {
    slug: string;
    id: string;
    name: string;
    image?: string | null;
    rarity?: string | null;
    sub?: string | null;
    /** Frame size for the art. It selects the generated variant. */
    size?: "sm" | "md";
  } = $props();
</script>

<a class="entity" href={resolve(`/${slug}/${id}/`)}>
  <!-- Branch here so each Art call site states literal kind and variant values.
       `check:art` reads those values from the markup. -->
  {#if size === "md"}
    <Art src={image} alt={name} kind="general" variant="card" {rarity} />
  {:else}
    <Art src={image} alt={name} kind="general" variant="thumb" {rarity} />
  {/if}
  <span class="entity-text">
    <span class="entity-name" class:rarity-common={rarity === "common"} class:rarity-uncommon={rarity === "uncommon"} class:rarity-rare={rarity === "rare"} class:rarity-epic={rarity === "epic"} class:rarity-legendary={rarity === "legendary"} class:rarity-mythic={rarity === "mythic"} class:rarity-living={rarity === "living"}>{name}</span>
    {#if sub}<span class="entity-sub">{sub}</span>{/if}
  </span>
</a>

<style>
  .entity {
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
    /* This element owns the thumb target for every cross-reference. */
    min-block-size: 2.75rem;
    min-inline-size: 0;
    padding: 0.2rem 0.35rem 0.2rem 0.2rem;
    border-radius: var(--radius-art);
    color: inherit;
    text-decoration: none;
  }

  .entity:hover {
    background: var(--panel-hover);
    text-decoration: none;
  }

  .entity:hover .entity-name {
    color: var(--brass-warm);
  }

  .entity-text {
    display: flex;
    flex-direction: column;
    min-inline-size: 0;
  }

  .entity-name {
    /* Names wrap instead of truncating. An ellipsis turns "Crownless Hood of Storm Regret" into
       "Crownless Hood of Storm R". A player then cannot match the name. */
    overflow-wrap: anywhere;
    color: var(--cyan);
    font-weight: 600;
  }

  .entity-sub {
    color: var(--text-muted);
    font-size: var(--text-xs);
    line-height: 1.3;
  }
</style>
