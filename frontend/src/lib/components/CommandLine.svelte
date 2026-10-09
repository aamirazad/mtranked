<script lang="ts" module>
  export const commandLine = $state({ open: false });
</script>

<script lang="ts">
  // Monkeytype-style command line: esc opens a list of settings, enter (or a
  // click) opens one to pick its value. Typing filters; at the top level it
  // also finds values directly ("nord" → Theme › nord). Everything here is
  // also on the settings page.
  import { tick } from "svelte";
  import { page } from "$app/state";
  import { Check, ChevronLeft, ChevronRight, Gauge, Paintbrush, Palette, RotateCcw, Search, TextCursor, Type } from "@lucide/svelte";
  import { THEMES, themeById, type Theme } from "@mtr/shared";
  import { FONT_SIZES, QUICK_RESTARTS, fontSizeName, prefs } from "#lib/prefs.svelte.ts";
  import { game } from "#lib/game.svelte.ts";

  type Option = {
    label: string;
    active: boolean;
    theme?: Theme;
    /** theme to show while this option is highlighted */
    preview?: string;
    run: () => void;
  };
  type Group = { id: string; label: string; icon: typeof Palette; options: Option[] };
  type Row = { group: Group; option?: Option };

  let query = $state("");
  let sel = $state(0);
  let openId = $state<string | null>(null);
  let input: HTMLInputElement | undefined = $state();
  let list: HTMLElement | undefined = $state();

  const onOff = (value: boolean, set: (v: boolean) => void): Option[] =>
    [true, false].map((v) => ({ label: v ? "on" : "off", active: value === v, run: () => set(v) }));

  const room = $derived(game.room);
  const canThemeRoom = $derived(!!room && room.hostId === game.you?.id && room.hostSubscriber && page.url.pathname.startsWith("/room/"));

  const groups = $derived.by<Group[]>(() => [
    {
      id: "theme",
      label: "Theme",
      icon: Palette,
      options: THEMES.map((t) => ({ label: t.name, active: prefs.theme === t.id, theme: t, preview: t.id, run: () => prefs.set("theme", t.id) })),
    },
    ...(canThemeRoom
      ? [
          {
            id: "room-theme",
            label: "Room theme",
            icon: Paintbrush,
            options: [
              { label: "none", active: !room!.theme, run: () => game.send({ type: "room.theme", theme: null }) },
              ...THEMES.map((t) => ({
                label: t.name,
                active: room!.theme === t.id,
                theme: t,
                preview: t.id,
                run: () => game.send({ type: "room.theme", theme: t.id }),
              })),
            ],
          },
        ]
      : []),
    {
      id: "quick-restart",
      label: "Quick restart",
      icon: RotateCcw,
      options: QUICK_RESTARTS.map((q) => ({ label: q, active: prefs.quickRestart === q, run: () => prefs.set("quickRestart", q) })),
    },
    { id: "room-themes", label: "Room themes", icon: Paintbrush, options: onOff(prefs.roomThemes, (v) => prefs.set("roomThemes", v)) },
    {
      id: "font-size",
      label: "Font size",
      icon: Type,
      options: FONT_SIZES.map((s) => ({ label: fontSizeName(s), active: prefs.fontSize === s, run: () => prefs.set("fontSize", s) })),
    },
    { id: "smooth-caret", label: "Smooth caret", icon: TextCursor, options: onOff(prefs.smoothCaret, (v) => prefs.set("smoothCaret", v)) },
    { id: "live-wpm", label: "Live wpm", icon: Gauge, options: onOff(prefs.liveWpm, (v) => prefs.set("liveWpm", v)) },
  ]);

  const opened = $derived(groups.find((g) => g.id === openId) ?? null);

  const rows = $derived.by<Row[]>(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const has = (s: string) => terms.every((t) => s.toLowerCase().includes(t));
    if (opened) return opened.options.filter((o) => has(o.label)).map((option) => ({ group: opened, option }));
    const top = groups.filter((g) => has(g.label)).map((group) => ({ group }));
    if (!terms.length) return top;
    // values whose own name matches part of the query, e.g. "nord" or "theme nord"
    const deep = groups.flatMap((group) =>
      group.options
        .filter((o) => has(`${group.label} ${o.label}`) && terms.some((t) => o.label.toLowerCase().includes(t)))
        .map((option) => ({ group, option })),
    );
    return [...top, ...deep];
  });

  // keep the highlighted row in range and in view, and preview its theme
  $effect(() => {
    if (sel >= rows.length) sel = Math.max(0, rows.length - 1);
  });
  $effect(() => {
    if (!commandLine.open) return;
    prefs.preview = rows[sel]?.option?.preview ?? null;
    void tick().then(() => (list?.children[sel] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" }));
  });

  export function show() {
    if (commandLine.open) return;
    query = "";
    openId = null;
    sel = 0;
    commandLine.open = true;
    void tick().then(() => input?.focus());
  }

  function hide() {
    commandLine.open = false;
    openId = null;
    prefs.preview = null;
  }

  function enter(g: Group) {
    openId = g.id;
    query = "";
    // start on the current value, like monkeytype
    sel = Math.max(0, g.options.findIndex((o) => o.active));
    input?.focus();
  }

  function back() {
    const id = openId;
    openId = null;
    query = "";
    sel = Math.max(0, groups.findIndex((g) => g.id === id));
    input?.focus();
  }

  function choose(r: Row | undefined) {
    if (!r) return;
    if (!r.option) return enter(r.group);
    hide();
    r.option.run();
  }

  function onkeydown(e: KeyboardEvent) {
    // keep page shortcuts (tab restart, enter for next race...) out of it
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      if (opened) back();
      else hide();
    } else if (e.key === "Backspace" && opened && !query) {
      e.preventDefault();
      back();
    } else if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      sel = (sel + 1) % Math.max(1, rows.length);
    } else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
      e.preventDefault();
      sel = (sel - 1 + rows.length) % Math.max(1, rows.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(rows[sel]);
    }
  }

  function onwindowkey(e: KeyboardEvent) {
    if (commandLine.open || !e.isTrusted) return;
    // ctrl+p (cmd+p on mac) always works and replaces the browser's print shortcut
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "p") {
      e.preventDefault();
      return show();
    }
    // esc opens it too, unless the user picked esc as their quick restart key
    if (e.key !== "Escape" || prefs.quickRestart === "esc") return;
    // esc already means something in these places
    if ((game.queueMode && page.url.pathname.startsWith("/play/")) || game.match) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT") && !t.closest("[role=textbox]")) return;
    e.preventDefault();
    show();
  }
