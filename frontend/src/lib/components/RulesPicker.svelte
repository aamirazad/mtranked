<script lang="ts">
  // Gameplay rules editor (stop on error, confidence, min speed, ...). Used by
  // practice (your own rules) and private rooms (the host's rules apply to
  // everyone). Compact by default: a "rules" toggle showing how many are on.
  import { SlidersHorizontal } from "@lucide/svelte";
  import { CONFIDENCE, DIFFICULTY, STOP_ON_ERROR, describeRules, normalizeRules, type Rules } from "@mtr/engine";

  let {
    rules,
    onchange,
    disabled = false,
    note,
  }: {
    rules: Rules | undefined;
    onchange: (r: Rules | undefined) => void;
    disabled?: boolean;
    /** shown under the editor, e.g. "applies to everyone in the room" */
    note?: string;
  } = $props();

  let open = $state(false);
  const active = $derived(describeRules(rules));

  function set<K extends keyof Rules>(k: K, v: Rules[K]) {
    onchange(normalizeRules({ ...rules, [k]: v }));
  }

  const ROWS: { key: "stopOnError" | "confidence" | "difficulty"; label: string; hint: string; options: readonly string[] }[] = [
    { key: "stopOnError", label: "stop on error", hint: "letter: wrong letters aren't typed. word: you can't move past a wrong word.", options: STOP_ON_ERROR },
    { key: "confidence", label: "confidence", hint: "on: no backspacing into the previous word. max: no backspace at all.", options: CONFIDENCE },
    { key: "difficulty", label: "difficulty", hint: "expert: fail on a wrong word. master: fail on any wrong key.", options: DIFFICULTY },
  ];
  const TOGGLES: { key: "freedom" | "strictSpace" | "lazy"; label: string; hint: string }[] = [
    { key: "freedom", label: "freedom", hint: "backspace into any previous word, even a correct one." },
    { key: "strictSpace", label: "strict space", hint: "a space at the start of a word counts as a mistake." },
    { key: "lazy", label: "lazy mode", hint: "type accented letters without their accents." },
  ];
  const MINS: { key: "minWpm" | "minAcc" | "minBurst"; label: string; hint: string; unit: string; max: number }[] = [
    { key: "minWpm", label: "min speed", hint: "fail if your speed drops below this (from the 5th word).", unit: "wpm", max: 300 },
    { key: "minAcc", label: "min accuracy", hint: "fail if your accuracy drops below this.", unit: "%", max: 100 },
    { key: "minBurst", label: "min burst", hint: "fail if any word is typed slower than this.", unit: "wpm", max: 300 },
  ];
</script>

<div class="text-sm">
  <button
    type="button"
    class="toggle inline-flex items-center gap-1.5"
    class:on={active.length > 0}
    onclick={() => (open = !open)}
    title={active.length ? active.join(", ") : "no rules"}
    aria-expanded={open}
  >
    <SlidersHorizontal size={14} /> rules{active.length ? ` · ${active.length}` : ""}
  </button>

  {#if open}
    <div class="mt-3 rounded-lg bg-bg/40 p-4 text-left animate-fade">
      <fieldset {disabled} class="space-y-3">
        {#each ROWS as r (r.key)}
          {@const value = rules?.[r.key] ?? r.options[0]}
          <div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
            <div>
              <div>{r.label}</div>
              <div class="text-xs text-sub">{r.hint}</div>
            </div>
            <div class="flex gap-1">
              {#each r.options as o (o)}
                <button type="button" class="toggle" class:on={value === o} onclick={() => set(r.key, o as never)}>{o}</button>
              {/each}
            </div>
          </div>
        {/each}
        {#each TOGGLES as r (r.key)}
          {@const on = !!rules?.[r.key]}
          <div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
            <div>
              <div>{r.label}</div>
              <div class="text-xs text-sub">{r.hint}</div>
            </div>
            <div class="flex gap-1">
              <button type="button" class="toggle" class:on={!on} onclick={() => set(r.key, false)}>off</button>
              <button type="button" class="toggle" class:on onclick={() => set(r.key, true)} disabled={r.key === "freedom" && !!rules?.confidence}>on</button>
            </div>
          </div>
        {/each}
        {#each MINS as r (r.key)}
          {@const v = rules?.[r.key] ?? 0}
          <div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
            <div>
              <div>{r.label}</div>
              <div class="text-xs text-sub">{r.hint}</div>
            </div>
            <div class="flex items-center gap-1">
              <button type="button" class="toggle" class:on={!v} onclick={() => set(r.key, 0)}>off</button>
              <input
                class="w-16 rounded-md bg-sub-alt px-2 py-1 text-right tabular-nums outline-none focus:ring-2 focus:ring-main/40"
                type="number"
                min="0"
                max={r.max}
                placeholder="—"
                value={v || ""}
                onchange={(e) => set(r.key, Math.max(0, Math.min(r.max, Number(e.currentTarget.value) || 0)))}
                aria-label={r.label}
              />
              <span class="w-8 text-xs text-sub">{r.unit}</span>
              {#if r.key === "minBurst"}
                <button type="button" class="toggle" class:on={!!rules?.burstFlex} disabled={!v} onclick={() => set("burstFlex", !rules?.burstFlex)} title="easier threshold for long words">flex</button>
              {/if}
            </div>
          </div>
        {/each}
      </fieldset>
      <div class="mt-4 flex items-center justify-between gap-4 text-xs text-sub">
        <span>{note ?? ""}</span>
        {#if active.length && !disabled}<button type="button" class="link" onclick={() => onchange(undefined)}>clear all</button>{/if}
      </div>
    </div>
  {/if}
</div>
