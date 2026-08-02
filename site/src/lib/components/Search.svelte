<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import {
    loadSearchIndex,
    rankSearchEntries,
    searchHref,
    type SearchEntry,
  } from "$lib/client/search-index";
  import Art from "./Art.svelte";

  /**
   * Client-side search over the published index, as a WAI-ARIA combobox.
   *
   * The index itself is owned by `$lib/client/search-index`, not by this component: the shell field
   * and a page's own field are both mounted on most routes, and they must share one transfer and one
   * decode. This file owns the interaction only.
   *
   * The field is never focused programmatically on mount. Initial focus belongs to the document, so
   * the skip link is the first stop for a keyboard user and a phone does not open its keyboard over
   * the page a visitor came to read. `/` reaches the field from anywhere.
   */
  let {
    idBase,
    placeholder = "Search items, enemies, quests, recipes…",
    /**
     * Shown instead of `placeholder` on a narrow viewport.
     *
     * The home field's full prompt overran a 390px box and clipped to "…recipe or zor", which read
     * as a broken control on the one instrument the page points at.
     */
    narrowPlaceholder = null,
    scopeTable = null,
    size = "md",
  }: {
    /** Unique per mounted instance, because two fields are on screen and every id here derives from it. */
    idBase: string;
    placeholder?: string;
    narrowPlaceholder?: string | null;
    /** Restricts results to one published table, for the entity browsers. */
    scopeTable?: string | null;
    size?: "md" | "lg";
  } = $props();

  const LIMIT = 12;

  let listboxId = $derived(`${idBase}-listbox`);
  let statusId = $derived(`${idBase}-status`);

  let narrow = $state(false);
  $effect(() => {
    if (!narrowPlaceholder) return;
    const query = window.matchMedia("(max-width: 30rem)");
    const sync = () => (narrow = query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  });
  let shownPlaceholder = $derived(narrow && narrowPlaceholder ? narrowPlaceholder : placeholder);

  let query = $state("");
  let entries = $state<SearchEntry[] | null>(null);
  let loading = $state(false);
  let failed = $state(false);
  let active = $state(0);
  let open = $state(false);
  let input = $state<HTMLInputElement | null>(null);

  function load(): void {
    if (entries || loading) return;
    loading = true;
    failed = false;
    loadSearchIndex()
      .then((rows) => (entries = rows))
      .catch(() => (failed = true))
      .finally(() => (loading = false));
  }

  let results = $derived(
    entries ? rankSearchEntries(entries, query.trim().toLowerCase(), scopeTable) : [],
  );
  let shown = $derived(results.slice(0, LIMIT));
  /* The popup is showing something, which is what `aria-expanded` reports: a "no match" note is a
     displayed popup too, and reporting it collapsed would contradict what is on screen. */
  let expanded = $derived(open && query.trim().length > 0);
  let activeId = $derived(expanded && shown.length > 0 ? `${idBase}-option-${active}` : undefined);

  $effect(() => {
    // Re-anchor the active option whenever the query changes, so Enter never fires a stale row.
    query;
    active = 0;
  });

  function follow(entry: SearchEntry): void {
    query = "";
    open = false;
    void goto(resolve(searchHref(entry)));
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      // Cleared and closed, but focus stays put: blurring here loses the place a keyboard user
      // reached the field from, and Escape is the one key they use to change their mind.
      event.preventDefault();
      query = "";
      open = false;
      return;
    }
    if (shown.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      active = (active + 1) % shown.length;
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      active = (active - 1 + shown.length) % shown.length;
    } else if (event.key === "Enter") {
      const entry = shown[active];
      if (entry) {
        event.preventDefault();
        follow(entry);
      }
    }
  }

  /** `/` focuses search from anywhere, unless the user is already typing into something. */
  function onWindowKeydown(event: KeyboardEvent): void {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = document.activeElement;
    const typing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable);
    if (typing) return;
    event.preventDefault();
    input?.focus();
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

