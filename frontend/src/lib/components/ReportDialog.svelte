<script lang="ts">
  import { untrack } from "svelte";
  import { api, errorMessage } from "#lib/api.ts";
  import { toasts } from "#lib/toast.svelte.ts";

  let {
    matchId,
    players,
    onclose,
  }: { matchId: string; players: { id: string; name: string }[]; onclose: () => void } = $props();

  let target = $state(untrack(() => players[0]?.id ?? ""));
  let reason = $state("suspected cheating");
  let details = $state("");
  let busy = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    const r = await api.report({
      body: {
        matchId,
        reportedUserId: target && !target.startsWith("g_") && !target.startsWith("ghost:") ? target : undefined,
        reason: details ? `${reason}: ${details}` : reason,
      },
    });
    busy = false;
    if (r.status === 200) {
      toasts.show("Thanks, a moderator will review the replay.", "success");
      onclose();
    } else toasts.show(errorMessage(r), "error");
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="fixed inset-0 z-40 flex items-center justify-center bg-bg/80 backdrop-blur-sm animate-fade" onclick={(e) => e.target === e.currentTarget && onclose()}>
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
    <div class="flex justify-end gap-2">
      <button type="button" class="btn btn-ghost" onclick={onclose}>cancel</button>
      <button class="btn btn-main" disabled={busy}>send report</button>
    </div>
  </form>
</div>
