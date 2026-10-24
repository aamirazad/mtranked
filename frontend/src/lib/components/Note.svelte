<script lang="ts">
  import type { Note } from "#lib/notes.svelte.ts";

  let { note, class: cls = "" }: { note: Note | null | undefined; class?: string } = $props();
</script>

{#if note}
  <span
    role={note.kind === "error" ? "alert" : "status"}
    class="text-xs animate-fade {note.kind === 'error'
      ? 'text-error'
      : note.kind === 'success'
        ? 'text-main'
        : 'text-sub'} {cls}">{note.text}</span
  >
{/if}
