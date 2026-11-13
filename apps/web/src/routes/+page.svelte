<script lang="ts">
  import { onMount } from 'svelte';
  import { goto, preloadCode } from '$app/navigation';

  import { cachedSessionUser } from '$lib/offline';
  import { ensureSession } from '$lib/session.svelte';
  import { AHORA_KEY } from '$lib/ahora';

  onMount(async () => {
    // The landing is the Desk (/h/desk, ADR-137), always: Hour no longer
    // remembers the last page (ADR-165). Ahora is no longer a screen
    // (ADR-202 § 5): the day it was left open, the app opens on Hoy too, and
    // the key it left behind goes.
    try {
      localStorage.removeItem(AHORA_KEY);
    } catch {
      /* no storage: nothing to forget */
    }
    // The home-screen app opens here: with a device cache (ADR-144) it goes
    // straight in, and the /h frame settles the session behind it.
    const probe = ensureSession();
    // The landing's code (the /h frame and the lens) loads alongside the
    // probe and the device read, not after them.
    const target = '/h/desk';
    void preloadCode(target).catch(() => {});
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
