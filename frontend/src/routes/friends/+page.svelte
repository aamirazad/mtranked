<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { Check, DoorOpen, Eye, Search, Swords, UserMinus, UserPlus, X } from "@lucide/svelte";
  import type { PlayerHit } from "@mtr/contracts";
  import { api } from "#lib/api.ts";
  import { session } from "#lib/session.svelte.ts";
  import { game } from "#lib/game.svelte.ts";
  import { friends, describeActivity } from "#lib/friends.svelte.ts";
  import { flag } from "#lib/countries.ts";
  import { Notes } from "#lib/notes.svelte.ts";
  import Note from "#lib/components/Note.svelte";

  onMount(async () => {
    if (!session.loaded) await session.refresh();
    if (!session.me) return goto("/login?next=/friends");
    await friends.load();
  });

  // add by name, with the same prefix search the leaderboard uses. Suggestions
  // only kick in after a few characters so the box doesn't list everyone.
  const MIN_SUGGEST = 3;
  let q = $state("");
  let hits = $state<PlayerHit[]>([]);
  let open = $state(false);
  let active = $state(-1);
  let adding = $state(false);
  // the result of the last add, shown under the box
  let note = $state<{ text: string; kind: "info" | "error" | "success" } | null>(null);
  let noteTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const term = q.trim();
    if (term.length < MIN_SUGGEST) {
      hits = [];
      return;
    }
    const t = setTimeout(() => {
      void api.users.search({ query: { q: term } }).then((r) => {
        if (r.status === 200 && term === q.trim()) {
          hits = r.body.players.filter((h) => h.name !== session.me?.displayName);
          active = -1;
        }
      });
    }, 150);
    return () => clearTimeout(t);
  });

  async function add(name: string) {
    name = name.trim();
    if (!name || adding) return;
    adding = true;
    open = false;
    const r = await friends.add(name);
    if (r.ok) q = "";
    adding = false;
    note = r;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => (note = null), 5000);
  }
  function onsearchkey(e: KeyboardEvent) {
    if (e.key === "ArrowDown" && hits.length) active = (active + 1) % hits.length;
    else if (e.key === "ArrowUp" && hits.length) active = (active - 1 + hits.length) % hits.length;
    else if (e.key === "Enter") void add(hits[active]?.name ?? q);
    else if (e.key === "Escape") open = false;
    else return;
    e.preventDefault();
  }

  function unfriend(f: { id: string; name: string }) {
    if (confirm(`Remove ${f.name} from your friends?`)) void friends.remove(f);
  }

  // feedback shown on the row that was clicked
  const notes = new Notes();
  const rowNote = (id: string) => {
    const refused = game.errorFrom(`friend:${id}`);
    return refused ? { text: refused, kind: "error" as const } : notes.get(id);
  };

  async function accept(f: { id: string }) {
    const problem = await friends.accept(f);
    if (problem) notes.set(f.id, problem, "error");
  }

  // "race": a new private room with them invited
  let starting = $state<string | null>(null);
  async function race(id: string) {
    starting = id;
    try {
      const code = await game.createRoom({ invite: [id], from: `friend:${id}` });
      await goto(`/room/${code}`);
    } catch {
      // the server said why (already in a match, ...), shown on their row
    } finally {
      starting = null;
    }
  }

  const list = $derived(friends.list);
  const onlineCount = $derived(friends.online.length);
</script>

<svelte:head><title>Friends · MT Ranked</title></svelte:head>

