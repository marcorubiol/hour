<script lang="ts">
  import { dev } from '$app/environment';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import Showcase from '$lib/dev/PlaygroundShowcase.svelte';

  onMount(() => {
    if (!dev) goto('/', { replaceState: true });
  });
</script>

<svelte:head>
  <title>Playground — Hour</title>
</svelte:head>

{#if dev}
  <Showcase />
{/if}
