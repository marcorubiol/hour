<script lang="ts">
  import { onMount } from 'svelte';
  import BrandMark from '$lib/components/BrandMark.svelte';
  import { appLocale, t } from '$lib/i18n';

  const locale = appLocale();

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
  <title>{t('offline.title', locale)}</title>
</svelte:head>

<main class="offline">
  <BrandMark size="l" />
  <p class="offline__status">
    {#if online}
      {t('offline.back', locale)} <button type="button" class="offline__retry" onclick={retry}>{t('offline.reload', locale)}</button>
    {:else}
      {t('offline.away', locale)}
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
