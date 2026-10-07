<script lang="ts">
  let { size = "md" }: { size?: "md" | "lg" } = $props();
</script>

<div class="flex items-center gap-2.5">
  <svg viewBox="0 0 64 64" class={size === "lg" ? "h-12 w-12" : "h-8 w-8"} aria-hidden="true">
    <rect x="4" y="10" width="56" height="44" rx="11" fill="none" stroke="currentColor" stroke-width="4" class="text-main" />
    <path d="M17 40V24l7.5 9 7.5-9v16M39 24h11M44.5 24v16" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" class="text-main" />
  </svg>
  <div class="leading-none">
    <div class="font-logo text-[0.6rem] tracking-wider text-sub transition-colors group-hover:text-text">typing, but competitive</div>
    <div class="font-logo {size === 'lg' ? 'text-4xl' : 'text-[1.7rem]'} text-text">mt ranked</div>
  </div>
</div>
