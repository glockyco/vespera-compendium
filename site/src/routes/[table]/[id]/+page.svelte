<script lang="ts">
  import { resolve } from "$app/paths";
  import AnswerBlock from "$lib/components/AnswerBlock.svelte";
  import Art from "$lib/components/Art.svelte";
  import Bar from "$lib/components/Bar.svelte";
  import Chip from "$lib/components/Chip.svelte";
  import EntityLink from "$lib/components/EntityLink.svelte";
  import { chance, duration, levelNote, statLabel, statValue, titleCase } from "$lib/format";
  import { tableLabel } from "$lib/labels";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  /** Chip values that are durations in the data but should read as time. */
  const DURATION_CHIPS = new Set(["Takes", "Cooldown"]);

  const NUMERIC = /^-?\d+(\.\d+)?$/;

  /**
   * Stat values arrive as strings because some are already display-formatted by the game (world
   * boss gear reads "+12% haste"). A purely numeric one is passed through the stat formatter so
   * percentages and flat amounts are never confused; anything else is printed verbatim.
   */
  function statDisplay(label: string, value: string): string {
    return NUMERIC.test(value) ? statValue(label, Number(value)) : value;
  }

  /**
   * A block is empty when it has no lines, no stats and no prose. The component cannot infer this,
   * because a snippet that renders nothing is still a snippet, so the page states it.
   */
  function isEmpty(block: PageData["shape"]["blocks"][number]): boolean {
    return !block.prose && !(block.lines?.length ?? 0) && !(block.stats?.length ?? 0);
  }

  function chipValue(label: string, value: string | number | undefined): string | number | undefined {
    if (value === undefined) return undefined;
    if (DURATION_CHIPS.has(label) && typeof value === "string" && /^\d+$/.test(value)) {
      return duration(Number(value));
    }
    if (DURATION_CHIPS.has(label) && typeof value === "number") return duration(value);
    return typeof value === "string" ? titleCase(value) : value;
  }
</script>

<svelte:head>
  <title>{data.heading} — Vespera Compendium</title>
</svelte:head>

<nav class="crumbs" aria-label="Breadcrumb">
  <a href={resolve("/")}>Home</a> /
  <a href={resolve(`/${data.slug}/`)}>{tableLabel(data.name)}</a> /
  {data.heading}
</nav>

