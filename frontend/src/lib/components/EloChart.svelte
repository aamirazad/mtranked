<script lang="ts">
  import type { RatingPoint } from "@mtr/contracts";
  import { TIERS } from "@mtr/shared";
  import { api } from "#lib/api.ts";

  let { name }: { name: string } = $props();

  let points = $state<RatingPoint[] | null>(null);
  let seasonName = $state("");
  let width = $state(0);
  let hover = $state<number | null>(null);

  $effect(() => {
    const n = name;
    points = null;
    hover = null;
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

  const line = $derived(points ? points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.rating).toFixed(1)}`).join("") : "");
  const area = $derived(
    points && points.length > 1 ? `${line}L${x(points.length - 1).toFixed(1)},${pad.top + innerH}L${x(0).toFixed(1)},${pad.top + innerH}Z` : "",
  );
  const ticks = $derived.by(() => {
    const [lo, hi] = domain;
    const step = hi - lo > 600 ? 200 : hi - lo > 300 ? 100 : 50;
    const out: number[] = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
    return out;
  });
  const tierLines = $derived(TIERS.filter((t) => t.min > domain[0] && t.min < domain[1]));
  const change = $derived(points && points.length > 1 ? points.at(-1)!.rating - points[0]!.rating : 0);

  const hp = $derived(hover !== null && points ? points[hover] : null);
  const hDelta = $derived(hover !== null && hover > 0 && points ? points[hover]!.rating - points[hover - 1]!.rating : null);
  const signed = (n: number) => `${n >= 0 ? "+" : ""}${n}`;

  function onmove(e: PointerEvent) {
    if (!points || points.length < 2) return;
    const box = (e.currentTarget as SVGElement).getBoundingClientRect();
    const t = (e.clientX - box.left - pad.left) / innerW;
    hover = Math.max(0, Math.min(points.length - 1, Math.round(t * (points.length - 1))));
  }
  function onkey(e: KeyboardEvent) {
    if (!points?.length) return;
    const last = points.length - 1;
    if (e.key === "ArrowLeft") hover = Math.max(0, (hover ?? last + 1) - 1);
    else if (e.key === "ArrowRight") hover = Math.min(last, (hover ?? -1) + 1);
    else if (e.key === "Home") hover = 0;
    else if (e.key === "End") hover = last;
    else return;
    e.preventDefault();
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
        aria-valuenow={hover ?? points.length - 1}
        aria-valuetext={`${(hp ?? points.at(-1)!).rating} rating${(hp ?? points.at(-1)!).races ? ` after race ${(hp ?? points.at(-1)!).races}` : " at season start"}`}
        onpointermove={onmove}
        onpointerleave={() => (hover = null)}
        onkeydown={onkey}
        onblur={() => (hover = null)}
      >
        {#each ticks as t (t)}
          <line x1={pad.left} x2={pad.left + innerW} y1={y(t)} y2={y(t)} class="stroke-sub/25" stroke-width="1" />
          <text x={pad.left - 8} y={y(t)} dy="0.32em" text-anchor="end" class="fill-sub text-[11px] tabular-nums">{t}</text>
        {/each}
        {#each tierLines as t (t.id)}
          <line x1={pad.left} x2={pad.left + innerW} y1={y(t.min)} y2={y(t.min)} stroke={t.color} stroke-opacity="0.45" stroke-dasharray="3 4" />
          <text x={pad.left + innerW + 8} y={y(t.min)} dy="0.32em" class="fill-sub text-[11px]">{t.name.toLowerCase()}</text>
        {/each}
        <text x={pad.left} y={H - 6} class="fill-sub text-[11px]">season start</text>
        <text x={pad.left + innerW} y={H - 6} text-anchor="end" class="fill-sub text-[11px]">{points.at(-1)!.races} races</text>

        <path d={area} class="fill-main/10" />
        <path d={line} fill="none" class="stroke-main" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />

        {#if hp && hover !== null}
          <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + innerH} class="stroke-sub" stroke-width="1" />
          <circle cx={x(hover)} cy={y(hp.rating)} r="4.5" class="fill-main stroke-sub-alt" stroke-width="2" />
        {:else}
          <circle cx={x(points.length - 1)} cy={y(points.at(-1)!.rating)} r="4" class="fill-main stroke-sub-alt" stroke-width="2" />
        {/if}
      </svg>

      {#if hp && hover !== null}
        <div
          class="pointer-events-none absolute top-0 rounded-lg bg-bg px-3 py-2 text-xs shadow-lg"
          style="left: {x(hover)}px; transform: translateX({x(hover) > width / 2 ? 'calc(-100% - 10px)' : '10px'})"
        >
          <div class="text-base tabular-nums text-text">
            {hp.rating}
            {#if hDelta !== null}<span class="ml-1 text-xs {hDelta >= 0 ? 'text-win' : 'text-error'}">{signed(hDelta)}</span>{/if}
          </div>
          <div class="whitespace-nowrap text-sub">
            {hp.races ? `race ${hp.races}` : "season start"} · {new Date(hp.at).toLocaleDateString()}
          </div>
        </div>
      {/if}
    {/if}
  </div>
</div>
