<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { Check, Lock, LogOut, Monitor, Search, X } from "@lucide/svelte";
  import { COSMETICS, THEMES, tierById, type Cosmetic, type CosmeticType } from "@mtr/shared";
  import { api, errorMessage, fieldErrors } from "#lib/api.ts";
  import { session } from "#lib/session.svelte.ts";
  import { game } from "#lib/game.svelte.ts";
  import { toasts } from "#lib/toast.svelte.ts";
  import { COUNTRIES, flag } from "#lib/countries.ts";
  import Caret from "#lib/components/Caret.svelte";
  import {
    CARET_SPEEDS,
    FONT_SIZES,
    HIGHLIGHT_MODES,
    INDICATE_TYPOS,
    LIVE_STYLES,
    PROGRESS_STYLES,
    QUICK_RESTARTS,
    TAPE_MODES,
    fontSizeName,
    prefs,
    type PrefKey,
  } from "#lib/prefs.svelte.ts";
  import { FONTS, fontLabel } from "#lib/fonts.ts";
  import { CLICK_SOUNDS, ERROR_SOUNDS, VOLUMES, playClick, playError } from "#lib/sound.ts";
  import { LAYOUT_IDS, layoutName } from "#lib/layouts.ts";

  type Sess = { id: string; current: boolean; userAgent: string | null; ip: string | null; createdAt: string; lastSeenAt: string };

  let displayName = $state("");
  let country = $state("");
  let unlocked = $state<Set<string>>(new Set());
  let sessions = $state<Sess[]>([]);
  let billing = $state<{ enabled: boolean; status: string; renewsAt: string | null; subscriber: boolean } | null>(null);
  let nameError = $state<string | null>(null);

  onMount(async () => {
    if (!session.loaded) await session.refresh();
    if (!session.me) return;
    displayName = session.me.displayName;
    country = session.me.country ?? "";
    await load();
    if (page.url.searchParams.get("subscribed")) toasts.show("Thanks for supporting MT Ranked! Perks are active.", "success", 6000);
  });

  // hover-intent for theme previews: the first preview waits until the pointer rests on a
  // theme, so sweeping the mouse across the grid doesn't flash every theme. once a preview
  // is showing, moving to another theme swaps instantly until the pointer leaves the grid.
  const PREVIEW_DELAY = 500;
  let previewTimer: ReturnType<typeof setTimeout> | undefined;

  function hoverTheme(id: string) {
    clearTimeout(previewTimer);
    if (prefs.preview) prefs.preview = id;
    else previewTimer = setTimeout(() => (prefs.preview = id), PREVIEW_DELAY);
  }

  function endPreview() {
    clearTimeout(previewTimer);
    prefs.preview = null;
  }

  onDestroy(endPreview);

  async function load() {
    const [c, s, b] = await Promise.all([api.me.cosmetics(), api.auth.sessions(), api.billing.status()]);
    if (c.status === 200) unlocked = new Set(c.body.unlocked);
    if (s.status === 200) sessions = s.body.sessions;
    if (b.status === 200) billing = b.body;
  }

  async function saveProfile(e: SubmitEvent) {
    e.preventDefault();
    nameError = null;
    const r = await api.me.update({ body: { displayName, country: country || null } });
    if (r.status === 200) {
      session.set(r.body.user);
      toasts.show("Profile saved", "success", 1500);
      void game.reconnect();
    } else nameError = fieldErrors(r).displayName ?? errorMessage(r);
  }

  async function equip(c: Cosmetic) {
    if (!unlocked.has(c.id)) return;
    const r = await api.me.update({ body: { equipped: { [c.type]: c.id } } });
    if (r.status === 200) {
      session.set(r.body.user);
      void game.reconnect();
    } else toasts.show(errorMessage(r), "error");
  }

  async function resend() {
    const r = await api.auth.resendVerification({});
    toasts.show(r.status === 200 ? "Verification email sent." : errorMessage(r), r.status === 200 ? "success" : "error");
  }

  async function revoke(id: string) {
    await api.auth.revokeSession({ params: { id } });
    if (sessions.find((s) => s.id === id)?.current) return logout();
    sessions = sessions.filter((s) => s.id !== id);
  }

  async function logout() {
    await api.auth.logout({});
    session.set(null);
    await session.refresh();
    void game.reconnect();
    goto("/");
  }

  async function checkout(interval: "month" | "year") {
    const r = await api.billing.checkout({ body: { interval } });
    if (r.status === 200) location.href = r.body.url;
    else toasts.show(errorMessage(r), "error");
  }
  async function portal() {
    const r = await api.billing.portal({});
    if (r.status === 200) location.href = r.body.url;
    else toasts.show(errorMessage(r), "error");
  }
  async function devToggle() {
    await api.billing.devToggle({});
    await session.refresh();
    await load();
    void game.reconnect();
  }

  const groups: { type: CosmeticType; label: string }[] = [
    { type: "caret_color", label: "caret colour" },
    { type: "caret_shape", label: "caret shape" },
    { type: "finish", label: "win animation" },
    { type: "banner", label: "profile banner" },
  ];

  function rule(c: Cosmetic) {
    const u = c.unlock;
    if (u.type === "level") return `level ${u.level}`;
    if (u.type === "tier") return `reach ${tierById(u.tier)?.name} in ranked`;
    return "";
  }
  // points the supporter tile's rainbow border at the cursor
  function aim(e: PointerEvent & { currentTarget: HTMLElement }) {
    const r = e.currentTarget.getBoundingClientRect();
    const deg = (Math.atan2(e.clientX - r.left - r.width / 2, r.top + r.height / 2 - e.clientY) * 180) / Math.PI;
    e.currentTarget.style.setProperty("--angle", `${deg}deg`);
  }
  const cosmeticName = (c: Cosmetic) => (session.supporterSales ? c.name : (c.quietName ?? c.name));
  const equippedId = (type: CosmeticType) => session.me?.equipped[type];
  const shortUa = (ua: string | null) =>
    !ua ? "unknown device" : `${/Firefox/.test(ua) ? "Firefox" : /Edg/.test(ua) ? "Edge" : /Chrome/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "Browser"} on ${/Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "unknown"}`;

  // ---------------------------------------------------------------- preferences
  // Every typing preference, grouped like monkeytype's settings page. They're
  // all cosmetic; gameplay rules live in practice and private rooms instead.
  type Setting = {
    id: string;
    section: string;
    title: string;
    hint: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: readonly any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: () => any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    set: (v: any) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    name?: (v: any) => string;
    kind?: "buttons" | "select" | "fonts";
    /** extra search words */
    tags?: string;
  };
  const onOff = [true, false];
  const onOffName = (v: boolean) => (v ? "on" : "off");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pref = <K extends PrefKey>(id: K) => ({ value: () => prefs[id], set: (v: any) => prefs.set(id, v) });

  const SECTIONS: { id: string; label: string; note?: string }[] = [
    {
      id: "behaviour",
      label: "behaviour",
      note: 'gameplay rules like stop on error, confidence mode or minimum speed are set per test under <b>rules</b> in <a class="link" href="/practice">practice</a>, or by the host of a private room. ranked and casual always race without them.',
    },
    { id: "input", label: "input" },
    { id: "sound", label: "sound" },
    { id: "caret", label: "caret", note: 'caret colour and shape are cosmetics you unlock by playing (see <a class="link" href="#cosmetics">cosmetics</a>).' },
    { id: "appearance", label: "appearance" },
    { id: "live", label: "live stats" },
  ];

  const SETTINGS: Setting[] = [
    { id: "quick-restart", section: "behaviour", title: "quick restart", hint: "restart a practice test with a single key.", options: QUICK_RESTARTS, ...pref("quickRestart") },
    { id: "layout", section: "input", title: "layout emulation", hint: "type as if your keyboard had this layout, whatever your system layout is (e.g. practise dvorak on a qwerty board).", options: LAYOUT_IDS, name: layoutName, kind: "select", tags: "keyboard dvorak colemak workman azerty qwertz", ...pref("layout") },
    { id: "sound-click", section: "sound", title: "sound on click", hint: "play a sound on every key.", options: Object.keys(CLICK_SOUNDS), name: (v: string) => CLICK_SOUNDS[v]!.name, tags: "audio", value: () => prefs.soundOnClick, set: (v: string) => (prefs.set("soundOnClick", v), playClick(v, prefs.soundVolume)) },
    { id: "sound-error", section: "sound", title: "sound on error", hint: "play a sound when you make a mistake (instead of the click).", options: Object.keys(ERROR_SOUNDS), name: (v: string) => ERROR_SOUNDS[v]!.name, tags: "audio", value: () => prefs.soundOnError, set: (v: string) => (prefs.set("soundOnError", v), playError(v, prefs.soundVolume)) },
    { id: "sound-volume", section: "sound", title: "sound volume", hint: "how loud typing sounds are.", options: VOLUMES, name: (v: number) => `${v * 100}%`, tags: "audio", value: () => prefs.soundVolume, set: (v: number) => (prefs.set("soundVolume", v), playClick(prefs.soundOnClick === "off" ? "click" : prefs.soundOnClick, v)) },
    { id: "smooth-caret", section: "caret", title: "smooth caret", hint: "glide the caret between letters instead of jumping, and how fast.", options: CARET_SPEEDS, ...pref("smoothCaret") },
    { id: "font-family", section: "appearance", title: "font family", hint: "the font used across the site and for the words you type.", options: [], kind: "fonts", tags: FONTS.map(fontLabel).join(" "), ...pref("fontFamily") },
    { id: "font-size", section: "appearance", title: "font size", hint: "size of the words you type.", options: FONT_SIZES, name: fontSizeName, ...pref("fontSize") },
    { id: "tape-mode", section: "appearance", title: "tape mode", hint: "show the words on one scrolling line. letter scrolls every letter, word every word.", options: TAPE_MODES, ...pref("tapeMode") },
    { id: "show-all-lines", section: "appearance", title: "show all lines", hint: "show the whole text instead of three lines (not in time mode).", options: onOff, name: onOffName, ...pref("showAllLines") },
    { id: "smooth-line-scroll", section: "appearance", title: "smooth line scroll", hint: "slide to the next line instead of jumping.", options: onOff, name: onOffName, ...pref("smoothLineScroll") },
    { id: "highlight-mode", section: "appearance", title: "highlight mode", hint: "letter colours each typed letter, word lights up the whole current word, off only shows mistakes.", options: HIGHLIGHT_MODES, ...pref("highlightMode") },
    { id: "indicate-typos", section: "appearance", title: "indicate typos", hint: "show the letter you actually typed below the word, or in place of the right one.", options: INDICATE_TYPOS, ...pref("indicateTypos") },
    { id: "blind-mode", section: "appearance", title: "blind mode", hint: "hide mistakes while you type. they still count.", options: onOff, name: onOffName, ...pref("blindMode") },
    { id: "hide-extra", section: "appearance", title: "hide extra letters", hint: "don't show letters typed past the end of a word.", options: onOff, name: onOffName, ...pref("hideExtraLetters") },
    { id: "flip-colors", section: "appearance", title: "flip test colors", hint: "untyped words bright, typed words dim.", options: onOff, name: onOffName, ...pref("flipColors") },
    { id: "colorful-mode", section: "appearance", title: "colorful mode", hint: "typed letters use the theme's main colour.", options: onOff, name: onOffName, ...pref("colorfulMode") },
    { id: "live-progress", section: "live", title: "live progress", hint: "the timer or word count while typing: big, small, a bar, or hidden.", options: PROGRESS_STYLES, tags: "timer", ...pref("liveProgress") },
    { id: "live-wpm", section: "live", title: "live speed", hint: "your wpm while typing.", options: LIVE_STYLES, tags: "wpm", ...pref("liveWpm") },
    { id: "live-acc", section: "live", title: "live accuracy", hint: "your accuracy while typing.", options: LIVE_STYLES, ...pref("liveAcc") },
    { id: "live-burst", section: "live", title: "live burst", hint: "the speed of your last word.", options: LIVE_STYLES, ...pref("liveBurst") },
  ];

  let query = $state("");
  const terms = $derived(query.toLowerCase().split(/\s+/).filter(Boolean));
  const hit = (s: string) => terms.every((t) => s.toLowerCase().includes(t));
  const matching = $derived(SETTINGS.filter((s) => hit(`${s.section} ${s.title} ${s.hint} ${s.tags ?? ""}`)));
  const visibleSection = (id: string) => matching.some((s) => s.section === id);
  const shownThemes = $derived(hit("theme colour color") ? THEMES : THEMES.filter((t) => hit(t.name)));
  const themeVisible = $derived(shownThemes.length > 0 || hit("room themes"));
