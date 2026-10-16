<script lang="ts" module>
  export type OtherCaret = { id: string; idx: number; color: string; shape?: string; name?: string; done?: boolean };
</script>

<script lang="ts">
  // Monkeytype-style words view: 3 visible lines (or all lines, or a one-line
  // tape), smooth caret, and opponent carets interpolated between server
  // updates with CSS transitions. Everything the player can tweak here is
  // cosmetic (see prefs); it never changes which keys count.
  import { tick, untrack } from "svelte";
  import { BACKSPACE, WORD_DELETE, type TypingState } from "@mtr/engine";
  import Caret from "./Caret.svelte";
  import { CARET_MS, prefs } from "#lib/prefs.svelte.ts";
  import { emulateKey } from "#lib/layouts.ts";
  import { playClick, playError } from "#lib/sound.ts";
  import FunboxLayer from "#lib/funbox/FunboxLayer.svelte";
  import { applyGlobalFunbox, funboxClass, funboxLines, mapFunboxKey } from "#lib/funbox/index.ts";

  let {
    ts,
    active = true,
    blurred = false,
    carets = [],
    caretColor = "#e2b714",
    caretShape = "line",
    showOwnCaret = true,
    onkey,
    lines: baseLines = 3,
    allowAllLines = true,
    funbox = [],
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
    /** funbox ids (practice/private rooms only) */
    funbox?: readonly string[];
    /** "show all lines" is skipped for very long texts (time mode) */
    allowAllLines?: boolean;
  } = $props();

  // funbox: page-wide effects are torn down on unmount or when the funbox changes
  $effect(() => applyGlobalFunbox(funbox));
  const lines = $derived(funboxLines(funbox, baseLines));
  let fbHide = $state(false);

  let inputs = $state<string[]>([]);
  let wi = $state(0);
  let inputEl: HTMLInputElement | undefined = $state();
  let wrapper: HTMLElement | undefined = $state();
  // words are the first children of the wrapper (carets come after them)
  const wordEl = (i: number) => wrapper?.children[i] as HTMLElement | undefined;
  let focused = $state(false);
  let typing = $state(false);
  let typingTimer: ReturnType<typeof setTimeout> | undefined;

  let caretPos = $state({ x: 0, y: 0, h: 0 });
  let scroll = $state(0);
  let tapeX = $state(0);
  let boxW = $state(0);
  let lineH = $state(48);
  let layoutVersion = $state(0);

  const tape = $derived(prefs.tapeMode !== "off");
  const allLines = $derived(!tape && prefs.showAllLines && allowAllLines);
  const shownLines = $derived(tape ? 1 : lines);
  /** extra letters aren't drawn, so the caret stops at the word's end */
  const hideExtra = $derived(prefs.blindMode || prefs.hideExtraLetters);
  /** where the tape keeps the caret, as a share of the width */
  const TAPE_MARGIN = 0.4;

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

  // font, size and view preferences change every position
  $effect(() => {
    void [prefs.fontSize, prefs.fontFamily, prefs.tapeMode, prefs.showAllLines, prefs.hideExtraLetters, prefs.blindMode, prefs.indicateTypos, boxW];
    void tick().then(measure);
  });
  // web fonts arrive after first layout
  $effect(() => {
    void prefs.fontFamily;
    void document.fonts?.ready.then(() => measure());
  });

  function measure() {
    const el = wordEl(Math.min(wi, ts.words.length - 1));
    if (!el) return;
    const first = wordEl(0);
    if (first) {
      const cs = getComputedStyle(first);
      lineH = first.offsetHeight + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
    }
    const input = inputs[wi] ?? "";
    const word = ts.words[wi] ?? "";
    caretPos = letterPos(el, ts.finished ? el.children.length : hideExtra ? Math.min(input.length, word.length) : input.length);
    if (tape) {
      scroll = 0;
      const at = prefs.tapeMode === "word" ? el.offsetLeft : caretPos.x;
      tapeX = boxW * TAPE_MARGIN - at;
    } else {
      tapeX = 0;
      const target = allLines ? 0 : Math.max(0, el.offsetTop - (lines >= 3 ? lineH : 0) - (first?.offsetTop ?? 0));
      if (target !== scroll) scroll = target;
    }
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
    // the last visible letter (hidden extras have no box)
    let last = letters[letters.length - 1]!;
    for (let i = letters.length - 1; i > 0 && last.offsetWidth === 0; i--) last = letters[i - 1]!;
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
    const el = wordEl(lo);
    if (!el) return { x: 0, y: 0, h: 0 };
    const word = ts.words[lo]!;
    return letterPos(el, Math.min(idx - offs[lo]!, word.length));
  }

  // matches Caret: the classic and prism carets use the theme colour
  const tagColor = (color: string) => (color === "prism" || color === "#e2b714" ? "var(--color-caret)" : color);

  const otherPositions = $derived.by(() => {
    void layoutVersion;
    return carets.map((c) => ({ ...c, pos: posForIndex(c.idx) }));
  });

  /** Hand a key to the parent, then play the click (or error) sound for what it did. */
  function send(k: string, code?: string) {
    const before = ts.incorrectKeys;
    onkey!(k);
    if (prefs.soundOnError !== "off" && ts.incorrectKeys > before) playError(prefs.soundOnError, prefs.soundVolume);
    else if (prefs.soundOnClick !== "off") playClick(prefs.soundOnClick, prefs.soundVolume, code);
  }

  function onkeydown(e: KeyboardEvent) {
    if (!active || !onkey) return;
    // only real keyboard events count (no synthetic/scripted input)
    if (!e.isTrusted) return e.preventDefault();
    if (e.key === "Backspace") {
      e.preventDefault();
      send(e.ctrlKey || e.altKey || e.metaKey ? WORD_DELETE : BACKSPACE, e.code);
      return;
    }
    const mapped = mapFunboxKey(funbox, e);
    if (mapped) {
      e.preventDefault();
      send(mapped, e.code);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // layout emulation: the physical key types its character on the chosen layout
    const emulated = prefs.layout !== "default" && e.key !== "Dead" ? emulateKey(prefs.layout, e) : null;
    if (emulated) {
      e.preventDefault();
      send(emulated, e.code);
      return;
    }
    if (e.key.length === 1) {
      e.preventDefault();
      send(e.key, e.code);
    }
  }

  // dead keys, IME composition and mobile keyboards land here
  function oninput(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    const v = el.value;
    el.value = "";
    if (!active || !onkey || !e.isTrusted) return;
    // a dead key or IME commit yields a character or two; anything longer is
    // a paste/autofill in disguise and is ignored
    if ([...v].length > 2) return;
    for (const ch of v) send(ch);
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
  class="relative select-none {funboxClass(funbox)}"
  class:fb-hide={fbHide}
  style="{allLines ? '' : `height: ${lineH * shownLines}px;`} --typing-size: {prefs.fontSize}rem"
  bind:clientWidth={boxW}
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
  <div class="h-full transition-[filter] duration-300" class:overflow-hidden={!allLines} class:tape-mask={tape} class:blur-sm={blurred || (active && !focused)}>
    <div
      bind:this={wrapper}
      class="words relative flex content-start"
      class:flex-wrap={!tape}
      class:smooth-scroll={prefs.smoothLineScroll}
      class:flipped={prefs.flipColors}
      class:colorful={prefs.colorfulMode}
      class:blind={prefs.blindMode}
      class:hide-extra={prefs.hideExtraLetters}
      class:hl-word={prefs.highlightMode === "word"}
      class:hl-off={prefs.highlightMode === "off"}
      class:typos-below={prefs.indicateTypos === "below"}
      style="transform: translate({tapeX}px, {-scroll}px)"
    >
      {#each ts.words as word, i (i)}
        {@const input = inputs[i] ?? ""}
        {@const isTyped = i <= wi}
        <div class="word" class:error={i < wi && input !== word} class:typed={i < wi} class:active={i === wi}>
          {#each { length: isTyped ? Math.max(word.length, input.length) : word.length } as _, j (j)}
            {@const cls = letterClass(word, input, j, isTyped)}
            <span class={cls}
              >{j >= word.length || (cls === "incorrect" && prefs.indicateTypos === "replace" && !prefs.blindMode) ? input[j] : word[j]}{#if cls === "incorrect" && prefs.indicateTypos === "below" && !prefs.blindMode}<span
                  class="typo">{input[j]}</span
                >{/if}</span
            >
          {/each}
        </div>
      {/each}

      {#each otherPositions as c (c.id)}
        <div
          class="other-caret pointer-events-none absolute"
          style="transform: translate({c.pos.x}px, {c.pos.y}px); height: {c.pos.h}px; --c: {tagColor(c.color)}"
        >
          <Caret x={0} y={0} h={c.pos.h} color={c.color} shape={c.shape ?? "line"} smooth={false} ghost />
          {#if c.name}<div class="tag">{c.name}</div>{/if}
        </div>
      {/each}

      {#if showOwnCaret && !ts.finished}
        <Caret
          x={caretPos.x}
          y={caretPos.y}
          h={caretPos.h}
          color={caretColor}
          shape={caretShape}
          blink={!typing}
          smooth={prefs.smoothCaret !== "off"}
          speed={CARET_MS[prefs.smoothCaret]}
        />
      {/if}
    </div>
  </div>
  {#if funbox.length}
    {#key ts}
      <FunboxLayer {funbox} word={ts.words[wi]} input={inputs[wi] ?? ""} {wi} words={ts.words.length} active={active && !blurred} bind:hide={fbHide} />
    {/key}
  {/if}
  {#if active && !focused && !blurred}
    <div class="pointer-events-none absolute inset-0 flex items-center justify-center text-sub animate-fade">
      click here or press any key to focus
    </div>
  {/if}
</div>

<style>
  .words {
    font-size: var(--typing-size);
    line-height: 1.6;
    --c-correct: var(--color-text);
    --c-untyped: var(--color-sub);
    --c-incorrect: var(--color-error);
    --c-extra: var(--color-error-extra);
  }
  .words.smooth-scroll {
    transition: transform 0.12s ease-out;
  }
  .tape-mask {
    mask-image: linear-gradient(90deg, transparent, black 12%, black 88%, transparent);
  }
  .words.flipped {
    --c-correct: var(--color-sub);
    --c-untyped: var(--color-text);
  }
  .words.colorful {
    --c-correct: var(--color-main);
  }
  .words.flipped.colorful {
    --c-correct: var(--color-sub);
    --c-untyped: var(--color-main);
  }
  .word {
    position: relative;
    flex-shrink: 0;
    margin: 0.1em 0.3em;
    color: var(--c-untyped);
    border-bottom: 2px solid transparent;
  }
  .word.error {
    border-bottom-color: var(--c-incorrect);
  }
  .word > span {
    position: relative;
  }
  .word > span.correct {
    color: var(--c-correct);
  }
  .word > span.incorrect {
    color: var(--c-incorrect);
  }
  .word > span.extra {
    color: var(--c-extra);
  }
  .typo {
    position: absolute;
    left: 0;
    right: 0;
    top: 1.1em;
    font-size: 0.55em;
    text-align: center;
    color: var(--c-incorrect);
    opacity: 0.8;
  }
  /* blind mode: mistakes look like correct letters */
  .blind .word > span.incorrect {
    color: var(--c-correct);
  }
  .blind .word.error {
    border-bottom-color: transparent;
  }
  .blind .word > span.extra,
  .hide-extra .word > span.extra {
    display: none;
  }
  /* highlight mode off: only mistakes stand out */
  .hl-off .word > span.correct,
  .hl-off.blind .word > span.incorrect {
    color: var(--c-untyped);
  }
  /* highlight mode word: the whole current word lights up, typed words dim again */
  .hl-word .word.typed > span {
    color: var(--c-untyped);
  }
  .hl-word .word.active > span {
    color: var(--c-correct);
  }
  .hl-word:not(.blind) .word.typed.error > span,
  .hl-word:not(.blind) .word.active:has(> span.incorrect) > span {
    color: var(--c-incorrect);
  }
  .other-caret {
    left: 0;
    top: 0;
    width: 2px;
    transition: transform 0.11s linear;
    will-change: transform;
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
