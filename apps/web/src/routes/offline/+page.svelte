<script lang="ts">
  import { onMount } from 'svelte';

  let online = $state(true);

  onMount(() => {
    // Show the actual current state on mount, then live-update.
    online = navigator.onLine;
    const onChange = () => (online = navigator.onLine);
    window.addEventListener('online', onChange);
    window.addEventListener('offline', onChange);
    return () => {
      window.removeEventListener('online', onChange);
      window.removeEventListener('offline', onChange);
    };
  });

  function retry() {
    location.reload();
  }
</script>

<svelte:head>
  <title>Hour — Offline</title>
</svelte:head>

<main class="offline">
  <h1 class="offline__brand">Hour</h1>
  <p class="offline__status">
    {#if online}
      You're back online. <button type="button" class="offline__retry" onclick={retry}>Reload</button>
    {:else}
      You're offline. The app will reconnect when your network is back.
    {/if}
  </p>
</main>

<style>
  @layer components {
    .offline {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-block-size: 100vh;
      gap: var(--space-m);
      padding: var(--space-l);
      text-align: center;
    }

    .offline__brand {
      font-size: var(--text-xl);
      font-weight: 700;
      color: var(--primary);
      margin: 0;
    }

    .offline__status {
      max-inline-size: 36ch;
      color: var(--text-color-muted);
      margin: 0;
    }

    .offline__retry {
      background: none;
      border: none;
      padding: 0;
      color: var(--primary);
      text-decoration: underline;
      cursor: pointer;
      font: inherit;
    }
  }
</style>
