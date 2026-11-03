// Replays are stored packed: JSON [[key, ms since the previous key], ...], about half the
// size of [{k, t}, ...] with absolute times.
import type { Keystroke } from "@mtr/engine";

export function packKeys(keys: Keystroke[]): string {
  let last = 0;
  return JSON.stringify(
    keys.map((k) => {
      const d = k.t - last;
      last = k.t;
      return [k.k, d];
    }),
  );
}

export function unpackKeys(raw: unknown): Keystroke[] {
  if (typeof raw !== "string") return [];
  const arr = JSON.parse(raw) as [string, number][];
  let t = 0;
  return arr.map(([k, d]) => ({ k, t: (t += d) }));
}
