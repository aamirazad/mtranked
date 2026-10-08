<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { beforeNavigate, goto } from "$app/navigation";
  import { page } from "$app/state";
  import { Copy, Crown, Lock, LockOpen, LogOut, Paintbrush, Play, Repeat, Shuffle, UserMinus, Link as LinkIcon } from "@lucide/svelte";
  import { THEMES, themeById } from "@mtr/shared";
  import { LANGUAGES } from "@mtr/engine";
  import { ROOM_NAME_MAX, type TextSettings } from "@mtr/race-protocol";
  import { game } from "#lib/game.svelte.ts";
  import { session } from "#lib/session.svelte.ts";
  import { toasts } from "#lib/toast.svelte.ts";
  import { prefs } from "#lib/prefs.svelte.ts";
  import RaceView from "#lib/components/RaceView.svelte";
  import ResultsPanel from "#lib/components/ResultsPanel.svelte";

  const code = $derived((page.params.code ?? "").toUpperCase());
  let joined = $state(false);
  let joinError = $state<string | null>(null);
  let guestName = $state("");
  let needsName = $state(false);

  onMount(async () => {
    if (!session.loaded) await session.refresh();
    if (game.room?.code === code) {
      joined = true;
      return;
    }
    if (!session.me) {
      needsName = true;
      guestName = session.guest?.name ?? "";
      return;
    }
    await join();
  });

  async function join(e?: SubmitEvent) {
    e?.preventDefault();
    joinError = null;
    if (!session.me && guestName && guestName !== session.guest?.name) {
      if (!/^[a-zA-Z0-9_.-]{3,20}$/.test(guestName)) {
        joinError = "Names are 3–20 letters, numbers, _ . or -";
        return;
      }
      await game.reconnect(guestName).catch(() => {});
      await session.refresh();
    }
    needsName = false;
    await game.connect().catch(() => {});
    game.send({ type: "room.join", code });
    joined = true;
  }

  $effect(() => {
    const e = game.lastError;
    if (e?.code === "room_join" && Date.now() - e.at < 3000 && !game.room) joinError = e.message;
  });

  function leave() {
    if (game.room) game.send({ type: "room.leave" });
    game.room = null;
    game.clearRace();
  }
  onDestroy(leave);

  beforeNavigate((nav) => {
    if (game.race && !game.result && game.race.mode === "private" && nav.type !== "leave") {
      if (!confirm("Leaving now forfeits the race. Leave anyway?")) nav.cancel();
    }
  });

  const room = $derived(game.room);
  const meId = $derived(game.you?.id);
  const isHost = $derived(!!room && room.hostId === meId);
  const inRace = $derived(!!game.race && game.race.mode === "private" && !game.result);
  const link = $derived(typeof location !== "undefined" ? `${location.origin}/room/${code}` : "");
  const board = $derived(
    room ? [...room.players].map((p) => ({ p, wins: room.scoreboard[p.id] ?? 0 })).sort((a, b) => b.wins - a.wins) : [],
  );

  function copy(text: string, what: string) {
    void navigator.clipboard.writeText(text);
    toasts.show(`${what} copied`, "success", 1500);
  }

  function update<K extends keyof TextSettings>(k: K, v: TextSettings[K]) {
    if (!room || !isHost) return;
    game.send({ type: "room.settings", settings: { ...room.settings, [k]: v } });
  }

  let customDraft = $state("");
  let editingCustom = $state(false);
  function saveCustom() {
    if (!room) return;
    game.send({ type: "room.settings", settings: { ...room.settings, mode: "custom", custom: customDraft } });
    editingCustom = false;
  }

  let nameDraft = $state("");
  $effect(() => {
    nameDraft = game.room?.name ?? "";
  });
  function saveName() {
    if (!room || nameDraft.trim() === (room.name ?? "")) return;
    game.send({ type: "room.rename", name: nameDraft });
  }

  // kicked, or the room closed underneath us
  let hadRoom = $state(false);
  $effect(() => {
    if (game.room) hadRoom = true;
  });

  const describe = (s: TextSettings) =>
    s.mode === "time"
      ? `time ${s.time}s`
      : s.mode === "words"
        ? `${s.words} words`
        : s.mode === "quote"
          ? `${s.quoteLength} quote`
          : "custom text";
</script>

<svelte:head><title>{room?.name ?? `room ${code}`} · mt ranked</title></svelte:head>

