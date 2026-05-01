<script lang="ts">
  import { dev } from '$app/environment';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import * as Sentry from '@sentry/sveltekit';

  // Dev-only by default. In production, accessible via ?force=1 so we can
  // run the same smoke test against the deployed Worker without exposing
  // the test routes to drive-by traffic.
  let allowed = $state(true);

  onMount(() => {
    if (!dev && page.url.searchParams.get('force') !== '1') {
      allowed = false;
      goto('/', { replaceState: true });
    }
  });

  let lastResult = $state('');

  function throwClientError() {
    // Capture explicitly because click handlers don't bubble through
    // SvelteKit's handleError. captureException always works.
    const err = new Error(
      `Hour client smoke ${new Date().toISOString()}`,
    );
    Sentry.captureException(err);
    lastResult = `Captured client error: "${err.message}"`;
  }

  async function hitServerError() {
    lastResult = 'Hitting /api/sentry-test...';
    const target = dev ? '/api/sentry-test' : '/api/sentry-test?force=1';
    try {
      const res = await fetch(target);
      lastResult = `Server responded ${res.status} (expected 500). Check Sentry.`;
    } catch (err) {
      lastResult = `Network error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  function throwUncaughtClientError() {
    // Bubbles all the way up to handleError → handleErrorWithSentry.
    setTimeout(() => {
      throw new Error(
        `Hour uncaught client smoke ${new Date().toISOString()}`,
      );
    }, 0);
    lastResult = 'Uncaught error scheduled (check console + Sentry).';
  }
</script>

<svelte:head>
  <title>Sentry smoke — Hour</title>
</svelte:head>

{#if allowed}
  <main>
    <h1 class="h2">Sentry smoke test</h1>
    <p class="text--dark-muted">
      Dev-only. Each button generates a different kind of event so you can
      verify the wiring end-to-end. Errors should appear in your Sentry
      project's Issues list within seconds.
    </p>

    <div class="actions">
      <button class="btn--primary" onclick={throwClientError}>
        1. Captured client error (Sentry.captureException)
      </button>

      <button class="btn--outline" onclick={throwUncaughtClientError}>
        2. Uncaught client error (handleError path)
      </button>

      <button class="btn--outline" onclick={hitServerError}>
        3. Server error (+server.ts throws)
      </button>
    </div>

    {#if lastResult}
      <p class="result">{lastResult}</p>
    {/if}
  </main>

  <style>
    @layer components {
      main {
        max-inline-size: 36rem;
        padding-block: var(--space-xl);
        padding-inline: var(--gutter);
      }
      .actions {
        display: flex;
        flex-direction: column;
        gap: var(--space-s);
        margin-block: var(--space-l);
      }
      .result {
        padding: var(--space-s);
        background: var(--bg-ultra-light);
        border: var(--divider);
        font-family: ui-monospace, SFMono-Regular, monospace;
        font-size: var(--text-s);
      }
    }
  </style>
{/if}
