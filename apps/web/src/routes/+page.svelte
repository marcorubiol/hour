<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';

  import { resolveLoginTarget } from '$lib/master-view';
  import { ensureSession } from '$lib/session.svelte';

  onMount(async () => {
    // Phase 0 has hardcoded /h/marco-rubiol/ as the default landing.
    // Master View (Phase 0.1 trabajo #11) can override it with the last
    // Project the user visited, if they opted in via /settings.
    const user = await ensureSession();
    goto(user ? resolveLoginTarget() : '/login', { replaceState: true });
  });
</script>

<svelte:head>
  <title>Hour</title>
</svelte:head>
