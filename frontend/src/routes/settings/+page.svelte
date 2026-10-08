<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { Check, Lock, LogOut, Monitor } from "@lucide/svelte";
  import { COSMETICS, THEMES, tierById, type Cosmetic, type CosmeticType } from "@mtr/shared";
  import { api, errorMessage, fieldErrors } from "#lib/api.ts";
  import { session } from "#lib/session.svelte.ts";
  import { game } from "#lib/game.svelte.ts";
  import { toasts } from "#lib/toast.svelte.ts";
  import { COUNTRIES, flag } from "#lib/countries.ts";
  import Caret from "#lib/components/Caret.svelte";
  import { FONT_SIZES, QUICK_RESTARTS, fontSizeName, prefs, type QuickRestart } from "#lib/prefs.svelte.ts";

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

  onDestroy(() => (prefs.preview = null));

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
  const equippedId = (type: CosmeticType) => session.me?.equipped[type];
  const shortUa = (ua: string | null) =>
    !ua ? "unknown device" : `${/Firefox/.test(ua) ? "Firefox" : /Edg/.test(ua) ? "Edge" : /Chrome/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "Browser"} on ${/Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "unknown"}`;
</script>

<svelte:head><title>settings · mt ranked</title></svelte:head>

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

<div class="mx-auto max-w-[900px] space-y-12 animate-fade">
  <section>
    <h2 class="label mb-1 text-sm">preferences</h2>
    <p class="mb-5 text-xs text-sub">{session.me ? "synced to your account" : "saved on this device (sign in to sync them)"}. press <kbd>{prefs.quickRestart === "esc" ? "ctrl+p" : "esc"}</kbd> anywhere to change these without the mouse.</p>
    <div class="label mb-2">theme</div>
    <div class="mb-8 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
      {#each THEMES as t (t.id)}
        {@const on = prefs.theme === t.id}
        <button
          class="flex items-center justify-between gap-2 rounded-lg border-2 px-3 py-2 text-left text-sm"
          style="background: {t.bg}; color: {t.text}; border-color: {on ? t.main : 'transparent'}"
          onmouseenter={() => (prefs.preview = t.id)}
          onmouseleave={() => (prefs.preview = null)}
          onfocus={() => (prefs.preview = t.id)}
          onblur={() => (prefs.preview = null)}
          onclick={() => prefs.set("theme", t.id)}
        >
          <span class="truncate">{t.name}</span>
          <span class="flex shrink-0 gap-1">
            {#each [t.main, t.sub, t.text] as c, j (j)}<span class="h-2.5 w-2.5 rounded-full" style="background: {c}"></span>{/each}
          </span>
        </button>
      {/each}
    </div>
    <div class="space-y-6">
      {@render choice<QuickRestart>("quick restart", "restart a practice test with a single key.", QUICK_RESTARTS, prefs.quickRestart, (v) => prefs.set("quickRestart", v))}
      {@render choice("room themes", "show a supporter host's room theme while you're in their room. your own theme comes back when you leave.", [true, false], prefs.roomThemes, (v) => prefs.set("roomThemes", v), (v) => (v ? "on" : "off"))}
      {@render choice("font size", "size of the words you type.", FONT_SIZES, prefs.fontSize, (v) => prefs.set("fontSize", v), fontSizeName)}
      {@render choice("smooth caret", "glide the caret between letters instead of jumping.", [true, false], prefs.smoothCaret, (v) => prefs.set("smoothCaret", v), (v) => (v ? "on" : "off"))}
      {@render choice("live wpm", "show your speed while typing.", [true, false], prefs.liveWpm, (v) => prefs.set("liveWpm", v), (v) => (v ? "on" : "off"))}
    </div>
  </section>

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
      <button
        class="flex min-w-28 flex-col items-start gap-2 rounded-lg border-2 bg-sub-alt px-3 py-2 text-left text-sm transition-colors"
        class:border-main={on}
        class:border-transparent={!on}
        class:opacity-40={!open}
        disabled={!open}
        onclick={() => equip(c)}
        title={open ? c.name : c.unlock.type === "subscriber" ? "supporter perk" : `unlocks at ${rule(c)}`}
      >
        <span class="relative block h-8 w-full overflow-hidden rounded" style={c.type === "banner" ? `background: ${c.value}` : ""}>
          {#if c.type === "caret_color"}
            <Caret x={6} y={0} h={32} color={c.value} shape={equippedId("caret_shape") ? (COSMETICS.find((x) => x.id === equippedId("caret_shape"))?.value ?? "line") : "line"} smooth={false} />
          {:else if c.type === "caret_shape"}
            <Caret x={6} y={0} h={32} color={COSMETICS.find((x) => x.id === equippedId("caret_color"))?.value ?? "#e2b714"} shape={c.value} smooth={false} />
          {:else if c.type === "finish"}
            <span class="text-lg">{c.value === "none" ? "·" : c.value === "fireworks" ? "✺" : c.value === "stars" ? "★" : c.value === "gold" ? "✦" : "🎉"}</span>
          {/if}
        </span>
        <span class="flex w-full items-center justify-between gap-2">
          {c.name}
          {#if on}<Check size={14} class="text-main" />{:else if !open}<Lock size={12} />{/if}
        </span>
        {#if !open && rule(c)}<span class="text-[0.65rem] text-sub">{rule(c)}</span>{/if}
      </button>
    {/snippet}

    <section>
      <h2 class="label mb-1 text-sm">cosmetics</h2>
      <p class="mb-5 text-xs text-sub">
        unlocked by typing. every race earns xp toward your next level, and reaching a tier in ranked unlocks its reward for good.
        you're level {me.level}.
      </p>
      {#each groups as g (g.type)}
        <div class="mb-6">
          <div class="label mb-2">{g.label}</div>
          <div class="flex flex-wrap gap-2">
            {#each COSMETICS.filter((c) => c.type === g.type && c.unlock.type !== "subscriber") as c (c.id)}
              {@render tile(c)}
            {/each}
          </div>
        </div>
      {/each}
    </section>

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
        <div class="label mb-2 mt-5">supporter cosmetics</div>
        <div class="flex flex-wrap gap-2">
          {#each COSMETICS.filter((c) => c.unlock.type === "subscriber") as c (c.id)}
            {@render tile(c)}
          {/each}
        </div>
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
