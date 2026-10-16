<script lang="ts">
  // The row above the words while typing: timer/word count, live speed,
  // accuracy and burst, each shown big ("text"), small ("mini") or not at all
  // per the player's settings. Progress can also be a thin bar.
  import type { Snippet } from "svelte";
  import { prefs, type LiveStyle } from "#lib/prefs.svelte.ts";

  let {
    show,
    counter,
    progress,
    wpm,
    acc,
    burst,
    children,
  }: {
    show: boolean;
    counter: string | number;
    /** 0..1, for the bar style */
    progress: number;
    wpm?: number;
    acc?: number;
    burst?: number;
    children?: Snippet;
  } = $props();

  const stats = $derived(
    (
      [
        [prefs.liveWpm, wpm, " wpm"],
        [prefs.liveAcc, acc, "%"],
        [prefs.liveBurst, burst, " burst"],
      ] as [LiveStyle, number | undefined, string][]
    ).filter(([style, v]) => style !== "off" && v !== undefined),
  );
</script>

<div class="relative mb-2 flex h-10 items-end gap-6 tabular-nums">
  {#if show}
    {#if prefs.liveProgress === "text"}<span class="text-3xl text-main">{counter}</span>{/if}
    {#if prefs.liveProgress === "mini"}<span class="text-lg text-main">{counter}</span>{/if}
    {#each stats as [style, v, unit] (unit)}
      <span class={style === "text" ? "text-xl text-sub" : "text-sm text-sub"}>{v}{unit}</span>
    {/each}
    {#if prefs.liveProgress === "bar"}
      <div class="absolute inset-x-0 bottom-0 h-1 overflow-hidden rounded-full bg-sub-alt">
        <div class="h-full bg-main transition-[width] duration-100 ease-linear" style="width: {progress * 100}%"></div>
      </div>
    {/if}
  {/if}
  {@render children?.()}
</div>
