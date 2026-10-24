<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';

  import { resolveLoginTarget } from '$lib/master-view';
  import { cachedSessionUser } from '$lib/offline';
  import { ensureSession } from '$lib/session.svelte';

  onMount(async () => {
    // Default landing is the Desk (/h/desk, ADR-137). Master View (Phase 0.1
    // trabajo #11) can override it with the last Project the user visited,
    // if they opted in via /settings.
    // The home-screen app opens here: with a device cache (ADR-144) it goes
    // straight in, and the /h frame settles the session behind it.
    const probe = ensureSession();
    if (await cachedSessionUser()) {
      goto(resolveLoginTarget(), { replaceState: true });
      return;
    }
    const user = await probe;
    goto(user ? resolveLoginTarget() : '/login', { replaceState: true });
  });
</script>

<svelte:head>
  <title>Hour</title>
</svelte:head>