{#if needsName}
  <form class="card mx-auto mt-10 max-w-sm space-y-4 animate-rise" onsubmit={join}>
    <div class="text-lg">join room <span class="tracking-widest text-main">{code}</span></div>
    <label class="block space-y-1">
      <span class="label">your name for this room</span>
      <input class="input" bind:value={guestName} maxlength="20" placeholder="guest name" />
    </label>
    {#if joinError}<div class="text-sm text-error">{joinError}</div>{/if}
    <button class="btn btn-main w-full">join as guest</button>
    <div class="text-center text-sm text-sub">or <a class="link" href="/login?next=/room/{code}">sign in</a> to keep your stats</div>
  </form>
{:else if joinError && !room}
  <div class="mx-auto max-w-md pt-16 text-center animate-rise">
    <div class="text-xl">{joinError}</div>
    <a class="btn mt-6" href="/">back home</a>
  </div>
{:else if !room && hadRoom}
  <div class="mx-auto max-w-md pt-16 text-center animate-rise">
    <div class="text-xl">you're no longer in this room</div>
    <div class="mt-6 flex justify-center gap-3">
      <button class="btn btn-main" onclick={() => join()}>rejoin</button>
      <a class="btn btn-ghost" href="/">home</a>
    </div>
  </div>
{:else if !room}
  <div class="pt-20 text-center text-sub">{joined ? "joining room…" : "connecting…"}</div>
{:else if inRace}
  <RaceView />
{:else}
  <div class="mx-auto max-w-[1000px] animate-fade">
    {#if game.result && game.result.mode === "private"}
      <ResultsPanel result={game.result}>
        {#snippet actions()}
          {#if isHost}
            <button class="btn btn-main" onclick={() => game.send({ type: "room.start" })}><Shuffle size={16} /> rematch · new text</button>
            <button class="btn" onclick={() => game.send({ type: "room.start", sameText: true })}><Repeat size={16} /> same text</button>
          {:else}
            <span class="text-sub">waiting for the host to start a rematch…</span>
          {/if}
          <a class="btn btn-ghost" href="/replay/{game.result!.matchId}">replay</a>
        {/snippet}
      </ResultsPanel>
      <div class="my-10 h-px bg-sub-alt"></div>
    {/if}

    <div class="flex flex-wrap items-start justify-between gap-6">
      <div>
        {#if isHost && room.hostSubscriber}
          <input
            class="mb-4 w-full max-w-sm border-b-2 border-transparent bg-transparent text-2xl outline-none placeholder:text-sub/60 hover:border-sub-alt focus:border-main"
            placeholder="name this room"
            maxlength={ROOM_NAME_MAX}
            bind:value={nameDraft}
            onblur={saveName}
            onkeydown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        {:else if room.name}
          <div class="mb-4 text-2xl">{room.name}</div>
        {/if}
        <div class="label">room code</div>
        <button class="group flex items-center gap-3 text-5xl tracking-[0.25em] text-main" onclick={() => copy(code, "code")} title="copy code">
          {code}<Copy size={20} class="text-sub opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
        <button class="mt-2 flex items-center gap-2 text-sm text-sub hover:text-text" onclick={() => copy(link, "invite link")}>
          <LinkIcon size={14} /> copy invite link
        </button>
        {#if isHost && room.hostSubscriber}
          <label class="mt-2 flex items-center gap-2 text-sm text-sub">
            <Paintbrush size={14} /> room theme
            <select
              class="cursor-pointer bg-transparent outline-none hover:text-text"
              value={room.theme ?? ""}
              onchange={(e) => game.send({ type: "room.theme", theme: e.currentTarget.value || null })}
            >
              <option value="">none (everyone keeps theirs)</option>
              {#each THEMES as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
            </select>
          </label>
        {:else if room.theme}
          <div class="mt-2 flex items-center gap-2 text-sm text-sub">
            <Paintbrush size={14} /> room theme · {themeById(room.theme)?.name ?? room.theme}
            {#if !prefs.roomThemes}<span class="text-xs">(off in your settings)</span>{/if}
          </div>
        {/if}
      </div>
      <div class="flex items-center gap-2">
        {#if isHost}
          <button class="btn" onclick={() => game.send({ type: "room.lock", locked: !room.locked })} title={room.locked ? "unlock room" : "lock room"}>
            {#if room.locked}<Lock size={16} /> locked{:else}<LockOpen size={16} /> open{/if}
          </button>
          <button class="btn btn-main px-8" onclick={() => game.send({ type: "room.start" })}><Play size={16} /> start race</button>
        {/if}
        <button class="btn btn-ghost" onclick={() => { leave(); goto("/"); }}><LogOut size={16} /> leave</button>
      </div>
    </div>

    <div class="mt-10 grid gap-6 md:grid-cols-[1fr_1.2fr]">
      <div class="card">
        <div class="mb-3 flex items-center justify-between">
          <span class="label">players {room.players.length}/{room.cap}</span>
          <span class="label">wins</span>
        </div>
        <ul class="space-y-1">
          {#each board as { p, wins } (p.id)}
            <li class="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-bg/40">
              {#if p.id === room.hostId}<Crown size={14} class="text-main" />{:else}<span class="w-3.5"></span>{/if}
              <span class:text-main={p.id === meId}>{p.name}</span>
              {#if p.guest}<span class="text-xs text-sub">guest</span>{:else}<span class="text-xs text-sub">lv {p.level}</span>{/if}
              {#if isHost && p.id !== meId}
                <span class="ml-auto hidden gap-1 group-hover:flex">
                  <button class="text-sub hover:text-main" title="make host" onclick={() => game.send({ type: "room.transfer", playerId: p.id })}><Crown size={14} /></button>
                  <button class="text-sub hover:text-error" title="kick" onclick={() => game.send({ type: "room.kick", playerId: p.id })}><UserMinus size={14} /></button>
                </span>
              {/if}
              <span class="ml-auto text-main tabular-nums group-hover:ml-2">{wins}</span>
            </li>
          {/each}
        </ul>
        {#if room.races}<div class="mt-4 text-xs text-sub">{room.races} race{room.races === 1 ? "" : "s"} played</div>{/if}
        {#if !room.hostSubscriber && room.players.length >= room.cap}
          <div class="mt-4 text-xs text-sub">room is full. supporter hosts get rooms of up to 16.</div>
        {/if}
      </div>

      <div class="card">
        <div class="label mb-3">text · {describe(room.settings)}</div>
        <fieldset disabled={!isHost} class="space-y-3 text-sm">
          <div class="flex flex-wrap gap-1">
            {#each ["words", "time", "quote", "custom"] as const as m (m)}
              <button
                class="toggle"
                class:on={editingCustom ? m === "custom" : room.settings.mode === m}
                onclick={() => (m === "custom" ? ((customDraft = room.settings.custom ?? ""), (editingCustom = true)) : ((editingCustom = false), update("mode", m)))}
                >{m}</button
              >
            {/each}
          </div>
          {#if editingCustom || (room.settings.mode === "custom" && isHost)}
            <textarea class="input h-28 resize-none" maxlength="5000" placeholder="paste your text" bind:value={customDraft}></textarea>
            <button class="btn" onclick={saveCustom} disabled={!customDraft.trim()}>use this text</button>
          {:else if room.settings.mode === "words"}
            <div class="flex flex-wrap gap-1">
              {#each [10, 25, 50, 100] as w (w)}<button class="toggle" class:on={room.settings.words === w} onclick={() => update("words", w)}>{w}</button>{/each}
            </div>
          {:else if room.settings.mode === "time"}
            <div class="flex flex-wrap gap-1">
              {#each [15, 30, 60, 120] as t (t)}<button class="toggle" class:on={room.settings.time === t} onclick={() => update("time", t)}>{t}s</button>{/each}
            </div>
          {:else if room.settings.mode === "quote"}
            <div class="flex flex-wrap gap-1">
              {#each ["short", "medium", "long"] as const as q (q)}<button class="toggle" class:on={room.settings.quoteLength === q} onclick={() => update("quoteLength", q)}>{q}</button>{/each}
            </div>
          {/if}
          {#if room.settings.mode === "words" || room.settings.mode === "time"}
            <div class="flex flex-wrap items-center gap-1">
              <button class="toggle" class:on={room.settings.punctuation} onclick={() => update("punctuation", !room.settings.punctuation)}>@ punctuation</button>
              <button class="toggle" class:on={room.settings.numbers} onclick={() => update("numbers", !room.settings.numbers)}># numbers</button>
              <select class="ml-2 cursor-pointer bg-transparent text-sub outline-none hover:text-text" value={room.settings.language} onchange={(e) => update("language", e.currentTarget.value as TextSettings["language"])}>
                {#each LANGUAGES as l (l)}<option value={l}>{l.replace("_", " ")}</option>{/each}
              </select>
            </div>
          {/if}
        </fieldset>
        {#if !isHost}<div class="mt-4 text-xs text-sub">the host picks the text</div>{/if}
      </div>
    </div>
  </div>
{/if}
