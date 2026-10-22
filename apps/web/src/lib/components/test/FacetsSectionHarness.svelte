<script lang="ts">
  /** FacetsSection con su propio QueryClient, para FacetsSection.svelte.test.ts. */
  import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
  import FacetsSection from '../settings/FacetsSection.svelte';

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
</script>

<QueryClientProvider {client}>
  <FacetsSection workspaceId="a0000000-0000-4000-8000-000000000001" />
</QueryClientProvider>
