<script lang="ts">
  import { untrack } from "svelte";
  import { api, errorMessage } from "#lib/api.ts";

  let {
    matchId,
    players,
    onclose,
  }: { matchId: string; players: { id: string; name: string }[]; onclose: () => void } = $props();

  let target = $state(untrack(() => players[0]?.id ?? ""));
  let reason = $state("suspected cheating");
  let details = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);
  let sent = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = null;
    const r = await api.report({
      body: {
        matchId,
        reportedUserId: target && !target.startsWith("g_") && !target.startsWith("ghost:") ? target : undefined,
        reason: details ? `${reason}: ${details}` : reason,
      },
    });
    busy = false;
    if (r.status === 200) sent = true;
    else error = errorMessage(r);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="fixed inset-0 z-40 flex items-center justify-center bg-bg/80 backdrop-blur-sm animate-fade" onclick={(e) => e.target === e.currentTarget && onclose()}>
  {#if sent}
    <div class="card w-[min(440px,92vw)] animate-pop space-y-4" role="status">
      <div class="text-lg">report sent</div>
      <div class="text-sm text-sub">Thanks, a moderator will review the replay.</div>
      <div class="flex justify-end"><button class="btn btn-main" onclick={onclose}>done</button></div>
    </div>
  {:else}
    <form class="card w-[min(440px,92vw)] animate-pop space-y-4" onsubmit={submit}>
      <div class="text-lg">report a player</div>
      {#if players.length > 1}
        <label class="block space-y-1">
          <span class="label">player</span>
          <select class="input" bind:value={target}>
            {#each players as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
          </select>
        </label>
      {/if}
      <label class="block space-y-1">
        <span class="label">reason</span>
        <select class="input" bind:value={reason}>
          <option>suspected cheating</option>
          <option>offensive name</option>
          <option>intentional throwing</option>
          <option>other</option>
        </select>
      </label>
      <label class="block space-y-1">
        <span class="label">details (optional)</span>
        <textarea class="input h-24 resize-none" maxlength="400" bind:value={details}></textarea>
      </label>
      <div class="flex items-center justify-end gap-2">
        {#if error}<span class="mr-auto text-sm text-error" role="alert">{error}</span>{/if}
        <button type="button" class="btn btn-ghost" onclick={onclose}>cancel</button>
        <button class="btn btn-main" disabled={busy}>send report</button>
      </div>
    </form>
  {/if}
</div>
