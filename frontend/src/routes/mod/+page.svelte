<script lang="ts">
  import { onMount } from "svelte";
  import type { FlagRow, HeldMatch, ReportRow } from "@mtr/contracts";
  import { api, errorMessage } from "#lib/api.ts";
  import { session } from "#lib/session.svelte.ts";
  import { Notes } from "#lib/notes.svelte.ts";
  import Note from "#lib/components/Note.svelte";
  import ModStats from "#lib/components/ModStats.svelte";
  import ModUsers from "#lib/components/ModUsers.svelte";

  let tab = $state<"reports" | "held" | "flags" | "stats" | "users">("reports");
  let reports = $state<ReportRow[]>([]);
  let held = $state<HeldMatch[]>([]);
  let flags = $state<FlagRow[]>([]);
  let denied = $state(false);
  // the outcome of an action, shown on the row it was taken from
  const notes = new Notes();

  async function load() {
    const [r, h, f] = await Promise.all([api.mod.reports(), api.mod.held(), api.mod.flags()]);
    if (r.status === 403) return void (denied = true);
    if (r.status === 200) reports = r.body.reports;
    if (h.status === 200) held = h.body.matches;
    if (f.status === 200) flags = f.body.flags;
  }
  onMount(load);

  const TIMEOUTS = [
    { label: "1 hour", hours: 1 },
    { label: "1 day", hours: 24 },
    { label: "7 days", hours: 7 * 24 },
    { label: "30 days", hours: 30 * 24 },
  ];
  const BAN_CONFIRM = "Ban this player and reverse their recent opponents' rating losses?";
  const FLAG_LABELS: Record<string, string> = { possible_ban_evader: "possible ban-evader", shared_ip: "shared ip" };

  /** Ask for the reason the player sees; null if the moderator cancelled. */
  const askReason = () => prompt("Reason shown to the player (optional):", "");

  async function resolve(id: number, action: "dismiss" | "ban" | "timeout" | "flag", hours?: number) {
    if (action === "ban" && !confirm(BAN_CONFIRM)) return;
    const reason = action === "ban" || action === "timeout" ? askReason() : undefined;
    if (reason === null) return;
    const r = await api.mod.resolveReport({ params: { id: String(id) }, body: { action, hours, reason } });
    if (r.status !== 200) notes.set(`r:${id}`, errorMessage(r), "error");
    await load();
  }
  async function ban(userId: string) {
    if (!confirm(BAN_CONFIRM)) return;
    const reason = askReason();
    if (reason === null) return;
    const r = await api.mod.ban({ params: { id: userId }, body: { reason } });
    if (r.status !== 200) notes.set(`f:${userId}`, errorMessage(r), "error");
    else notes.set(`f:${userId}`, "banned", "success");
    await load();
  }
  async function timeout(userId: string, hours: number) {
    const reason = askReason();
    if (reason === null) return;
    const r = await api.mod.timeout({ params: { id: userId }, body: { hours, reason } });
    if (r.status !== 200) notes.set(`f:${userId}`, errorMessage(r), "error");
    else notes.set(`f:${userId}`, "timed out from ranked and casual", "success");
    await load();
  }
  async function unsuspend(userId: string) {
    if (!confirm("Lift this player's ban or timeout? Voided races and refunded rating stay as they are.")) return;
    const r = await api.mod.unsuspend({ params: { id: userId } });
    if (r.status !== 200) notes.set(`f:${userId}`, errorMessage(r), "error");
    else notes.set(`f:${userId}`, "ban or timeout lifted", "success");
    await load();
  }
  /** a timeout picker that resets itself after each pick */
  function pickTimeout(e: Event & { currentTarget: HTMLSelectElement }, apply: (hours: number) => void) {
    const hours = Number(e.currentTarget.value);
    e.currentTarget.value = "";
    if (hours) apply(hours);
  }
  const bannedFrom = (details: unknown) => ((details as { banned?: { id: string; name: string }[] } | null)?.banned ?? []);
  async function resolveHeld(id: string, action: "approve" | "void") {
    const r = await api.mod.resolveHeld({ params: { id }, body: { action } });
    if (r.status !== 200) notes.set(`h:${id}`, errorMessage(r), "error");
    await load();
  }
  async function unflag(id: string) {
    const r = await api.mod.unflag({ params: { id } });
    if (r.status !== 200) notes.set(`f:${id}`, errorMessage(r), "error");
    else notes.set(`f:${id}`, "moved back to the normal queue", "success");
  }
</script>

<svelte:head><title>Moderation · MT Ranked</title></svelte:head>

