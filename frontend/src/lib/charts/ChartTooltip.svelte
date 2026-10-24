<script lang="ts">
  import type { Snippet } from "svelte";
  import type { ChartHover } from "./hover.svelte.ts";

  // Follows the hover springs; flips to the left of the guide in the right half,
  // fades in and out rather than popping.
  let {
    hover,
    width,
    top = 0,
    children,
  }: { hover: ChartHover; width: number; top?: number; children: Snippet } = $props();

  const flip = $derived(hover.x.target > width / 2);
</script>

<div
  class="pointer-events-none absolute z-10 rounded-lg bg-bg/95 px-3 py-2 text-xs shadow-lg ring-1 ring-white/5 backdrop-blur-sm"
  style="left: {hover.x.current}px; top: {top}px; opacity: {hover.shown ? 1 : 0}; transform: translateX({flip
    ? 'calc(-100% - 14px)'
    : '14px'}); transition: opacity 0.15s ease-out, transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)"
  aria-hidden="true"
>
  {#if hover.index !== null}{@render children()}{/if}
</div>
