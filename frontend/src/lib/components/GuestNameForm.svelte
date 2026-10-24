<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import { OFFENSIVE_NAME_MESSAGE, isOffensiveName } from "@mtr/shared";
  import { game } from "#lib/game.svelte.ts";
  import { session } from "#lib/session.svelte.ts";

  /** Asks a signed-out player for their guest name, then carries on with `oncontinue`. */
  let {
    children,
    action,
    next,
    busy = false,
    error = null,
    oncontinue,
    oncancel,
  }: {
    children: Snippet;
    /** the submit button's label */
    action: string;
    /** where signing in instead comes back to */
    next: string;
    busy?: boolean;
    /** a refusal from whatever `oncontinue` started */
    error?: string | null;
    oncontinue: () => unknown;
    oncancel?: () => void;
  } = $props();

  let name = $state(session.guest?.name ?? "");
  let nameError = $state<string | null>(null);
  let renaming = $state(false);

  // a first-time guest only gets their name once connected: fetch it to start from
  onMount(async () => {
    if (!session.guest) {
      await game.connect().catch(() => {});
      await session.refresh();
    }
    if (!name) name = session.guest?.name ?? "";
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    nameError = null;
    if (name && name !== session.guest?.name) {
      if (!/^[a-zA-Z0-9_.-]{3,20}$/.test(name)) {
        nameError = "Names are 3–20 letters, numbers, _ . or -";
        return;
      }
      if (isOffensiveName(name)) {
        nameError = OFFENSIVE_NAME_MESSAGE;
        return;
      }
      renaming = true;
      await game.reconnect(name).catch(() => {});
      await session.refresh();
      renaming = false;
      if (game.guestNameError) {
        nameError = game.guestNameError;
        return;
      }
    }
    await oncontinue();
  }
</script>

<form class="card mx-auto mt-10 max-w-sm space-y-4 animate-rise" onsubmit={submit}>
  <div class="text-lg">{@render children()}</div>
  <label class="block space-y-1">
    <span class="label">your name for this room</span>
    <input class="input" bind:value={name} maxlength="20" placeholder="guest name" />
  </label>
  {#if nameError ?? error}<div class="text-sm text-error">{nameError ?? error}</div>{/if}
  <button class="btn btn-main w-full" disabled={busy || renaming}>{action}</button>
  {#if oncancel}<button type="button" class="btn btn-ghost w-full" onclick={oncancel}>cancel</button>{/if}
  <div class="text-center text-sm text-sub">
    or <a class="link" href="/login?next={next}">sign in</a> to keep your stats
  </div>
</form>
