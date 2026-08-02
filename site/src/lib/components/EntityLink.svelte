<script lang="ts">
  import { resolve } from "$app/paths";
  import Art from "./Art.svelte";

  /**
   * The one way a record points at another record. Every cross-reference on the site goes through
   * this, so a link to an item looks the same whether it is reached from a recipe, a drop table or
   * a search result — and so the art, rarity colour and sub-line are never rendered inconsistently.
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
    /** Frame size for the art, which selects the generated variant behind it. */
    size?: "sm" | "md";
  } = $props();
</script>

<a class="entity" href={resolve(`/${slug}/${id}/`)}>
  <!-- Branched rather than passed through, because every Art callsite states its kind and variant
       literally and `check:art` reads them from the markup. -->
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
    /* Every cross-reference on the site is this element, so it carries the thumb target rather than
       each page adding its own. */
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
    /* Names wrap rather than truncate. In a narrow column an ellipsis turns "Crownless Hood of
       Storm Regret" into "Crownless Hood of Storm R", which is not a name a player can match. */
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
