<script lang="ts">
  /**
   * Contacts module (ADR-056) — the line's conversations. Mounts the ONE
   * ConversationTable implementation with a line_id filter (true line
   * scoping, not project approximation), plus a line-scoped "Add conversation"
   * that auto-assigns line_id at capture (the module context is the line —
   * no select needed, unlike the global dialog).
   *
   * 409 conversation_exists: uniqueness ignores line_id — the person already
   * has a conversation in this project that the caller can see (the shared
   * one, or their own private one; possibly on another line). Someone else's
   * private one never counts (20261011500000). v1 surfaces it honestly
   * instead of silently relinking.
   */

  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import ConversationTable from '$lib/components/ConversationTable.svelte';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { mutateJSON, ApiError } from '$lib/api';
  import { conversationWhoBody } from '$lib/conversation';
  import { organizationNames, organizationsQueryOptions } from '$lib/organizations';
  import { conversationAccessQueryOptions } from '$lib/conversation-access';
  import { toStore } from 'svelte/store';
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
  }

  let { line, workspaceSlug }: Props = $props();

  const queryClient = useQueryClient();
  const locale = appLocale();

  // ADR-124: «Añadir» and its directory autocomplete only for whoever edits
  // conversations somewhere (the API still decides per project).
  const accessQuery = createQuery(conversationAccessQueryOptions());
  let canEdit = $derived($accessQuery.data?.edit !== false);
  const organizationsQuery = createQuery(
    toStore(() => organizationsQueryOptions($accessQuery.data?.edit === true)),
  );
  let orgSuggestions = $derived(organizationNames($organizationsQuery.data?.items ?? [], [line.workspace_id]));
  const orgListId = `lcm-org-list-${Math.random().toString(36).slice(2, 8)}`;

  let filters = $derived({ lineId: line.id, status: 'any' as const });

  // ── Add conversation (line-scoped) ────────────────────────────────────
  let addOpen = $state(false);
  let aName = $state('');
  let aEmail = $state('');
  let aOrg = $state('');
  let aNextAt = $state('');
  let aNextNote = $state('');


  function openAdd() {
    aName = '';
    aEmail = '';
    aOrg = '';
    aNextAt = '';
    aNextNote = '';
    addOpen = true;
  }

  const addMutation = createMutation({
    mutationFn: () =>
      mutateJSON('POST', '/api/conversations', {
        project_id: line.project_id,
        // ADR-102: the person is optional; the organization alone is enough.
        ...conversationWhoBody({ name: aName, email: aEmail, organization: aOrg }),
        next_action_at: aNextAt || null,
        next_action_note: aNextNote.trim() || null,
        line_id: line.id,
      }),
    onSuccess: () => {
      addOpen = false;
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['organizations'] });
      void queryClient.invalidateQueries({ queryKey: ['line-eng-stats'] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        addOpen = false;
        addToast({
          tone: 'warning',
          title: t('line.conv_exists_title', locale),
          message: t('line.conv_exists_msg', locale),
        });
        return;
      }
      addToast({
        tone: 'danger',
        title: t('line.conv_add_error', locale),
        message: err instanceof ApiError ? err.message : String(err),
      });
    },
  });

  function submitAdd() {
    if (!aName.trim() && !aOrg.trim()) {
      addToast({
        tone: 'warning',
        title: t('line.name_required', locale),
        message: t('line.name_required_msg', locale),
      });
      return;
    }
    $addMutation.mutate();
  }
</script>

<div class="lcm">
  <div class="lcm__bar">
    {#if canEdit}
      <Button size="xs" variant="secondary" onclick={openAdd}>{t('conversations.add', locale)}</Button>
    {/if}
  </div>
  <ConversationTable {filters} editable={canEdit} personBase={`/h/${workspaceSlug}/person`} conversationHref={(item) => `/h/${workspaceSlug}/conversation/${item.id}`} />
</div>

<Dialog bind:open={addOpen} title={t('conversations.add', locale)} size="s" onclose={() => (addOpen = false)}>
  <form
    class="lcm__form"
    onsubmit={(e) => {
      e.preventDefault();
      submitAdd();
    }}
  >
    <Input label={t('conversations.col_organization', locale)} bind:value={aOrg} list={orgListId} autocomplete="off" />
    <datalist id={orgListId}>
      {#each orgSuggestions as name (name)}<option value={name}></option>{/each}
    </datalist>
    <Input label={t('conversations.full_name', locale)} bind:value={aName} />
    <Input label={t('conversations.email', locale)} type="email" bind:value={aEmail} />
    <Input label={t('conversations.col_next_action', locale)} type="date" bind:value={aNextAt} />
    <Input label={t('conversations.next_note', locale)} bind:value={aNextNote} />
  </form>
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (addOpen = false)}>{t('create.cancel', locale)}</Button>
    <Button loading={$addMutation.isPending} onclick={submitAdd}>{t('composer.add', locale)}</Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .lcm {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }
    .lcm__bar {
      display: flex;
      justify-content: flex-end;
    }
    .lcm__form {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }
  }
</style>
