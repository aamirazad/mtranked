<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import type { Me } from "@mtr/contracts";
  import { api, errorMessage, fieldErrors, type ApiResult } from "#lib/api.ts";
  import { session } from "#lib/session.svelte.ts";
  import { game } from "#lib/game.svelte.ts";

  // email → password (has one) | code (code-only, already sent) | choose (no account yet)
  // choose → code → name, or choose → create (password + name)
  type Step = "email" | "password" | "code" | "choose" | "create" | "name";

  let step = $state<Step>("email");
  let email = $state("");
  let password = $state("");
  let code = $state("");
  let displayName = $state("");
  let signupToken = $state("");
  let error = $state<string | null>(null);
  let fields = $state<Record<string, string>>({});
  let info = $state<string | null>(null);
  let busy = $state(false);
  const next = $derived(page.url.searchParams.get("next") ?? "/");

  function go(s: Step) {
    step = s;
    error = null;
    fields = {};
    info = null;
  }

  /** run a request with the busy flag; returns the response only when it succeeded */
  async function call<R extends ApiResult>(req: () => Promise<R>): Promise<(R & { status: 200 }) | null> {
    busy = true;
    error = null;
    fields = {};
    const r = await req().catch(() => ({ status: 0, body: { message: "Couldn't reach the server. Try again." } }) as R);
    busy = false;
    if (r.status === 200) return r as R & { status: 200 };
    fields = fieldErrors(r);
    error = Object.keys(fields).length ? null : errorMessage(r);
    return null;
  }

  function done(user: Me) {
    session.set(user);
    void game.reconnect();
    goto(next.startsWith("/") ? next : "/");
  }

  async function submitEmail(e: SubmitEvent) {
    e.preventDefault();
    const r = await call(() => api.auth.start({ body: { email } }));
    if (!r) return;
    code = "";
    password = "";
    go(r.body.next === "new" ? "choose" : r.body.next);
  }

  async function sendCode() {
    const r = await call(() => api.auth.sendCode({ body: { email } }));
    if (!r) return;
    const resend = step === "code";
    code = "";
    go("code");
    if (resend) info = "sent a new code";
  }

  async function submitCode(e?: SubmitEvent) {
    e?.preventDefault();
    if (busy) return;
    const r = await call(() => api.auth.verifyCode({ body: { email, code } }));
    if (!r) return void (code = "");
    if (r.body.user) return done(r.body.user);
    signupToken = r.body.signupToken;
    go("name");
  }

  async function submitPassword(e: SubmitEvent) {
    e.preventDefault();
    const r = await call(() => api.auth.login({ body: { email, password } }));
    if (r) done(r.body.user);
  }

  async function submitCreate(e: SubmitEvent) {
    e.preventDefault();
    const r = await call(() => api.auth.signup({ body: { email, password, displayName } }));
    if (r) done(r.body.user);
  }

  async function submitName(e: SubmitEvent) {
    e.preventDefault();
    const r = await call(() => api.auth.signupWithCode({ body: { signupToken, displayName } }));
    if (r) done(r.body.user);
  }

  /** each step focuses its first field as it appears */
  const focus = (el: HTMLElement) => el.focus();

  /** submit as soon as the sixth digit is typed or pasted */
  function codeInput() {
    code = code.replace(/\D/g, "").slice(0, 6);
    if (code.length === 6) void submitCode();
  }
</script>

<svelte:head><title>Sign In · MT Ranked</title></svelte:head>

