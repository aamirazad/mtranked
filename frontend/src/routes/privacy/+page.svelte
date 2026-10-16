<script lang="ts">
  import { session } from "#lib/session.svelte.ts";
</script>

<svelte:head><title>Privacy Policy · MT Ranked</title></svelte:head>

<div class="mx-auto max-w-[760px] space-y-10 leading-relaxed animate-fade">
  <section>
    <h1 class="font-logo text-4xl">privacy policy</h1>
    <p class="mt-2 text-xs text-sub">last updated October 8, 2026</p>
    <p class="mt-4 text-sub">
      mt ranked collects only what it needs to run races, keep ratings fair and keep your account working. we don't sell your data,
      show ads or use third-party analytics or tracking.
    </p>
  </section>

  <section>
    <h2 class="mb-3 text-xl">what we collect</h2>
    <ul class="list-inside list-disc space-y-1 text-sub">
      <li><span class="text-text">account details:</span> your email, display name and password (stored only as a secure hash).</li>
      <li><span class="text-text">races:</span> the text, your keystrokes and their timing, results, ratings and match history. ranked races are stored as replays.</li>
      <li><span class="text-text">sessions:</span> your IP address and browser user agent for each sign-in, so you can review and sign out devices in settings.</li>
      <li><span class="text-text">fair play:</span> IP addresses and keystroke timing are used to detect cheating and alternate accounts. reports you file or receive are kept for moderators.</li>
      {#if session.supporterSales}<li><span class="text-text">payments:</span> if you become a supporter, Stripe processes your payment. we store your Stripe customer id and subscription status, never your card details.</li>{/if}
    </ul>
  </section>

  <section>
    <h2 class="mb-3 text-xl">cookies and local storage</h2>
    <p class="text-sub">
      we use two essential cookies: <code>mtr_session</code> keeps you signed in (30 days, renewed while you use the site), and
      <code>mtr_guest</code> remembers a guest player (30 days). your settings, like theme and caret style, are saved in your browser's
      local storage. there are no advertising or tracking cookies.
    </p>
  </section>

  <section>
    <h2 class="mb-3 text-xl">what's public</h2>
    <p class="text-sub">
      your display name, profile, level, cosmetics, ratings, tier, leaderboard position, match history and replays can be seen by anyone.
      your email address is never shown to other players.
    </p>
  </section>

  <section>
    <h2 class="mb-3 text-xl">who we share it with</h2>
    <ul class="list-inside list-disc space-y-1 text-sub">
      {#if session.supporterSales}<li>Stripe, to process supporter payments.</li>{/if}
      <li>our email provider, to send verification and password reset emails.</li>
      <li>our hosting provider, which stores the data on our behalf.</li>
      <li>authorities, if the law requires it.</li>
    </ul>
  </section>

  <section>
    <h2 class="mb-3 text-xl">how long we keep it</h2>
    <p class="text-sub">
      account and race data is kept while your account exists. sign-in sessions are removed when you sign out or they expire.
      when you delete your account we remove your personal details; we may keep anonymised race results so other players' ratings and
      history stay correct, and records needed to enforce bans or meet legal obligations.
    </p>
  </section>

  <section>
    <h2 class="mb-3 text-xl">your rights</h2>
    <p class="text-sub">
      you can ask for a copy of your data, ask us to correct it, or ask us to delete your account. depending on where you live you may have
      further rights, like objecting to processing or complaining to your data protection authority. mt ranked is not meant for children
      under 13.
    </p>
  </section>

  <section>
    <h2 class="mb-3 text-xl">contact</h2>
    <p class="text-sub">
      for privacy questions or requests,
      {#if __CONTACT_EMAIL__}email <a class="link" href="mailto:{__CONTACT_EMAIL__}">{__CONTACT_EMAIL__}</a>.{:else}contact the site operator.{/if}
      see also our <a class="link" href="/terms">terms of service</a>.
    </p>
  </section>
</div>
