<script lang="ts">
  import { browser } from "$app/environment";
  import { resolve } from "$app/paths";
  import { onMount } from "svelte";
  import {
    preloadDatabase,
    resetDatabase,
    runQuery,
    type LoadProgress,
    type QueryOutcome,
  } from "$lib/client/sql";
  import { fetchManifest } from "$lib/manifest";
  import type { Manifest } from "$lib/manifest";
  import type { SqlValue } from "sql.js/dist/sql-wasm.js";

  const EXAMPLES = [
    {
      title: "Legendary items and where they come from",
      description: "List legendary item records and their modelled source paths.",
      sql: "SELECT i.name, s.source_kind, s.source_id, s.chance FROM item_sources s JOIN items i ON i.id = s.item_id WHERE i.rarity = 'legendary' ORDER BY s.chance DESC LIMIT 50;",
    },
    {
      title: "Which enemies drop a given item",
      description: "Find the enemies that drop ember_shard.",
      sql: "SELECT e.name, e.level, d.chance, d.min, d.max FROM enemy_drops d JOIN enemies e ON e.id = d.enemy_id WHERE d.item_id = 'ember_shard' ORDER BY e.level;",
    },
    {
      title: "Items with no modelled source yet",
      description: "Find items without a modelled source. This gap does not prove that the items cannot be obtained.",
      sql: "SELECT id, name, type, rarity FROM items WHERE has_modelled_source = 0 ORDER BY id;",
    },
    {
      title: "Highest-level recipes and their inputs",
      description: "Compare the highest crafting-level recipes with their input items.",
      sql: "SELECT r.name, r.crafting_level, group_concat(ri.item_id) AS inputs FROM recipes r JOIN recipe_inputs ri ON ri.recipe_id = r.id GROUP BY r.id ORDER BY r.crafting_level DESC LIMIT 30;",
    },
    {
      title: "Equipment sell value by slot and rarity",
      description: "Summarize equipment sell value across slots and rarities.",
      sql: "SELECT slot, rarity, COUNT(*) AS n, ROUND(AVG(sell_value)) AS avg_sell_value FROM items WHERE slot IS NOT NULL GROUP BY slot, rarity ORDER BY slot, n DESC;",
    },
  ] as const;

  let sql = $state(EXAMPLES[0].sql);
  let manifest = $state<Manifest | null>(null);
  let phase = $state<"loading" | "ready" | "error">("loading");
  let loadError = $state("");
  let receivedBytes = $state(0);
  let totalBytes = $state<number | null>(null);
  let queryResult = $state<QueryOutcome | null>(null);
  let waitingForDatabase = $state(false);
  let copied = $state(false);

  let loadGeneration = 0;
  let queryGeneration = 0;

  function formatMiB(bytes: number): string {
    return (bytes / 1_048_576).toFixed(1);
  }

  function encodeBase64Url(value: string): string {
    return btoa(String.fromCharCode(...new TextEncoder().encode(value)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  function decodeBase64Url(value: string): string {
    const restored = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = restored + "=".repeat((4 - (restored.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function queryFromHash(hash: string): string {
    if (!hash.startsWith("#q=")) {
      return EXAMPLES[0].sql;
    }

    try {
      return decodeBase64Url(hash.slice(3));
    } catch {
      return EXAMPLES[0].sql;
    }
  }

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  function handleProgress(generation: number, progress: LoadProgress): void {
    if (generation !== loadGeneration) return;
    receivedBytes = progress.receivedBytes;
    totalBytes = progress.totalBytes;
  }

  function beginLoad(): void {
    const generation = ++loadGeneration;
    phase = "loading";
    loadError = "";
    receivedBytes = 0;
    totalBytes = null;
    queryResult = null;
    waitingForDatabase = false;
    queryGeneration += 1;

    const manifestPromise = fetchManifest();
    void manifestPromise.then(
      (nextManifest) => {
        if (generation === loadGeneration) {
          manifest = nextManifest;
        }
      },
      () => {
        // Promise.all below owns the visible error state.
      },
    );

    const databasePromise = preloadDatabase((progress) => handleProgress(generation, progress));
    void Promise.all([manifestPromise, databasePromise]).then(
      ([nextManifest]) => {
        if (generation !== loadGeneration) return;
        manifest = nextManifest;
        phase = "ready";
        void runCurrentQuery();
      },
      (error: unknown) => {
        if (generation !== loadGeneration) return;
        phase = "error";
        loadError = errorMessage(error);
      },
    );
  }

  async function runCurrentQuery(): Promise<void> {
    const generation = ++queryGeneration;
    const query = sql;
    waitingForDatabase = phase === "loading";
    queryResult = null;

    try {
      const outcome = await runQuery(query);
      if (generation !== queryGeneration) return;
      queryResult = outcome;
    } catch (error: unknown) {
      if (generation !== queryGeneration) return;
      queryResult = { ok: false, message: errorMessage(error), elapsedMs: 0 };
    } finally {
      if (generation === queryGeneration) {
        waitingForDatabase = false;
      }
    }
  }

  function selectExample(exampleSql: string): void {
    sql = exampleSql;
    void runCurrentQuery();
  }

  function handleEditorKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void runCurrentQuery();
    }
  }

  async function copyLink(): Promise<void> {
    if (!browser) return;
    const link = `${location.origin}${location.pathname}#q=${encodeBase64Url(sql)}`;
    await navigator.clipboard.writeText(link);
    copied = true;
    window.setTimeout(() => {
      copied = false;
    }, 1600);
  }

  function retry(): void {
    resetDatabase();
    beginLoad();
  }

  function formatCell(value: SqlValue): string {
    if (value === null) return "";
    if (value instanceof Uint8Array) return new TextDecoder().decode(value);
    return String(value);
  }

  onMount(() => {
    sql = queryFromHash(location.hash);
    beginLoad();
  });
</script>

<svelte:head>
  <title>SQL Playground | Vespera Compendium</title>
  <meta
    name="description"
    content="Query the Vespera Compendium database in your browser with the SQL playground."
  />
</svelte:head>

<div class="crumbs">
  <a href={resolve("/")}>Compendium</a>
  <span aria-hidden="true"> / </span>
  SQL Playground
</div>

<span class="kicker">SQL PLAYGROUND</span>
<h1>SQL Playground</h1>
<p>The whole Vespera database runs in your browser. The page sends no data anywhere.</p>

<div class="stack">
  <section class="panel pad">
    <div class="controls">
      <button class="btn btn-primary" type="button" onclick={() => void runCurrentQuery()}>Run</button>
      <button class="btn" type="button" onclick={() => void copyLink()}>Copy link</button>
      {#if copied}
        <span class="status" role="status">Copied</span>
      {/if}
    </div>
    <textarea
      bind:value={sql}
      aria-label="SQL query"
      spellcheck="false"
      onkeydown={handleEditorKeydown}
    ></textarea>
  </section>

  <section class="panel pad">
    <h2>Example queries</h2>
    <div class="chips">
      {#each EXAMPLES as example}
        <div class="chip-row">
          <button class="btn" type="button" onclick={() => selectExample(example.sql)}>{example.title}</button>
          <span class="chip-note">{example.description}</span>
        </div>
      {/each}
    </div>
  </section>

  <section class="panel pad" aria-live="polite">
    <h2>Database</h2>
    {#if phase === "loading"}
      {#if totalBytes === null}
        <p class="status">Loading database... {formatMiB(receivedBytes)} MiB</p>
      {:else}
        <p class="status">
          Loading database... {formatMiB(receivedBytes)} of {formatMiB(totalBytes)} MiB
        </p>
      {/if}
    {:else if phase === "ready"}
      <p class="status">
        Database ready - {formatMiB(receivedBytes)} MiB - {manifest?.tables.length ?? 0} tables
      </p>
    {:else}
      <div class="error">{loadError}</div>
      <div class="controls">
        <button class="btn" type="button" onclick={retry}>Retry</button>
      </div>
    {/if}
  </section>

  <section class="panel pad" aria-live="polite">
    <h2>Results</h2>
    {#if waitingForDatabase}
      <p class="status">Waiting for database...</p>
    {:else if queryResult === null}
      <p class="muted">Run a query to see its results.</p>
    {:else if queryResult.ok}
      <p class="status">{queryResult.rows.length} rows - {queryResult.elapsedMs.toFixed(1)} ms</p>
      {#if queryResult.columns.length > 0}
        <div class="scroll">
          <table>
            <thead>
              <tr>
                {#each queryResult.columns as column}
                  <th scope="col">{column}</th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each queryResult.rows as row}
                <tr>
                  {#each row as value}
                    <td>{formatCell(value)}</td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    {:else}
      <div class="error">{queryResult.message}</div>
    {/if}
  </section>

  <section class="panel pad">
    <h2>Schema</h2>
    {#if manifest === null}
      <p class="muted">Loading schema...</p>
    {:else}
      {#each manifest.tables as table}
        <details class="schema-table">
          <summary>{table.name} <span class="muted">({table.rows} rows)</span></summary>
          <ul class="schema-cols">
            {#each table.columns as column}
              <li>{column.name}: {column.type}</li>
            {/each}
          </ul>
        </details>
      {/each}
    {/if}
  </section>
</div>

<style>
  /* A max-content grid column lets the widest result table stretch the page.
     Pin the column to the container so the table's own scroll area moves. */
  .stack {
    grid-template-columns: minmax(0, 1fr);
  }

  /* An example title is a sentence, not a word.
     Let the button wrap when its intrinsic width exceeds the phone viewport. */
  .chip-row .btn {
    flex: 0 1 auto;
    max-inline-size: 100%;
    text-align: start;
  }

  /* Use padding instead of flex so the disclosure marker keeps its 44px floor. */
  .schema-table summary {
    padding-block: 0.6rem;
  }
</style>