{#snippet who()}
  <div class="flex items-baseline justify-between gap-3 text-sm">
    <span class="truncate text-sub">{email}</span>
    <button type="button" class="shrink-0 text-sub hover:text-text" onclick={() => go("email")}>change</button>
  </div>
  <!-- lets password managers pair the password with the email -->
  <input class="sr-only" type="email" autocomplete="username" value={email} tabindex="-1" aria-hidden="true" readonly />
{/snippet}

{#snippet problem()}
  {#if error}<div class="text-sm text-error">{error}</div>{/if}
{/snippet}

{#snippet nameField()}
  <div>
    <input class="input" placeholder="display name" autocomplete="nickname" bind:value={displayName} required minlength="3" maxlength="20" {@attach focus} />
    {#if fields.displayName}<div class="mt-1 text-xs text-error">{fields.displayName}</div>{/if}
  </div>
{/snippet}

<div class="mx-auto mt-8 max-w-sm animate-rise">
  {#if step === "email"}
    <form class="space-y-4" onsubmit={submitEmail}>
      <h1 class="font-logo text-3xl">sign in</h1>
      <div>
        <input class="input" type="email" autocomplete="email" placeholder="email" bind:value={email} required {@attach focus} />
        {#if fields.email}<div class="mt-1 text-xs text-error">{fields.email}</div>{/if}
      </div>
      {@render problem()}
      <button class="btn btn-main w-full" disabled={busy}>{busy ? "…" : "continue"}</button>
      <p class="text-sm text-sub">new here? enter your email and we'll set up your account.</p>
    </form>
  {:else if step === "password"}
    <form class="space-y-4" onsubmit={submitPassword}>
      <h1 class="font-logo text-3xl">welcome back</h1>
      {@render who()}
      <input class="input" type="password" autocomplete="current-password" placeholder="password" bind:value={password} required {@attach focus} />
      {@render problem()}
      <button class="btn btn-main w-full" disabled={busy}>{busy ? "signing in…" : "sign in"}</button>
      <button type="button" class="btn w-full" disabled={busy} onclick={sendCode}>email me a code instead</button>
      <div class="text-right text-sm"><a class="text-sub hover:text-text" href="/forgot">forgot password?</a></div>
    </form>
  {:else if step === "code"}
    <form class="space-y-4" onsubmit={submitCode}>
      <h1 class="font-logo text-3xl">check your email</h1>
      {@render who()}
      <p class="text-sm text-sub">we sent a 6-digit code. it expires in 10 minutes.</p>
      <div>
        <input
          class="input text-center text-2xl tracking-[0.5em] tabular-nums"
          inputmode="numeric"
          autocomplete="one-time-code"
          placeholder="······"
          maxlength="6"
          pattern="\d{6}"
          aria-label="sign-in code"
          bind:value={code}
          oninput={codeInput}
          required
          {@attach focus}
        />
        {#if fields.code}<div class="mt-1 text-xs text-error">{fields.code}</div>{/if}
      </div>
      {@render problem()}
      <button class="btn btn-main w-full" disabled={busy || code.length < 6}>{busy ? "checking…" : "continue"}</button>
      <div class="flex items-baseline justify-between text-sm">
        <button type="button" class="text-sub hover:text-text" disabled={busy} onclick={sendCode}>resend code</button>
        {#if info}<span class="text-main">{info}</span>{/if}
      </div>
    </form>
  {:else if step === "choose"}
    <div class="space-y-4">
      <h1 class="font-logo text-3xl">create account</h1>
      {@render who()}
      <p class="text-sm text-sub">there's no account for this email yet. how would you like to sign in?</p>
      {@render problem()}
      <button class="btn btn-main w-full flex-col items-start gap-0.5 py-3 text-left" disabled={busy} onclick={sendCode}>
        <span>email me a code</span>
        <span class="text-xs opacity-70">no password to remember. we'll send a code each time you sign in.</span>
      </button>
      <button class="btn w-full flex-col items-start gap-0.5 py-3 text-left" disabled={busy} onclick={() => go("create")}>
        <span>create a password</span>
        <span class="text-xs opacity-70">sign in with a password. you can still ask for a code.</span>
      </button>
    </div>
  {:else if step === "create"}
    <form class="space-y-4" onsubmit={submitCreate}>
      <h1 class="font-logo text-3xl">create account</h1>
      {@render who()}
      {@render nameField()}
      <div>
        <input class="input" type="password" autocomplete="new-password" placeholder="password (8+ characters)" bind:value={password} required minlength="8" />
        {#if fields.password}<div class="mt-1 text-xs text-error">{fields.password}</div>{/if}
      </div>
      {@render problem()}
      <button class="btn btn-main w-full" disabled={busy}>{busy ? "creating…" : "create account"}</button>
      <p class="text-sm text-sub">
        we'll email you a link to verify your address (needed for ranked).
        <button type="button" class="link" onclick={() => go("choose")}>back</button>
      </p>
    </form>
  {:else if step === "name"}
    <form class="space-y-4" onsubmit={submitName}>
      <h1 class="font-logo text-3xl">pick a name</h1>
      {@render who()}
      <p class="text-sm text-sub">this is what other players see. you can change it later, once every 30 days.</p>
      {@render nameField()}
      {@render problem()}
      <button class="btn btn-main w-full" disabled={busy}>{busy ? "creating…" : "create account"}</button>
    </form>
  {/if}
</div>
