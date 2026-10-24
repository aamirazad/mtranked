// Client-side funbox runtime: visual effects (CSS classes), key emulation and
// page-wide effects with teardown. Text-changing funboxes live in @mtr/engine
// so the race server generates the same text. Funbox ids/metadata: @mtr/engine.
import { FUNBOX_IDS, funboxTypingOptions, type FunboxId } from "@mtr/engine";
import "./funbox.css";

type Ids = readonly string[] | undefined | null;
const on = (ids: Ids, id: FunboxId) => !!ids?.includes(id);

/** funboxes that restyle the whole page (body class), not just the typing area */
const GLOBAL: FunboxId[] = ["space_balls", "crt"];

/** Classes for the typing area root. Every rule in funbox.css is scoped under these. */
export function funboxClass(ids: Ids): string {
  if (!ids?.length) return "";
  const cls = ids.filter((id) => (FUNBOX_IDS as readonly string[]).includes(id)).map((id) => `fb-${id}`);
  if (funboxTypingOptions(ids).nospace) cls.push("fb-nospace-layout");
  return cls.join(" ");
}

/** Memory needs every line on screen so it can be memorized. */
export function funboxLines(ids: Ids, lines: number): number {
  return on(ids, "memory") ? Math.max(lines, 6) : lines;
}

/**
 * Turn on page-wide effects; returns the teardown. Call from an $effect so
 * the effects go away when the typing area unmounts or the funbox changes.
 */
export function applyGlobalFunbox(ids: Ids): () => void {
  if (typeof document === "undefined" || !ids?.length) return () => {};
  const added = GLOBAL.filter((id) => on(ids, id)).map((id) => `fb-${id}`);
  if (!added.length) return () => {};
  document.body.classList.add(...added);
  let scan: HTMLDivElement | undefined;
  if (on(ids, "crt")) {
    scan = document.createElement("div");
    scan.className = "fb-crt-scanline";
    document.body.appendChild(scan);
  }
  return () => {
    document.body.classList.remove(...added);
    scan?.remove();
  };
}

const ARROWS: Record<string, string> = {
  ArrowLeft: "←",
  a: "←",
  j: "←",
  ArrowDown: "↓",
  s: "↓",
  k: "↓",
  ArrowUp: "↑",
  w: "↑",
  i: "↑",
  ArrowRight: "→",
  d: "→",
  l: "→",
};

// physical key (e.code) -> what the mirrored qwerty layout types there
const MIRROR_ROWS = ["1234567890", "qwertyuiop", "asdfghjkl;", "zxcvbnm,./"];
const ROW_CODES = [
  ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0"],
  ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI", "KeyO", "KeyP"],
  ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "KeyL", "Semicolon"],
  ["KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN", "KeyM", "Comma", "Period", "Slash"],
];
const MIRROR: Record<string, string> = {};
ROW_CODES.forEach((codes, r) => codes.forEach((c, i) => (MIRROR[c] = MIRROR_ROWS[r]![9 - i]!)));

/**
 * Emulated input for funboxes that remap keys (arrows, 58008's enter,
 * layout mirror). Returns the character to type, or null for normal handling.
 */
export function mapFunboxKey(ids: Ids, e: KeyboardEvent): string | null {
  if (!ids?.length || e.ctrlKey || e.metaKey || e.altKey) return null;
  if (on(ids, "arrows")) return ARROWS[e.key] ?? ARROWS[e.key.toLowerCase()] ?? null;
  if (on(ids, "58008") && e.key === "Enter") return " ";
  if (on(ids, "layout_mirror")) {
    const m = MIRROR[e.code];
    if (!m) return null;
    if (/[a-z]/.test(m)) return e.shiftKey ? m.toUpperCase() : m;
    return e.shiftKey ? null : m;
  }
  return null;
}
