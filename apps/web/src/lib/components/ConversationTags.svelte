<script lang="ts">
  /**
   * Las etiquetas en la ficha de una conversación (ADR-138 § 1, fase 2): de
   * qué va (Difusión, Prensa, Coproducción, las del espacio). Varias a la vez;
   * al menos una. Quien edita la conversación las cambia aquí
   * (`PUT /api/conversations/:id/tags`); el resto solo las ve.
   *
   * La etiqueta nunca da ni quita acceso: cambiarla solo cambia en qué chip
   * de la lente sale.
   */

  import BlockHead from '$lib/components/BlockHead.svelte';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { refreshAfterWrite } from '$lib/query-refresh';
  import { mutateJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Checkbox from '$lib/components/Checkbox.svelte';
  import ConversationTagList from '$lib/components/ConversationTagList.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { tagLabel, workspaceTags } from '$lib/conversation-tags';
  import { conversationTagsQueryOptions } from '$lib/conversation-tags-query';
  import { t, type Locale } from '$lib/i18n';

  interface Props {
    conversationId: string;
    workspaceId: string;
    /** Las claves que lleva (`ConversationItem.tags`). */
    tags: readonly string[];
    canEdit: boolean;
    locale: Locale;
  }

  let { conversationId, workspaceId, tags, canEdit, locale }: Props = $props();

  const vocabQuery = createQuery(conversationTagsQueryOptions());
  let known = $derived($vocabQuery.data ? workspaceTags($vocabQuery.data, workspaceId) : []);

  let editing = $state(false);
  let picked = $state<string[]>([]);

  function startEdit() {
    picked = known.filter((x) => tags.includes(x.key)).map((x) => x.id);
    editing = true;
  }

  function toggle(id: string) {
    picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
  }

  const queryClient = useQueryClient();
  const save = createMutation({
    mutationFn: (ids: string[]) => mutateJSON('PUT', `/api/conversations/${conversationId}/tags`, { tag_ids: ids }),
    onSuccess: () => {
      editing = false;
    },
    onError: (err) =>
      addToast({
        tone: 'danger',
        title: t('conversations.tags_not_saved', locale),
        message: err instanceof Error ? err.message : String(err),
      }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['conversation'] });
      void refreshAfterWrite(queryClient, ['conversations']);
      void queryClient.invalidateQueries({ queryKey: ['conversation-overview'] });
    },
  });

  function done() {
    if (picked.length === 0) {
      addToast({ tone: 'warning', message: t('conversations.tags_need_one', locale) });
      return;
    }
    $save.mutate(picked);
  }
</script>

<div class="conv-tags-block" data-testid="conversation-tags">
  <BlockHead title={t('conversations.tags', locale)}>
    {#if canEdit && !editing && known.length > 0}
      <button type="button" class="block-head__act" onclick={startEdit}>{t('conversations.tags_edit', locale)}</button>
    {/if}
  </BlockHead>
  {#if editing}
    <fieldset class="conv-tags-block__pick" aria-label={t('conversations.tags', locale)}>
      {#each known as tag (tag.id)}
        <Checkbox label={tagLabel(tag, locale)} checked={picked.includes(tag.id)} onchange={() => toggle(tag.id)} />
      {/each}
    </fieldset>
    <div class="conv-tags-block__acts">
      <Button size="xs" variant="quiet" onclick={() => (editing = false)}>{t('create.cancel', locale)}</Button>
      <Button size="xs" loading={$save.isPending} onclick={done}>{t('conversations.tags_done', locale)}</Button>
    </div>
  {:else}
    <ConversationTagList {tags} {known} {locale} />
  {/if}
</div>

<style>
  @layer components {
    .conv-tags-block {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }
    .conv-tags-block__pick {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      margin: 0;
      padding: 0;
      border: 0;
    }
    .conv-tags-block__acts {
      display: flex;
      gap: var(--space-xs);
    }
  }
</style>
