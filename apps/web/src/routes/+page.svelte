<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';

  onMount(() => {
    // Phase 0 has one workspace (marco-rubiol). When multi-workspace
    // switching lands (Phase 1), derive from the JWT's first accepted
    // membership instead of hardcoding.
    const target = localStorage.getItem('hour_jwt') ? '/h/marco-rubiol/' : '/login';
    goto(target, { replaceState: true });
  });
</script>

<svelte:head>
  <title>Hour</title>
</svelte:head>
