<script lang="ts">
  import type { Snippet } from "svelte";
  import type { CharStats, TimelinePoint, WordStat } from "@mtr/engine";
  import SpeedChart from "./SpeedChart.svelte";
  import WordHistory from "./WordHistory.svelte";

  // monkeytype-style result block: big wpm + acc beside the speed chart, then a row of
  // secondary stats, then the input history.
  let {
    wpm,
    acc,
    raw,
    timeMs,
    consistency,
    chars,
    timeline,
    words,
    pb,
    testType = [],
    chartMax,
    extra,
  }: {
    wpm: number;
    acc: number;
    raw: number;
    timeMs: number | null;
    consistency?: number | null;
    chars?: CharStats | null;
    timeline?: TimelinePoint[] | null;
    words?: WordStat[] | null;
    pb?: number | null;
    testType?: string[];
    chartMax?: number;
    /** extra stat cells appended to the row (xp, placement, …) */
    extra?: Snippet;
  } = $props();

  const r2 = (n: number) => Math.round(n * 100) / 100;
</script>

<div class="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-[auto_minmax(0,1fr)]">
  <div class="flex gap-10 md:flex-col md:gap-2">
    <div class="tip w-fit" aria-label="{r2(wpm)} wpm">
      <div class="label text-3xl leading-none">wpm</div>
      <div class="text-7xl leading-tight text-main tabular-nums">{Math.round(wpm)}</div>
    </div>
    <div class="tip w-fit" aria-label="{r2(acc)}% accuracy">
      <div class="label text-3xl leading-none">acc</div>
      <div class="text-7xl leading-tight text-main tabular-nums">{Math.round(acc)}%</div>
    </div>
  </div>
  <div class="min-w-0">
    {#if timeline?.length}
      <SpeedChart points={timeline} max={chartMax} {pb} height={220} label="your speed over time" />
    {/if}
  </div>
</div>

<div class="mt-6 grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-3 lg:flex lg:flex-wrap lg:justify-between">
  {#if testType.length}
    <div>
      <div class="label text-sm">test type</div>
      <div class="text-main">{#each testType as t (t)}<div>{t}</div>{/each}</div>
    </div>
  {/if}
  <div class="tip w-fit" aria-label="{r2(raw)} wpm">
    <div class="label text-sm">raw</div>
    <div class="text-3xl text-main tabular-nums">{Math.round(raw)}</div>
  </div>
  {#if chars}
    <div class="tip w-fit" aria-label="correct, incorrect, extra, missed">
      <div class="label text-sm">characters</div>
      <div class="text-3xl text-main tabular-nums">{chars.join("/")}</div>
    </div>
  {/if}
  {#if consistency != null}
    <div>
      <div class="label text-sm">consistency</div>
      <div class="text-3xl text-main tabular-nums">{Math.round(consistency)}%</div>
    </div>
  {/if}
  <div class="tip w-fit" aria-label={timeMs === null ? "did not finish" : `${r2(timeMs / 1000)}s`}>
    <div class="label text-sm">time</div>
    <div class="text-3xl text-main tabular-nums">{timeMs === null ? "—" : `${Math.round(timeMs / 1000)}s`}</div>
  </div>
  {@render extra?.()}
</div>

{#if words?.length}
  <div class="mt-8"><WordHistory {words} /></div>
{/if}
