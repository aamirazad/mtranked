<script lang="ts">
  // Practice's less-used text options (punctuation, numbers, language) behind
  // one button, so the settings bar keeps a stable width and doesn't wrap.
  import { Type } from "@lucide/svelte";
  import { LANGUAGES, type TextSettings } from "@mtr/engine";

  let {
    punctuation,
    numbers,
    language,
    onchange,
  }: {
    punctuation: boolean;
    numbers: boolean;
    language: TextSettings["language"];
    onchange: <K extends "punctuation" | "numbers" | "language">(k: K, v: TextSettings[K]) => void;
  } = $props();

  let open = $state(false);
  let root: HTMLElement | undefined = $state();

  function onwindowclick(e: MouseEvent) {
    if (open && root && !root.contains(e.target as Node)) open = false;
  }
  function onwindowkey(e: KeyboardEvent) {
    if (open && e.key === "Escape") open = false;
  }
</script>

<svelte:window onclick={onwindowclick} onkeydown={onwindowkey} />

<div class="relative inline-flex" bind:this={root}>
  <!-- @ and # always show (lit when on) so it's clear they live in here -->
  <button class="toggle flex items-center gap-1" onclick={() => (open = !open)} aria-expanded={open}>
    <Type size={14} />
    {language.replace("_", " ")}
    <span class="ml-1 rounded px-1 {punctuation ? 'bg-main/20 text-main' : 'bg-bg/60'}">@</span>
    <span class="rounded px-1 {numbers ? 'bg-main/20 text-main' : 'bg-bg/60'}">#</span>
  </button>
  {#if open}
    <div class="absolute top-full left-1/2 z-40 mt-2 flex w-56 -translate-x-1/2 flex-col gap-1 rounded-xl bg-bg p-3 text-left shadow-2xl ring-2 ring-sub-alt animate-fade">
      <button class="toggle text-left" class:on={punctuation} onclick={() => onchange("punctuation", !punctuation)}>@ punctuation</button>
      <button class="toggle text-left" class:on={numbers} onclick={() => onchange("numbers", !numbers)}># numbers</button>
      <div class="label mt-2 px-2">language</div>
      <select
        class="cursor-pointer rounded-md bg-sub-alt px-2 py-1 text-text outline-none"
        value={language}
        onchange={(e) => onchange("language", e.currentTarget.value as TextSettings["language"])}
      >
        {#each LANGUAGES as l (l)}<option value={l}>{l.replace("_", " ")}</option>{/each}
      </select>
    </div>
  {/if}
</div>
