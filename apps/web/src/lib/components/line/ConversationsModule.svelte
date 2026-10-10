<script lang="ts">
  /**
   * Contacts module (ADR-056) — the line's conversations. Mounts the ONE
   * ConversationTable implementation with a line_id filter (true line
   * scoping, not project approximation), plus a line-scoped "Add conversation"
   * that auto-assigns line_id at capture (the module context is the line —
   * no select needed, unlike the global dialog).
   *
   * 409 conversation_exists: the (workspace, project, person) UNIQUE ignores
   * line_id — the person already has a conversation in this project
   * (possibly on another line). v1 surfaces it honestly instead of
   * silently relinking.
   */

  import { createMutation, useQueryClient } from '@tanstack/svelte-query';
  import ConversationTable from '$lib/components/ConversationTable.svelte';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import Select from '$lib/components/Select.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { mutateJSON, ApiError } from '$lib/api';
  import { CONVERSATION_STATUSES, statusLabel } from '$lib/conversation';
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

  let filters = $derived({ lineId: line.id, status: 'any' as const });

  // ── Add conversation (line-scoped) ────────────────────────────────────
  let addOpen = $state(false);
  let aName = $state('');
  let aEmail = $state('');
  let aOrg = $state('');
  let aStatus = $state('contacted');
  let aNextAt = $state('');
  let aNextNote = $state('');

  const statusOptions = CONVERSATION_STATUSES.map((s) => ({
    value: s,
    label: statusLabel(s, locale),
  }));

  function openAdd() {
    aName = '';
    aEmail = '';
    aOrg = '';
    aStatus = 'contacted';
    aNextAt = '';
    aNextNote = '';
    addOpen = true;
  }

  const addMutation = createMutation({
    mutationFn: () =>
      mutateJSON('POST', '/api/conversations', {
        project_id: line.project_id,
        person: {
          full_name: aName.trim(),
          email: aEmail.trim() || null,
          organization_name: aOrg.trim() || null,
        },
        status: aStatus,
        next_action_at: aNextAt || null,
        next_action_note: aNextNote.trim() || null,
        line_id: line.id,
      }),
    onSuccess: () => {
      addOpen = false;
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
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
    if (!aName.trim()) {
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
    <Button size="xs" variant="outline" onclick={openAdd}>{t('conversations.add', locale)}</Button>
  </div>
  <ConversationTable {filters} personBase={`/h/${workspaceSlug}/person`} />
</div>

<Dialog bind:open={addOpen} title={t('conversations.add', locale)} size="s" onclose={() => (addOpen = false)}>
  <form
    class="lcm__form"
    onsubmit={(e) => {
      e.preventDefault();
      submitAdd();
    }}
  >
    <Input label={t('conversations.full_name', locale)} bind:value={aName} required />
    <Input label={t('conversations.email', locale)} type="email" bind:value={aEmail} />
    <Input label={t('conversations.col_organization', locale)} bind:value={aOrg} />
    <Select label={t('edit.status', locale)} options={statusOptions} bind:value={aStatus} />
    <Input label={t('conversations.col_next_action', locale)} type="date" bind:value={aNextAt} />
    <Input label={t('conversations.next_note', locale)} bind:value={aNextNote} />
  </form>
  {#snippet actions()}
    <Button variant="outline" onclick={() => (addOpen = false)}>{t('create.cancel', locale)}</Button>
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
