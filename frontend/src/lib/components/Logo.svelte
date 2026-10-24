<script lang="ts">
  let { size = "md" }: { size?: "md" | "lg" } = $props();
</script>

<div class="flex items-center gap-2.5">
  <svg viewBox="0 0 64 64" class={size === "lg" ? "h-12 w-12" : "h-8 w-8"} aria-hidden="true">
    <rect
      x="4"
      y="10"
      width="56"
      height="44"
      rx="11"
      fill="var(--tile-bg)"
      stroke="var(--color-main)"
      stroke-width="4"
    />
    <path
      d="M13 40V24l5.5 8 5.5-8v16M28 24h10M33 24v16M42 40V24h5a4 4 0 0 1 0 8h-5M46 32l5 8"
      fill="none"
      stroke="var(--tile-fg)"
      stroke-width="4"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
  <div class="leading-none">
    <div class="font-logo text-[0.6rem] tracking-wider text-sub transition-colors group-hover:text-text">
      competitive typing
    </div>
    <div class="font-logo {size === 'lg' ? 'text-4xl' : 'text-[1.7rem]'} text-text">mt ranked</div>
  </div>
</div>
