<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { goto, beforeNavigate } from "$app/navigation";
  import { page } from "$app/state";
  import { Bell, Ghost, X } from "@lucide/svelte";
  import { COUNTDOWN_MS, type QueueMode } from "@mtr/race-protocol";
  import { game } from "#lib/game.svelte.ts";
  import { session } from "#lib/session.svelte.ts";
  import { notifier } from "#lib/notify.svelte.ts";
  import RaceView from "#lib/components/RaceView.svelte";
  import ResultsPanel from "#lib/components/ResultsPanel.svelte";
  import MatchFound from "#lib/components/MatchFound.svelte";
  import GameIntro from "#lib/components/GameIntro.svelte";
  import TierBadge from "#lib/components/TierBadge.svelte";
  import ReportDialog from "#lib/components/ReportDialog.svelte";
  import Note from "#lib/components/Note.svelte";

  const mode = $derived(page.params.mode as QueueMode);
  let blocked = $state<string | null>(null);
  // a ban or timeout covers casual too, so don't offer it as a way out
  let suspended = $state(false);
  let now = $state(Date.now());
  let reporting = $state(false);
  const iv = setInterval(() => (now = Date.now()), 250);

  onMount(async () => {
    if (mode !== "ranked" && mode !== "casual") return goto("/");
    if (!session.loaded) await session.refresh();
    if (mode === "ranked" && !session.me) return goto("/login?next=/play/ranked");
    if (session.me?.suspended) {
      blocked = session.me.suspended;
      suspended = true;
      return;
    }
    if (mode === "ranked" && session.me?.rankedBlock) {
      blocked = session.me.rankedBlock;
      return;
    }
    await game.connect().catch(() => {});
    const busy = game.match || (game.race && !game.result && game.race.mode !== "private");
    if (!busy && game.queueMode !== mode) game.joinQueue(mode);
  });

  // the queue keeps searching while the player browses the rest of the site;
  // a ghost race is only played here, so leaving drops it
  onDestroy(() => {
    clearInterval(iv);
    if (game.race?.mode === "ghost" && !game.result) game.leaveRace();
    if (game.result) game.clearRace();
  });

  // the server refused the queue (not verified, decline timeout, ...)
  $effect(() => {
    const e = game.lastError;
    if (e && ["ranked_blocked", "queue_timeout", "suspended"].includes(e.code) && Date.now() - e.at < 2000) {
      blocked = e.message;
      suspended = e.code === "suspended";
      game.queueMode = null;
    }
  });

  // we declined or missed the ready check, so the server dropped us from the queue
  $effect(() => {
    const c = game.cancelled;
    if (c && !c.requeued && Date.now() - c.at < 2000) goto("/");
  });

  beforeNavigate((nav) => {
    if (game.race && !game.result && game.race.mode !== "ghost" && nav.type !== "leave") {
      if (!confirm("Leaving now forfeits the race and counts as a loss. Leave anyway?")) nav.cancel();
      else game.leaveRace();
    }
  });

  const inRace = $derived(!!game.race && !game.result);
  // show the game type until the typing countdown starts
  let preparing = $state(false);
  $effect(() => {
    const r = game.race;
    const wait = r && !r.resumeKeys?.length ? r.startAt - COUNTDOWN_MS - game.serverNow() : 0;
    preparing = wait > 0;
    if (wait <= 0) return;
    const t = setTimeout(() => (preparing = false), wait);
    return () => clearTimeout(t);
  });
  // `now` ticks so the timer re-renders
  const waited = $derived((void now, game.queue ? Math.max(0, Math.floor((game.serverNow() - game.queue.since) / 1000)) : 0));
  const rematch = $derived(game.rematch && game.rematch.matchId === game.result?.matchId ? game.rematch : null);
  const rematchLeft = $derived((void now, rematch ? Math.max(0, Math.ceil((rematch.expiresAt - game.serverNow()) / 1000)) : 0));
  const opponent = $derived(game.result?.results.find((r) => r.id !== game.you?.id));
  const iAsked = $derived(!!rematch && !!game.you && rematch.requested.includes(game.you.id));
  const theyAsked = $derived(!!rematch && !!opponent && rematch.requested.includes(opponent.id));
  // an incoming request takes over as the primary action
  const rematchInvite = $derived(theyAsked && !iAsked && !rematch?.closed && rematchLeft > 0);
  const asNote = (text: string | null) => (text ? { text, kind: "error" as const } : null);
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  function again() {
    game.clearRace();
    game.joinQueue(mode);
  }

  function cancel() {
    game.leaveQueue();
    goto("/");
  }

  function onkey(e: KeyboardEvent) {
    if (game.match || reporting) return;
    if (e.key === "Escape" && game.queueMode && !inRace && !game.result) cancel();
    if (e.key === "Enter" && game.result && game.result.mode !== "ghost") again();
  }
