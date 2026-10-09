<script lang="ts">
  import { page } from "$app/state";

  let { children } = $props();
</script>

<!-- /room/A -> /room/B reuses the page component; remount it so it joins B and drops A's state -->
{#key page.params.code}{@render children()}{/key}
