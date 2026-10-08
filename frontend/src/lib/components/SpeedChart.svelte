<script lang="ts">
  import type { TimelinePoint } from "@mtr/engine";

  // wpm (net, so far) and raw (per second) over the race, with a red x for every
  // second that had mistakes. `compact` is the small per-opponent version.
  let {
    points,
    max,
    compact = false,
    label = "speed over time",
  }: { points: TimelinePoint[]; max?: number; compact?: boolean; label?: string } = $props();

  let width = $state(0);
  let hover = $state<number | null>(null);

  const H = $derived(compact ? 64 : 240);
  const pad = $derived(compact ? { top: 6, right: 6, bottom: 6, left: 6 } : { top: 14, right: 40, bottom: 28, left: 44 });
  const innerW = $derived(Math.max(0, width - pad.left - pad.right));
  const innerH = $derived(H - pad.top - pad.bottom);

  const yMax = $derived.by(() => {
    const top = max ?? Math.max(1, ...points.map((p) => Math.max(p.wpm, p.raw)));
    const step = top > 150 ? 40 : 20;
    return Math.ceil(top / step) * step || step;
  });
  const errMax = $derived(Math.max(1, ...points.map((p) => p.err)));

  const x = (i: number) => pad.left + (points.length > 1 ? (i / (points.length - 1)) * innerW : innerW / 2);
  const y = (v: number) => pad.top + innerH - (Math.min(v, yMax) / yMax) * innerH;
  const yErr = (n: number) => pad.top + innerH - (n / errMax) * innerH;

  /** Monotone cubic through the points, so the curve never overshoots below 0 or past a peak. */
  function smooth(vals: number[]): string {
    const n = vals.length;
    if (!n) return "";
    const xs = vals.map((_, i) => x(i));
    const ys = vals.map(y);
    if (n === 1) return `M${xs[0]},${ys[0]}`;
    const d: number[] = [];
    for (let i = 0; i < n - 1; i++) d.push((ys[i + 1]! - ys[i]!) / (xs[i + 1]! - xs[i]!));
    const m = vals.map((_, i) => {
      if (i === 0) return d[0]!;
      if (i === n - 1) return d[n - 2]!;
      const a = d[i - 1]!;
      const b = d[i]!;
      return a * b <= 0 ? 0 : (2 * a * b) / (a + b);
    });
    let path = `M${xs[0]!.toFixed(1)},${ys[0]!.toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) {
      const h = (xs[i + 1]! - xs[i]!) / 3;
      path += `C${(xs[i]! + h).toFixed(1)},${(ys[i]! + m[i]! * h).toFixed(1)} ${(xs[i + 1]! - h).toFixed(1)},${(ys[i + 1]! - m[i + 1]! * h).toFixed(1)} ${xs[i + 1]!.toFixed(1)},${ys[i + 1]!.toFixed(1)}`;
    }
    return path;
  }

  const wpmLine = $derived(width ? smooth(points.map((p) => p.wpm)) : "");
  const rawLine = $derived(width ? smooth(points.map((p) => p.raw)) : "");
  const ticks = $derived.by(() => {
    const step = yMax / 4;
    return [0, 1, 2, 3, 4].map((k) => k * step);
  });
  const errTicks = $derived(errMax <= 4 ? Array.from({ length: errMax + 1 }, (_, i) => i) : [0, Math.round(errMax / 2), errMax]);
  const xTicks = $derived.by(() => {
    const n = points.length;
    const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(innerW / 36))));
    return points.map((_, i) => i).filter((i) => i === n - 1 || (i % every === 0 && n - 1 - i >= every / 2));
  });
  const totalErr = $derived(points.reduce((a, p) => a + p.err, 0));
  const hp = $derived(hover !== null ? points[hover] : null);

  function onmove(e: PointerEvent) {
    if (compact || points.length < 2) return;
    const box = (e.currentTarget as SVGElement).getBoundingClientRect();
    const t = (e.clientX - box.left - pad.left) / innerW;
    hover = Math.max(0, Math.min(points.length - 1, Math.round(t * (points.length - 1))));
  }
  function onkey(e: KeyboardEvent) {
    const last = points.length - 1;
    if (e.key === "ArrowLeft") hover = Math.max(0, (hover ?? last + 1) - 1);
    else if (e.key === "ArrowRight") hover = Math.min(last, (hover ?? -1) + 1);
    else if (e.key === "Home") hover = 0;
    else if (e.key === "End") hover = last;
    else return;
    e.preventDefault();
  }
</script>

<div class="relative" bind:clientWidth={width} style="height: {H}px">
  {#if width && points.length}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (role is slider whenever tabindex is set) -->
    <svg
      {width}
      height={H}
      class="block overflow-visible rounded outline-none focus-visible:ring-2 focus-visible:ring-main/40"
      role={compact ? "img" : "slider"}
      tabindex={compact ? undefined : 0}
      aria-label="{label}: finished at {points.at(-1)!.wpm} wpm over {points.length}s with {totalErr} mistakes"
      aria-valuemin={compact ? undefined : 1}
      aria-valuemax={compact ? undefined : points.length}
      aria-valuenow={compact ? undefined : (hover ?? points.length - 1) + 1}
      aria-valuetext={compact ? undefined : `${(hp ?? points.at(-1)!).wpm} wpm, ${(hp ?? points.at(-1)!).raw} raw, ${(hp ?? points.at(-1)!).err} errors at second ${(hover ?? points.length - 1) + 1}`}
      onpointermove={onmove}
      onpointerleave={() => (hover = null)}
      onkeydown={compact ? undefined : onkey}
      onblur={() => (hover = null)}
    >
      {#if !compact}
        {#each ticks as t (t)}
          <line x1={pad.left} x2={pad.left + innerW} y1={y(t)} y2={y(t)} class="stroke-sub/20" stroke-width="1" />
          <text x={pad.left - 8} y={y(t)} dy="0.32em" text-anchor="end" class="fill-sub text-[11px] tabular-nums">{t}</text>
        {/each}
        {#each errTicks as t (t)}
          <text x={pad.left + innerW + 8} y={yErr(t)} dy="0.32em" class="fill-sub text-[11px] tabular-nums">{t}</text>
        {/each}
        {#each xTicks as i (i)}
          <text x={x(i)} y={H - 8} text-anchor="middle" class="fill-sub text-[11px] tabular-nums">{i + 1}</text>
        {/each}
        <text transform="translate(10 {pad.top + innerH / 2}) rotate(-90)" text-anchor="middle" class="fill-sub text-[11px]">wpm</text>
        <text transform="translate({width - 6} {pad.top + innerH / 2}) rotate(90)" text-anchor="middle" class="fill-sub text-[11px]">errors</text>
      {:else}
        <line x1={pad.left} x2={pad.left + innerW} y1={y(0)} y2={y(0)} class="stroke-sub/25" stroke-width="1" />
      {/if}

      <path d={rawLine} fill="none" class="stroke-sub" stroke-width={compact ? 1.5 : 2} stroke-linejoin="round" stroke-linecap="round" />
      <path d={wpmLine} fill="none" class="stroke-main" stroke-width={compact ? 1.5 : 2} stroke-linejoin="round" stroke-linecap="round" />

      {#each points as p, i (i)}
        {#if p.err}
          {@const cx = x(i)}
          {@const cy = compact ? pad.top + 3 : yErr(p.err)}
          {@const r = compact ? 2.5 : 3.5}
          <path d="M{cx - r},{cy - r}L{cx + r},{cy + r}M{cx + r},{cy - r}L{cx - r},{cy + r}" class="stroke-error" stroke-width="2" stroke-linecap="round" />
        {/if}
      {/each}

      {#if hp && hover !== null}
        <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + innerH} class="stroke-sub" stroke-width="1" />
        <circle cx={x(hover)} cy={y(hp.raw)} r="4" class="fill-sub stroke-sub-alt" stroke-width="2" />
        <circle cx={x(hover)} cy={y(hp.wpm)} r="4.5" class="fill-main stroke-sub-alt" stroke-width="2" />
      {/if}
    </svg>

    {#if hp && hover !== null}
      <div
        class="pointer-events-none absolute top-0 rounded-lg bg-bg px-3 py-2 text-xs shadow-lg"
        style="left: {x(hover)}px; transform: translateX({x(hover) > width / 2 ? 'calc(-100% - 10px)' : '10px'})"
      >
        <div class="mb-1 text-sub">second {hover + 1}</div>
        <div class="flex items-center gap-2 whitespace-nowrap text-text">
          <span class="inline-block h-0.5 w-3 rounded bg-main"></span>wpm <span class="ml-auto tabular-nums">{hp.wpm}</span>
        </div>
        <div class="flex items-center gap-2 whitespace-nowrap text-text">
          <span class="inline-block h-0.5 w-3 rounded bg-sub"></span>raw <span class="ml-auto tabular-nums">{hp.raw}</span>
        </div>
        {#if hp.err}
          <div class="flex items-center gap-2 whitespace-nowrap text-text">
            <span class="w-3 text-center leading-none text-error">×</span>errors <span class="ml-auto tabular-nums">{hp.err}</span>
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</div>