<header class="record-hero" class:hero-wide={data.shape.heroSize === "hero"}>
  {#if data.shape.image}
    <div class="record-art">
      <Art src={data.shape.image} alt={data.heading} size={data.shape.heroSize} rarity={data.shape.rarity} />
    </div>
  {/if}

  <div class="record-headline">
    <span class="kicker">{tableLabel(data.name).toUpperCase()}</span>
    <h1
      class:rarity-common={data.shape.rarity === "common"}
      class:rarity-uncommon={data.shape.rarity === "uncommon"}
      class:rarity-rare={data.shape.rarity === "rare"}
      class:rarity-epic={data.shape.rarity === "epic"}
      class:rarity-legendary={data.shape.rarity === "legendary"}
      class:rarity-mythic={data.shape.rarity === "mythic"}
      class:rarity-living={data.shape.rarity === "living"}
    >{data.heading}</h1>
    {#if data.headingSub}<p class="record-sub mono">{data.headingSub}</p>{/if}

    <div class="chips">
      {#each data.shape.chips as chip, index (chip.label + index)}
        <Chip tone={chip.tone} label={chip.label} value={chipValue(chip.label, chip.value)} rarity={chip.rarity} />
      {/each}
      {#if data.level}
        <Chip
          tone={data.level.source === "crafting" ? "crafting" : data.level.source === "gathering" ? "gathering" : "combat"}
          label="Level"
          value={levelNote(typeof data.level.value === "number" ? data.level.value : null, data.level.source)}
        />
      {/if}
    </div>

    {#if data.shape.description}
      <p class="record-description">{data.shape.description}</p>
    {/if}
  </div>
</header>

<div class="record-blocks">
  {#each data.shape.blocks as block (block.title)}
    <AnswerBlock title={block.title} empty={block.empty} isEmpty={isEmpty(block)}>
      {#if (block.lines && block.lines.length > 0) || (block.stats && block.stats.length > 0) || block.prose}
        {#if block.prose && !block.lines?.length}
          <p class="block-prose">{block.prose}</p>
        {/if}

        {#if block.stats && block.stats.length > 0}
          <dl class="stat-list">
            {#each block.stats as stat, statIndex (stat.label + statIndex)}
              <div class="stat">
                <dt>{statLabel(stat.label)}</dt>
                <dd>{statDisplay(stat.label, stat.value)}</dd>
              </div>
            {/each}
          </dl>
        {/if}

        {#if block.lines && block.lines.length > 0}
          <ul class="line-list">
            {#each block.lines as line, index (index)}
              <li>
                <div class="line">
                  {#if line.ref}
                    <EntityLink
                      slug={line.ref.slug}
                      id={line.ref.id}
                      name={line.ref.name}
                      image={line.ref.image}
                      rarity={line.ref.rarity}
                      sub={line.ref.sub}
                    />
                  {/if}
                  {#if line.text}
                    <span class="line-text">{line.text}</span>
                  {/if}
                  {#if line.quantity}
                    <span class="line-qty">{line.quantity}</span>
                  {/if}
                  {#if block.showChance && line.chance !== null && line.chance !== undefined}
                    <span class="line-chance"><Bar value={line.chance} label={chance(line.chance)} /></span>
                  {/if}
                  {#if line.facts && line.facts.length > 0}
                    <span class="line-facts">
                      {#each line.facts as fact (fact.label)}
                        <span class="line-fact"><span class="line-fact-label">{fact.label}</span> {fact.value}</span>
                      {/each}
                    </span>
                  {/if}
                </div>
                {#if line.children && line.children.length > 0}
                  <ul class="line-children">
                    {#each line.children as child, childIndex (childIndex)}
                      <li>
                        {#if child.ref}
                          <EntityLink slug={child.ref.slug} id={child.ref.id} name={child.ref.name} image={child.ref.image} rarity={child.ref.rarity} />
                        {/if}
                        {#if child.quantity}<span class="line-qty">{child.quantity}</span>{/if}
                      </li>
                    {/each}
                  </ul>
                {/if}
              </li>
            {/each}
          </ul>
          {#if block.prose}
            <p class="block-more">{block.prose}</p>
          {/if}
        {/if}
      {/if}
    </AnswerBlock>
  {/each}
</div>

<style>
  .crumbs {
    margin-block-end: 0.8rem;
  }

  .record-hero {
    display: flex;
    gap: 1.1rem;
    align-items: flex-start;
    margin-block-end: 1.4rem;
  }

  .hero-wide {
    flex-direction: column;
  }

  .hero-wide .record-art {
    inline-size: min(100%, 34rem);
  }

  .record-headline {
    min-inline-size: 0;
  }

  .record-headline h1 {
    margin-block-end: 0.5rem;
  }

  .record-sub {
    margin-block: -0.25rem 0.5rem;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .record-description {
    max-inline-size: 52rem;
    margin-block-start: 0.7rem;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .record-blocks {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
    gap: 0.9rem;
    align-items: start;
  }

  .block-prose {
    margin: 0;
    color: var(--parchment);
  }

  .block-more {
    margin: 0.5rem 0 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  .stat-list {
    display: grid;
    /* A wide column gap so a value never sits flush against the next column's label, which reads as
       one run-on pair. */
    grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
    gap: 0.25rem 2.2rem;
    margin: 0;
  }

  .stat {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
    padding-block: 0.15rem;
    border-block-end: 1px dotted var(--hairline);
  }

  .stat dt {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .stat dd {
    margin: 0;
    color: var(--parchment);
    font-variant-numeric: tabular-nums;
    font-weight: 700;
  }

  .line-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .line-list > li + li {
    margin-block-start: 0.15rem;
    border-block-start: 1px dotted var(--hairline-faint);
    padding-block-start: 0.15rem;
  }

  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 0.7rem;
  }

  .line-text {
    color: var(--lavender-grey);
  }

  .line-qty {
    color: var(--brass);
    font-variant-numeric: tabular-nums;
    font-weight: 700;
  }

  .line-chance {
    margin-inline-start: auto;
  }

  .line-facts {
    display: flex;
    flex-wrap: wrap;
    gap: 0.15rem 0.7rem;
    inline-size: 100%;
    color: var(--lavender-grey);
    font-size: var(--text-sm);
  }

  .line-fact-label {
    color: var(--text-muted);
    font-size: var(--text-2xs);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .line-children {
    margin: 0.1rem 0 0.3rem 2.4rem;
    padding: 0;
    list-style: none;
    border-inline-start: 1px solid var(--line-soft);
  }

  .line-children li {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding-inline-start: 0.5rem;
  }
</style>
