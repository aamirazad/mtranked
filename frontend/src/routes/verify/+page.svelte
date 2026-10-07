<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { api, errorMessage } from "#lib/api.ts";
  import { session } from "#lib/session.svelte.ts";
  import { game } from "#lib/game.svelte.ts";

  let status = $state<"working" | "ok" | "error">("working");
  let message = $state("");

  onMount(async () => {
    const token = page.url.searchParams.get("token") ?? "";
    const r = await api.auth.verify({ body: { token } });
    if (r.status === 200) {
      status = "ok";
      await session.refresh();
      void game.reconnect();
    } else {
      status = "error";
      message = errorMessage(r);
    }
  });
</script>

<div class="mx-auto mt-16 max-w-md text-center animate-rise">
  {#if status === "working"}
    <div class="text-sub">verifying…</div>
  {:else if status === "ok"}
    <div class="font-logo text-3xl text-main">email verified</div>
    <p class="mt-3 text-sub">ranked is unlocked{session.me?.rankedBlock ? " once your account is old enough" : ""}.</p>
    <a class="btn btn-main mt-8" href="/play/ranked">play ranked</a>
  {:else}
    <div class="text-xl">{message}</div>
    <a class="btn mt-8" href="/settings">send a new link</a>
  {/if}
</div>
