<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { api, errorMessage } from "#lib/api.ts";
  import { session } from "#lib/session.svelte.ts";
  import { game } from "#lib/game.svelte.ts";

  let email = $state("");
  let password = $state("");
  let error = $state<string | null>(null);
  let busy = $state(false);
  const next = $derived(page.url.searchParams.get("next") ?? "/");

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = null;
    const r = await api.auth.login({ body: { email, password } });
    busy = false;
    if (r.status !== 200) return void (error = errorMessage(r));
    session.set(r.body.user);
    void game.reconnect();
    goto(next.startsWith("/") ? next : "/");
  }
</script>

<svelte:head><title>Sign In · MT Ranked</title></svelte:head>

<form class="mx-auto mt-8 max-w-sm space-y-4 animate-rise" onsubmit={submit}>
  <h1 class="font-logo text-3xl">sign in</h1>
  <input class="input" type="email" autocomplete="email" placeholder="email" bind:value={email} required />
  <input class="input" type="password" autocomplete="current-password" placeholder="password" bind:value={password} required />
  {#if error}<div class="text-sm text-error">{error}</div>{/if}
  <button class="btn btn-main w-full" disabled={busy}>{busy ? "signing in…" : "sign in"}</button>
  <div class="flex justify-between text-sm text-sub">
    <a class="hover:text-text" href="/signup?next={encodeURIComponent(next)}">create account</a>
    <a class="hover:text-text" href="/forgot">forgot password?</a>
  </div>
</form>
