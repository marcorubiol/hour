<script lang="ts">
  import { onMount } from 'svelte';
  import { goto, preloadCode } from '$app/navigation';

  import { cachedSessionUser } from '$lib/offline';
  import { ensureSession } from '$lib/session.svelte';
  import { AHORA_KEY, ahoraRelaunch } from '$lib/ahora';
  import { viewerTimeZone } from '$lib/datetime';
  import { dayKeyInTz } from '$lib/planner';

  /** Ahora left open today: the home-screen app opens straight in it (ADR-146). */
  function landing(): string {
    try {
      const today = dayKeyInTz(new Date().toISOString(), viewerTimeZone());
      if (ahoraRelaunch(localStorage.getItem(AHORA_KEY), today)) return '/h/desk?mode=ahora';
    } catch {
      /* no storage: the usual door */
    }
    return '/h/desk';
  }

  onMount(async () => {
    // The landing is the Desk (/h/desk, ADR-137), always: Hour no longer
    // remembers the last page (ADR-165).
    // The home-screen app opens here: with a device cache (ADR-144) it goes
    // straight in, and the /h frame settles the session behind it.
    const probe = ensureSession();
    // The landing's code (the /h frame and the lens) loads alongside the
    // probe and the device read, not after them.
    const target = landing();
    void preloadCode(target.split('?')[0]).catch(() => {});
    if (await cachedSessionUser()) {
      goto(target, { replaceState: true });
      return;
    }
    const user = await probe;
    goto(user ? target : '/login', { replaceState: true });
  });
</script>

<svelte:head>
  <title>Hour</title>
</svelte:head>