</script>

<svelte:window onkeydown={onwindowkey} />

{#snippet swatch(t: Theme)}
  <span class="flex shrink-0 gap-1.5 rounded-full px-2 py-1" style="background: {t.bg}">
    {#each [t.main, t.sub, t.text] as c, j (j)}
      <span class="h-3 w-3 rounded-full" style="background: {c}"></span>
    {/each}
  </span>
{/snippet}

{#if commandLine.open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="fixed inset-0 z-50 flex items-start justify-center bg-bg/80 px-4 pt-[10vh] animate-fade" onmousedown={(e) => e.target === e.currentTarget && hide()}>
    <div class="flex max-h-[75vh] w-[min(760px,100%)] flex-col overflow-hidden rounded-xl bg-bg shadow-2xl ring-2 ring-sub-alt" role="dialog" aria-label="command line">
      <div class="flex items-center gap-4 px-5 py-4">
        {#if opened}
          <button class="flex shrink-0 items-center gap-1 text-sub hover:text-text" onclick={back} title="back (esc)">
            <ChevronLeft size={18} />{opened.label}
          </button>
        {:else}
          <Search size={20} class="text-sub" />
        {/if}
        <input
          bind:this={input}
          bind:value={query}
          oninput={() => (sel = 0)}
          {onkeydown}
          class="w-full bg-transparent text-lg text-text outline-none placeholder:text-sub"
          placeholder={opened ? `search ${opened.label.toLowerCase()}` : "search settings"}
          aria-label="search settings"
          autocomplete="off"
          spellcheck="false"
        />
      </div>
      <ul bind:this={list} class="overflow-y-auto pb-2">
        {#each rows as r, i (r.group.id + (r.option ? `:${r.option.label}` : ""))}
          {@const current = r.group.options.find((o) => o.active)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <li
            class="flex cursor-pointer items-center gap-3 px-5 py-2 text-sm text-sub"
            class:selected={i === sel}
            onmousemove={() => (sel = i)}
            onclick={() => choose(r)}
            role="option"
            aria-selected={i === sel}
          >
            {#if !r.option}
              <r.group.icon size={16} />
              <span>{r.group.label}</span>
              <span class="ml-auto truncate opacity-70">{current?.label ?? ""}</span>
              {#if current?.theme}{@render swatch(current.theme)}{/if}
              <ChevronRight size={14} class="shrink-0" />
            {:else}
              {#if !opened}
                <r.group.icon size={16} />
                <span class="shrink-0">{r.group.label}</span>
                <ChevronRight size={14} class="shrink-0" />
              {/if}
              <span class="w-4 shrink-0">{#if r.option.active}<Check size={14} />{/if}</span>
              <span class="truncate">{r.option.label}</span>
              {#if r.option.theme}<span class="ml-auto">{@render swatch(r.option.theme)}</span>{/if}
            {/if}
          </li>
        {:else}
          <li class="px-5 py-2 text-sm text-sub">nothing found</li>
        {/each}
      </ul>
      <div class="border-t-2 border-sub-alt px-5 py-2 text-xs text-sub">
        <kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>enter</kbd> {opened ? "apply" : "open"} · <kbd>esc</kbd> {opened ? "back" : "close"}
        {#if prefs.preview && themeById(prefs.preview)}· previewing {themeById(prefs.preview)!.name}{/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .selected {
    background: var(--color-text);
    color: var(--color-bg);
  }
</style>
