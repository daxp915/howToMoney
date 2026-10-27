<script lang="ts">
  import SettingsShell from '$lib/components/SettingsShell.svelte';
  let { children } = $props();
</script>

<SettingsShell>{@render children()}</SettingsShell>
