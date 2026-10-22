<script lang="ts">
  /** BoloAccess con su propio QueryClient, para BoloAccess.svelte.test.ts. */
  import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
  import BoloAccess from '../BoloAccess.svelte';
  import type { GoingPerson } from '$lib/bolo-access';

  interface Props {
    going?: GoingPerson[];
  }
  let { going = [] }: Props = $props();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
</script>

<QueryClientProvider {client}>
  <BoloAccess boloId="b0000000-0000-4000-8000-000000000001" {going} tz="Europe/Madrid" locale="es" />
</QueryClientProvider>
