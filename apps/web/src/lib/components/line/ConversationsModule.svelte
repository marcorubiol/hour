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
  import { CONVERSATION_STATUSES, STATUS_LABELS } from '$lib/conversation';

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
    label: STATUS_LABELS[s],
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
          title: 'Already in this project',
          message:
            'This person already has a conversation here — find them in the table (they may sit on another line).',
        });
        return;
      }
      addToast({
        tone: 'danger',
        title: 'Could not add conversation',
        message: err instanceof ApiError ? err.message : String(err),
      });
    },
  });

  function submitAdd() {
    if (!aName.trim()) {
      addToast({ tone: 'warning', title: 'Name required', message: 'Give the contact a name.' });
      return;
    }
    $addMutation.mutate();
  }
</script>

<div class="lcm">
  <div class="lcm__bar">
    <Button size="xs" variant="outline" onclick={openAdd}>Add conversation</Button>
  </div>
  <ConversationTable {filters} personBase={`/h/${workspaceSlug}/person`} />
</div>

<Dialog bind:open={addOpen} title="Add conversation" size="s" onclose={() => (addOpen = false)}>
  <form
    class="lcm__form"
    onsubmit={(e) => {
      e.preventDefault();
      submitAdd();
    }}
  >
    <Input label="Full name" bind:value={aName} required />
    <Input label="Email" type="email" bind:value={aEmail} />
    <Input label="Organization" bind:value={aOrg} />
    <Select label="Status" options={statusOptions} bind:value={aStatus} />
    <Input label="Next action" type="date" bind:value={aNextAt} />
    <Input label="Next action note" bind:value={aNextNote} />
  </form>
  {#snippet actions()}
    <Button variant="outline" onclick={() => (addOpen = false)}>Cancel</Button>
    <Button loading={$addMutation.isPending} onclick={submitAdd}>Add</Button>
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
