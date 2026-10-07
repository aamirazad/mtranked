<script lang="ts" module>
  export type OtherCaret = { id: string; idx: number; color: string; name?: string; done?: boolean };
</script>

<script lang="ts">
  // Monkeytype-style words view: 3 visible lines, smooth caret, and
  // opponent carets interpolated between server updates with CSS transitions.
  import { tick, untrack } from "svelte";
  import { BACKSPACE, WORD_DELETE, type TypingState } from "@mtr/engine";
  import Caret from "./Caret.svelte";

  let {
    ts,
    active = true,
    blurred = false,
    carets = [],
    caretColor = "#e2b714",
    caretShape = "line",
    showOwnCaret = true,
    onkey,
    lines = 3,
  }: {
    ts: TypingState;
    active?: boolean;
    blurred?: boolean;
    carets?: OtherCaret[];
    caretColor?: string;
    caretShape?: string;
    showOwnCaret?: boolean;
    onkey?: (key: string) => void;
    lines?: number;
  } = $props();

  let inputs = $state<string[]>([]);
  let wi = $state(0);
  const wordEls: HTMLElement[] = [];
  let inputEl: HTMLInputElement | undefined = $state();
  let wrapper: HTMLElement | undefined = $state();
  let focused = $state(false);
  let typing = $state(false);
  let typingTimer: ReturnType<typeof setTimeout> | undefined;

  let caretPos = $state({ x: 0, y: 0, h: 0 });
  let scroll = $state(0);
  let lineH = $state(48);
  let layoutVersion = $state(0);

  /** Re-read the engine state after the parent applied keys. */
  export function sync(all = false) {
    const from = all ? 0 : Math.max(0, Math.min(wi, ts.wi) - 1);
    const to = all ? ts.words.length - 1 : Math.max(wi, ts.wi);
    for (let i = from; i <= to; i++) {
      const v = ts.inputs[i] ?? "";
      if (inputs[i] !== v) inputs[i] = v;
    }
    if (all) inputs.length = ts.words.length;
    wi = ts.wi;
    typing = true;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => (typing = false), 600);
    void tick().then(measure);
  }

  export function focus() {
    inputEl?.focus({ preventScroll: true });
  }

  // reset whenever a new text/state is passed in
  $effect(() => {
    const t = ts;
    untrack(() => {
      inputs = t.words.map((_, i) => t.inputs[i] ?? "");
      wi = t.wi;
      scroll = 0;
      void tick().then(() => {
        measure();
        if (active) focus();
      });
    });
  });

  $effect(() => {
    if (active) void tick().then(focus);
  });

  function measure() {
    const el = wordEls[Math.min(wi, ts.words.length - 1)];
    if (!el) return;
    const first = wordEls[0];
    if (first) {
      const cs = getComputedStyle(first);
      lineH = first.offsetHeight + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
    }
    const input = inputs[wi] ?? "";
    caretPos = letterPos(el, ts.finished ? el.children.length : input.length);
    const target = Math.max(0, el.offsetTop - (lines >= 3 ? lineH : 0) - (first?.offsetTop ?? 0));
    if (target !== scroll) scroll = target;
    layoutVersion++;
  }

  function letterPos(wordEl: HTMLElement, letterIdx: number) {
    const letters = wordEl.children as HTMLCollectionOf<HTMLElement>;
    const h = wordEl.offsetHeight;
    if (letters.length === 0) return { x: wordEl.offsetLeft, y: wordEl.offsetTop, h };
    if (letterIdx < letters.length) {
      const l = letters[letterIdx]!;
      return { x: wordEl.offsetLeft + l.offsetLeft, y: wordEl.offsetTop, h };
    }
    const last = letters[letters.length - 1]!;
    return { x: wordEl.offsetLeft + last.offsetLeft + last.offsetWidth, y: wordEl.offsetTop, h };
  }

  /** Text index -> pixel position, for opponent carets. */
  function posForIndex(idx: number) {
    const offs = ts.offsets;
    let lo = 0;
    let hi = offs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (offs[mid]! <= idx) lo = mid;
      else hi = mid - 1;
    }
    const el = wordEls[lo];
    if (!el) return { x: 0, y: 0, h: 0 };
    const word = ts.words[lo]!;
    return letterPos(el, Math.min(idx - offs[lo]!, word.length));
  }

  const otherPositions = $derived.by(() => {
    void layoutVersion;
    return carets.map((c) => ({ ...c, pos: posForIndex(c.idx) }));
  });

  function onkeydown(e: KeyboardEvent) {
    if (!active || !onkey) return;
    // only real keyboard events count (no synthetic/scripted input)
    if (!e.isTrusted) return e.preventDefault();
    if (e.key === "Backspace") {
      e.preventDefault();
      onkey(e.ctrlKey || e.altKey || e.metaKey ? WORD_DELETE : BACKSPACE);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.length === 1) {
      e.preventDefault();
      onkey(e.key);
    }
  }

  // dead keys, IME composition and mobile keyboards land here
  function oninput(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    const v = el.value;
    el.value = "";
    if (!active || !onkey || !e.isTrusted) return;
    for (const ch of v) onkey(ch);
  }

  const block = (e: Event) => e.preventDefault();

  // press any key to refocus (like monkeytype)
  function onwindowkeydown(e: KeyboardEvent) {
    if (!active || focused || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    if (e.key.length === 1 || e.key === "Backspace") {
      focus();
      onkeydown(e);
    }
  }

  function letterClass(word: string, input: string, j: number, isTyped: boolean): string {
    if (j >= word.length) return "extra";
    if (!isTyped || j >= input.length) return "";
    return input[j] === word[j] ? "correct" : "incorrect";
  }
</script>

<svelte:window onkeydown={onwindowkeydown} onresize={() => void tick().then(measure)} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  class="relative select-none"
  style="height: {lineH * lines}px"
  onclick={focus}
  role="textbox"
  tabindex="-1"
>
  <input
    bind:this={inputEl}
    class="absolute top-0 left-0 h-px w-px opacity-0"
    autocomplete="off"
    autocapitalize="off"
    spellcheck="false"
    aria-label="typing input"
    {onkeydown}
    {oninput}
    onpaste={block}
    ondrop={block}
    oncut={block}
    onfocus={() => (focused = true)}
    onblur={() => (focused = false)}
  />
  <div class="h-full overflow-hidden transition-[filter] duration-300" class:blur-sm={blurred || (active && !focused)}>
    <div bind:this={wrapper} class="words relative flex flex-wrap content-start" style="transform: translateY({-scroll}px)">
      {#each ts.words as word, i (i)}
        {@const input = inputs[i] ?? ""}
        {@const isTyped = i <= wi}
        <div bind:this={wordEls[i]} class="word" class:error={i < wi && input !== word}>
          {#each { length: isTyped ? Math.max(word.length, input.length) : word.length } as _, j (j)}
            <span class={letterClass(word, input, j, isTyped)}>{j < word.length ? word[j] : input[j]}</span>
          {/each}
        </div>
      {/each}

      {#each otherPositions as c (c.id)}
        <div
          class="other-caret pointer-events-none absolute"
          style="transform: translate({c.pos.x}px, {c.pos.y}px); height: {c.pos.h}px; --c: {c.color}"
        >
          <div class="bar"></div>
          {#if c.name}<div class="tag">{c.name}</div>{/if}
        </div>
      {/each}

      {#if showOwnCaret && !ts.finished}
        <Caret x={caretPos.x} y={caretPos.y} h={caretPos.h} color={caretColor} shape={caretShape} blink={!typing} />
      {/if}
    </div>
  </div>
  {#if active && !focused && !blurred}
    <div class="pointer-events-none absolute inset-0 flex items-center justify-center text-sub animate-fade">
      click here or press any key to focus
    </div>
  {/if}
</div>

<style>
  .words {
    font-size: 1.65rem;
    line-height: 1.6;
    transition: transform 0.12s ease-out;
  }
  .word {
    position: relative;
    margin: 0.1em 0.3em;
    color: var(--color-sub);
    border-bottom: 2px solid transparent;
  }
  .word.error {
    border-bottom-color: var(--color-error);
  }
  .word span.correct {
    color: var(--color-text);
  }
  .word span.incorrect {
    color: var(--color-error);
  }
  .word span.extra {
    color: var(--color-error-extra);
  }
  .other-caret {
    left: 0;
    top: 0;
    width: 2px;
    transition: transform 0.11s linear;
    will-change: transform;
  }
  .other-caret .bar {
    position: absolute;
    top: 12%;
    height: 76%;
    width: 2px;
    border-radius: 2px;
    background: var(--c);
    opacity: 0.55;
  }
  .other-caret .tag {
    position: absolute;
    top: -0.55em;
    left: 2px;
    font-size: 0.6rem;
    line-height: 1;
    white-space: nowrap;
    color: var(--c);
    opacity: 0.7;
  }
</style>
