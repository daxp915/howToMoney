<script lang="ts">
  import WealthView from './WealthView.svelte';
  let { data } = $props();
</script>

<svelte:head><title>Wealth · HTMFD</title></svelte:head>

<WealthView {data} />
