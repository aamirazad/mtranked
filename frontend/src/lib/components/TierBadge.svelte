<script lang="ts">
  import { rankLabel, tierFor } from "@mtr/shared";

  let {
    rating,
    races,
    size = "md",
    showRating = true,
  }: { rating: number; races?: number; size?: "sm" | "md" | "lg"; showRating?: boolean } = $props();

  const info = $derived(races === undefined ? { placed: true, tier: tierFor(rating), label: tierFor(rating).name } : rankLabel(rating, races));
  const color = $derived(info.tier?.color ?? "var(--tier-unranked, #646669)");
  const px = $derived(size === "lg" ? 56 : size === "md" ? 22 : 16);
</script>

<span class="inline-flex items-center gap-2 align-middle" title={info.label}>
  <svg width={px} height={px} viewBox="0 0 32 32" aria-hidden="true">
    <path d="M16 2 28 9v14l-12 7L4 23V9z" style="fill: {color}; stroke: {color}" fill-opacity={info.placed ? 0.18 : 0.08} stroke-width="2" />
    {#if info.placed}
      <path d="M16 9 21 14l-5 9-5-9z" style="fill: {color}" />
    {:else}
      <text x="16" y="21" text-anchor="middle" font-size="12" style="fill: {color}">?</text>
    {/if}
  </svg>
  {#if size !== "sm" || showRating}
    <span class="leading-tight">
      <span style="color: {color}" class={size === "lg" ? "text-xl" : "text-sm"}>{info.label}</span>
      {#if showRating && info.placed}<span class="text-sub {size === 'lg' ? 'text-xl' : 'text-sm'}"> {Math.round(rating)}</span>{/if}
    </span>
  {/if}
</span>
