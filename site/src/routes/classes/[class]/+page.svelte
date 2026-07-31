<script lang="ts">
  import { resolve } from "$app/paths";
  import { CLASS_BLURB, type ClassId } from "$lib/classes";
  import AnswerBlock from "$lib/components/AnswerBlock.svelte";
  import Art from "$lib/components/Art.svelte";
  import Chip from "$lib/components/Chip.svelte";
  import EntityLink from "$lib/components/EntityLink.svelte";
  import { duration, levelNote, slotLabel, titleCase } from "$lib/format";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  function effectLine(effect: PageData["abilities"][number]["effects"][number]): string {
    const parts = [titleCase(effect.type)];
    if (effect.value !== null) parts.push(effect.isPercent ? `${effect.value}%` : String(effect.value));
    if (effect.stat) parts.push(`to ${effect.stat}`);
    if (effect.target) parts.push(`on ${effect.target}`);
    if (effect.duration !== null) parts.push(`for ${duration(effect.duration)}`);
    return parts.join(" ");
  }
</script>

<svelte:head>
  <title>{titleCase(data.classId)} — Vespera Compendium</title>
  <meta
    name="description"
    content="Every {titleCase(data.classId)} ability and the gear restricted to the class, slot by slot."
  />
</svelte:head>

<nav class="crumbs" aria-label="Breadcrumb">
  <a href={resolve("/")}>Home</a> / <a href={resolve("/classes/")}>Classes</a> / {titleCase(data.classId)}
</nav>

<span class="kicker">CLASS</span>
<h1>{titleCase(data.classId)}</h1>
<p class="lede">
  {CLASS_BLURB[data.classId as ClassId]}
  {data.abilities.length} abilities and {data.itemCount} class-restricted items.
</p>

<div class="class-layout">
  <AnswerBlock title="Ability ladder" count={data.abilities.length}>
    <ol class="ladder">
      {#each data.abilities as ability (ability.id)}
        <li class="rung">
          <Art src={ability.image} alt={ability.name} size="md" />
          <div class="rung-body">
            <div class="rung-head">
              <a class="rung-name" href={resolve(`/abilities/${ability.id}/`)}>{ability.name}</a>
              <div class="rung-chips">
                <Chip tone="combat" label="Combat" value={ability.combatLevel ?? "—"} />
                {#if ability.manaCost !== null}<Chip tone="neutral" label="Mana" value={ability.manaCost} />{/if}
                {#if ability.cooldown !== null}<Chip tone="neutral" label="Cooldown" value={duration(ability.cooldown)} />{/if}
                <Chip tone="neutral" label="Kind" value={titleCase(ability.category)} />
                {#if ability.subclass}<Chip tone="neutral" label="Subclass" value={titleCase(ability.subclass)} />{/if}
              </div>
            </div>
            {#if ability.description}<p class="rung-text">{ability.description}</p>{/if}
            {#if ability.effects.length > 0}
              <ul class="effects">
                {#each ability.effects as effect, index (index)}
                  <li>{effectLine(effect)}</li>
                {/each}
              </ul>
            {/if}
          </div>
        </li>
      {/each}
    </ol>
  </AnswerBlock>

  <AnswerBlock title="Gear by slot" count={data.itemCount}>
    <div class="slots">
      {#each data.slots as group (group.slot)}
        <section class="slot">
          <h3>{slotLabel(group.slot)}</h3>
          {#if group.items.length === 0}
            <p class="muted">No class-restricted item for this slot.</p>
          {:else}
            <ul class="slot-items">
              {#each group.items as item (item.id)}
                <li>
                  <EntityLink
                    slug="items"
                    id={item.id}
                    name={item.name}
                    image={item.image}
                    rarity={item.rarity}
                    sub={levelNote(item.level, item.levelSource)}
                  />
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {/each}
    </div>
  </AnswerBlock>
</div>

<style>
  .lede {
    max-inline-size: 46rem;
  }

  .class-layout {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
    gap: 0.9rem;
    align-items: start;
    margin-block-start: 1.2rem;
  }

  .ladder {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .rung {
    display: flex;
    gap: 0.7rem;
  }

  .rung + .rung {
    padding-block-start: 0.55rem;
    border-block-start: 1px dotted rgba(146, 180, 176, 0.14);
  }

  .rung-body {
    min-inline-size: 0;
  }

  .rung-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.4rem 0.6rem;
  }

  .rung-name {
    color: var(--parchment);
    font-weight: 700;
  }

  .rung-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .rung-text {
    margin: 0.25rem 0 0;
    color: var(--lavender-grey);
    font-size: 0.88rem;
  }

  .effects {
    margin: 0.25rem 0 0;
    padding-inline-start: 1rem;
    color: var(--text-muted);
    font-size: 0.82rem;
  }

  .slots {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
    gap: 0.8rem;
  }

  .slot h3 {
    margin-block-end: 0.3rem;
    color: var(--kicker);
    font-size: 0.7rem;
    font-weight: 800;
    letter-spacing: 0.11em;
    text-transform: uppercase;
  }

  .slot-items {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    max-block-size: 22rem;
    overflow-y: auto;
    list-style: none;
  }

  @media (max-width: 62rem) {
    .class-layout {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
