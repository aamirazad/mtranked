<script lang="ts">
  import type { Snippet } from "svelte";
  import { onMount } from "svelte";
  import { Ghost } from "@lucide/svelte";
  import { tierFor, PLACEMENT_RACES, resolveEquipped } from "@mtr/shared";
  import type { RaceResult } from "#lib/game.svelte.ts";
  import { game } from "#lib/game.svelte.ts";
  import { session } from "#lib/session.svelte.ts";
  import { celebrate } from "#lib/celebrate.ts";
  import TierBadge from "./TierBadge.svelte";
  import SpeedChart from "./SpeedChart.svelte";

  let { result, actions }: { result: RaceResult; actions?: Snippet } = $props();

  const meId = $derived(game.you?.id);
  const me = $derived(result.results.find((r) => r.id === meId));
  const many = $derived(result.results.length > 2);
  const won = $derived(me?.placement === 1 && result.results.length > 1);

  const title = $derived.by(() => {
    if (!me) return "race over";
    if (me.forfeit) return "forfeit";
    if (result.mode === "ghost") return won ? "you beat the ghost" : "the ghost wins";
    if (result.results.length === 1) return "finished";
    if (many) return `#${me.placement} of ${result.results.length}`;
    return won ? "victory" : "defeat";
  });

  // count the rating up/down for a bit of drama
  let shown = $state(0);
  onMount(() => {
    void session.refresh();
    if (won) celebrate(resolveEquipped(session.me?.equipped).finish);
    if (me?.ratingBefore === undefined || me.ratingAfter === undefined) return;
    const from = me.ratingBefore;
    const to = me.ratingAfter;
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 900);
      shown = Math.round(from + (to - from) * (1 - (1 - k) ** 3));
      if (k < 1) requestAnimationFrame(step);
    };
    shown = from;
    setTimeout(() => requestAnimationFrame(step), 350);
  });

  const tierUp = $derived(
    me?.ratingBefore !== undefined && me.ratingAfter !== undefined && (me.races ?? 0) >= PLACEMENT_RACES
      ? tierFor(me.ratingAfter).id !== tierFor(me.ratingBefore).id || (me.races ?? 0) === PLACEMENT_RACES
      : false,
  );
  // one wpm scale for every graph so the small ones compare against yours
  const chartMax = $derived(Math.max(1, ...result.results.flatMap((r) => r.timeline ?? []).map((p) => Math.max(p.wpm, p.raw))));
  const showMinis = $derived(result.results.some((r) => r.id !== meId && r.timeline?.length));
  const fmtTime = (ms: number | null) => (ms === null ? "—" : `${(ms / 1000).toFixed(2)}s`);
</script>

