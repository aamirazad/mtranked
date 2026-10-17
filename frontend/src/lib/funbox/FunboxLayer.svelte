<script lang="ts">
  // Funbox effects that need the typing position: tts reads the current word,
  // simon says shows the next key, memory hides the words once typing starts
  // (or when its timer runs out). Mounted inside TypingArea.
  import { onDestroy } from "svelte";

  let {
    funbox,
    word = "",
    input = "",
    wi = 0,
    words = 0,
    active = false,
    hide = $bindable(false),
  }: {
    funbox: readonly string[];
    word?: string;
    input?: string;
    wi?: number;
    words?: number;
    active?: boolean;
    hide?: boolean;
  } = $props();

  const tts = $derived(funbox.includes("tts"));
  const simon = $derived(funbox.includes("simon_says"));
  const memory = $derived(funbox.includes("memory"));

  // ---- tts
  const synth = typeof speechSynthesis !== "undefined" ? speechSynthesis : undefined;
  $effect(() => {
    if (!tts || !active || !synth || !word) return;
    void wi;
    synth.cancel();
    synth.speak(new SpeechSynthesisUtterance(word));
  });
  onDestroy(() => synth?.cancel());

  // ---- memory: visible for words^1.2 seconds (min 5) once typing is possible
  let memoryLeft = $state(0);
  $effect(() => {
    if (!memory) return void (hide = false);
    if (!active) return;
    const started = performance.now();
    const total = Math.max(5, Math.round(Math.pow(words, 1.2)));
    memoryLeft = total;
    const id = setInterval(() => {
      memoryLeft = Math.max(0, total - Math.floor((performance.now() - started) / 1000));
      if (memoryLeft === 0) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  });
  $effect(() => {
    if (!memory) return;
    if (wi > 0 || input.length > 0 || (active && memoryLeft === 0)) hide = true;
  });
  // TypingArea remounts this layer for every new text: show the words again
  hide = false;

  const nextKey = $derived(input.length < word.length ? word[input.length]! : "space");
</script>

{#if simon && active}
  <div class="pointer-events-none absolute top-full left-1/2 mt-3 -translate-x-1/2 text-center">
    <div class="label">simon says</div>
    <div class="mt-1 rounded-lg bg-sub-alt px-4 py-2 text-3xl text-main">{nextKey === " " ? "space" : nextKey}</div>
  </div>
{/if}
{#if memory && active && !hide && memoryLeft > 0}
  <div class="pointer-events-none absolute top-full right-0 mt-2 text-sm text-sub">memorise · {memoryLeft}s</div>
{/if}
