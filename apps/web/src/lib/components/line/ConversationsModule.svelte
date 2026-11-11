<script lang="ts">
  /**
   * Conversations module (ADR-056): the line's conversations, in the same
   * two-line rows as the Conversations section (ADR-176, ADR-179): the ONE
   * ConversationTable in its `chat` shape, with a line_id filter (true line
   * scoping, not a project approximation).
   *
   * «+ conversación» opens the shell's one «Añadir conversación»
   * (`CreateConversationDialog`, tarea 135) with this project and this line
   * already checked, instead of a form of its own.
   */

  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON } from '$lib/api';
  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import ConversationTable from '$lib/components/ConversationTable.svelte';
  import LineModule from './LineModule.svelte';
  import { conversationAccessQueryOptions } from '$lib/conversation-access';
  import { useCreation } from '$lib/stores/creation.svelte';
  import { appLocale, t } from '$lib/i18n';

  interface Props {
    line: {
      id: string;
      slug: string | null;
      name: string;
      kind: string;
      project_id: string;
      workspace_id: string;
    };
    workspaceSlug: string;
    title: string;
  }

  let { line, workspaceSlug, title }: Props = $props();

  const locale = appLocale();
  const creation = useCreation();
  const queryClient = useQueryClient();

  // ADR-124: «+ conversación» only for whoever edits conversations somewhere
  // (the API still decides per project).
  const accessQuery = createQuery(conversationAccessQueryOptions());
  let canEdit = $derived($accessQuery.data?.edit !== false);

  // Whether the line has any, for the one empty line. Under the
  // `conversations` prefix, so any write that refreshes the lists
  // (`refreshAfterWrite`) asks it again.
  const countOptions = toStore(() => {
    const id = line.id;
    return {
      queryKey: ['conversations', 'line-any', id] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ total: number }>(`/api/conversations?line_id=${id}&limit=1`, signal),
    };
  });
  const countQuery = createQuery(countOptions);

  let filters = $derived({ lineId: line.id });

  function add() {
    creation.openConversation({ projectId: line.project_id, lineId: line.id });
  }

  /** After a row's «Ya está» or its undo: the line's head counts again. */
  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['line-eng-stats', line.id] });
    void queryClient.invalidateQueries({ queryKey: ['conversations', 'line-any', line.id] });
  }
</script>

{#snippet action(cls: string)}
  {#if canEdit}
    <button type="button" class={cls} onclick={add}>{t('line.add_conversation', locale)}</button>
  {/if}
{/snippet}

<LineModule {title} empty={$countQuery.isSuccess && $countQuery.data?.total === 0} {action}>
  {#if $countQuery.isPending}
    <EmptyLine text={t('desk.loading', locale)} busy />
  {:else}
    <!-- The line's head already counts them (tarea 131): one «N conversaciones», not two. -->
    <ConversationTable
      counted
      {filters}
      editable={canEdit}
      onchange={refresh}
      personBase={`/h/${workspaceSlug}/person`}
      conversationHref={(item) => `/h/${workspaceSlug}/conversation/${item.id}`}
    />
  {/if}
</LineModule>
