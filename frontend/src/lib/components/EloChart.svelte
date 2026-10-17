<script lang="ts">
  import type { RatingPoint } from "@mtr/contracts";
  import { TIERS } from "@mtr/shared";
  import { api } from "#lib/api.ts";
  import { areaPath, monotonePath, nearestIndex } from "#lib/charts/curve.ts";
  import { ChartHover } from "#lib/charts/hover.svelte.ts";
  import ChartTooltip from "#lib/charts/ChartTooltip.svelte";

  let { name }: { name: string } = $props();

  let points = $state<RatingPoint[] | null>(null);
  let seasonName = $state("");
  let width = $state(0);
  const hover = new ChartHover();

  $effect(() => {
    const n = name;
    points = null;
    hover.hide();
    hover.index = null;
    void api.users.ratingHistory({ params: { name: n } }).then((r) => {
      if (n !== name) return;
      if (r.status === 200) {
        points = r.body.points;
        seasonName = r.body.season.name;
      } else points = [];
    });
  });

  const H = 220;
  const pad = { top: 12, right: 64, bottom: 26, left: 44 };

  const domain = $derived.by(() => {
    if (!points?.length) return [0, 1] as const;
    const rs = points.map((p) => p.rating);
    const lo = Math.floor((Math.min(...rs) - 25) / 50) * 50;
    const hi = Math.ceil((Math.max(...rs) + 25) / 50) * 50;
    return [lo, Math.max(hi, lo + 100)] as const;
  });
  const innerW = $derived(Math.max(0, width - pad.left - pad.right));
  const innerH = H - pad.top - pad.bottom;
  const x = (i: number) => pad.left + (points && points.length > 1 ? (i / (points.length - 1)) * innerW : innerW / 2);
  const y = (r: number) => pad.top + innerH - ((r - domain[0]) / (domain[1] - domain[0])) * innerH;

  const line = $derived(points && width ? monotonePath(points.map((_, i) => x(i)), points.map((p) => y(p.rating))) : "");
  const area = $derived(points && points.length > 1 ? areaPath(line, x(0), x(points.length - 1), pad.top + innerH) : "");
  const ticks = $derived.by(() => {
    const [lo, hi] = domain;
    const step = hi - lo > 600 ? 200 : hi - lo > 300 ? 100 : 50;
    const out: number[] = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
    return out;
  });
  const tierLines = $derived(TIERS.filter((t) => t.min > domain[0] && t.min < domain[1]));
  const change = $derived(points && points.length > 1 ? points.at(-1)!.rating - points[0]!.rating : 0);

  const hp = $derived(hover.index !== null && points ? points[hover.index] : null);
  const hDelta = $derived(hover.index !== null && hover.index > 0 && points ? points[hover.index]!.rating - points[hover.index - 1]!.rating : null);
  const signed = (n: number) => `${n >= 0 ? "+" : ""}${n}`;

  const show = (i: number) => hover.move(i, x(i), y(points![i]!.rating));
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

<div class="card">
  <div class="mb-3 flex items-baseline justify-between gap-4">
    <div class="label">rating over time{seasonName ? ` · ${seasonName}` : ""}</div>
    {#if points && points.length > 1}
      <div class="text-sm text-sub">
        <span class={change >= 0 ? "text-win" : "text-error"}>{signed(change)}</span> this season
      </div>
    {/if}
  </div>

  <div class="relative" bind:clientWidth={width} style="height: {H}px">
    {#if points === null}
      <div class="flex h-full items-center justify-center text-sm text-sub">loading…</div>
    {:else if points.length < 2}
      <div class="flex h-full items-center justify-center text-sm text-sub">no ranked races this season yet.</div>
    {:else if width}
      <svg
        {width}
        height={H}
        class="block rounded outline-none focus-visible:ring-2 focus-visible:ring-main/40"
        role="slider"
        tabindex="0"
        aria-label="rating over {points.length - 1} ranked races, from {points[0]!.rating} to {points.at(-1)!.rating}"
        aria-valuemin={0}
        aria-valuemax={points.length - 1}
        aria-valuenow={hover.index ?? points.length - 1}
        aria-valuetext={`${(hp ?? points.at(-1)!).rating} rating${(hp ?? points.at(-1)!).races ? ` after race ${(hp ?? points.at(-1)!).races}` : " at season start"}`}
        onpointermove={onmove}
        onpointerleave={() => hover.hide()}
        onkeydown={onkey}
        onblur={() => hover.hide()}
      >
        <defs>
          <linearGradient id="elo-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="var(--color-main)" stop-opacity="0.25" />
            <stop offset="100%" stop-color="var(--color-main)" stop-opacity="0" />
          </linearGradient>
        </defs>
        {#each ticks as t (t)}
          <line x1={pad.left} x2={pad.left + innerW} y1={y(t)} y2={y(t)} class="stroke-sub/15" stroke-width="1" />
          <text x={pad.left - 8} y={y(t)} dy="0.32em" text-anchor="end" class="fill-sub text-[11px] tabular-nums">{t}</text>
        {/each}
        {#each tierLines as t (t.id)}
          <line x1={pad.left} x2={pad.left + innerW} y1={y(t.min)} y2={y(t.min)} stroke={t.color} stroke-opacity="0.45" stroke-dasharray="3 4" />
          <text x={pad.left + innerW + 8} y={y(t.min)} dy="0.32em" class="fill-sub text-[11px]">{t.name.toLowerCase()}</text>
        {/each}
        <text x={pad.left} y={H - 6} class="fill-sub text-[11px]">season start</text>
        <text x={pad.left + innerW} y={H - 6} text-anchor="end" class="fill-sub text-[11px]">{points.at(-1)!.races} races</text>

        <path d={area} fill="url(#elo-fill)" />
        <path d={line} fill="none" class="stroke-main" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />

        <circle
          cx={x(points.length - 1)}
          cy={y(points.at(-1)!.rating)}
          r="4"
          class="fill-main stroke-sub-alt"
          stroke-width="2"
          style="opacity: {hover.shown ? 0 : 1}; transition: opacity 0.15s"
        />
        <g class="pointer-events-none" style="opacity: {hover.shown ? 1 : 0}; transition: opacity 0.15s ease-out">
          <line x1={hover.x.current} x2={hover.x.current} y1={pad.top} y2={pad.top + innerH} class="stroke-sub/60" stroke-width="1" stroke-dasharray="3 3" />
          <circle cx={hover.x.current} cy={hover.y.current} r="5" class="fill-main stroke-sub-alt" stroke-width="2" />
        </g>
      </svg>

      <ChartTooltip {hover} {width}>
        {#if hp}
          <div class="text-base tabular-nums text-text">
            {hp.rating}
            {#if hDelta !== null}<span class="ml-1 text-xs {hDelta >= 0 ? 'text-win' : 'text-error'}">{signed(hDelta)}</span>{/if}
          </div>
          <div class="whitespace-nowrap text-sub">
            {hp.races ? `race ${hp.races}` : "season start"} · {new Date(hp.at).toLocaleDateString()}
          </div>
        {/if}
      </ChartTooltip>
    {/if}
  </div>
</div>
