<script lang="ts">
  import type { StatKind, WpmPoint } from "@mtr/contracts";
  import { api } from "#lib/api.ts";
  import { monotonePath, movingAverage, nearestIndex, niceStep } from "#lib/charts/curve.ts";
  import { ChartHover } from "#lib/charts/hover.svelte.ts";
  import ChartTooltip from "#lib/charts/ChartTooltip.svelte";
  import { fmtDate } from "#lib/format.ts";

  // Every recent result as a dot, with a smoothed 10-result average through them.
  let { name, kind }: { name: string; kind: StatKind | null } = $props();

  let points = $state<WpmPoint[] | null>(null);
  let width = $state(0);
  const hover = new ChartHover();
  const H = 220;
  const pad = { top: 12, right: 12, bottom: 24, left: 40 };
  const AVG = 10;

  $effect(() => {
    const n = name;
    const k = kind;
    points = null;
    hover.hide();
    void api.users.wpmHistory({ params: { name: n }, query: k ? { kind: k } : {} }).then((r) => {
      if (n !== name || k !== kind) return;
      points = r.status === 200 ? r.body.points : [];
    });
  });

  const innerW = $derived(Math.max(0, width - pad.left - pad.right));
  const innerH = H - pad.top - pad.bottom;
  const avg = $derived(
    points
      ? movingAverage(
          points.map((p) => p.wpm),
          AVG,
        )
      : [],
  );
  const domain = $derived.by(() => {
    if (!points?.length) return { lo: 0, hi: 100, step: 25 };
    const ws = points.map((p) => p.wpm);
    const step = niceStep(Math.max(...ws) - Math.min(...ws) || 40, 4);
    const lo = Math.max(0, Math.floor(Math.min(...ws) / step) * step);
    const hi = Math.ceil(Math.max(...ws) / step) * step;
    return { lo, hi: Math.max(hi, lo + step), step };
  });
  const x = (i: number) => pad.left + (points && points.length > 1 ? (i / (points.length - 1)) * innerW : innerW / 2);
  const y = (v: number) => pad.top + innerH - ((v - domain.lo) / (domain.hi - domain.lo)) * innerH;
  const ticks = $derived.by(() => {
    const out: number[] = [];
    for (let v = domain.lo; v <= domain.hi + 1e-9; v += domain.step) out.push(Math.round(v * 10) / 10);
    return out;
  });
  const avgLine = $derived(
    points && width
      ? monotonePath(
          points.map((_, i) => x(i)),
          avg.map(y),
        )
      : "",
  );
  const best = $derived(points?.length ? Math.max(...points.map((p) => p.wpm)) : 0);
  const hp = $derived(hover.index !== null && points ? points[hover.index] : null);

  const show = (i: number) => hover.move(i, x(i), y(points![i]!.wpm), y(avg[i]!));
  function onmove(e: PointerEvent) {
    if (!points || points.length < 2) return;
    const box = (e.currentTarget as SVGElement).getBoundingClientRect();
    show(nearestIndex(e.clientX - box.left, pad.left, innerW, points.length));
  }
  function onkey(e: KeyboardEvent) {
    if (!points?.length) return;
    const i = hover.key(e, points.length);
    if (i !== null) show(i);
  }
</script>

<div class="relative" bind:clientWidth={width} style="height: {H}px">
  {#if points === null}
    <div class="flex h-full items-center justify-center text-sm text-sub">loading…</div>
  {:else if points.length < 2}
    <div class="flex h-full items-center justify-center text-sm text-sub">not enough results yet.</div>
  {:else if width}
    <svg
      {width}
      height={H}
      class="block rounded outline-none focus-visible:ring-2 focus-visible:ring-main/40"
      role="slider"
      tabindex="0"
      aria-label="wpm over the last {points.length} results, best {best}"
      aria-valuemin={1}
      aria-valuemax={points.length}
      aria-valuenow={(hover.index ?? points.length - 1) + 1}
      aria-valuetext="{(hp ?? points.at(-1)!).wpm} wpm"
      onpointermove={onmove}
      onpointerleave={() => hover.hide()}
      onkeydown={onkey}
      onblur={() => hover.hide()}
    >
      {#each ticks as t (t)}
        <line x1={pad.left} x2={pad.left + innerW} y1={y(t)} y2={y(t)} class="stroke-sub/15" stroke-width="1" />
        <text x={pad.left - 8} y={y(t)} dy="0.32em" text-anchor="end" class="fill-sub text-[11px] tabular-nums"
          >{t}</text
        >
      {/each}
      <text x={pad.left} y={H - 6} class="fill-sub text-[11px]">{fmtDate(points[0]!.at)}</text>
      <text x={pad.left + innerW} y={H - 6} text-anchor="end" class="fill-sub text-[11px]">{points.length} results</text
      >
      {#each points as p, i (i)}
        <circle cx={x(i)} cy={y(p.wpm)} r={points.length > 150 ? 2 : 2.75} class="fill-sub" fill-opacity="0.55" />
      {/each}
      <path
        d={avgLine}
        fill="none"
        class="stroke-main"
        stroke-width="2.5"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
      <g class="pointer-events-none" style="opacity: {hover.shown ? 1 : 0}; transition: opacity 0.15s ease-out">
        <line
          x1={hover.x.current}
          x2={hover.x.current}
          y1={pad.top}
          y2={pad.top + innerH}
          class="stroke-sub/60"
          stroke-width="1"
          stroke-dasharray="3 3"
        />
        <circle cx={hover.x.current} cy={hover.y2.current} r="4" class="fill-main stroke-sub-alt" stroke-width="2" />
        <circle cx={hover.x.current} cy={hover.y.current} r="4.5" class="fill-text stroke-sub-alt" stroke-width="2" />
      </g>
    </svg>
    <ChartTooltip {hover} {width} top={pad.top}>
      {#if hp}
        <div class="mb-1 whitespace-nowrap text-sub">{fmtDate(hp.at)} · {hp.kind}</div>
        <div class="flex gap-3 whitespace-nowrap text-text">
          <span>wpm</span><span class="ml-auto tabular-nums">{Math.round(hp.wpm)}</span>
        </div>
        <div class="flex gap-3 whitespace-nowrap text-text">
          <span>acc</span><span class="ml-auto tabular-nums">{Math.round(hp.acc)}%</span>
        </div>
        <div class="flex gap-3 whitespace-nowrap text-main">
          <span>avg {AVG}</span><span class="ml-auto tabular-nums">{Math.round(avg[hover.index!]!)}</span>
        </div>
      {/if}
    </ChartTooltip>
  {/if}
</div>
