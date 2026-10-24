<script lang="ts">
  import type { Snippet } from "svelte";
  import { areaPath, monotonePath, nearestIndex, niceStep } from "#lib/charts/curve.ts";
  import { ChartHover } from "#lib/charts/hover.svelte.ts";
  import ChartTooltip from "#lib/charts/ChartTooltip.svelte";

  // One value per UTC day, as a line (running totals) or bars (daily counts).
  let {
    days,
    values,
    kind = "bars",
    label,
    tooltip,
  }: {
    /** YYYY-MM-DD, oldest first */
    days: string[];
    values: number[];
    kind?: "line" | "bars";
    /** what a value is, for the screen-reader text */
    label: string;
    /** tooltip body for the hovered day */
    tooltip: Snippet<[number]>;
  } = $props();

  // the days are UTC dates, so format them in UTC or they shift a day west of Greenwich
  const fmtDate = (day: string) =>
    new Date(day).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

  let width = $state(0);
  const hover = new ChartHover();
  const H = 200;
  const pad = { top: 12, right: 12, bottom: 24, left: 40 };

  const innerW = $derived(Math.max(0, width - pad.left - pad.right));
  const innerH = H - pad.top - pad.bottom;
  const n = $derived(values.length);
  const domain = $derived.by(() => {
    const max = Math.max(0, ...values);
    // a line of running totals reads better off a zero baseline only when it starts near zero
    const min = kind === "line" ? Math.min(...values) : 0;
    const step = niceStep(Math.max(1, max - (min > max / 2 ? min : 0)), 4);
    const lo = kind === "line" && min > max / 2 ? Math.floor(min / step) * step : 0;
    const hi = Math.max(Math.ceil(max / step) * step, lo + step);
    return { lo, hi, step: Math.max(1, step) };
  });
  const slot = $derived(n ? innerW / n : 0);
  // bars sit in the middle of their day's slot; a line runs edge to edge
  const x = (i: number) =>
    kind === "bars" ? pad.left + slot * (i + 0.5) : pad.left + (n > 1 ? (i / (n - 1)) * innerW : innerW / 2);
  const y = (v: number) => pad.top + innerH - ((v - domain.lo) / (domain.hi - domain.lo)) * innerH;
  const ticks = $derived.by(() => {
    const out: number[] = [];
    for (let v = domain.lo; v <= domain.hi + 1e-9; v += domain.step) out.push(Math.round(v));
    return out;
  });
  const line = $derived(
    kind === "line" && width
      ? monotonePath(
          values.map((_, i) => x(i)),
          values.map(y),
        )
      : "",
  );
  const area = $derived(areaPath(line, x(0), x(n - 1), pad.top + innerH));
  const barW = $derived(Math.max(1, Math.min(18, slot - 2)));
  /** a bar with a rounded top, square at the baseline */
  function bar(i: number, v: number) {
    const base = pad.top + innerH;
    const top = y(v);
    const x0 = x(i) - barW / 2;
    const x1 = x0 + barW;
    const r = Math.min(2, barW / 2, base - top);
    return `M${x0},${base}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x1 - r}Q${x1},${top} ${x1},${top + r}V${base}Z`;
  }
  const fmtTick = (v: number) => (v >= 10_000 ? `${Math.round(v / 1000)}k` : v.toLocaleString());

  const show = (i: number) => hover.move(i, x(i), y(values[i]!));
  function onmove(e: PointerEvent) {
    if (!n) return;
    const box = (e.currentTarget as SVGElement).getBoundingClientRect();
    const px = e.clientX - box.left;
    show(
      kind === "bars"
        ? Math.max(0, Math.min(n - 1, Math.floor((px - pad.left) / (slot || 1))))
        : nearestIndex(px, pad.left, innerW, n),
    );
  }
  function onkey(e: KeyboardEvent) {
    if (!n) return;
    const i = hover.key(e, n);
    if (i !== null) show(i);
  }
</script>

<div class="relative" bind:clientWidth={width} style="height: {H}px">
  {#if width && n}
    <svg
      {width}
      height={H}
      class="block rounded outline-none focus-visible:ring-2 focus-visible:ring-main/40"
      role="slider"
      tabindex="0"
      aria-label="{label} per day, {fmtDate(days[0]!)} to {fmtDate(days.at(-1)!)}"
      aria-valuemin={1}
      aria-valuemax={n}
      aria-valuenow={(hover.index ?? n - 1) + 1}
      aria-valuetext="{fmtDate(days[hover.index ?? n - 1]!)}: {values[hover.index ?? n - 1]} {label}"
      onpointermove={onmove}
      onpointerleave={() => hover.hide()}
      onkeydown={onkey}
      onblur={() => hover.hide()}
    >
      {#each ticks as t (t)}
        <line x1={pad.left} x2={pad.left + innerW} y1={y(t)} y2={y(t)} class="stroke-sub/15" stroke-width="1" />
        <text x={pad.left - 8} y={y(t)} dy="0.32em" text-anchor="end" class="fill-sub text-[11px] tabular-nums"
          >{fmtTick(t)}</text
        >
      {/each}
      <text x={pad.left} y={H - 6} class="fill-sub text-[11px]">{fmtDate(days[0]!)}</text>
      <text x={pad.left + innerW} y={H - 6} text-anchor="end" class="fill-sub text-[11px]">{fmtDate(days.at(-1)!)}</text
      >
      {#if kind === "line"}
        <path d={area} class="fill-main" fill-opacity="0.12" />
        <path
          d={line}
          fill="none"
          class="stroke-main"
          stroke-width="2"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
      {:else}
        {#each values as v, i (i)}
          {#if v > 0}
            <path d={bar(i, v)} class="fill-main" fill-opacity={hover.shown && hover.index !== i ? 0.55 : 1} />
          {/if}
        {/each}
      {/if}
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
        {#if kind === "line"}
          <circle cx={hover.x.current} cy={hover.y.current} r="4.5" class="fill-main stroke-sub-alt" stroke-width="2" />
        {/if}
      </g>
    </svg>
    <ChartTooltip {hover} {width} top={pad.top}>
      <div class="mb-1 whitespace-nowrap text-sub">{fmtDate(days[hover.index!]!)}</div>
      {@render tooltip(hover.index!)}
    </ChartTooltip>
  {/if}
</div>
