<script lang="ts">
  import { Search } from "@lucide/svelte";
  import { MOD_USERS_PAGE, type ModUser, type ModUserFilter, type ModUserSort } from "@mtr/contracts";
  import { api, errorMessage } from "#lib/api.ts";
  import { session } from "#lib/session.svelte.ts";
  import type { Notes } from "#lib/notes.svelte.ts";
  import { fmtDate } from "#lib/format.ts";
  import Note from "./Note.svelte";

  // Every account, searchable, with moderator and suspension controls per row.
  let {
    notes,
    timeouts,
    ban,
    timeout,
    unsuspend,
  }: {
    /** shared with the rest of the page; rows use the f:<userId> keys like the flags tab */
    notes: Notes;
    timeouts: { label: string; hours: number }[];
    ban: (userId: string) => Promise<void>;
    timeout: (userId: string, hours: number) => Promise<void>;
    unsuspend: (userId: string) => Promise<void>;
  } = $props();

  let q = $state("");
  let filter = $state<ModUserFilter>("all");
  let sort = $state<ModUserSort>("newest");
  let page = $state(0);
  let users = $state<ModUser[] | null>(null);
  let total = $state(0);
  // bumped to refetch the current page after an action
  let reload = $state(0);

  $effect(() => {
    const query = { q: q.trim() || undefined, filter, sort, page };
    void reload;
    const t = setTimeout(() => {
      void api.mod.users({ query }).then((r) => {
        if (query.q !== (q.trim() || undefined) || query.filter !== filter || query.sort !== sort || query.page !== page) return;
        if (r.status === 200) {
          users = r.body.users;
          total = r.body.total;
        }
      });
    }, 150);
    return () => clearTimeout(t);
  });
  // a new search or filter starts from the first page
  const reset = () => (page = 0);

  const FILTERS: { value: ModUserFilter; label: string }[] = [
    { value: "all", label: "all" },
    { value: "moderators", label: "moderators" },
    { value: "supporters", label: "supporters" },
    { value: "suspended", label: "suspended" },
    { value: "flagged", label: "shadow queue" },
    { value: "bots", label: "bots" },
  ];
  const SORTS: { value: ModUserSort; label: string }[] = [
    { value: "newest", label: "newest" },
    { value: "oldest", label: "oldest" },
    { value: "active", label: "last seen" },
    { value: "tests", label: "most tests" },
    { value: "rating", label: "rating" },
    { value: "name", label: "name" },
  ];
  const pages = $derived(Math.max(1, Math.ceil(total / MOD_USERS_PAGE)));

  async function setModerator(u: ModUser, moderator: boolean) {
    const ask = moderator
      ? `Make ${u.name} a moderator? They'll see reports, stats and this list, and can ban players and add moderators.`
      : `Remove ${u.name}'s moderator access?`;
    if (!confirm(ask)) return;
    const r = await api.mod.setModerator({ params: { id: u.id }, body: { moderator } });
    if (r.status !== 200) notes.set(`f:${u.id}`, errorMessage(r), "error");
    else notes.set(`f:${u.id}`, moderator ? "now a moderator" : "no longer a moderator", "success");
    reload++;
  }
  async function act(run: Promise<void>) {
    await run;
    reload++;
  }
  function pickTimeout(e: Event & { currentTarget: HTMLSelectElement }, userId: string) {
    const hours = Number(e.currentTarget.value);
    e.currentTarget.value = "";
    if (hours) void act(timeout(userId, hours));
  }
  const ago = (iso: string | null) => {
    if (!iso) return "never";
    const m = (Date.now() - Date.parse(iso)) / 60_000;
    if (m < 5) return "just now";
    if (m < 60) return `${Math.round(m)}m ago`;
    if (m < 24 * 60) return `${Math.round(m / 60)}h ago`;
    if (m < 60 * 24 * 60) return `${Math.round(m / 60 / 24)}d ago`;
    return fmtDate(iso);
  };
</script>

