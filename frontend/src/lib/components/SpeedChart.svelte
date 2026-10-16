<script lang="ts">
  import type { TimelinePoint } from "@mtr/engine";
  import { areaPath, monotonePath, nearestIndex } from "#lib/charts/curve.ts";
  import { ChartHover } from "#lib/charts/hover.svelte.ts";
  import ChartTooltip from "#lib/charts/ChartTooltip.svelte";

  // wpm (net, so far) and raw (per second) over the race as smooth curves, a red x for
  // every second that had mistakes (right axis) and an optional dashed personal best.
  // `compact` is the small per-opponent sparkline.
  let {
    points,
    max,
    pb,
    compact = false,
    height,
    label = "speed over time",
  }: { points: TimelinePoint[]; max?: number; pb?: number | null; compact?: boolean; height?: number; label?: string } = $props();

  let width = $state(0);
  const hover = new ChartHover();

  const H = $derived(height ?? (compact ? 64 : 240));
  const pad = $derived(compact ? { top: 6, right: 6, bottom: 6, left: 6 } : { top: 14, right: 40, bottom: 28, left: 44 });
  const innerW = $derived(Math.max(0, width - pad.left - pad.right));
  const innerH = $derived(H - pad.top - pad.bottom);

  const yMax = $derived.by(() => {
    const top = Math.max(max ?? 0, pb ?? 0, 1, ...points.map((p) => Math.max(p.wpm, p.raw)));
    const step = top > 150 ? 40 : 20;
    return Math.ceil(top / step) * step || step;
  });
  const errMax = $derived(Math.max(1, ...points.map((p) => p.err)));

  const x = (i: number) => pad.left + (points.length > 1 ? (i / (points.length - 1)) * innerW : innerW / 2);
  const y = (v: number) => pad.top + innerH - (Math.min(v, yMax) / yMax) * innerH;
  const yErr = (n: number) => pad.top + innerH - (n / errMax) * innerH;

  const xs = $derived(width ? points.map((_, i) => x(i)) : []);
  const wpmLine = $derived(width ? monotonePath(xs, points.map((p) => y(p.wpm))) : "");
  const rawLine = $derived(width ? monotonePath(xs, points.map((p) => y(p.raw))) : "");
  const wpmArea = $derived(width && points.length > 1 ? areaPath(wpmLine, x(0), x(points.length - 1), pad.top + innerH) : "");
  const ticks = $derived([0, 1, 2, 3, 4].map((k) => (k * yMax) / 4));
  const errTicks = $derived(errMax <= 4 ? Array.from({ length: errMax + 1 }, (_, i) => i) : [0, Math.round(errMax / 2), errMax]);
  const xTicks = $derived.by(() => {
    const n = points.length;
    const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(innerW / 40))));
    return points.map((_, i) => i).filter((i) => i === n - 1 || (i % every === 0 && n - 1 - i >= every / 2));
  });
  const totalErr = $derived(points.reduce((a, p) => a + p.err, 0));
  const hp = $derived(hover.index !== null ? points[hover.index] : null);
  const gid = `sg${Math.random().toString(36).slice(2, 8)}`;

  function show(i: number) {
    const p = points[i]!;
    hover.move(i, x(i), y(p.wpm), y(p.raw));
  }
  function onmove(e: PointerEvent) {
    if (compact || points.length < 2) return;
    const box = (e.currentTarget as SVGElement).getBoundingClientRect();
    show(nearestIndex(e.clientX - box.left, pad.left, innerW, points.length));
  }
  function onkey(e: KeyboardEvent) {
    const i = hover.key(e, points.length);
    if (i !== null) show(i);
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
      aria-valuenow={compact ? undefined : (hover.index ?? points.length - 1) + 1}
      aria-valuetext={compact ? undefined : `${(hp ?? points.at(-1)!).wpm} wpm, ${(hp ?? points.at(-1)!).raw} raw, ${(hp ?? points.at(-1)!).err} errors`}
      onpointermove={onmove}
      onpointerleave={() => hover.hide()}
      onkeydown={compact ? undefined : onkey}
      onblur={() => hover.hide()}
    >
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="var(--color-main)" stop-opacity={compact ? 0.18 : 0.22} />
          <stop offset="100%" stop-color="var(--color-main)" stop-opacity="0" />
        </linearGradient>
      </defs>
      {#if !compact}
        {#each ticks as t (t)}
          <line x1={pad.left} x2={pad.left + innerW} y1={y(t)} y2={y(t)} class="stroke-sub/15" stroke-width="1" />
          <text x={pad.left - 8} y={y(t)} dy="0.32em" text-anchor="end" class="fill-sub text-[11px] tabular-nums">{t}</text>
        {/each}
        {#each errTicks as t (t)}
          <text x={pad.left + innerW + 8} y={yErr(t)} dy="0.32em" class="fill-sub text-[11px] tabular-nums">{t}</text>
        {/each}
        {#each xTicks as i (i)}
          <text x={x(i)} y={H - 8} text-anchor="middle" class="fill-sub text-[11px] tabular-nums">{i + 1}</text>
        {/each}
        <text transform="translate(10 {pad.top + innerH / 2}) rotate(-90)" text-anchor="middle" class="fill-sub text-[11px]">words per minute</text>
        <text transform="translate({width - 6} {pad.top + innerH / 2}) rotate(90)" text-anchor="middle" class="fill-sub text-[11px]">errors</text>
      {:else}
        <line x1={pad.left} x2={pad.left + innerW} y1={y(0)} y2={y(0)} class="stroke-sub/25" stroke-width="1" />
      {/if}

      <path d={wpmArea} fill="url(#{gid})" />
      {#if pb && !compact}
        <line x1={pad.left} x2={pad.left + innerW} y1={y(pb)} y2={y(pb)} class="stroke-sub" stroke-width="1.5" stroke-dasharray="6 5" />
        <g transform="translate({pad.left + innerW / 2} {y(pb)})">
          <rect x="-34" y="-10" width="68" height="20" rx="5" class="fill-sub-alt stroke-sub/40" />
          <text text-anchor="middle" dy="0.35em" class="fill-sub text-[11px] tabular-nums">pb: {Math.round(pb * 100) / 100}</text>
        </g>
      {/if}
      <path d={rawLine} fill="none" class="stroke-sub" stroke-width={compact ? 1.5 : 2} stroke-linejoin="round" stroke-linecap="round" />
      <path d={wpmLine} fill="none" class="stroke-main" stroke-width={compact ? 1.5 : 2.5} stroke-linejoin="round" stroke-linecap="round" />

      {#each points as p, i (i)}
        {#if p.err}
          {@const cx = x(i)}
          {@const cy = compact ? pad.top + 3 : yErr(p.err)}
          {@const r = compact ? 2.5 : 3.5}
          <path d="M{cx - r},{cy - r}L{cx + r},{cy + r}M{cx + r},{cy - r}L{cx - r},{cy + r}" class="stroke-error" stroke-width="2" stroke-linecap="round" />
        {/if}
      {/each}

      {#if !compact}
        <g style="opacity: {hover.shown ? 1 : 0}; transition: opacity 0.15s ease-out" class="pointer-events-none">
          <line x1={hover.x.current} x2={hover.x.current} y1={pad.top} y2={pad.top + innerH} class="stroke-sub/60" stroke-width="1" stroke-dasharray="3 3" />
          <circle cx={hover.x.current} cy={hover.y2.current} r="4" class="fill-sub stroke-sub-alt" stroke-width="2" />
          <circle cx={hover.x.current} cy={hover.y.current} r="5" class="fill-main stroke-sub-alt" stroke-width="2" />
        </g>
      {/if}
    </svg>

    {#if !compact}
      <ChartTooltip {hover} {width} top={pad.top}>
        {#if hp}
          <div class="mb-1 text-sub">second {hover.index! + 1}</div>
          <div class="flex items-center gap-2 whitespace-nowrap text-text">
            <span class="inline-block h-0.5 w-3 rounded bg-main"></span>wpm <span class="ml-auto pl-3 tabular-nums">{hp.wpm}</span>
          </div>
          <div class="flex items-center gap-2 whitespace-nowrap text-text">
            <span class="inline-block h-0.5 w-3 rounded bg-sub"></span>raw <span class="ml-auto pl-3 tabular-nums">{hp.raw}</span>
          </div>
          {#if hp.err}
            <div class="flex items-center gap-2 whitespace-nowrap text-text">
              <span class="w-3 text-center leading-none text-error">×</span>errors <span class="ml-auto pl-3 tabular-nums">{hp.err}</span>
            </div>
          {/if}
        {/if}
      </ChartTooltip>
    {/if}
  {/if}
</div>
