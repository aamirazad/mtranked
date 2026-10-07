<script lang="ts">
  import "../app.css";
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { Crown, Info, Keyboard, Settings, Shield, Swords, UserRound, LogIn } from "@lucide/svelte";
  import { session } from "#lib/session.svelte.ts";
  import { game } from "#lib/game.svelte.ts";
  import Toasts from "#lib/components/Toasts.svelte";
  import Logo from "#lib/components/Logo.svelte";

  let { children } = $props();

  onMount(async () => {
    await session.refresh();
    game.connect().catch(() => {});
  });

  // during a race keep the chrome quiet, like monkeytype's focus mode
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
          title={n.label}
          class="rounded-md p-2 transition-colors hover:text-text"
          class:text-text={n.href === "/" ? page.url.pathname === "/" : page.url.pathname.startsWith(n.href)}
        >
          <n.icon size={20} />
        </a>
      {/each}
      {#if session.me?.moderator}
        <a href="/mod" title="moderation" class="rounded-md p-2 transition-colors hover:text-text"><Shield size={20} /></a>
      {/if}
    </nav>
    <div class="ml-auto flex items-center gap-2 text-sub">
      {#if session.me}
        <a href="/u/{session.me.displayName}" class="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:text-text">
          <UserRound size={18} />
          <span class="hidden text-sm sm:inline">{session.me.displayName}</span>
          <span class="rounded bg-sub-alt px-1.5 text-xs text-main">{session.me.level}</span>
        </a>
        <a href="/settings" title="settings" class="rounded-md p-2 transition-colors hover:text-text"><Settings size={20} /></a>
      {:else if session.loaded}
        <a href="/login" class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:text-text">
          <LogIn size={18} /> sign in
        </a>
      {/if}
    </div>
  </header>

  <main class="flex-1">
    {@render children()}
  </main>

  <footer class="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 py-6 text-xs text-sub transition-opacity duration-300" class:opacity-0={racing}>
    <a href="/about" class="hover:text-text">about</a>
    <a href="/leaderboard" class="hover:text-text">leaderboard</a>
    <a href={__SOURCE_URL__ || "/about#source"} class="hover:text-text">source code (GPL-3.0)</a>
    <a href="https://github.com/monkeytypegame/monkeytype" class="hover:text-text" rel="noopener">built on monkeytype ♥</a>
    {#if game.status !== "online"}
      <span class="flex items-center gap-1.5"><span class="h-1.5 w-1.5 rounded-full bg-error"></span>{game.status === "connecting" ? "connecting" : "offline"}</span>
    {/if}
  </footer>
</div>

<Toasts />