<div class="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
  <div class="relative w-64">
    <Search size={14} class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sub" />
    <input class="input pl-8" placeholder="search by name" autocomplete="off" spellcheck="false" maxlength="64" bind:value={q} oninput={reset} />
  </div>
  <div class="flex flex-wrap gap-1 text-sm">
    {#each FILTERS as f (f.value)}
      <button class="toggle" class:on={filter === f.value} onclick={() => ((filter = f.value), reset())}>{f.label}</button>
    {/each}
  </div>
  <label class="ml-auto flex items-center gap-2 text-sm text-sub">
    sort
    <select class="cursor-pointer bg-transparent text-text outline-none" bind:value={sort} onchange={reset}>
      {#each SORTS as s (s.value)}<option value={s.value}>{s.label}</option>{/each}
    </select>
  </label>
</div>

{#if users === null}
  <div class="text-sub">loading…</div>
{:else}
  <div class="mb-2 text-xs text-sub">{total.toLocaleString()} account{total === 1 ? "" : "s"}</div>
  <div class="overflow-x-auto">
    <table class="w-full text-left text-sm">
      <thead class="text-sub">
        <tr>
          <th class="py-2 font-normal">player</th>
          <th class="font-normal">joined</th>
          <th class="font-normal">last seen</th>
          <th class="text-right font-normal">tests</th>
          <th class="text-right font-normal">rating</th>
          <th class="pl-4 font-normal">status</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each users as u (u.id)}
          {@const self = u.id === session.me?.id}
          <tr class="border-t border-sub-alt">
            <td class="py-2">
              <a class="hover:underline" href="/u/{u.name}">{u.name}</a>
              {#if u.moderator}<span class="ml-1 text-xs text-main">mod</span>{/if}
              {#if u.bot}<span class="ml-1 text-xs text-sub">bot</span>{/if}
              {#if u.supporter && !u.bot}<span class="ml-1 text-xs text-sub" title="supporter">♥</span>{/if}
            </td>
            <td class="whitespace-nowrap text-sub">{fmtDate(u.createdAt)}</td>
            <td class="whitespace-nowrap text-sub">{ago(u.lastSeen)}</td>
            <td class="text-right tabular-nums">{u.tests.toLocaleString()}</td>
            <td class="text-right tabular-nums">{u.rating ?? "—"}</td>
            <td class="pl-4 text-xs">
              {#if u.bannedAt}<span class="text-error">banned</span>
              {:else if u.timedOutUntil}<span class="text-main">timed out until {new Date(u.timedOutUntil).toLocaleString()}</span>
              {:else if u.flagged}<span class="text-main">shadow queue</span>
              {:else if !u.verified}<span class="text-sub">unverified</span>
              {:else}<span class="text-sub">active</span>{/if}
              <Note note={notes.get(`f:${u.id}`)} class="block" />
            </td>
            <td class="space-x-2 text-right whitespace-nowrap">
              {#if !self && !u.bot}
                {#if u.moderator}
                  <button class="text-sub hover:text-error" onclick={() => setModerator(u, false)}>remove mod</button>
                {:else if !u.bannedAt}
                  <button class="text-sub hover:text-text" onclick={() => setModerator(u, true)}>make mod</button>
                {/if}
              {/if}
              {#if !u.moderator}
                {#if u.bannedAt || u.timedOutUntil}
                  <button class="text-sub hover:text-text" onclick={() => act(unsuspend(u.id))}>lift</button>
                {/if}
                {#if !u.bannedAt}
                  <select class="cursor-pointer bg-transparent text-sub outline-none hover:text-text" aria-label="time out {u.name}" onchange={(e) => pickTimeout(e, u.id)}>
                    <option value="">timeout…</option>
                    {#each timeouts as t (t.hours)}<option value={t.hours}>{t.label}</option>{/each}
                  </select>
                  <button class="text-sub hover:text-error" onclick={() => act(ban(u.id))}>ban</button>
                {/if}
              {/if}
            </td>
          </tr>
        {:else}
          <tr><td colspan="7" class="py-4 text-sub">no accounts match.</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
  {#if pages > 1}
    <div class="mt-4 flex items-center justify-center gap-4 text-sm">
      <button class="toggle" disabled={page === 0} onclick={() => page--}>← prev</button>
      <span class="text-sub tabular-nums">page {page + 1} of {pages}</span>
      <button class="toggle" disabled={page >= pages - 1} onclick={() => page++}>next →</button>
    </div>
  {/if}
{/if}
