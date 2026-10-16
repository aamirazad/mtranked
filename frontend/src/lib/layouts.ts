// Layout emulation (monkeytype's "layout" setting): the physical key you press
// (KeyboardEvent.code) is typed as the character it has on the chosen layout,
// whatever layout the OS uses. Only the emulated character is sent, and only
// from trusted keydown events (see TypingArea).
import { LAYOUTS } from "./layouts.data";

export { LAYOUTS };
export const LAYOUT_IDS = ["default", ...Object.keys(LAYOUTS)];
export const layoutName = (id: string) => (id === "default" ? "off" : (LAYOUTS[id]?.name ?? id));

const ROW1 = ["Backquote", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0", "Minus", "Equal"];
const ROW2 = ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI", "KeyO", "KeyP", "BracketLeft", "BracketRight"];
const ROW3 = ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "KeyL", "Semicolon", "Quote"];
const ROW4 = ["KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN", "KeyM", "Comma", "Period", "Slash"];
const CODES = {
  ansi: [...ROW1, ...ROW2, "Backslash", ...ROW3, ...ROW4],
  iso: [...ROW1, ...ROW2, ...ROW3, "Backslash", "IntlBackslash", ...ROW4],
};

/** The character the key would type on `layoutId`, or null to use the browser's own `e.key`. */
export function emulateKey(layoutId: string, e: KeyboardEvent): string | null {
  const l = LAYOUTS[layoutId];
  if (!l) return null;
  const i = CODES[l.type].indexOf(e.code);
  const pair = l.keys[i];
  if (!pair) return null;
  let shift = e.shiftKey;
  // caps lock only shifts letters
  if (e.getModifierState?.("CapsLock") && pair[0].toLowerCase() !== pair[0].toUpperCase()) shift = !shift;
  return (shift ? pair[1] : pair[0]) || null;
}
