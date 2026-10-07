<script lang="ts">
  import { api, errorMessage } from "#lib/api.ts";

  let email = $state("");
  let sent = $state(false);
  let error = $state<string | null>(null);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const r = await api.auth.forgot({ body: { email } });
    if (r.status === 200) sent = true;
    else error = errorMessage(r);
  }
</script>

<form class="mx-auto mt-8 max-w-sm space-y-4 animate-rise" onsubmit={submit}>
  <h1 class="font-logo text-3xl">reset password</h1>
  {#if sent}
    <p class="text-sub">if an account exists for {email}, a reset link is on its way. it's valid for 30 minutes.</p>
  {:else}
    <input class="input" type="email" placeholder="email" bind:value={email} required />
    {#if error}<div class="text-sm text-error">{error}</div>{/if}
    <button class="btn btn-main w-full">send reset link</button>
  {/if}
</form>