<div class="mx-auto max-w-[1000px] animate-rise">
  <div class="mb-8 flex flex-wrap items-end justify-between gap-6">
    <div>
      <div class="label mb-1">{result.mode === "ghost" ? "ghost race · unrated" : result.mode}</div>
      <div class="font-logo text-6xl {won ? 'text-main' : me?.forfeit ? 'text-error' : 'text-text'}">{title}</div>
    </div>
    {#if me && me.delta !== undefined && me.ratingAfter !== undefined}
      <div class="text-right">
        {#if result.held}
          <div class="text-sm text-sub">result held for review — rating unchanged for now</div>
        {:else}
          <div class="text-5xl tabular-nums {me.delta >= 0 ? 'text-win' : 'text-error'} animate-pop">
            {me.delta >= 0 ? "+" : ""}{me.delta}
          </div>
          <div class="mt-1 flex items-center justify-end gap-3">
            <TierBadge rating={shown} races={me.races} />
          </div>
          {#if tierUp && (me.races ?? 0) === PLACEMENT_RACES}
            <div class="mt-2 text-sm text-main animate-pop">placements complete!</div>
          {:else if tierUp}
            <div class="mt-2 text-sm text-main animate-pop">new tier: {tierFor(me.ratingAfter).name}</div>
          {/if}
        {/if}
      </div>
    {/if}
  </div>

  {#if me}
    <div class="mb-10 flex flex-wrap gap-12">
      <div><div class="label text-xl">wpm</div><div class="text-6xl text-main tabular-nums">{Math.round(me.wpm)}</div></div>
      <div><div class="label text-xl">acc</div><div class="text-6xl text-main tabular-nums">{Math.round(me.acc)}%</div></div>
      <div><div class="label text-xl">time</div><div class="text-6xl text-main tabular-nums">{me.timeMs !== null ? (me.timeMs / 1000).toFixed(1) + "s" : "—"}</div></div>
      {#if me.xp}<div><div class="label text-xl">xp</div><div class="text-6xl text-main tabular-nums">+{me.xp}</div></div>{/if}
    </div>
    {#if me.timeline?.length}
      <div class="card mb-10">
        <div class="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-sub">
          <span class="label">speed over time</span>
          <span class="ml-auto inline-flex items-center gap-1.5"><span class="inline-block h-0.5 w-4 rounded bg-main"></span>wpm</span>
          <span class="inline-flex items-center gap-1.5"><span class="inline-block h-0.5 w-4 rounded bg-sub"></span>raw</span>
          <span class="inline-flex items-center gap-1.5"><span class="text-error">×</span>errors</span>
        </div>
        <SpeedChart points={me.timeline} max={chartMax} label="your speed over time" />
      </div>
    {/if}
  {/if}

  <table class="w-full text-left text-sm">
    <thead class="text-sub">
      <tr>
        <th class="py-2 font-normal">#</th>
        <th class="font-normal">player</th>
        {#if showMinis}<th class="w-[200px] font-normal"><span class="sr-only">graph</span></th>{/if}
        <th class="text-right font-normal">wpm</th>
        <th class="text-right font-normal">raw</th>
        <th class="text-right font-normal">acc</th>
        <th class="text-right font-normal">time</th>
        {#if result.mode === "ranked"}<th class="text-right font-normal">rating</th>{/if}
      </tr>
    </thead>
    <tbody>
      {#each result.results as r (r.id)}
        <tr class="border-t border-sub-alt" class:text-main={r.id === meId}>
          <td class="py-2.5">{r.placement}</td>
          <td>
            <span class="inline-flex items-center gap-2">
              {#if r.ghost}<Ghost size={14} class="text-sub" />{/if}
              {#if !r.guest && !r.ghost}<a href="/u/{r.name}" class="hover:underline">{r.name}</a>{:else}{r.name}{/if}
              {#if r.guest}<span class="text-xs text-sub">guest</span>{/if}
              {#if r.forfeit}<span class="text-xs text-error">forfeit</span>{:else if !r.finished}<span class="text-xs text-sub">{r.progress}%</span>{/if}
            </span>
          </td>
          {#if showMinis}
            <td class="py-1.5 pr-4">
              {#if r.id !== meId && r.timeline?.length}
                <SpeedChart points={r.timeline} max={chartMax} compact label="{r.name}'s speed over time" />
              {/if}
            </td>
          {/if}
          <td class="text-right tabular-nums">{Math.round(r.wpm)}</td>
          <td class="text-right tabular-nums text-sub">{Math.round(r.raw)}</td>
          <td class="text-right tabular-nums">{Math.round(r.acc)}%</td>
          <td class="text-right tabular-nums">{fmtTime(r.timeMs)}</td>
          {#if result.mode === "ranked"}
            <td class="text-right tabular-nums {r.delta === undefined ? '' : r.delta >= 0 ? 'text-win' : 'text-error'}">
              {r.delta === undefined ? "—" : `${r.delta >= 0 ? "+" : ""}${r.delta}`}
            </td>
          {/if}
        </tr>
      {/each}
    </tbody>
  </table>
  {#if !result.saved}
    <div class="mt-4 text-sm text-error">We couldn't save this race. It won't count towards your stats.</div>
  {/if}

  {#if actions}
    <div class="mt-10 flex flex-wrap items-center gap-3">{@render actions()}</div>
  {/if}
</div>
