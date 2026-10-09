<script lang="ts">
  let {
    x,
    y,
    h,
    color = "#e2b714",
    shape = "line",
    blink = false,
    smooth = true,
    ghost = false,
  }: { x: number; y: number; h: number; color?: string; shape?: string; blink?: boolean; smooth?: boolean; ghost?: boolean } = $props();

  // the default "classic" caret follows the site theme
  const c = $derived(color === "prism" || color === "#e2b714" ? "var(--color-caret)" : color);
</script>

<div
  class="caret {shape}"
  class:blink
  class:smooth
  class:ghost
  class:prism={color === "prism"}
  style="transform: translate({x}px, {y}px); height: {h}px; --c: {c}"
  aria-hidden="true"
></div>

<style>
  .caret {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
    will-change: transform;
  }
  /* someone else's caret: same cosmetic, faded so yours stays the focus */
  .caret.ghost {
    opacity: 0.45;
  }
  .caret.smooth {
    transition: transform 0.08s ease-out;
  }
  .caret::before {
    content: "";
    position: absolute;
    border-radius: 2px;
    background: var(--c);
  }
  .caret.line::before {
    left: -1px;
    top: 14%;
    height: 72%;
    width: 2.5px;
  }
  .caret.block::before {
    left: 0;
    top: 14%;
    height: 72%;
    width: 0.62em;
    font-size: var(--typing-size, 1.65rem);
    opacity: 0.45;
  }
  .caret.underline::before {
    left: 0;
    bottom: 12%;
    height: 2.5px;
    width: 0.62em;
    font-size: var(--typing-size, 1.65rem);
  }
  .caret.outline::before {
    left: 0;
    top: 14%;
    height: 72%;
    width: 0.62em;
    font-size: var(--typing-size, 1.65rem);
    background: transparent;
    border: 2px solid var(--c);
    box-sizing: border-box;
  }
  .caret.prism::before {
    background: linear-gradient(180deg, #ff6b9a, #e2b714, #5ce0a0, #5cb8ff, #a78bfa);
    background-size: 100% 300%;
    animation: prism 2s linear infinite;
  }
  .caret.prism.outline::before {
    background: transparent;
    border-color: var(--color-caret);
  }
  .caret.blink::before {
    animation: blink 1s step-end infinite;
  }
  .caret.prism.blink::before {
    animation:
      blink 1s step-end infinite,
      prism 2s linear infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }
  @keyframes prism {
    to {
      background-position: 0 300%;
    }
  }
</style>
