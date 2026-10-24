<script lang="ts">
  import { session } from "#lib/session.svelte.ts";
</script>

<svelte:head><title>Terms of Service · MT Ranked</title></svelte:head>

<div class="mx-auto max-w-[760px] space-y-10 leading-relaxed animate-fade">
  <section>
    <h1 class="font-logo text-4xl">terms of service</h1>
    <p class="mt-2 text-xs text-sub">last updated October 8, 2026</p>
    <p class="mt-4 text-sub">
      by using mt ranked you agree to these terms. if you don't agree, please don't use the site. we may update these
      terms; if we make a significant change we'll update the date above, and continuing to use the site means you
      accept the new version.
    </p>
  </section>

  <section>
    <h2 class="mb-3 text-xl">your account</h2>
    <ul class="list-inside list-disc space-y-1 text-sub">
      <li>you can play as a guest, but ranked needs an account with a verified email.</li>
      <li>you're responsible for keeping your password safe and for everything done with your account.</li>
      <li>one ranked account per person. don't share accounts or play ranked on someone else's.</li>
      <li>display names must not impersonate others or be offensive. we may rename accounts that break this rule.</li>
    </ul>
  </section>

  <section>
    <h2 class="mb-3 text-xl">fair play</h2>
    <p class="text-sub">you must type every race yourself, on a normal keyboard, without help. that means no:</p>
    <ul class="mt-2 list-inside list-disc space-y-1 text-sub">
      <li>macros, scripts, bots, autotypers or any tool that types or alters input for you;</li>
      <li>alternate accounts to manipulate ratings, or deliberately losing to boost someone else;</li>
      <li>exploiting bugs, or interfering with the servers or other players' connections.</li>
    </ul>
    <p class="mt-3 text-sub">
      races are checked automatically and by human moderators. we may void results, reset ratings, restrict or ban
      accounts that break these rules, at our discretion. if you think a decision was wrong, contact us below.
    </p>
  </section>

  <section>
    <h2 class="mb-3 text-xl">conduct</h2>
    <p class="text-sub">
      don't harass other players, and don't use room names or any other text you can set to post anything illegal,
      hateful or explicit.
    </p>
  </section>

  {#if session.supporterSales}
    <section>
      <h2 class="mb-3 text-xl">supporter subscriptions</h2>
      <ul class="list-inside list-disc space-y-1 text-sub">
        <li>payments are handled by Stripe. subscriptions renew automatically until you cancel.</li>
        <li>
          you can cancel any time from settings. you keep supporter perks until the end of the period you've paid for.
        </li>
        <li>payments are non-refundable except where the law requires otherwise.</li>
        <li>
          perks are cosmetic and convenience features. we may change them, and an account banned for cheating loses them
          without a refund.
        </li>
      </ul>
    </section>
  {/if}

  <section>
    <h2 class="mb-3 text-xl">the software</h2>
    <p class="text-sub">
      mt ranked's source code is free software under the GNU GPL v3.0. these terms cover your use of this hosted site,
      and don't limit the rights the GPL gives you over the code.
    </p>
  </section>

  <section>
    <h2 class="mb-3 text-xl">no warranty</h2>
    <p class="text-sub">
      the site is provided "as is", without guarantees that it will always be available, bug-free, or that ratings and
      history will be kept forever. to the fullest extent the law allows, we aren't liable for any indirect or
      consequential loss from using the site.
    </p>
  </section>

  <section>
    <h2 class="mb-3 text-xl">ending things</h2>
    <p class="text-sub">
      you can stop using mt ranked at any time and ask us to delete your account. we may suspend or close accounts that
      break these terms.
    </p>
  </section>

  <section>
    <h2 class="mb-3 text-xl">contact</h2>
    <p class="text-sub">
      questions about these terms?
      {#if __CONTACT_EMAIL__}email <a class="link" href="mailto:{__CONTACT_EMAIL__}">{__CONTACT_EMAIL__}</a
        >.{:else}contact the site operator.{/if}
      see also our <a class="link" href="/privacy">privacy policy</a>.
    </p>
  </section>
</div>