</script>

<svelte:window onkeydown={onkey} />
<svelte:head><title>{mode.charAt(0).toUpperCase() + mode.slice(1)} · MT Ranked</title></svelte:head>

{#if blocked}
  <div class="mx-auto max-w-md pt-16 text-center animate-rise">
    <div class="text-xl">{blocked}</div>
    <div class="mt-6 flex justify-center gap-3">
      {#if !suspended}
        {#if session.me && !session.me.verified}<a class="btn btn-main" href="/settings">verify email</a>{/if}
        {#if mode !== "casual"}<a class="btn" href="/play/casual">play casual</a>{/if}
      {/if}
      <a class="btn btn-ghost" href="/">home</a>
    </div>
  </div>
{:else if inRace && preparing && game.race!.mode !== "ghost"}
  <GameIntro race={game.race!} />
{:else if inRace}
  <RaceView />
{:else if game.result}
  <ResultsPanel result={game.result}>
    {#snippet actions()}
      {#if game.result!.mode === "ghost"}
        <button class="btn btn-main" onclick={() => game.clearRace()}>back to queue</button>
        <span class="text-sm text-sub">still searching for a real opponent · {fmt(waited)}</span>
      {:else}
        <button class="btn" class:btn-main={!rematchInvite} onclick={again}>
          queue again <kbd class={rematchInvite ? "" : "bg-bg/30 text-bg"}>enter</kbd>
        </button>
        {#if rematch?.closed}
          <span class="text-sm text-sub">{rematch.closed}</span>
        {:else if rematch && rematchLeft}
          {#if iAsked}
            <button class="btn" disabled>rematch requested</button>
            <span class="text-sm text-sub">waiting for {opponent?.name} · {rematchLeft}s</span>
          {:else if theyAsked}
            <button class="btn btn-main animate-pop" onclick={() => game.requestRematch()}>accept rematch</button>
            <span class="text-sm text-sub">{opponent?.name} wants a rematch · {rematchLeft}s</span>
          {:else}
            <button class="btn" onclick={() => game.requestRematch()}>rematch</button>
            <span class="text-sm text-sub">{rematchLeft}s</span>
          {/if}
        {/if}
      {/if}
      <a class="btn" href="/replay/{game.result!.matchId}">view replay</a>
      {#if session.me && game.result!.mode !== "ghost"}
        <button class="btn btn-ghost" onclick={() => (reporting = true)}>report</button>
      {/if}
      <a class="btn btn-ghost ml-auto" href="/">home</a>
    {/snippet}
  </ResultsPanel>
  {#if reporting}
    <ReportDialog
      matchId={game.result.matchId}
      players={game.result.results.filter((r) => r.id !== game.you?.id && !r.guest).map((r) => ({ id: r.id, name: r.name }))}
      onclose={() => (reporting = false)}
    />
  {/if}
{:else}
  <div class="flex flex-col items-center pt-10 animate-fade">
    <div class="relative flex h-56 w-56 items-center justify-center">
      <!-- svg rings animate their radius instead of scaling bordered divs, which made
           chromium flash tile seams as a crosshair through the middle -->
      <svg class="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 224 224" fill="none" aria-hidden="true">
        <circle class="pulse stroke-main/30" cx="112" cy="112" r="111" stroke-width="2" />
        <circle class="pulse inner stroke-main/20" cx="112" cy="112" r="87" stroke-width="2" />
      </svg>
      <div class="text-center">
        <div class="text-5xl text-main tabular-nums">{fmt(waited)}</div>
        <div class="mt-1 text-sm text-sub">{game.queue ? "searching" : game.status === "online" ? "joining queue" : "connecting"}</div>
      </div>
    </div>
    <div class="mt-8 font-logo text-2xl">{mode} match</div>
    <div class="mt-4 flex flex-wrap items-center justify-center gap-6 text-sm text-sub">
      {#if mode === "ranked" && session.me}
        <TierBadge rating={session.me.rating} races={session.me.races} />
      {:else if game.queue}
        <span>rating {game.queue.rating}</span>
      {/if}
      {#if game.queue}
        <span>range ±{game.queue.range}</span>
        <span>{game.queue.size} in queue</span>
      {/if}
    </div>
    {#if game.queue?.ghostAvailable}
      <button class="btn btn-main mt-8 animate-pop" onclick={() => game.send({ type: "ghost.accept" }, "ghost")}>
        <Ghost size={18} /> race a ghost while you wait
      </button>
      <div class="mt-2 text-xs text-sub">an unrated replay of a player near your rating · you stay in the queue</div>
      <Note note={asNote(game.errorFrom("ghost"))} class="mt-1" />
    {/if}
    {#if notifier.offer}
      <div class="mt-8 flex max-w-md flex-col items-center gap-3 rounded-xl bg-sub-alt px-6 py-4 text-center text-sm animate-rise">
        {#if notifier.refused}
          <div>
            {#if notifier.permission === "denied"}
              Notifications are blocked for this site. Allow them from the icon beside the address bar, then try again.
            {:else}
              Your browser should have asked for permission. Approve the request so we can let you know.
            {/if}
          </div>
          <div class="flex gap-2">
            <button class="btn btn-main" onclick={() => notifier.enable()}><Bell size={16} /> try again</button>
            <button class="btn btn-ghost" onclick={() => notifier.dismiss()}>never mind</button>
          </div>
        {:else}
          <div>Going to switch tabs while you wait? We can send a notification when your match is found.</div>
          <div class="flex gap-2">
            <button class="btn btn-main" onclick={() => notifier.enable()}><Bell size={16} /> yes, notify me</button>
            <button class="btn btn-ghost" onclick={() => notifier.dismiss()}>no thanks</button>
          </div>
        {/if}
      </div>
    {/if}
    <div class="mt-10 flex flex-wrap items-center justify-center gap-3">
      <a class="btn" href="/">queue in the background</a>
      <button class="btn btn-ghost" onclick={cancel}><X size={16} /> cancel <kbd>esc</kbd></button>
    </div>
    <Note note={asNote(game.errorFrom("queue"))} class="mt-3" />
    {#if game.cancelled?.requeued && now - game.cancelled.at < 8000}
      <Note note={{ text: `${game.cancelled.reason} Back in the queue.`, kind: "info" }} class="mt-3 text-sm" />
    {/if}
  </div>
{/if}

{#if game.match}
  <MatchFound match={game.match} />
{/if}

<style>
  .pulse {
    animation: pulse 2.4s ease-out infinite;
  }
  .pulse.inner {
    animation-name: pulse-inner;
  }
  @keyframes pulse {
    0% {
      r: 94px;
      opacity: 1;
    }
    100% {
      r: 139px;
      opacity: 0;
    }
  }
  @keyframes pulse-inner {
    0% {
      r: 74px;
      opacity: 1;
    }
    100% {
      r: 109px;
      opacity: 0;
    }
  }
</style>
