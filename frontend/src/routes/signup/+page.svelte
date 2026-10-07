<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { api, errorMessage, fieldErrors } from "#lib/api.ts";
  import { session } from "#lib/session.svelte.ts";
  import { game } from "#lib/game.svelte.ts";

  let email = $state("");
  let displayName = $state("");
  let password = $state("");
  let error = $state<string | null>(null);
  let fields = $state<Record<string, string>>({});
  let busy = $state(false);
  const next = $derived(page.url.searchParams.get("next") ?? "/");

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = null;
    fields = {};
    const r = await api.auth.signup({ body: { email, password, displayName } });
    busy = false;
    if (r.status !== 200) {
      fields = fieldErrors(r);
      error = Object.keys(fields).length ? null : errorMessage(r);
      return;
    }
    session.set(r.body.user);
    void game.reconnect();
    goto(next.startsWith("/") ? next : "/");
  }
</script>

<svelte:head><title>create account · mt ranked</title></svelte:head>

<form class="mx-auto mt-8 max-w-sm space-y-4 animate-rise" onsubmit={submit}>
  <h1 class="font-logo text-3xl">create account</h1>
  <div>
    <input class="input" placeholder="display name" autocomplete="username" bind:value={displayName} required minlength="3" maxlength="20" />
    {#if fields.displayName}<div class="mt-1 text-xs text-error">{fields.displayName}</div>{/if}
  </div>
  <div>
    <input class="input" type="email" autocomplete="email" placeholder="email" bind:value={email} required />
    {#if fields.email}<div class="mt-1 text-xs text-error">{fields.email}</div>{/if}
  </div>
  <div>
    <input class="input" type="password" autocomplete="new-password" placeholder="password (8+ characters)" bind:value={password} required minlength="8" />
    {#if fields.password}<div class="mt-1 text-xs text-error">{fields.password}</div>{/if}
  </div>
  {#if error}<div class="text-sm text-error">{error}</div>{/if}
  <button class="btn btn-main w-full" disabled={busy}>{busy ? "creating…" : "create account"}</button>
  <div class="text-sm text-sub">
    we'll email you a link to verify your address (needed for ranked). already have an account? <a class="link" href="/login?next={encodeURIComponent(next)}">sign in</a>
  </div>
</form>
