<script lang="ts">
  import { resolve } from "$app/paths";
  import Art from "./Art.svelte";

  /**
   * Shows one of the four classes as a painted plate.
   * The home hall and class index share this component, so each class has one visual form.
   * The portrait, `title`, `worldRole`, and `traits` come from the game.
   */
  let {
    id,
    name,
    title,
    worldRole,
    image = null,
    traits = [],
    abilityCount,
    itemCount,
  }: {
    id: string;
    name: string;
    title: string;
    worldRole: string;
    image?: string | null;
    traits?: string[];
    abilityCount: number;
    itemCount: number;
  } = $props();
</script>

<a class="plate" href={resolve(`/classes/${id}/`)} data-class={id}>
  <Art src={image} alt={name} kind="class" variant="portrait" />
  <span class="plate-name">{name}</span>
  <span class="plate-title">{title}</span>
  <span class="plate-role">{worldRole}</span>
  {#if traits.length > 0}
    <!--
      Add a label because three classes list "Combat" first.
      The same word names a level scale on every page.
      Without the label, a grey "Combat" pill can look like a combat level.
    -->
    <span class="plate-traits">
      <span class="plate-traits-label">Built around</span>
      <span class="plate-trait-list">
        {#each traits as trait (trait)}<span class="plate-trait">{trait}</span>{/each}
      </span>
    </span>
  {/if}
  <span class="plate-counts">
    {abilityCount} abilities &middot; {itemCount.toLocaleString("en-US")} items
  </span>
</a>

<style>
  .plate {
    display: grid;
    grid-template-rows: auto auto auto auto 1fr auto;
    gap: 0.3rem;
    padding: 0.55rem 0.55rem 0.7rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: linear-gradient(145deg, var(--panel-top), var(--panel-bottom) 72%);
    color: inherit;
    text-decoration: none;
    transition: border-color 140ms ease;
  }

  .plate:hover,
  .plate:focus-visible {
    border-color: var(--brass);
    text-decoration: none;
  }

  /*
   * Each class has a hue in the game's art.
   * Tinting the ground separates the four at a glance.
   * The name stays present, so hue never carries meaning alone.
   */
  .plate[data-class="barbarian"] {
    background-image: linear-gradient(160deg, color-mix(in srgb, var(--ember) 13%, var(--panel-top)), var(--panel-bottom) 74%);
  }

  .plate[data-class="warden"] {
    background-image: linear-gradient(160deg, color-mix(in srgb, var(--green) 11%, var(--panel-top)), var(--panel-bottom) 74%);
  }

  .plate[data-class="nightblade"] {
    background-image: linear-gradient(160deg, color-mix(in srgb, var(--lilac-painted) 15%, var(--panel-top)), var(--panel-bottom) 74%);
  }

  .plate[data-class="arcanist"] {
    background-image: linear-gradient(160deg, color-mix(in srgb, var(--cyan) 12%, var(--panel-top)), var(--panel-bottom) 74%);
  }

  .plate-name {
    margin-block-start: 0.35rem;
    color: var(--parchment);
    font-size: var(--text-title);
    font-weight: 800;
    line-height: 1.1;
  }

  .plate:hover .plate-name,
  .plate:focus-visible .plate-name {
    color: var(--brass-warm);
  }

  .plate-title {
    color: var(--lavender-grey);
    font-size: var(--text-sm);
    line-height: 1.3;
  }

  .plate-role {
    color: var(--text-muted);
    font-size: var(--text-xs);
    line-height: 1.35;
  }

  .plate-traits {
    display: grid;
    /*
       The traits row uses 1fr.
       Without this setting, nested rows grow to each class's trait-list height.
       Four plates then show pills at four different heights.
    */
    align-content: start;
    justify-items: start;
    gap: 0.2rem;
    margin-block-start: 0.15rem;
  }

  .plate-traits-label {
    color: var(--kicker);
    font-size: var(--text-kicker);
    font-weight: 800;
    letter-spacing: 0.15em;
    text-transform: uppercase;
  }

  .plate-trait-list {
    display: flex;
    flex-wrap: wrap;
    align-items: start;
    gap: 0.25rem;
  }

  .plate-trait {
    padding: 0.18rem 0.5rem;
    border: 1px solid var(--line-soft);
    border-radius: var(--radius-chip);
    background: var(--panel-raised);
    color: var(--parchment);
    font-size: var(--text-2xs);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .plate-counts {
    margin-block-start: 0.5rem;
    padding-block-start: 0.45rem;
    border-block-start: 1px dotted var(--hairline);
    color: var(--text-muted);
    font-size: var(--text-2xs);
    font-variant-numeric: tabular-nums;
  }
</style>
