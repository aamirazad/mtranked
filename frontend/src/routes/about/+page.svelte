<script lang="ts">
  import { TIERS, PLACEMENT_RACES } from "@mtr/shared";
  import TierBadge from "#lib/components/TierBadge.svelte";
</script>

<svelte:head><title>About · MT Ranked</title></svelte:head>

<div class="mx-auto max-w-[760px] space-y-10 leading-relaxed animate-fade">
  <section>
    <h1 class="font-logo text-4xl">about</h1>
    <p class="mt-4 text-sub">
      mt ranked is competitive typing: ranked 1v1s matched by rating, casual quick matches, and private rooms for
      friends. the server is the referee. it picks the text, receives every keystroke and calculates the result, so
      results come from what you typed, not from what a browser claims.
    </p>
  </section>

  <section>
    <h2 class="mb-3 text-xl">how ranked works</h2>
    <ul class="list-inside list-disc space-y-1 text-sub">
      <li>one format: about 50 common english words, no punctuation, so ratings mean one thing.</li>
      <li>
        ratings use <span class="text-text">Glicko-2</span>. everyone starts at 1500; new players move fast until the
        system is confident.
      </li>
      <li>your first {PLACEMENT_RACES} races are placements. your tier appears after that.</li>
      <li>leaving or disconnecting for more than 15 seconds after the countdown counts as a loss.</li>
      <li>
        seasons last about 3 months. at the end, ratings move partway back to 1500 and you keep a badge for your peak
        tier.
      </li>
      <li>
        nobody online at your level? after a minute you can race a ghost (a recorded race) while you stay in the queue.
      </li>
    </ul>
    <div class="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
      {#each TIERS as t (t.id)}
        <div class="card flex items-center justify-between py-3">
          <TierBadge rating={Math.max(t.min, 0)} showRating={false} />
          <span class="text-xs text-sub">{t.min === -Infinity ? "< 1200" : `${t.min}+`}</span>
        </div>
      {/each}
    </div>
  </section>

  <section>
    <h2 class="mb-3 text-xl">fair play</h2>
    <p class="text-sub">
      pasted and synthetic input is ignored. every ranked race is stored as a replay. races with unnaturally even key
      timing are flagged automatically, and races above 250 wpm are held for review before ratings change. reports go to
      human moderators, and a ban gives back rating to the people who lost to the cheater.
    </p>
  </section>

  <section id="source">
    <h2 class="mb-3 text-xl">credits &amp; source</h2>
    <p class="text-sub">
      mt ranked is built on <a class="link" href="https://github.com/monkeytypegame/monkeytype" rel="noopener"
        >monkeytype</a
      > by Miodec and contributors. its typing feel, wpm and accuracy formulas, word lists, quotes, fonts and theme come from
      that project. thank you!
    </p>
    <p class="mt-3 text-sub">
      like monkeytype, mt ranked is free software under the
      <a class="link" href="https://www.gnu.org/licenses/gpl-3.0.html" rel="noopener">GNU GPL v3.0</a>.
      {#if __SOURCE_URL__}the complete source is at <a class="link" href={__SOURCE_URL__} rel="noopener"
          >{__SOURCE_URL__}</a
        >.{/if}
      mt ranked is not affiliated with monkeytype.com.
    </p>
  </section>
</div>
