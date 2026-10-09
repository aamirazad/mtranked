<script lang="ts">
  import type { ActiveRace } from "#lib/game.svelte.ts";
  import { game } from "#lib/game.svelte.ts";
  import TierBadge from "./TierBadge.svelte";

  let { race }: { race: ActiveRace } = $props();

  const meId = $derived(game.you?.id);
  const me = $derived(race.players.find((p) => p.id === meId));
  const opp = $derived(race.players.find((p) => p.id !== meId));

  const s = $derived(race.settings);
  const format = $derived(
    s.mode === "time" ? `${s.time} seconds` : s.mode === "words" ? `${s.words} words` : s.mode === "quote" ? `${s.quoteLength} quote` : "custom text",
  );
  const details = $derived(
    [
      s.language.replace("_", " "),
      s.mode === "quote" ? "capitals & punctuation" : s.punctuation && "punctuation",
      s.numbers && "numbers",
    ].filter(Boolean),
  );
</script>

<div class="flex flex-col items-center pt-10 animate-fade">
  <div class="text-sm text-sub">{race.mode} match · get ready</div>
  <div class="mt-3 font-logo text-6xl text-main animate-pop">{format}</div>
  <div class="mt-3 text-sub">{details.join(" · ")}</div>

  <div class="mt-12 grid w-[min(640px,92vw)] grid-cols-[1fr_auto_1fr] items-center gap-4">
    {#each [me, null, opp] as p, i (i)}
      {#if i === 1}
        <div class="font-logo text-3xl text-sub">vs</div>
      {:else if p}
        <div
          class="banner flex flex-col items-center gap-2 rounded-xl bg-sub-alt px-4 py-5 text-center"
          style={p.banner ? `background: ${p.banner}` : undefined}
        >
          <div class="text-xl" class:text-main={p.id === meId}>{p.name}</div>
          {#if p.rating !== undefined && race.mode === "ranked"}
            <TierBadge rating={p.rating} races={p.races} />
          {:else}
            <div class="text-sm text-sub">level {p.level}</div>
          {/if}
        </div>
      {:else}
        <div></div>
      {/if}
    {/each}
  </div>
</div>
