<script lang="ts">
  import '../styles/base.css';
  import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
  import { browser } from '$app/environment';
  import { onMount, type Snippet } from 'svelte';
  import { registerServiceWorker } from '$lib/offline';

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();

  // One QueryClient per session. SSR-safe: enabled only on the client to avoid
  // sharing cache across requests when SvelteKit prerenders or runs SSR.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        enabled: browser,
        staleTime: 30_000,
      },
    },
  });

  // Register the SW once after first paint. Helper has its own Playwright,
  // SSR, and browser-support guards; idempotent.
  onMount(() => {
    void registerServiceWorker();
  });
</script>

<QueryClientProvider client={queryClient}>
  {@render children()}
</QueryClientProvider>
