<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { Mail, X } from "@lucide/svelte";
  import { game } from "#lib/game.svelte.ts";

  // never pop up over a race or a ready check; they wait until it's over
  const busy = $derived(!!game.match || (!!game.race && !game.result));
  const shown = $derived(busy ? [] : game.openInvites.slice(-3));

  function join(code: string) {
    game.dismissInvite(code);
    if (page.url.pathname !== `/room/${code}`) void goto(`/room/${code}`);
  }
</script>

<div class="pointer-events-none fixed bottom-5 left-5 z-50 flex w-80 flex-col gap-2">
  {#each shown as inv (inv.code)}
    <div class="pointer-events-auto animate-rise rounded-lg bg-sub-alt p-4 text-sm shadow-lg" role="alert">
      <div class="flex items-start gap-3">
        <Mail size={18} class="mt-0.5 shrink-0 text-main" />
        <div class="min-w-0 flex-1">
          <div><span class="text-main">{inv.from.name}</span> invited you to {inv.roomName ? `“${inv.roomName}”` : "their room"}</div>
          <div class="text-xs text-sub">{inv.players} player{inv.players === 1 ? "" : "s"} in the room</div>
          <div class="mt-3 flex gap-2">
            <button class="btn btn-main py-1 text-sm" onclick={() => join(inv.code)}>join</button>
            <button class="btn btn-ghost py-1 text-sm" onclick={() => game.dismissInvite(inv.code)}>not now</button>
          </div>
        </div>
        <button class="text-sub hover:text-text" aria-label="dismiss" onclick={() => game.dismissInvite(inv.code)}><X size={14} /></button>
      </div>
    </div>
  {/each}
</div>
