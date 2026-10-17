<script lang="ts">
  import { AlignLeft, Gauge } from "@lucide/svelte";
  import type { WordStat } from "@mtr/engine";

  // monkeytype's input history: every word reached, mistakes marked; or coloured by
  // burst speed. Hovering a word shows what was typed and its burst.
  let { words }: { words: WordStat[] } = $props();

  let heat = $state(false);
  const bursts = $derived(words.map((w) => w.b).filter((b) => b > 0));
  // five buckets around the median burst
  const bins = $derived.by(() => {
    if (!bursts.length) return [];
    const sorted = [...bursts].sort((a, b) => a - b);
    const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
    return [q(0.2), q(0.4), q(0.6), q(0.8)];
  });
  const HEAT = ["var(--color-error)", "color-mix(in srgb, var(--color-error) 50%, var(--color-text))", "var(--color-text)", "color-mix(in srgb, var(--color-main) 55%, var(--color-text))", "var(--color-main)"];
  const bin = (b: number) => bins.filter((x) => b > x).length;
  const legend = $derived(
    bins.length
      ? [`<${bins[0]}`, `${bins[0]}-${bins[1]}`, `${bins[1]}-${bins[2]}`, `${bins[2]}-${bins[3]}`, `${bins[3]}+`]
      : [],
  );
</script>

<div>
  <div class="mb-2 flex flex-wrap items-center gap-3">
    <span class="label text-sm">input history</span>
    <button class="toggle tip inline-flex" class:on={!heat} aria-label="mistakes" onclick={() => (heat = false)}><AlignLeft size={15} /></button>
    <button class="toggle tip inline-flex" class:on={heat} aria-label="burst heatmap" onclick={() => (heat = true)}><Gauge size={15} /></button>
    {#if heat && legend.length}
      <span class="flex overflow-hidden rounded text-[11px] text-bg">
        {#each legend as l, i (i)}<span class="px-1.5 py-0.5 tabular-nums" style="background: {HEAT[i]}">{l}</span>{/each}
      </span>
    {/if}
  </div>
  <div class="flex flex-wrap gap-x-2.5 gap-y-1 text-lg leading-relaxed">
    {#each words as w, i (i)}
      {@const wrong = w.i !== w.w}
      <span
        class="tip whitespace-nowrap"
        class:wrong={wrong && !heat}
        aria-label="{w.b} wpm{wrong ? ` · typed “${w.i}”` : ''}"
        style={heat ? `color: ${HEAT[bin(w.b)]}` : ""}
      >
        {#if heat}{w.w}{:else}{#each [...w.w] as ch, j (j)}<span class={w.i[j] === undefined ? "text-sub" : w.i[j] === ch ? "text-text" : "text-error"}>{ch}</span>{/each}{#if w.i.length > w.w.length}<span class="text-error-extra">{w.i.slice(w.w.length)}</span>{/if}{/if}
      </span>
    {/each}
  </div>
</div>

<style>
  .wrong {
    text-decoration: underline;
    text-decoration-color: var(--color-error);
    text-underline-offset: 6px;
    text-decoration-thickness: 2px;
  }
</style>
