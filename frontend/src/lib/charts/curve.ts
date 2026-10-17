// Small helpers shared by the hand-rolled SVG charts.

/**
 * Monotone cubic (Fritsch–Carlson / d3's curveMonotoneX) path through the points:
 * smooth, but never overshoots, so a line can't dip below 0 or above a peak.
 * Returns "" for no points.
 */
export function monotonePath(xs: number[], ys: number[]): string {
  const n = Math.min(xs.length, ys.length);
  if (!n) return "";
  const f = (v: number) => v.toFixed(1);
  if (n === 1) return `M${f(xs[0]!)},${f(ys[0]!)}`;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = xs[i + 1]! - xs[i]!;
    d.push(dx ? (ys[i + 1]! - ys[i]!) / dx : 0);
  }
  const m: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) m.push(d[0]!);
    else if (i === n - 1) m.push(d[n - 2]!);
    else {
      const a = d[i - 1]!;
      const b = d[i]!;
      m.push(a * b <= 0 ? 0 : (2 * a * b) / (a + b));
    }
  }
  let path = `M${f(xs[0]!)},${f(ys[0]!)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = (xs[i + 1]! - xs[i]!) / 3;
    path += `C${f(xs[i]! + h)},${f(ys[i]! + m[i]! * h)} ${f(xs[i + 1]! - h)},${f(ys[i + 1]! - m[i + 1]! * h)} ${f(xs[i + 1]!)},${f(ys[i + 1]!)}`;
  }
  return path;
}

/** Close a line path down to a baseline, for an area fill. */
export function areaPath(line: string, x0: number, x1: number, base: number): string {
  return line ? `${line}L${x1.toFixed(1)},${base.toFixed(1)}L${x0.toFixed(1)},${base.toFixed(1)}Z` : "";
}

/** Round "nice" step for about `count` ticks over a span. */
export function niceStep(span: number, count = 4): number {
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const norm = raw / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
}

/** Index of the data point nearest to a pointer x, for evenly spaced points. */
export function nearestIndex(px: number, left: number, width: number, n: number): number {
  if (n < 2 || width <= 0) return 0;
  return Math.max(0, Math.min(n - 1, Math.round(((px - left) / width) * (n - 1))));
}

/** Simple moving average over the previous `k` values (shorter at the start). */
export function movingAverage(vals: number[], k: number): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < vals.length; i++) {
    sum += vals[i]!;
    if (i >= k) sum -= vals[i - k]!;
    out.push(sum / Math.min(i + 1, k));
  }
  return out;
}
