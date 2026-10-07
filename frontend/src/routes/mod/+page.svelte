<script lang="ts">
  import { onMount } from "svelte";
  import type { FlagRow, HeldMatch, ReportRow } from "@mtr/contracts";
  import { api, errorMessage } from "#lib/api.ts";
  import { session } from "#lib/session.svelte.ts";
  import { toasts } from "#lib/toast.svelte.ts";

  let tab = $state<"reports" | "held" | "flags">("reports");
  let reports = $state<ReportRow[]>([]);
  let held = $state<HeldMatch[]>([]);
  let flags = $state<FlagRow[]>([]);
  let denied = $state(false);

  async function load() {
    const [r, h, f] = await Promise.all([api.mod.reports(), api.mod.held(), api.mod.flags()]);
    if (r.status === 403) return void (denied = true);
    if (r.status === 200) reports = r.body.reports;
    if (h.status === 200) held = h.body.matches;
    if (f.status === 200) flags = f.body.flags;
  }
  onMount(load);

  async function resolve(id: number, action: "dismiss" | "ban" | "flag") {
    if (action === "ban" && !confirm("Ban this player and reverse their recent opponents' rating losses?")) return;
    const r = await api.mod.resolveReport({ params: { id: String(id) }, body: { action } });
    if (r.status !== 200) toasts.show(errorMessage(r), "error");
    await load();
  }
  async function resolveHeld(id: string, action: "approve" | "void") {
    const r = await api.mod.resolveHeld({ params: { id }, body: { action } });
    if (r.status !== 200) toasts.show(errorMessage(r), "error");
    await load();
  }
  async function unflag(id: string) {
    await api.mod.unflag({ params: { id } });
    toasts.show("Player moved back to the normal queue.", "success");
  }
</script>

<svelte:head><title>moderation · mt ranked</title></svelte:head>

{#if denied || (session.loaded && !session.me?.moderator)}
  <div class="pt-16 text-center text-sub">moderators only.</div>
{:else}
  <div class="mx-auto max-w-[1000px] animate-fade">
    <h1 class="font-logo text-4xl">moderation</h1>
    <div class="mt-6 mb-6 flex gap-1">
      <button class="toggle" class:on={tab === "reports"} onclick={() => (tab = "reports")}>reports ({reports.length})</button>
      <button class="toggle" class:on={tab === "held"} onclick={() => (tab = "held")}>held results ({held.length})</button>
      <button class="toggle" class:on={tab === "flags"} onclick={() => (tab = "flags")}>auto flags ({flags.length})</button>
    </div>

    {#if tab === "reports"}
      {#each reports as r (r.id)}
        <div class="card mb-3 flex flex-wrap items-center gap-4">
          <div class="flex-1 text-sm">
            <div><span class="text-main">{r.reported ?? "unknown"}</span> reported by {r.reporter ?? "deleted"}</div>
            <div class="text-sub">{r.reason}</div>
            <div class="text-xs text-sub">{new Date(r.createdAt).toLocaleString()}</div>
          </div>
          <a class="btn" href="/replay/{r.matchId}" target="_blank">replay</a>
          <button class="btn" onclick={() => resolve(r.id, "dismiss")}>dismiss</button>
          <button class="btn" onclick={() => resolve(r.id, "flag")} title="move to the separate queue for flagged players">shadow queue</button>
          <button class="btn hover:!bg-error" onclick={() => resolve(r.id, "ban")}>ban</button>
        </div>
      {:else}
        <div class="text-sub">no open reports.</div>
      {/each}
    {:else if tab === "held"}
      <p class="mb-4 text-sm text-sub">ranked races above the speed ceiling wait here before their rating changes apply.</p>
      {#each held as m (m.matchId)}
        <div class="card mb-3 flex flex-wrap items-center gap-4">
          <div class="flex-1 text-sm">
            {#each m.players as p (p.name)}<div>{p.name}: <span class="text-main">{Math.round(p.wpm)} wpm</span> · {Math.round(p.acc)}%</div>{/each}
          </div>
          <a class="btn" href="/replay/{m.matchId}" target="_blank">replay</a>
          <button class="btn btn-main" onclick={() => resolveHeld(m.matchId, "approve")}>approve</button>
          <button class="btn" onclick={() => resolveHeld(m.matchId, "void")}>void</button>
        </div>
      {:else}
        <div class="text-sub">nothing held.</div>
      {/each}
    {:else}
      <table class="w-full text-left text-sm">
        <thead class="text-sub"><tr><th class="py-2 font-normal">player</th><th class="font-normal">reason</th><th class="font-normal">details</th><th class="font-normal">when</th><th></th></tr></thead>
        <tbody>
          {#each flags as f (f.id)}
            <tr class="border-t border-sub-alt">
              <td class="py-2"><a class="hover:underline" href="/u/{f.user}">{f.user}</a></td>
              <td class="text-main">{f.reason}</td>
              <td class="text-xs text-sub">{JSON.stringify(f.details)}</td>
              <td class="text-sub">{new Date(f.createdAt).toLocaleDateString()}</td>
              <td class="space-x-2 text-right">
                {#if f.matchId}<a class="link" href="/replay/{f.matchId}" target="_blank">replay</a>{/if}
                <button class="text-sub hover:text-text" onclick={() => unflag(f.userId)}>unflag</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
{/if}
