<script lang="ts">
  import { page } from "$app/state";

  let { children } = $props();
</script>

<!-- /watch/A -> /watch/B reuses the page component; remount it so it watches B -->
{#key page.params.name}{@render children()}{/key}
