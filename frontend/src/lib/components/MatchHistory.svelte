<script lang="ts">
  import { Play } from "@lucide/svelte";
  import type { MatchSummary } from "@mtr/contracts";
  import { api } from "#lib/api.ts";

  type Kind = "ranked" | "casual" | "private";
  const KINDS: { id: Kind; label: string }[] = [
    { id: "ranked", label: "ranked" },
    { id: "casual", label: "casual" },
    { id: "private", label: "private rooms" },
  ];

  let { name }: { name: string } = $props();

  let kind = $state<Kind>("ranked");
  let matches = $state<MatchSummary[]>([]);
  let more = $state(false);
  let limited = $state(false);

  $effect(() => {
    const n = name;
    const k = kind;
    matches = [];
    more = false;
    limited = false;
    void load(n, k, 0);
  });

  async function load(n: string, k: Kind, offset: number) {
    const r = await api.users.matches({ params: { name: n }, query: { offset, kind: k } });
    if (r.status !== 200 || n !== name || k !== kind) return;
    matches = offset ? [...matches, ...r.body.matches] : r.body.matches;
    more = r.body.more;
    limited = r.body.limited;
  }

  const ago = (iso: string) => {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    return `${Math.round(s / 86400)}d ago`;
  };
</script>

<div class="mb-3 flex items-center gap-4">
  <div class="label">match history</div>
  <div class="flex gap-1 text-sm">
    {#each KINDS as t (t.id)}
      <button class="toggle" class:on={kind === t.id} onclick={() => (kind = t.id)}>{t.label}</button>
    {/each}
  </div>
</div>
{#if matches.length === 0}
  <div class="text-sub">no races yet.</div>
{:else}
  <table class="w-full text-left text-sm">
    <thead class="text-sub">
      <tr>
        <th class="py-2 font-normal">result</th>
        {#if kind === "casual"}<th class="font-normal">mode</th>{/if}
        <th class="font-normal">opponent</th>
        <th class="text-right font-normal">wpm</th>
        <th class="text-right font-normal">acc</th>
        {#if kind === "ranked"}<th class="text-right font-normal">rating</th>{/if}
        <th class="text-right font-normal">when</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      {#each matches as m (m.matchId)}
        <tr class="border-t border-sub-alt">
          <td class="py-2.5">
            {#if m.players === 1}<span class="text-sub">solo</span>
            {:else if m.placement === 1}<span class="text-win">{m.players > 2 ? "#1" : "win"}</span>
            {:else}<span class="text-error">{m.players > 2 ? `#${m.placement}` : "loss"}</span>{/if}
            {#if m.status === "held"}<span class="ml-1 text-xs text-sub">(review)</span>{/if}
            {#if m.status === "void"}<span class="ml-1 text-xs text-sub">(void)</span>{/if}
          </td>
          {#if kind === "casual"}<td class="text-sub">{m.mode}</td>{/if}
          <td>{#if m.opponent}{m.opponent}{:else if m.players > 2}<span class="text-sub">{m.players} players</span>{/if}</td>
          <td class="text-right tabular-nums">{Math.round(m.wpm)}</td>
          <td class="text-right tabular-nums text-sub">{Math.round(m.acc)}%</td>
          {#if kind === "ranked"}
            <td class="text-right tabular-nums {m.delta === null ? 'text-sub' : m.delta >= 0 ? 'text-win' : 'text-error'}">
              {m.delta === null ? "—" : `${m.delta >= 0 ? "+" : ""}${Math.round(m.delta)}`}
            </td>
          {/if}
          <td class="text-right text-sub">{ago(m.finishedAt)}</td>
          <td class="text-right"><a href="/replay/{m.matchId}" class="inline-flex text-sub hover:text-main" title="replay"><Play size={14} /></a></td>
        </tr>
      {/each}
    </tbody>
  </table>
  {#if more}<button class="btn btn-ghost mt-4" onclick={() => load(name, kind, matches.length)}>load more</button>{/if}
  {#if limited}<div class="mt-4 text-xs text-sub">free accounts keep their last 50 races. supporters keep everything.</div>{/if}
{/if}
