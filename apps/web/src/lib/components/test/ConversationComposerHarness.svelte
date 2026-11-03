<script lang="ts">
  /** ConversationComposer con su propio QueryClient, uno por conversación como en la ficha. */
  import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
  import ConversationComposer from '../ConversationComposer.svelte';
  import type { MailAccountsResponse } from '$lib/mail';

  interface Props {
    convId: string;
    mail: MailAccountsResponse;
    outsiders?: string[];
  }
  let { convId, mail, outsiders = ['Laia Puig'] }: Props = $props();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
</script>

<QueryClientProvider {client}>
  {#key convId}
    <ConversationComposer
      conversation={{ id: convId, workspace_id: 'w1', line_id: null, can_edit: true }}
      workspaceSlug="muk-cia"
      recipient={{ full_name: 'Laia Puig', email: 'laia@teatrellum.test' }}
      {outsiders}
      {mail}
      replyTo={null}
      locale="es"
      onsent={() => {}}
    />
  {/key}
</QueryClientProvider>
