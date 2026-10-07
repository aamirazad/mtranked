// Automatic integrity checks on a finished race. These only flag; enforcement
// is done by moderators (or by moving strong cases into the shadow queue).
import { BACKSPACE, WORD_DELETE, type Keystroke } from "@mtr/engine";

export type Flag = { reason: string; details: Record<string, number>; shadow: boolean };

export function analyzeTiming(keys: Keystroke[], recv: number[]): Flag[] {
  const flags: Flag[] = [];
  const typed = keys.filter((k) => k.k !== BACKSPACE && k.k !== WORD_DELETE);
  const iv: number[] = [];
  for (let i = 1; i < typed.length; i++) iv.push(typed[i]!.t - typed[i - 1]!.t);

  if (iv.length >= 40) {
    const mean = iv.reduce((a, b) => a + b, 0) / iv.length;
    const sd = Math.sqrt(iv.reduce((a, b) => a + (b - mean) ** 2, 0) / iv.length);
    const cv = mean > 0 ? sd / mean : 0;
    // human typing has a coefficient of variation well above 0.3
    if (cv < 0.15) flags.push({ reason: "uniform_timing", details: { cv: +cv.toFixed(3), mean: +mean.toFixed(1) }, shadow: true });
  }

  let run = 0;
  let maxRun = 0;
  for (const d of iv) {
    run = d < 15 ? run + 1 : 0;
    maxRun = Math.max(maxRun, run);
  }
  if (maxRun >= 15) flags.push({ reason: "impossible_burst", details: { consecutiveUnder15ms: maxRun }, shadow: true });

  // the client's own clock should roughly agree with when we received keys
  if (keys.length > 20 && recv.length === keys.length) {
    const clientSpan = keys.at(-1)!.t - keys[0]!.t;
    const serverSpan = recv.at(-1)! - recv[0]!;
    if (serverSpan > 5000 && clientSpan < serverSpan * 0.7) {
      flags.push({ reason: "clock_mismatch", details: { clientSpan, serverSpan }, shadow: false });
    }
  }
  return flags;
}
