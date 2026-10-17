<script lang="ts">
  import type { ActivityDay } from "@mtr/contracts";
  import { api } from "#lib/api.ts";

  // GitHub/monkeytype-style calendar of results per UTC day.
  let { name }: { name: string } = $props();

  let year = $state<number | null>(null);
  let data = $state<{ days: ActivityDay[]; from: string; to: string; years: number[] } | null>(null);
  let hovered = $state<{ date: string; count: number; x: number; y: number } | null>(null);

  $effect(() => {
    const n = name;
    const yr = year;
    void api.users.activity({ params: { name: n }, query: yr ? { year: yr } : {} }).then((r) => {
      if (n === name && yr === year && r.status === 200) data = r.body;
    });
  });

  const DAY = 86_400_000;
  const CELL = 12;
  const GAP = 3;
  const LEFT = 34;
  const TOP = 16;
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

  const grid = $derived.by(() => {
    if (!data) return null;
    const counts = new Map(data.days.map((d) => [d.date, d.count]));
    const from = Date.parse(data.from);
    const to = Date.parse(data.to);
    const start = from - new Date(from).getUTCDay() * DAY; // back to sunday
    const cells: { date: string; count: number; col: number; row: number }[] = [];
    const months: { col: number; label: string }[] = [];
    for (let t = start, i = 0; t <= to; t += DAY, i++) {
      if (t < from) continue;
      const d = new Date(t);
      const date = d.toISOString().slice(0, 10);
      const col = Math.floor(i / 7);
      cells.push({ date, count: counts.get(date) ?? 0, col, row: d.getUTCDay() });
      if (d.getUTCDate() === 1 || t === from) {
        if (!months.length || col - months.at(-1)!.col >= 3) months.push({ col, label: MONTHS[d.getUTCMonth()]! });
      }
    }
    const cols = (cells.at(-1)?.col ?? 0) + 1;
    const max = Math.max(1, ...cells.map((c) => c.count));
    return { cells, months, cols, max };
  });
  const total = $derived(data?.days.reduce((a, d) => a + d.count, 0) ?? 0);
  const level = (n: number, max: number) => (n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4)));
  const FILL = [
    "var(--color-bg)",
    "color-mix(in srgb, var(--color-main) 30%, var(--color-bg))",
    "color-mix(in srgb, var(--color-main) 55%, var(--color-bg))",
    "color-mix(in srgb, var(--color-main) 78%, var(--color-bg))",
    "var(--color-main)",
  ];
  const W = $derived(grid ? LEFT + grid.cols * (CELL + GAP) : 0);
  const H = TOP + 7 * (CELL + GAP);
  const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
</script>

<div class="card">
  <div class="mb-4 flex flex-wrap items-center gap-4">
    <select
      class="input w-auto cursor-pointer py-1.5"
      aria-label="period"
      value={year ?? ""}
      onchange={(e) => (year = e.currentTarget.value ? Number(e.currentTarget.value) : null)}
    >
      <option value="">last 12 months</option>
      {#each data?.years ?? [] as y (y)}<option value={y}>{y}</option>{/each}
    </select>
    <span class="text-sub">{total} {total === 1 ? "result" : "results"}</span>
    <span class="ml-auto flex items-center gap-1 text-xs text-sub">
      less
      {#each FILL as f, i (i)}<span class="inline-block h-3 w-3 rounded-sm" style="background: {f}"></span>{/each}
      more
    </span>
  </div>
  {#if grid}
    <div class="relative overflow-x-auto">
      <svg viewBox="0 0 {W} {H}" class="block w-full min-w-[640px]" role="img" aria-label="{total} results in this period">
        {#each grid.months as m (m.col)}
          <text x={LEFT + m.col * (CELL + GAP)} y="10" class="fill-sub text-[9px]">{m.label}</text>
        {/each}
        {#each [[1, "mon"], [3, "wed"], [5, "fri"]] as const as [r, l] (r)}
          <text x="0" y={TOP + r * (CELL + GAP) + CELL - 2} class="fill-sub text-[9px]">{l}</text>
        {/each}
        {#each grid.cells as c (c.date)}
          {@const cx = LEFT + c.col * (CELL + GAP)}
          {@const cy = TOP + c.row * (CELL + GAP)}
          <rect
            x={cx}
            y={cy}
            width={CELL}
            height={CELL}
            rx="2.5"
            style="fill: {FILL[level(c.count, grid.max)]}"
            class="transition-[stroke] duration-100"
            stroke={hovered?.date === c.date ? "var(--color-text)" : "none"}
            role="presentation"
            onpointerenter={() => (hovered = { date: c.date, count: c.count, x: (cx + CELL / 2) / W, y: cy / H })}
            onpointerleave={() => (hovered = null)}
          />
        {/each}
      </svg>
      <div
        class="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-bg px-2.5 py-1.5 text-xs whitespace-nowrap shadow-lg transition-[opacity,left,top] duration-150 ease-out"
        style="left: {(hovered?.x ?? 0) * 100}%; top: calc({(hovered?.y ?? 0) * 100}% - 6px); opacity: {hovered ? 1 : 0}"
      >
        {#if hovered}<span class="text-text">{hovered.count} {hovered.count === 1 ? "result" : "results"}</span> <span class="text-sub">· {fmt(hovered.date)}</span>{/if}
      </div>
    </div>
    <div class="mt-3 text-center text-[11px] text-sub">all activity uses UTC days</div>
  {/if}
</div>
