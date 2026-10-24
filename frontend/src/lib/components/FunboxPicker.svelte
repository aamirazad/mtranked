<script lang="ts">
  // Funbox picker: a button that opens a grid of toggleable chips. Funboxes
  // that conflict with the current selection are greyed out. Read-only mode
  // (room guests) just lists the active funboxes.
  import { Dices, PartyPopper, X } from "@lucide/svelte";
  import { FUNBOX_LIST, FUNBOXES, checkFunboxCompatibility, isFunboxId, type FunboxId } from "@mtr/engine";

  let {
    value = [],
    onchange,
    readonly = false,
  }: {
    value?: readonly string[];
    onchange?: (v: FunboxId[]) => void;
    readonly?: boolean;
  } = $props();

  let open = $state(false);
  let root: HTMLElement | undefined = $state();
  const active = $derived(value.filter(isFunboxId));

  function toggle(id: FunboxId) {
    if (active.includes(id)) onchange?.(active.filter((x) => x !== id));
    else if (checkFunboxCompatibility(active, id)) onchange?.([...active, id]);
  }
  function random() {
    const pick = FUNBOX_LIST.filter((f) => f.id !== "no_quit" && !active.includes(f.id));
    onchange?.([pick[Math.floor(Math.random() * pick.length)]!.id]);
  }

  function onwindowclick(e: MouseEvent) {
    if (open && root && !root.contains(e.target as Node)) open = false;
  }
  function onwindowkey(e: KeyboardEvent) {
    if (open && e.key === "Escape") open = false;
  }
  const groups = [
    { label: "visual", items: FUNBOX_LIST.filter((f) => f.kind === "visual") },
    { label: "text", items: FUNBOX_LIST.filter((f) => f.kind === "text") },
  ];
</script>

<svelte:window onclick={onwindowclick} onkeydown={onwindowkey} />

<div class="relative inline-flex flex-wrap items-center gap-1" bind:this={root}>
  {#if readonly}
    <span class="flex items-center gap-1 text-sub"><PartyPopper size={14} /> funbox</span>
    {#if active.length}
      {#each active as id (id)}
        <span class="tip tip-wrap rounded-md bg-bg/50 px-2 py-0.5 text-main" data-tip={FUNBOXES[id].description}
          >{FUNBOXES[id].name}</span
        >
      {/each}
    {:else}
      <span class="text-sub">none</span>
    {/if}
  {:else}
    <button
      class="toggle flex items-center gap-1"
      class:on={active.length > 0}
      onclick={() => (open = !open)}
      aria-expanded={open}
    >
      <PartyPopper size={14} class="shrink-0" />
      <!-- capped so a long selection doesn't push the settings bar onto a second line -->
      <span class="max-w-56 truncate"
        >funbox{#if active.length}: {active.map((id) => FUNBOXES[id].name).join(", ")}{/if}</span
      >
    </button>
    {#if open}
      <div
        class="absolute top-full left-1/2 z-40 mt-2 w-[min(640px,90vw)] -translate-x-1/2 rounded-xl bg-bg p-4 text-left shadow-2xl ring-2 ring-sub-alt animate-fade"
      >
        <div class="mb-3 flex items-center gap-2">
          <span class="label">funbox · practice and private rooms only</span>
          <button class="btn btn-ghost ml-auto px-2 py-1 text-sm" onclick={random}><Dices size={14} /> random</button>
          <button class="btn btn-ghost px-2 py-1 text-sm" onclick={() => onchange?.([])} disabled={!active.length}
            ><X size={14} /> clear</button
          >
        </div>
        {#each groups as g (g.label)}
          <div class="label mt-2 mb-1">{g.label}</div>
          <div class="grid grid-cols-2 gap-1 sm:grid-cols-3">
            {#each g.items as f (f.id)}
              {@const on = active.includes(f.id)}
              {@const ok = on || checkFunboxCompatibility(active, f.id)}
              <button
                class="tip tip-wrap rounded-md px-2 py-1.5 text-left text-sm transition-colors {on
                  ? 'bg-main text-bg'
                  : ok
                    ? 'bg-sub-alt text-text hover:bg-text hover:text-bg'
                    : 'bg-sub-alt/40 text-sub/50'}"
                data-tip={ok ? f.description : `${f.description} (conflicts with the current selection)`}
                disabled={!ok}
                onclick={() => toggle(f.id)}>{f.name}</button
              >
            {/each}
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>
