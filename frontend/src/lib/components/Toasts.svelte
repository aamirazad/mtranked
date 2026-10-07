<script lang="ts">
  import { toasts } from "#lib/toast.svelte.ts";
</script>

<div class="pointer-events-none fixed right-5 bottom-5 z-50 flex w-80 flex-col gap-2">
  {#each toasts.list as t (t.id)}
    <button
      class="pointer-events-auto animate-rise rounded-lg px-4 py-3 text-left text-sm shadow-lg"
      class:bg-sub-alt={t.kind === "info"}
      class:bg-error={t.kind === "error"}
      class:text-bg={t.kind !== "info"}
      class:bg-main={t.kind === "success"}
      onclick={() => toasts.dismiss(t.id)}
    >
      {t.text}
    </button>
  {/each}
</div>
