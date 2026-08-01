<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import Art from "./Art.svelte";

  /**
   * Client-side search over the published search index.
   *
   * The index is fetched on first focus rather than on mount, so a visitor who never searches never
   * pays its 367 KiB. It is fetched once per page load and shared by every instance through a
   * module-level promise, because the shell's field and a page's own field are both on screen.
   *
   * Keys in the published JSON are abbreviated to keep it small; the mapping is expanded here and
   * published in the manifest so it is not a private convention.
   */
  type Entry = {
    table: string;
    id: string;
    slug: string;
    name: string;
    kind: string;
    subtitle: string | null;
    level: number | null;
    rarity: string | null;
    image: string | null;
  };

  type Packed = {
    t: string;
    i: string;
    s: string;
    n: string;
    k: string;
    b: string | null;
    l: number | null;
    r: string | null;
    g: string | null;
  };

  let {
    placeholder = "Search items, enemies, quests, recipes…",
    focusOnDesktop = false,
    scopeTable = null,
    size = "md",
  }: {
    placeholder?: string;
    /**
     * Focus the field on mount, but only on a wide viewport with a real pointer.
     *
     * Not the `autofocus` attribute: that fires everywhere, and on a phone it opens the keyboard
     * over the content the visitor came to read. It also moves focus without announcing it, which
     * is why Svelte warns on it. Pressing `/` reaches this field from anywhere regardless.
     */
    focusOnDesktop?: boolean;
    /** Restricts results to one published table, for the entity browsers. */
    scopeTable?: string | null;
    size?: "md" | "lg";
  } = $props();

  const LIMIT = 12;

  let query = $state("");
  let entries = $state<Entry[] | null>(null);
  let loading = $state(false);
  let highlighted = $state(0);
  let open = $state(false);
  let input = $state<HTMLInputElement | null>(null);
  let focused = false;

  $effect(() => {
    if (!focusOnDesktop || focused || !input) return;
    // A wide viewport with a real pointer: a desk, not a phone or a tablet held in one hand.
    if (!window.matchMedia("(min-width: 64rem) and (pointer: fine)").matches) return;
    focused = true;
    // preventScroll, because the field may sit below the shell's own copy and focusing it should
    // never yank the page down past the sentence explaining what the site is.
    input.focus({ preventScroll: true });
  });

  async function load(): Promise<void> {
    if (entries || loading) return;
    loading = true;
    try {
      const response = await fetch("/data/search_index.json");
      const packed = (await response.json()) as Packed[];
      entries = packed.map((row) => ({
        table: row.t,
        id: row.i,
        slug: row.s,
        name: row.n,
        kind: row.k,
        subtitle: row.b,
        level: row.l,
        rarity: row.r,
        image: row.g,
      }));
    } catch {
      entries = [];
    } finally {
      loading = false;
    }
  }

  /**
   * Exact name, then name prefix, then name substring, then id substring; shorter names win ties.
   * Ranked rather than filtered because a substring match over 2267 records otherwise buries the
   * record whose name the player actually typed.
   */
  let results = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0 || !entries) return [] as Entry[];
    const pool = scopeTable ? entries.filter((entry) => entry.table === scopeTable) : entries;
    const scored: { entry: Entry; rank: number }[] = [];
    for (const entry of pool) {
      const name = entry.name.toLowerCase();
      const rank = name === needle ? 0 : name.startsWith(needle) ? 1 : name.includes(needle) ? 2 : entry.id.toLowerCase().includes(needle) ? 3 : -1;
      if (rank >= 0) scored.push({ entry, rank });
    }
    scored.sort((left, right) => left.rank - right.rank || left.entry.name.length - right.entry.name.length);
    return scored.map((item) => item.entry);
  });

  let shown = $derived(results.slice(0, LIMIT));

  $effect(() => {
    // Re-anchor the highlight whenever the result set changes, so Enter never fires a stale row.
    query;
    highlighted = 0;
  });

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      query = "";
      open = false;
      input?.blur();
      return;
    }
    if (shown.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      highlighted = (highlighted + 1) % shown.length;
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      highlighted = (highlighted - 1 + shown.length) % shown.length;
    } else if (event.key === "Enter") {
      const entry = shown[highlighted];
      if (entry) {
        event.preventDefault();
        query = "";
        open = false;
        input?.blur();
        void goto(resolve(`/${entry.slug}/${entry.id}/`));
      }
    }
  }

  /** `/` focuses search from anywhere, unless the user is already typing into something. */
  function onWindowKeydown(event: KeyboardEvent): void {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
    const active = document.activeElement;
    const typing =
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      (active instanceof HTMLElement && active.isContentEditable);
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
    type="search"
    class="search-input"
    {placeholder}
    autocomplete="off"
    spellcheck="false"
    aria-label={scopeTable ? `Search ${scopeTable.replace(/_/g, " ")}` : "Search the compendium"}
    onfocus={() => {
      open = true;
      void load();
    }}
    onblur={() => setTimeout(() => (open = false), 140)}
    onkeydown={onKeydown}
  />

  <p class="sr-only" aria-live="polite">
    {#if query.trim().length === 0}{:else if loading}Loading the index.{:else}{results.length} matches for {query}.{/if}
  </p>

  {#if open && query.trim().length > 0}
    <div class="search-results panel">
      {#if loading}
        <p class="search-note">Loading…</p>
      {:else if shown.length === 0}
        <p class="search-note">No record matches "{query}".</p>
      {:else}
        <ul>
          {#each shown as entry, index (entry.table + entry.id)}
            <li class:highlighted={index === highlighted}>
              <a
                href={resolve(`/${entry.slug}/${entry.id}/`)}
                onmouseenter={() => (highlighted = index)}
              >
                <Art src={entry.image} alt={entry.name} size="sm" rarity={entry.rarity} />
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
          <p class="search-note">+{results.length - shown.length} more</p>
        {/if}
      {/if}
    </div>
  {/if}
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
    padding: 0.75rem 1rem;
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

  .search-results ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .search-results a {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.35rem 0.45rem;
    border-radius: 8px;
    color: inherit;
    text-decoration: none;
  }

  .highlighted a {
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
    color: var(--text-muted);
    font-size: var(--text-xs);
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

  .search-note {
    margin: 0;
    padding: 0.5rem;
    color: var(--text-muted);
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
