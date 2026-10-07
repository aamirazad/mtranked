<script lang="ts">
  import { page } from "$app/state";
  import { api, errorMessage } from "#lib/api.ts";

  let password = $state("");
  let done = $state(false);
  let error = $state<string | null>(null);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const r = await api.auth.reset({ body: { token: page.url.searchParams.get("token") ?? "", password } });
    if (r.status === 200) done = true;
    else error = errorMessage(r);
  }
</script>

<form class="mx-auto mt-8 max-w-sm space-y-4 animate-rise" onsubmit={submit}>
  <h1 class="font-logo text-3xl">choose a new password</h1>
  {#if done}
    <p class="text-sub">password updated. all devices were signed out.</p>
    <a class="btn btn-main" href="/login">sign in</a>
  {:else}
    <input class="input" type="password" autocomplete="new-password" placeholder="new password (8+ characters)" minlength="8" bind:value={password} required />
    {#if error}<div class="text-sm text-error">{error}</div>{/if}
    <button class="btn btn-main w-full">update password</button>
  {/if}
</form>
