<script lang="ts">
  import { resolve } from "$app/paths";
</script>

<svelte:head>
  <title>Not found — Vespera Compendium</title>
</svelte:head>

<span class="kicker">NOT FOUND</span>
<h1>Record not found</h1>
<p>The page you requested does not exist in the published compendium.</p>
<a href={resolve("/")}>Return to the compendium</a>