<div class="search search-{size}">
  <input
    bind:this={input}
    bind:value={query}
    id="{idBase}-input"
    type="search"
    class="search-input"
    role="combobox"
    placeholder={shownPlaceholder}
    autocomplete="off"
    spellcheck="false"
    aria-label={scopeTable ? `Search ${scopeTable.replace(/_/g, " ")}` : "Search the compendium"}
    aria-expanded={expanded}
    aria-controls={listboxId}
    aria-activedescendant={activeId}
    aria-describedby={statusId}
    aria-autocomplete="list"
    onfocus={() => {
      open = true;
      load();
    }}
    oninput={() => {
      open = true;
      load();
    }}
    onblur={() => setTimeout(() => (open = false), 140)}
    onkeydown={onKeydown}
  />

  <p id={statusId} class="sr-only" aria-live="polite">
    {#if query.trim().length === 0}{:else if loading}The search index loads.{:else if failed}The
      search index did not load.{:else}The search found {results.length} matches for {query}.{/if}
  </p>

  <div class="search-results panel" class:search-hidden={!expanded} aria-hidden={!expanded}>
    {#if loading}
      <p class="search-note">The search index loads.</p>
    {:else if failed}
      <p class="search-note">The search index did not load. Focus the field again to retry.</p>
    {:else if shown.length === 0}
      <p class="search-note">No record matches "{query}".</p>
    {/if}
    <ul id={listboxId} role="listbox" aria-label="Search results">
      {#each shown as entry, index (entry.table + entry.id)}
        <li
          id="{idBase}-option-{index}"
          role="option"
          class:active={index === active}
          aria-selected={index === active}
        >
          <!--
            The row is an anchor so a middle click and a copied link both work, but pointer
            selection goes through the same handler as Enter: the visitor and the keyboard must not
            reach two different URLs from the same active row.
          -->
          <a
            href={resolve(searchHref(entry))}
            tabindex="-1"
            onmouseenter={() => (active = index)}
            onclick={(event) => {
              event.preventDefault();
              follow(entry);
            }}
          >
            <Art
              src={entry.image}
              alt={entry.name}
              kind="general"
              variant="thumb"
              rarity={entry.rarity}
            />
            <span class="search-text">
              <span class="search-name">{entry.name}</span>
              {#if entry.subtitle}<span class="search-sub">{entry.subtitle}</span>{/if}
            </span>
            <span class="search-meta">
              <span class="search-kind">{entry.kind}</span>
              {#if entry.level !== null}<span class="search-level">{entry.level}</span>{/if}
            </span>
          </a>
        </li>
      {/each}
    </ul>
    {#if results.length > shown.length}
      <p class="search-note">The search has {results.length - shown.length} more results.</p>
    {/if}
  </div>
</div>

<style>
  .search {
    position: relative;
    inline-size: 100%;
  }

  .search-input {
    inline-size: 100%;
  }

  .search-lg .search-input {
    min-block-size: 3.25rem;
    padding: 0.85rem 1rem;
    font-size: var(--text-lead);
  }

  .search-results {
    position: absolute;
    z-index: 40;
    inset-inline: 0;
    inset-block-start: calc(100% + 0.4rem);
    max-block-size: min(28rem, 70vh);
    overflow-y: auto;
    padding: 0.3rem;
  }

  /*
   * Hidden rather than unmounted, because `aria-controls` must resolve to a real element for the
   * combobox relationship to be valid even while the popup is closed.
   */
  .search-hidden {
    display: none;
  }

  .search-results ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .search-results a {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-block-size: 2.75rem;
    padding: 0.35rem 0.45rem;
    border-radius: var(--radius-art);
    color: inherit;
    text-decoration: none;
  }

  .active a {
    background: var(--panel-hover-strong);
  }

  .search-text {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-inline-size: 0;
  }

  .search-name {
    overflow: hidden;
    color: var(--parchment);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .search-sub {
    overflow: hidden;
    color: var(--text-muted);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /*
   * On the raised active row the muted grey drops under 4.5:1, so the subtitle steps up one ink
   * rather than the row losing its highlight.
   */
  .active .search-sub {
    color: var(--lavender-grey);
  }

  .search-meta {
    display: flex;
    flex: 0 0 auto;
    align-items: baseline;
    gap: 0.5rem;
  }

  .search-kind {
    color: var(--kicker);
    font-size: var(--text-2xs);
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .search-level {
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .active .search-level {
    color: var(--lavender-grey);
  }

  .search-note {
    margin: 0;
    padding: 0.5rem;
    color: var(--lavender-grey);
    font-size: var(--text-sm);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
