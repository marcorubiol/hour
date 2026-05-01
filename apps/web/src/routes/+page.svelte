<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';

  onMount(() => {
    const target = localStorage.getItem('hour_jwt') ? '/booking' : '/login';
    goto(target, { replaceState: true });
  });
</script>

<svelte:head>
  <title>Hour</title>
</svelte:head>
