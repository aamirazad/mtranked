<script lang="ts">
  // The row above the words while typing: timer/word count, live speed,
  // accuracy and burst, each shown big ("text"), small ("mini") or not at all
  // per the player's settings. Progress can also be a thin bar.
  import { untrack, type Snippet } from "svelte";
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

  // wpm is sampled once a second (like monkeytype) rather than every key, since
  // a few keys into a test it swings wildly and is unreadable
  const WPM_TICK_MS = 1000;
  let shownWpm = $state<number>();
  $effect(() => {
    if (!show) return void (shownWpm = undefined);
    const sample = () => (shownWpm = untrack(() => wpm));
    sample();
    const id = setInterval(sample, WPM_TICK_MS);
    return () => clearInterval(id);
  });

  const stats = $derived(
    (
      [
        [prefs.liveWpm, wpm === undefined ? undefined : shownWpm, " wpm"],
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
