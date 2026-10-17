<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { Crown, DoorOpen, Eye } from "@lucide/svelte";
  import { game } from "#lib/game.svelte.ts";
  import { session } from "#lib/session.svelte.ts";
  import { friends, describeActivity } from "#lib/friends.svelte.ts";
  import RaceView from "#lib/components/RaceView.svelte";
  import ResultsPanel from "#lib/components/ResultsPanel.svelte";
  import Note from "#lib/components/Note.svelte";

  const name = page.params.name ?? "";
  let friendId = $state<string | null>(null);
  let problem = $state<string | null>(null);
  const watch = game.watch;

  onMount(async () => {
    if (!session.loaded) await session.refresh();
    if (!session.me) return goto(`/login?next=/watch/${encodeURIComponent(name)}`);
    await friends.load();
    const f = friends.list?.friends.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!f) {
      problem = `${name} isn't on your friends list.`;
      return;
    }
    friendId = f.id;
    await game.connect().catch(() => {});
    game.spectate(f.id);
  });
  onDestroy(() => game.stopSpectating());

  // the server refused (they're not racing, the room is locked, ...)
  $effect(() => {
    const e = game.errorFrom("watch");
    if (e && !watch.target) problem = e;
  });
  const askRefused = $derived(game.errorFrom("watch-ask"));

  const presence = $derived(friendId ? friends.presenceOf(friendId) : null);
  const inRace = $derived(!!watch.race && !watch.result);
  const who = $derived(watch.target?.name || name);

  // when their match ends, pick up their next one: once they've left it (back in
  // the queue, say), the next match or room they're in is watched automatically
  let left = $state(false);
  $effect(() => {
    if (!watch.ended || !friendId) return void (left = false);
    const a = presence?.activity;
    if (!a || a.kind === "queue") left = true;
    else if (left && presence?.online) {
      left = false;
      game.spectate(friendId);
    }
  });

  function again() {
    problem = null;
    if (friendId) game.spectate(friendId);
  }
</script>

<svelte:head><title>Watching {name} · MT Ranked</title></svelte:head>

{#if problem && !watch.target}
  <div class="mx-auto max-w-md pt-16 text-center animate-rise">
    <div class="text-xl">{problem}</div>
    {#if presence}<div class="mt-2 text-sm text-sub">{name} is {describeActivity(presence)}</div>{/if}
    <div class="mt-6 flex justify-center gap-3">
      {#if friendId}<button class="btn btn-main" onclick={again}><Eye size={16} /> try again</button>{/if}
      <a class="btn btn-ghost" href="/friends">friends</a>
    </div>
  </div>
{:else if !watch.target}
  <div class="pt-20 text-center text-sub">connecting…</div>
{:else if inRace}
  <RaceView feed={watch} watching={who} onleave={() => goto("/friends")} />
{:else}
  <div class="mx-auto max-w-[1000px] animate-fade">
    {#if watch.result}
      <ResultsPanel result={watch.result}>
        {#snippet actions()}
          <a class="btn" href="/replay/{watch.result!.matchId}">replay</a>
          <a class="btn btn-ghost" href="/friends">friends</a>
        {/snippet}
      </ResultsPanel>
      <div class="my-10 h-px bg-sub-alt"></div>
    {/if}

    <div class="mx-auto max-w-md text-center">
      <div class="label mb-2 flex items-center justify-center gap-2"><Eye size={14} /> watching {who}</div>
      {#if watch.ended}
        <div class="text-xl">{watch.ended}</div>
        <div class="mt-2 text-sm text-sub">
          {#if presence?.online}{who} is {describeActivity(presence)}. their next race will show up here.{:else}{who} went offline.{/if}
        </div>
      {:else if watch.target.mode === "private" && watch.room}
        <div class="text-xl">{watch.room.name ?? "private room"}</div>
        <div class="mt-1 text-sm text-sub">waiting for a host to start the next race…</div>
      {:else}
        <div class="text-xl">{who} found a {watch.target.mode} match</div>
        <div class="mt-1 text-sm text-sub">the race starts in a moment…</div>
      {/if}
    </div>

    {#if watch.room && !watch.ended}
      <div class="card mx-auto mt-8 max-w-md">
        <div class="mb-3 flex items-center justify-between">
          <span class="label">players {watch.room.players.length}/{watch.room.cap}</span>
          <span class="label">wins</span>
        </div>
        <ul class="space-y-1">
          {#each watch.room.players as p (p.id)}
            <li class="flex items-center gap-2 px-2 py-1">
              {#if watch.room.hosts.includes(p.id)}<Crown size={14} class="text-main" />{:else}<span class="w-3.5"></span>{/if}
              <span class:text-main={p.id === friendId}>{p.name}</span>
              <span class="ml-auto text-main tabular-nums">{watch.room.scoreboard[p.id] ?? 0}</span>
            </li>
          {/each}
        </ul>
        {#if friendId}
          <div class="mt-4 flex justify-center">
            {#if game.hasAsked(friendId)}
              <span class="text-sm text-sub">asked to join · waiting for a host</span>
            {:else}
              <button class="btn" onclick={() => game.askToJoin(friendId!, "watch-ask")}><DoorOpen size={16} /> ask to join</button>
            {/if}
          </div>
          <Note note={askRefused ? { text: askRefused, kind: "error" } : null} class="mt-2 block text-center" />
        {/if}
      </div>
    {/if}
  </div>
{/if}
