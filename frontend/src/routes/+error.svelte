<script lang="ts">
  import { page } from "$app/state";
  import { CloudOff, SearchX, RotateCcw } from "@lucide/svelte";

  const notFound = $derived(page.status === 404);
</script>

<svelte:head><title>{notFound ? "Not found" : "Can't connect"} · MT Ranked</title></svelte:head>

<div class="flex min-h-[60vh] flex-col items-center justify-center gap-5 text-center animate-fade">
  {#if notFound}
    <SearchX size={44} class="text-sub" />
    <h1 class="font-logo text-3xl">page not found</h1>
    <p class="max-w-md text-sub">we couldn't find what you were looking for. it may have moved or never existed.</p>
    <a href="/" class="btn btn-main">back home</a>
  {:else}
    <CloudOff size={44} class="text-sub" />
    <h1 class="font-logo text-3xl">can't reach the server</h1>
    <p class="max-w-md text-sub">
      there was a problem connecting to mt ranked. the server may be down for a moment. sorry about that, please try again
      shortly.
    </p>
    <button class="btn btn-main" onclick={() => location.reload()}><RotateCcw size={16} /> try again</button>
  {/if}
</div>