</script>

<svelte:head><title>Settings · MT Ranked</title></svelte:head>

{#snippet choice<T>(label: string, hint: string, options: readonly T[], value: T, set: (v: T) => void, name: (v: T) => string = String)}
  <div class="flex flex-wrap items-center justify-between gap-x-8 gap-y-2">
    <div class="max-w-md">
      <div>{label}</div>
      <div class="text-xs text-sub">{hint}</div>
    </div>
    <div class="flex flex-wrap gap-1 rounded-lg bg-sub-alt p-1 text-sm">
      {#each options as o (o)}
        <button class="rounded-md px-3 py-1 transition-colors" class:bg-main={o === value} class:text-bg={o === value} class:text-sub={o !== value} class:hover:text-text={o !== value} onclick={() => set(o)}>{name(o)}</button>
      {/each}
    </div>
  </div>
{/snippet}

{#snippet perks()}
  <ul class="mt-2 list-inside list-disc text-sm text-sub">
    <li>private rooms for up to 16 players (4 for free accounts)</li>
    <li>name your private rooms and give them a theme</li>
    <li>supporter caret, win animation, banner and profile badge</li>
    <li>full match history and replays (free keeps the last 50)</li>
  </ul>
{/snippet}

{#snippet setting(s: Setting)}
  {#if s.kind === "fonts"}
    <div>
      <div>{s.title}</div>
      <div class="mb-3 text-xs text-sub">{s.hint}</div>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {#each FONTS as f (f.id)}
          {@const on = prefs.fontFamily === f.id}
          <button
            class="truncate rounded-lg border-2 bg-sub-alt px-3 py-2 text-left text-sm transition-colors"
            class:border-main={on}
            class:border-transparent={!on}
            class:text-sub={!on}
            style="font-family: '{f.name}', monospace"
            onclick={() => prefs.set("fontFamily", f.id)}>{fontLabel(f)}</button
          >
        {/each}
      </div>
    </div>
  {:else if s.kind === "select"}
    <div class="flex flex-wrap items-center justify-between gap-x-8 gap-y-2">
      <div class="max-w-md">
        <div>{s.title}</div>
        <div class="text-xs text-sub">{s.hint}</div>
      </div>
      <select class="input w-auto cursor-pointer text-sm" value={s.value()} onchange={(e) => s.set(e.currentTarget.value)}>
        {#each s.options as o (o)}<option value={o}>{(s.name ?? String)(o)}</option>{/each}
      </select>
    </div>
  {:else}
    {@render choice(s.title, s.hint, s.options, s.value(), s.set, s.name)}
  {/if}
{/snippet}

<div class="mx-auto max-w-[900px] space-y-12 animate-fade">
  <div class="sticky top-0 z-10 -mx-2 space-y-3 bg-bg/95 px-2 py-3 backdrop-blur">
    <label class="flex items-center gap-2 rounded-lg bg-sub-alt px-3">
      <Search size={16} class="text-sub" />
      <input class="w-full bg-transparent py-2 outline-none placeholder:text-sub" placeholder="search settings (e.g. caret, sound, tape)" bind:value={query} />
      {#if query}<button class="text-sub hover:text-text" onclick={() => (query = "")} aria-label="clear search"><X size={16} /></button>{/if}
    </label>
    <nav class="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {#each SECTIONS as sec (sec.id)}
        {#if visibleSection(sec.id)}<a class="text-sub hover:text-main" href="#{sec.id}">{sec.label}</a>{/if}
      {/each}
      <a class="text-sub hover:text-main" href="#theme" class:hidden={!themeVisible}>theme</a>
      {#if session.me && !query}<a class="text-sub hover:text-main" href="#account">account</a>{/if}
    </nav>
  </div>
  <p class="-mt-8 text-xs text-sub">
    {session.me ? "synced to your account" : "saved on this device (sign in to sync them)"}. press <kbd>{prefs.quickRestart === "esc" ? "ctrl+p" : "esc"}</kbd> anywhere
    to change these without the mouse. everything here only changes how typing looks and sounds for you, so it works in ranked too.
  </p>

  {#each SECTIONS as sec (sec.id)}
    {#if visibleSection(sec.id)}
      <section id={sec.id} class="scroll-mt-28">
        <h2 class="label mb-1 text-sm">{sec.label}</h2>
        {#if sec.note}<p class="mb-5 text-xs text-sub">{@html sec.note}</p>{:else}<div class="mb-5"></div>{/if}
        <div class="space-y-6">
          {#each matching.filter((s) => s.section === sec.id) as s (s.id)}
            {@render setting(s)}
          {/each}
        </div>
      </section>
    {/if}
  {/each}

  {#if themeVisible}
    <section id="theme" class="scroll-mt-28">
      <h2 class="label mb-4 text-sm">theme</h2>
      <div class="mb-8 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4" role="presentation" onmouseleave={endPreview}>
        {#each shownThemes as t (t.id)}
          {@const on = prefs.theme === t.id}
          <button
            class="flex items-center justify-between gap-2 rounded-lg border-2 px-3 py-2 text-left text-sm"
            style="background: {t.bg}; color: {t.text}; border-color: {on ? t.main : 'transparent'}"
            onmouseenter={() => hoverTheme(t.id)}
            onfocus={() => (prefs.preview = t.id)}
            onblur={endPreview}
            onclick={() => prefs.set("theme", t.id)}
          >
            <span class="truncate">{t.name}</span>
            <span class="flex shrink-0 gap-1">
              {#each [t.main, t.sub, t.text] as c, j (j)}<span class="h-2.5 w-2.5 rounded-full" style="background: {c}"></span>{/each}
            </span>
          </button>
        {/each}
      </div>
      {@render choice("room themes", `show ${session.supporterSales ? "a supporter host's" : "the host's"} room theme while you're in their room. your own theme comes back when you leave.`, [true, false], prefs.roomThemes, (v) => prefs.set("roomThemes", v), (v) => (v ? "on" : "off"))}
    </section>
  {/if}

  {#if query && !matching.length && !themeVisible}
    <div class="text-center text-sub">no settings match "{query}"</div>
  {/if}

<div id="account" class="scroll-mt-28 space-y-12" class:hidden={!!query}>

  {#if session.loaded && !session.me}
    <div class="card flex flex-wrap items-center justify-between gap-4">
      <div class="text-sm text-sub">sign in to edit your profile, cosmetics and sessions</div>
      <a class="btn btn-main" href="/login?next=/settings">sign in</a>
    </div>
  {/if}

{#if session.me}
  {@const me = session.me}
    {#if !me.verified}
      <div class="card flex flex-wrap items-center justify-between gap-4 border-2 border-main/40">
        <div>
          <div>verify your email to unlock ranked</div>
          <div class="text-sm text-sub">we sent a link to {me.email}</div>
        </div>
        <button class="btn btn-main" onclick={resend}>resend link</button>
      </div>
    {/if}

    <section>
      <h2 class="label mb-4 text-sm">profile</h2>
      <form class="grid gap-4 sm:grid-cols-[1fr_1fr_auto]" onsubmit={saveProfile}>
        <label class="space-y-1">
          <span class="label">display name</span>
          <input class="input" bind:value={displayName} minlength="3" maxlength="20" disabled={!!me.nameChangeAt} />
          {#if nameError}
            <span class="block text-xs text-error">{nameError}</span>
          {:else if me.nameChangeAt}
            <span class="block text-xs text-error">
              you can change your name again on {new Date(me.nameChangeAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
            </span>
          {:else}
            <span class="block text-xs text-error">names can only be changed once every 30 days</span>
          {/if}
        </label>
        <label class="space-y-1">
          <span class="label">country (leaderboard filter)</span>
          <select class="input" bind:value={country}>
            <option value="">not set</option>
            {#each COUNTRIES as c (c.code)}<option value={c.code}>{flag(c.code)} {c.name}</option>{/each}
          </select>
        </label>
        <button class="btn btn-main self-end">save</button>
      </form>
    </section>

    {#snippet tile(c: Cosmetic)}
      {@const open = unlocked.has(c.id)}
      {@const on = equippedId(c.type) === c.id}
      {@const perk = session.supporterSales && me.subscriber && c.unlock.type === "subscriber"}
      <button
        class="flex min-w-28 flex-col items-start gap-2 rounded-lg border-2 bg-sub-alt px-3 py-2 text-left text-sm transition-colors"
        class:supporter-tile={perk}
        class:border-main={on && !perk}
        class:border-transparent={!on && !perk}
        class:opacity-40={!open}
        disabled={!open}
        onclick={() => equip(c)}
        onpointermove={perk ? aim : undefined}
        onpointerleave={perk ? (e) => e.currentTarget.style.removeProperty("--angle") : undefined}
        title={open ? cosmeticName(c) : c.unlock.type === "subscriber" ? "supporter perk" : `unlocks at ${rule(c)}`}
      >
        <span class="relative block h-8 w-full overflow-hidden rounded" class:banner={c.type === "banner"} style={c.type === "banner" ? `background: ${c.value}` : ""}>
          {#if c.type === "caret_color"}
            <Caret x={6} y={0} h={32} color={c.value} shape={equippedId("caret_shape") ? (COSMETICS.find((x) => x.id === equippedId("caret_shape"))?.value ?? "line") : "line"} smooth={false} />
          {:else if c.type === "caret_shape"}
            <Caret x={6} y={0} h={32} color={COSMETICS.find((x) => x.id === equippedId("caret_color"))?.value ?? "#e2b714"} shape={c.value} smooth={false} />
          {:else if c.type === "finish"}
            <span class="text-lg">{c.value === "none" ? "·" : c.value === "fireworks" ? "✺" : c.value === "stars" ? "★" : c.value === "gold" ? "✦" : "🎉"}</span>
          {/if}
        </span>
        <span class="flex w-full items-center justify-between gap-2">
          {cosmeticName(c)}
          {#if on}<Check size={14} class="text-main" />{:else if !open}<Lock size={12} />{/if}
        </span>
        {#if !open && rule(c)}<span class="text-[0.65rem] text-sub">{rule(c)}</span>{/if}
        {#if perk}<span class="text-[0.65rem] text-main">{me.earlySupporter ? "early supporter perk ♥" : "supporter perk ♥"}</span>{/if}
      </button>
    {/snippet}

    <section id="cosmetics" class="scroll-mt-28">
      <h2 class="label mb-1 text-sm">cosmetics</h2>
      <p class="mb-5 text-xs text-sub">
        unlocked by typing. every race earns xp toward your next level, and reaching a tier in ranked unlocks its reward for good.
        you're level {me.level}.
      </p>
      {#each groups as g (g.type)}
        <div class="mb-6">
          <div class="label mb-2">{g.label}</div>
          <div class="flex flex-wrap gap-2">
            {#each COSMETICS.filter((c) => c.type === g.type && (me.subscriber || c.unlock.type !== "subscriber")) as c (c.id)}
              {@render tile(c)}
            {/each}
          </div>
        </div>
      {/each}
    </section>

    {#if session.supporterSales}
      <section>
        <h2 class="label mb-4 text-sm">supporter</h2>
        <div class="card">
          {#if me.earlySupporter}
            <div class="text-main">thank you for being one of our first users ♥</div>
            <div class="mt-1 text-sm text-sub">as an early supporter, these are yours for life:</div>
            {@render perks()}
          {:else if me.subscriber}
            <div class="text-main">you're a supporter ♥ thank you</div>
            <div class="mt-1 text-sm text-sub">
              {billing?.status === "active" && billing.renewsAt ? `renews ${new Date(billing.renewsAt).toLocaleDateString()}` : ""}
            </div>
          {:else}
            <div>support mt ranked</div>
            {@render perks()}
          {/if}
          {#if !me.subscriber}
            <div class="label mb-2 mt-5">supporter cosmetics</div>
            <div class="flex flex-wrap gap-2">
              {#each COSMETICS.filter((c) => c.unlock.type === "subscriber") as c (c.id)}
                {@render tile(c)}
              {/each}
            </div>
          {/if}
          <div class="mt-5 flex flex-wrap gap-2">
            {#if me.earlySupporter}
              {#if billing?.enabled && billing.status === "active"}<button class="btn" onclick={portal}>manage subscription</button>{/if}
            {:else if billing?.enabled}
              {#if me.subscriber}
                <button class="btn" onclick={portal}>manage subscription</button>
              {:else}
                <button class="btn btn-main" onclick={() => checkout("month")}>monthly</button>
                <button class="btn" onclick={() => checkout("year")}>yearly (save ~20%)</button>
              {/if}
            {:else}
              <span class="text-sm text-sub">payments aren't configured on this server.</span>
              {#if import.meta.env.DEV}<button class="btn btn-ghost text-sm" onclick={devToggle}>dev: toggle supporter</button>{/if}
            {/if}
          </div>
        </div>
      </section>
    {/if}

    <section>
      <h2 class="label mb-4 text-sm">sessions</h2>
      <ul class="space-y-2">
        {#each sessions as s (s.id)}
          <li class="card flex items-center gap-4 py-3">
            <Monitor size={18} class="text-sub" />
            <div class="flex-1 text-sm">
              <div>{shortUa(s.userAgent)} {#if s.current}<span class="text-xs text-main">this device</span>{/if}</div>
              <div class="text-xs text-sub">{s.ip ?? ""} · last active {new Date(s.lastSeenAt).toLocaleString()}</div>
            </div>
            <button class="btn btn-ghost text-sm" onclick={() => revoke(s.id)}>{s.current ? "sign out" : "revoke"}</button>
          </li>
        {/each}
      </ul>
      <button class="btn mt-6" onclick={logout}><LogOut size={16} /> sign out</button>
    </section>
{/if}
</div>
</div>