<div class="mx-auto max-w-[760px] animate-fade">
  <div class="mb-8 flex flex-wrap items-end justify-between gap-4">
    <div>
      <h1 class="font-logo text-4xl">friends</h1>
      <div class="mt-1 text-sm text-sub">
        {#if list}{list.friends.length} friend{list.friends.length === 1 ? "" : "s"} · {onlineCount} online{:else}&nbsp;{/if}
      </div>
    </div>
    <div class="relative w-64">
      <Search size={14} class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sub" />
      <input
        class="input pr-10 pl-8"
        placeholder="add a friend by name"
        role="combobox"
        aria-expanded={open && hits.length > 0}
        aria-controls="friend-hits"
        aria-autocomplete="list"
        autocomplete="off"
        spellcheck="false"
        maxlength="20"
        bind:value={q}
        oninput={() => {
          open = true;
          note = null;
        }}
        onfocus={() => (open = true)}
        onblur={() => (open = false)}
        onkeydown={onsearchkey}
      />
      <button
        class="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-sub hover:text-main"
        title="send friend request"
        disabled={!q.trim() || adding}
        onclick={() => add(q)}
      >
        <UserPlus size={16} />
      </button>
      {#if note && !(open && hits.length)}
        <div
          role="status"
          class="absolute z-20 mt-1 w-full rounded-lg bg-sub-alt px-3 py-1.5 text-sm shadow-lg animate-fade {note.kind ===
          'error'
            ? 'text-error'
            : note.kind === 'success'
              ? 'text-main'
              : 'text-text'}"
        >
          {note.text}
        </div>
      {/if}
      {#if open && q.trim().length >= MIN_SUGGEST && hits.length}
        <div
          id="friend-hits"
          role="listbox"
          class="absolute z-20 mt-1 w-full overflow-hidden rounded-lg bg-sub-alt py-1 shadow-lg"
        >
          {#each hits as h, i (h.name)}
            <button
              type="button"
              tabindex="-1"
              role="option"
              aria-selected={i === active}
              class="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm {i === active
                ? 'bg-bg/60 text-text'
                : 'text-sub'}"
              onmousedown={(e) => e.preventDefault()}
              onmouseenter={() => (active = i)}
              onclick={() => add(h.name)}
            >
              <span class="truncate">{flag(h.country)} {h.name}</span>
              <UserPlus size={14} />
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  {#if !list}
    <div class="pt-10 text-center text-sub">loading…</div>
  {:else}
    {#if list.incoming.length}
      <section class="card mb-6">
        <div class="label mb-3">friend requests</div>
        <ul class="space-y-1">
          {#each list.incoming as f (f.id)}
            <li class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-1.5 hover:bg-bg/40">
              <a href="/u/{f.name}" class="truncate hover:text-main">{flag(f.country)} {f.name}</a>
              <span class="text-xs text-sub">lv {f.level}</span>
              <span class="ml-auto flex gap-2">
                <button class="btn btn-main py-1 text-sm" onclick={() => accept(f)}><Check size={14} /> accept</button>
                <button class="btn btn-ghost py-1 text-sm" onclick={() => friends.remove(f)}
                  ><X size={14} /> decline</button
                >
              </span>
              <Note note={notes.get(f.id)} class="w-full text-right" />
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <section class="card">
      {#if !list.friends.length}
        <div class="py-6 text-center text-sub">no friends yet. add someone by name above, or from their profile.</div>
      {:else}
        <ul class="space-y-1">
          {#each friends.sorted as f (f.id)}
            <li class="group flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-2 hover:bg-bg/40">
              <span
                class="h-2 w-2 shrink-0 rounded-full {f.presence.online ? 'bg-main' : 'bg-sub/40'}"
                aria-hidden="true"
              ></span>
              <div class="min-w-0">
                <a href="/u/{f.name}" class="truncate hover:text-main">{flag(f.country)} {f.name}</a>
                <div class="text-xs text-sub">{describeActivity(f.presence)}</div>
              </div>
              <span class="ml-auto flex items-center gap-2">
                {#if f.presence.online && (f.presence.activity?.kind === "match" || (f.presence.activity?.kind === "room" && !f.presence.activity.locked))}
                  <a class="btn py-1 text-sm" title="watch their race" href="/watch/{f.name}"><Eye size={14} /> watch</a
                  >
                {/if}
                {#if f.presence.activity?.kind === "room"}
                  {#if game.hasAsked(f.id)}
                    <span class="text-xs text-sub" title="you'll be let in as soon as a host accepts"
                      >asked to join · waiting for a host</span
                    >
                  {:else}
                    <button
                      class="btn py-1 text-sm"
                      title="ask the room's hosts to let you in"
                      onclick={() => game.askToJoin(f.id, `friend:${f.id}`)}
                    >
                      <DoorOpen size={14} /> ask to join
                    </button>
                  {/if}
                {/if}
                {#if f.presence.online}
                  <button
                    class="btn btn-main py-1 text-sm"
                    title="open a private room and invite them"
                    disabled={!!starting}
                    onclick={() => race(f.id)}
                  >
                    <Swords size={14} />
                    {starting === f.id ? "opening…" : "race"}
                  </button>
                {/if}
                <button
                  class="rounded p-1.5 text-sub opacity-0 transition-opacity group-hover:opacity-100 hover:text-error focus:opacity-100"
                  title="remove friend"
                  onclick={() => unfriend(f)}
                >
                  <UserMinus size={16} />
                </button>
              </span>
              <Note note={rowNote(f.id)} class="w-full text-right" />
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    {#if list.outgoing.length}
      <section class="mt-6 px-2">
        <div class="label mb-2">sent requests</div>
        <ul class="space-y-1 text-sm">
          {#each list.outgoing as f (f.id)}
            <li class="flex items-center gap-3">
              <a href="/u/{f.name}" class="text-sub hover:text-text">{f.name}</a>
              <button class="text-xs text-sub hover:text-error" onclick={() => friends.remove(f)}>cancel</button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</div>
