<script lang="ts">
  import { onMount } from "svelte";
  import type { Tier } from "@mtr/shared";

  // full screen reveal for finishing placements or climbing a tier.
  // `from` is null when the player was unranked before this race
  let { from, to, rating, onclose }: { from: Tier | null; to: Tier; rating: number; onclose: () => void } = $props();

  const CHARGE_MS = 2800;
  const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  let phase = $state<"charge" | "reveal" | "leaving">(reduced ? "reveal" : "charge");
  let canClose = $state(reduced);
  const timers: ReturnType<typeof setTimeout>[] = [];
  const later = (fn: () => void, ms: number) => timers.push(setTimeout(fn, ms));

  const oldColor = $derived(from?.color ?? "#646669");

  function reveal() {
    if (phase !== "charge") return;
    phase = "reveal";
    later(() => (canClose = true), 900);
  }

  function advance() {
    if (phase === "charge") return reveal();
    if (phase !== "reveal" || !canClose) return;
    phase = "leaving";
    later(onclose, reduced ? 0 : 300);
  }

  onMount(() => {
    if (!reduced) later(reveal, CHARGE_MS);
    // capture on window so the results page's own shortcuts (enter to queue again) don't fire underneath
    const onkey = (e: KeyboardEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (e.key === "Enter" || e.key === " " || e.key === "Escape") advance();
    };
    addEventListener("keydown", onkey, true);
    return () => {
      removeEventListener("keydown", onkey, true);
      timers.forEach(clearTimeout);
    };
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events (keys are handled on window) -->
<div
  class="rankup fixed inset-0 z-[110] flex cursor-pointer flex-col items-center justify-center bg-bg select-none"
  class:leaving={phase === "leaving"}
  style="--tier: {to.color}; --old: {oldColor}"
  role="dialog"
  aria-modal="true"
  aria-label={from ? `promoted to ${to.name}` : `placed in ${to.name}`}
  tabindex="-1"
  onclick={advance}
>
  {#if phase === "charge"}
    <div class="label mb-8 text-base charge-label">{from ? "promotion" : "placements complete"}</div>
    <div class="pop">
      <svg class="old-badge" width="160" height="160" viewBox="0 0 32 32" aria-hidden="true">
        <path d="M16 2 28 9v14l-12 7L4 23V9z" style="fill: var(--old); stroke: var(--old)" fill-opacity="0.12" stroke-width="1.2" />
        {#if from}
          <path d="M16 9 21 14l-5 9-5-9z" style="fill: var(--old)" />
        {:else}
          <text x="16" y="20.5" text-anchor="middle" font-size="11" style="fill: var(--old)">?</text>
        {/if}
      </svg>
    </div>
    <!-- keeps the badge in the same spot across the swap -->
    <div class="invisible mt-6 font-logo text-6xl">&nbsp;</div>
    <div class="invisible mt-3 text-xl">&nbsp;</div>
  {:else}
    {#if !reduced}<div class="flash"></div>{/if}
    <div class="label mb-8 text-base reveal-label">{from ? "promoted to" : "you placed in"}</div>
    <svg class="new-badge" width="160" height="160" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 2 28 9v14l-12 7L4 23V9z" style="fill: var(--tier); stroke: var(--tier)" fill-opacity="0.18" stroke-width="1.2" />
      <path d="M16 9 21 14l-5 9-5-9z" style="fill: var(--tier)" />
    </svg>
    <div class="tier-name mt-6 font-logo text-6xl" style="color: var(--tier)">
      {#each to.name.split("") as ch, i (i)}
        <span style="animation-delay: {250 + i * 60}ms">{ch}</span>
      {/each}
    </div>
    <div class="rating mt-3 text-xl text-sub tabular-nums">{Math.round(rating)}</div>
    <div class="absolute bottom-12 text-sm text-sub transition-opacity duration-500" class:opacity-0={!canClose}>
      click anywhere to continue
    </div>
  {/if}
</div>

<style>
  .rankup {
    animation: fade-in 0.3s ease-out;
    transition: opacity 0.3s ease-out;
  }
  .rankup.leaving { opacity: 0; }

  .charge-label { animation: fade-in 0.5s ease-out both; }
  .pop { animation: pop-in 0.5s cubic-bezier(0.2, 1.4, 0.4, 1) both; }
  .old-badge { animation: shake 2.3s 0.5s ease-in both, charge 2.3s 0.5s ease-in both; }

  .new-badge {
    filter: drop-shadow(0 0 20px color-mix(in srgb, var(--tier) 60%, transparent));
    animation: slam 0.7s cubic-bezier(0.2, 1.5, 0.4, 1) both;
  }
  .flash {
    position: fixed;
    inset: 0;
    background: var(--color-text);
    pointer-events: none;
    animation: flash 0.6s ease-out both;
  }
  .reveal-label { animation: rise-in 0.5s 0.15s ease-out both; }
  .tier-name span { display: inline-block; animation: letter 0.5s cubic-bezier(0.2, 1.4, 0.4, 1) both; }
  .rating { animation: rise-in 0.5s 0.8s ease-out both; }

  @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes rise-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  @keyframes pop-in { from { opacity: 0; transform: scale(0.6); } to { opacity: 1; transform: scale(1); } }
  @keyframes slam { from { opacity: 0; transform: scale(2.4); } to { opacity: 1; transform: scale(1); } }
  @keyframes flash { from { opacity: 0.5; } to { opacity: 0; } }
  @keyframes letter {
    from { opacity: 0; transform: translateY(40px) scale(0.6); }
    to { opacity: 1; transform: none; }
  }
  /* the shake grows as the reveal gets closer */
  @keyframes shake {
    0%, 20% { transform: translate(0, 0) scale(1); }
    25% { transform: translate(-1px, 1px) scale(1.01); }
    35% { transform: translate(2px, -1px) scale(1.02); }
    45% { transform: translate(-2px, 2px) scale(1.03); }
    55% { transform: translate(3px, -2px) scale(1.04) rotate(1deg); }
    62% { transform: translate(-4px, 2px) scale(1.05) rotate(-1deg); }
    70% { transform: translate(4px, -3px) scale(1.06) rotate(2deg); }
    76% { transform: translate(-5px, 3px) scale(1.08) rotate(-2deg); }
    82% { transform: translate(6px, -4px) scale(1.1) rotate(2deg); }
    87% { transform: translate(-6px, 4px) scale(1.12) rotate(-3deg); }
    92% { transform: translate(7px, -5px) scale(1.15) rotate(3deg); }
    96% { transform: translate(-7px, 5px) scale(1.18) rotate(-3deg); }
    100% { transform: translate(0, 0) scale(1.25); }
  }
  /* stays colourless so the new tier isn't given away early */
  @keyframes charge {
    from { filter: drop-shadow(0 0 12px var(--old)) brightness(1); }
    to { filter: drop-shadow(0 0 40px white) brightness(2.2); }
  }

  @media (prefers-reduced-motion: reduce) {
    .rankup *, .rankup { animation: none !important; }
  }
</style>