{#if denied || (session.loaded && !session.me?.moderator)}
  <div class="pt-16 text-center text-sub">moderators only.</div>
{:else}
  <div class="mx-auto max-w-[1000px] animate-fade">
    <h1 class="font-logo text-4xl">moderation</h1>
    <div class="mt-6 mb-6 flex gap-1">
      <button class="toggle" class:on={tab === "reports"} onclick={() => (tab = "reports")}>reports ({reports.length})</button>
      <button class="toggle" class:on={tab === "held"} onclick={() => (tab = "held")}>held results ({held.length})</button>
      <button class="toggle" class:on={tab === "flags"} onclick={() => (tab = "flags")}>auto flags ({flags.length})</button>
      <button class="toggle" class:on={tab === "stats"} onclick={() => (tab = "stats")}>stats</button>
      <button class="toggle" class:on={tab === "users"} onclick={() => (tab = "users")}>users</button>
    </div>

    {#if tab === "reports"}
      {#each reports as r (r.id)}
        <div class="card mb-3 flex flex-wrap items-center gap-4">
          <div class="flex-1 text-sm">
            <div><span class="text-main">{r.reported ?? "unknown"}</span> reported by {r.reporter ?? "deleted"}</div>
            <div class="text-sub">{r.reason}</div>
            <div class="text-xs text-sub">{new Date(r.createdAt).toLocaleString()}</div>
            <Note note={notes.get(`r:${r.id}`)} />
          </div>
          <a class="btn" href="/replay/{r.matchId}" target="_blank">replay</a>
          <button class="btn" onclick={() => resolve(r.id, "dismiss")}>dismiss</button>
          <button class="btn" onclick={() => resolve(r.id, "flag")} title="move to the separate queue for flagged players">shadow queue</button>
          {#if r.reportedId}
            <select class="btn cursor-pointer" aria-label="time out" onchange={(e) => pickTimeout(e, (h) => resolve(r.id, "timeout", h))}>
              <option value="">timeout…</option>
              {#each TIMEOUTS as t (t.hours)}<option value={t.hours}>{t.label}</option>{/each}
            </select>
          {/if}
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
            <Note note={notes.get(`h:${m.matchId}`)} />
          </div>
          <a class="btn" href="/replay/{m.matchId}" target="_blank">replay</a>
          <button class="btn btn-main" onclick={() => resolveHeld(m.matchId, "approve")}>approve</button>
          <button class="btn" onclick={() => resolveHeld(m.matchId, "void")}>void</button>
        </div>
      {:else}
        <div class="text-sub">nothing held.</div>
      {/each}
    {:else if tab === "stats"}
      <ModStats />
    {:else if tab === "users"}
      <ModUsers {notes} timeouts={TIMEOUTS} {ban} {timeout} {unsuspend} />
    {:else}
      <table class="w-full text-left text-sm">
        <thead class="text-sub"><tr><th class="py-2 font-normal">player</th><th class="font-normal">reason</th><th class="font-normal">details</th><th class="font-normal">when</th><th class="font-normal">status</th><th></th></tr></thead>
        <tbody>
          {#each flags as f (f.id)}
            <tr class="border-t border-sub-alt">
              <td class="py-2"><a class="hover:underline" href="/u/{f.user}">{f.user}</a></td>
              <td class="text-main">{FLAG_LABELS[f.reason] ?? f.reason}</td>
              <td class="text-xs text-sub">
                {#if f.reason === "possible_ban_evader"}
                  signed up from a network used by banned
                  {#each bannedFrom(f.details) as b, i (b.id)}{i ? ", " : " "}<span class="text-text">{b.name}</span>{/each}
                {:else}
                  {JSON.stringify(f.details)}
                {/if}
              </td>
              <td class="text-sub">{new Date(f.createdAt).toLocaleDateString()}</td>
              <td class="text-xs">
                {#if f.bannedAt}<span class="text-error">banned</span>
                {:else if f.timedOutUntil}<span class="text-main">timed out until {new Date(f.timedOutUntil).toLocaleString()}</span>
                {:else}<span class="text-sub">active</span>{/if}
                <Note note={notes.get(`f:${f.userId}`)} class="block" />
              </td>
              <td class="space-x-2 text-right whitespace-nowrap">
                {#if f.matchId}<a class="link" href="/replay/{f.matchId}" target="_blank">replay</a>{/if}
                <button class="text-sub hover:text-text" onclick={() => unflag(f.userId)}>unflag</button>
                {#if f.bannedAt || f.timedOutUntil}
                  <button class="text-sub hover:text-text" onclick={() => unsuspend(f.userId)}>lift</button>
                {/if}
                {#if !f.bannedAt}
                  <select class="cursor-pointer bg-transparent text-sub outline-none hover:text-text" aria-label="time out" onchange={(e) => pickTimeout(e, (h) => timeout(f.userId, h))}>
                    <option value="">timeout…</option>
                    {#each TIMEOUTS as t (t.hours)}<option value={t.hours}>{t.label}</option>{/each}
                  </select>
                  <button class="text-sub hover:text-error" onclick={() => ban(f.userId)}>ban</button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
{/if}
