<script lang="ts">
  import "../app.css";
  import { onDestroy, onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { Crown, Info, Keyboard, Settings, Shield, Swords, UserRound, Users, LogIn, X } from "@lucide/svelte";
  import { session } from "#lib/session.svelte.ts";
  import { game } from "#lib/game.svelte.ts";
  import { friends } from "#lib/friends.svelte.ts";
  import Toasts from "#lib/components/Toasts.svelte";
  import Invites from "#lib/components/Invites.svelte";
  import Logo from "#lib/components/Logo.svelte";
  import CommandLine from "#lib/components/CommandLine.svelte";
  import { applyTheme, prefs } from "#lib/prefs.svelte.ts";

  let { children } = $props();

  onMount(async () => {
    await session.refresh();
    game.connect().catch(() => {});
  });

  // A supporter host's room theme only shows while we're actually in their
  // room: leaving, being kicked, the room closing or our connection dropping
  // all fall back to our own theme. It's never written to storage, so a
  // closed tab can't leave it behind either.
  const roomTheme = $derived(
    prefs.roomThemes && game.roomLive && page.url.pathname.startsWith("/room/") ? (game.room?.theme ?? null) : null,
  );
  $effect(() => applyTheme(prefs.preview ?? roomTheme ?? prefs.theme));

  // sync preferences on sign-in, when the network comes back and when the tab
  // is revisited (picks up changes made on other devices)
  $effect(() => {
    if (session.me?.id) void prefs.sync();
  });
  $effect(() => {
    if (session.me?.id) void friends.load();
    else friends.clear();
  });
  const syncPrefs = () => void prefs.sync();
  const onvisible = () => document.visibilityState === "visible" && syncPrefs();

  // queueing carries on while browsing: show it in the header, and bring the
  // player back to the play page when a match is found
  let now = $state(Date.now());
  const iv = setInterval(() => (now = Date.now()), 500);
  onDestroy(() => clearInterval(iv));
  const queuedAway = $derived(!!game.queueMode && !game.match && page.url.pathname !== `/play/${game.queueMode}`);
  const waited = $derived((void now, game.queue ? Math.max(0, Math.floor((game.serverNow() - game.queue.since) / 1000)) : 0));
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  // a host accepted our request to join their room
  $effect(() => {
    const code = game.admitted;
    if (!code) return;
    game.admitted = null;
    if (page.url.pathname !== `/room/${code}`) goto(`/room/${code}`);
  });
  $effect(() => {
    const m = game.match;
    if (m && (m.mode === "ranked" || m.mode === "casual") && page.url.pathname !== `/play/${m.mode}`) goto(`/play/${m.mode}`);
  });

  // during a race keep the chrome quiet, like monkeytype's focus mode
  const friendsLabel = $derived.by(() => {
    if (!friends.list) return "friends";
    const n = friends.list.friends.length;
    return `${n} friend${n === 1 ? "" : "s"} · ${friends.online.length} online`;
  });
  const racing = $derived(!!game.race && !game.result && page.url.pathname !== "/");
  const nav = [
    { href: "/", label: "play", icon: Swords },
    { href: "/practice", label: "practice", icon: Keyboard },
    { href: "/leaderboard", label: "leaderboard", icon: Crown },
    { href: "/about", label: "about", icon: Info },
  ];
</script>

<div class="mx-auto flex min-h-screen max-w-[1100px] flex-col px-6 sm:px-10">
  <header class="flex items-center gap-6 py-7 transition-opacity duration-300" class:opacity-0={racing} class:pointer-events-none={racing}>
    <a href="/" class="group flex items-center gap-3" aria-label="home">
      <Logo />
    </a>
    <nav class="flex items-center gap-1 text-sub">
      {#each nav as n (n.href)}
        <a
          href={n.href}
          aria-label={n.label}
          class="tip rounded-md p-2 transition-colors hover:text-text"
          class:text-text={n.href === "/" ? page.url.pathname === "/" : page.url.pathname.startsWith(n.href)}
        >
          <n.icon size={20} />
        </a>
      {/each}
      {#if session.me?.moderator}
        <a href="/mod" aria-label="moderation" class="tip rounded-md p-2 transition-colors hover:text-text"><Shield size={20} /></a>
      {/if}
    </nav>
    <div class="ml-auto flex items-center gap-2 text-sub">
      {#if queuedAway}
        <div class="flex items-center rounded-md bg-sub-alt text-sm animate-fade">
          <a href="/play/{game.queueMode}" class="flex items-center gap-2 py-1.5 pl-3 pr-1 transition-colors hover:text-text" title="back to the queue">
            <span class="h-2 w-2 animate-pulse rounded-full bg-main"></span>
            <span class="hidden sm:inline">{game.queueMode}</span>
            <span class="tabular-nums text-main">{game.queue ? fmt(waited) : "…"}</span>
          </a>
          <button class="rounded-md p-1.5 transition-colors hover:text-error" aria-label="leave queue" title="leave queue" onclick={() => game.leaveQueue()}>
            <X size={14} />
          </button>
        </div>
      {/if}
      {#if session.me}
        <a
          href="/friends"
          aria-label={friendsLabel}
          class="tip relative flex items-center gap-1 rounded-md p-2 transition-colors hover:text-text"
          class:text-text={page.url.pathname.startsWith("/friends")}
        >
          <Users size={20} />
          {#if friends.online.length}
            <span class="text-xs tabular-nums">{friends.online.length}</span>
          {/if}
          {#if friends.incomingCount}
            <span class="absolute top-0.5 left-5 min-w-4 rounded-full bg-main px-1 text-center text-[10px] leading-4 text-bg">{friends.incomingCount}</span>
          {/if}
        </a>
        <a href="/u/{session.me.displayName}" class="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:text-text">
          <UserRound size={18} />
          <span class="hidden text-sm sm:inline">{session.me.displayName}</span>
          <span class="rounded bg-sub-alt px-1.5 text-xs text-main">{session.me.level}</span>
        </a>
      {:else if session.loaded}
        <a href="/login" class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:text-text">
          <LogIn size={18} /> sign in
        </a>
      {/if}
      <a href="/settings" aria-label="settings" class="tip rounded-md p-2 transition-colors hover:text-text"><Settings size={20} /></a>
    </div>
  </header>

  <main class="flex-1">
    {@render children()}
  </main>

  <footer class="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 py-6 text-xs text-sub transition-opacity duration-300" class:opacity-0={racing}>
    <a href="/about" class="hover:text-text">about</a>
    <a href="/terms" class="hover:text-text">terms</a>
    <a href="/privacy" class="hover:text-text">privacy</a>
    <a href={__SOURCE_URL__ || "/about#source"} class="hover:text-text">source code (GPL-3.0)</a>
    <a href="https://github.com/monkeytypegame/monkeytype" class="hover:text-text" rel="noopener">built on monkeytype ♥</a>
    {#if game.down}
      <span class="flex items-center gap-1.5"><span class="h-1.5 w-1.5 rounded-full bg-error"></span>offline</span>
    {/if}
  </footer>
</div>

<svelte:window ononline={syncPrefs} />
<svelte:document onvisibilitychange={onvisible} />

<Toasts />
<Invites />
<CommandLine />
