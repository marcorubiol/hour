<script lang="ts">
  import '../styles/base.css';
  import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
  import { browser } from '$app/environment';
  import { onMount, type Snippet } from 'svelte';
  import Toast from '$lib/components/Toast.svelte';
  import { prewarmDB, registerServiceWorker } from '$lib/offline';
  import { provideTheme } from '$lib/theme.svelte';

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();

  // Theme context — available to every route. The actual DOM flip on
  // first paint is done by the inline script in app.html (avoids FOIC);
  // this provider keeps the store in sync for the toggle component.
  provideTheme();

  // One QueryClient per session. SSR-safe: enabled only on the client to avoid
  // sharing cache across requests when SvelteKit prerenders or runs SSR.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        enabled: browser,
        staleTime: 30_000,
        // notifyOnChangeProps: 'all' is a correctness setting here, not a perf
        // knob. TanStack's default tracked-props optimisation notifies an
        // observer ONLY when a prop the consumer actually read changes. Our
        // lens pages compute `loading`/`errorMsg` with short-circuiting `||`/
        // `??` chains AND read each feed's `.data` only from inside loops over
        // ANOTHER feed's rows. So while the first feed is still loading, a
        // sibling feed has only `error` tracked; when THAT sibling resolves,
        // status/isLoading/data change but error doesn't, the notification is
        // suppressed, and its Svelte store freezes at isLoading:true forever —
        // the non-deterministic "/h/money stuck on Loading…" bug (a reload
        // cured it). Opting every query out of tracked-props makes each
        // resolution notify unconditionally. Cost is negligible: queries here
        // are lens/page-level, not per-row, and Svelte's own equality checks
        // absorb any redundant notifications.
        notifyOnChangeProps: 'all',
      },
    },
  });

  // Offline scaffold — register SW + open the IndexedDB schema. Both are
  // idempotent and browser-only; helpers have their own guards (Playwright,
  // SSR, no-IDB-support).
  onMount(() => {
    void registerServiceWorker();
    prewarmDB();
  });
</script>

<QueryClientProvider client={queryClient}>
  {@render children()}
</QueryClientProvider>

<!-- App-global toast region (module store in Toast.svelte — any code calls
     addToast()). Lives outside the provider: it renders no queries. -->
<Toast />
