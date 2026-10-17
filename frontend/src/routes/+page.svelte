<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { Swords, Zap, Users, Keyboard, ArrowRight } from "@lucide/svelte";
  import { session } from "#lib/session.svelte.ts";
  import { game } from "#lib/game.svelte.ts";
  import { api } from "#lib/api.ts";
  import { DEFAULT_ROOM_SETTINGS } from "@mtr/race-protocol";
  import { ROOM_CODE_ALPHABET } from "@mtr/shared";
  import TierBadge from "#lib/components/TierBadge.svelte";

  let season = $state<{ name: string; endsAt: string } | null>(null);
  let code = $state("");
  let creating = $state(false);

  onMount(async () => {
    const r = await api.season();
    if (r.status === 200) season = r.body;
  });

  const daysLeft = $derived(season ? Math.max(0, Math.ceil((new Date(season.endsAt).getTime() - Date.now()) / 86400_000)) : 0);

  function ranked() {
    goto(session.me ? "/play/ranked" : "/login?next=/play/ranked");
  }

  async function createRoom() {
    creating = true;
    game.room = null;
    game.roomClosed = null;
    await game.connect().catch(() => {});
    game.send({ type: "room.create", settings: DEFAULT_ROOM_SETTINGS });
  }
  $effect(() => {
    if (creating && game.room?.code) goto(`/room/${game.room.code}`);
  });

  function cleanCode(v: string) {
    return [...v.toUpperCase()].filter((c) => ROOM_CODE_ALPHABET.includes(c)).join("").slice(0, 6);
  }
  function join(e: SubmitEvent) {
    e.preventDefault();
    if (code.length === 6) goto(`/room/${code}`);
  }
</script>

<svelte:head><title>MT Ranked - Competitive Typing</title></svelte:head>

<div class="mx-auto max-w-[1000px] pt-6">
  <div class="mb-12 text-center">
    <h1 class="font-logo text-4xl sm:text-5xl">race someone. <span class="text-main">right now.</span></h1>
    <p class="mt-3 text-sub">
      {#if season}{season.name} · {daysLeft} days left{:else}&nbsp;{/if}
    </p>
  </div>

  <div class="grid gap-5 md:grid-cols-3">
    <!-- ranked -->
    <button class="mode-card group" onclick={ranked}>
      <div class="flex items-center justify-between">
        <span class="icon-tile"><Swords size={30} /></span>
        <span class="text-xs text-sub">1v1 · rated</span>
      </div>
      <div class="mt-8 font-logo text-3xl">ranked</div>
      <div class="mt-2 min-h-12 text-sm text-sub">
        {#if session.me}
          <TierBadge rating={session.me.rating} races={session.me.races} />
          {#if session.me.rankedBlock}<div class="mt-2 text-xs text-error">{session.me.rankedBlock}</div>{/if}
        {:else}
          sign in and climb from bronze to master.
        {/if}
      </div>
      <div class="mt-6 flex items-center gap-2 text-main transition-transform group-hover:translate-x-1">find match <ArrowRight size={16} /></div>
    </button>

    <!-- casual -->
    <button class="mode-card group" onclick={() => goto("/play/casual")}>
      <div class="flex items-center justify-between">
        <span class="icon-tile"><Zap size={30} /></span>
        <span class="text-xs text-sub">1v1 · unrated</span>
      </div>
      <div class="mt-8 font-logo text-3xl">casual</div>
      <div class="mt-2 min-h-12 text-sm text-sub">quick match against the first available player. no account needed.</div>
      <div class="mt-6 flex items-center gap-2 text-main transition-transform group-hover:translate-x-1">quick match <ArrowRight size={16} /></div>
    </button>

    <!-- private -->
    <div class="mode-card">
      <div class="flex items-center justify-between">
        <span class="icon-tile"><Users size={30} /></span>
        <span class="text-xs text-sub">2–16 players</span>
      </div>
      <div class="mt-8 font-logo text-3xl">private room</div>
      <div class="mt-2 text-sm text-sub">race your friends.</div>
      <button class="btn btn-main mt-5 w-full" onclick={createRoom} disabled={creating}>{creating ? "creating…" : "create room"}</button>
      <form class="mt-2 flex gap-2" onsubmit={join}>
        <input
          class="input text-center tracking-[0.3em] uppercase"
          placeholder="CODE"
          aria-label="room code"
          value={code}
          oninput={(e) => (code = e.currentTarget.value = cleanCode(e.currentTarget.value))}
        />
        <button class="btn" disabled={code.length !== 6}>join</button>
      </form>
    </div>
  </div>

  <div class="mt-10 flex justify-center">
    <a href="/practice" class="flex items-center gap-2 text-sub transition-colors hover:text-text"><Keyboard size={16} /> practice solo</a>
  </div>
</div>

<style>
  .mode-card {
    display: flex;
    flex-direction: column;
    text-align: left;
    border-radius: 1rem;
    background: var(--color-sub-alt);
    padding: 1.75rem;
    border: 2px solid transparent;
    transition:
      border-color 0.15s,
      transform 0.15s;
  }
  button.mode-card:hover {
    border-color: var(--edge-hover);
    transform: translateY(-2px);
  }
</style>
