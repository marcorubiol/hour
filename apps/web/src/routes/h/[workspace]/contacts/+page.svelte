<script lang="ts">
  /**
   * Contacts lens — Phase 0.3 item 1, v1 (ADR-044). The difusión work
   * surface inside the shell: engagement list filtered by the sidebar
   * selection (ADR-038 union; empty = everything RLS allows), free-text
   * search over person name/organization, status filter, and the ADR-040
   * inline editors via the shared EngagementTable.
   *
   * "Add contact" (ADR-051) captures a person + conversation in one step:
   * POST /api/engagements with inline person fields — the RPC
   * find-or-creates the person on email, so re-typing a known email links
   * the existing file instead of duplicating it.
   */

  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { page } from '$app/state';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import EngagementTable from '$lib/components/EngagementTable.svelte';
  import Input from '$lib/components/Input.svelte';
  import Select from '$lib/components/Select.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { ENGAGEMENT_STATUSES, statusLabel } from '$lib/engagement';
  import { resolveSelectionIds } from '$lib/selection-filter';
  import { useSelection } from '$lib/stores/selection.svelte';

  type WorkspaceLite = { id: string; slug: string };
  type ProjectLite = { id: string; slug: string; name?: string };

  const selection = useSelection();

  const workspacesQuery = createQuery({
    queryKey: ['workspaces'],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: WorkspaceLite[] }>('/api/workspaces', signal),
  });
  const projectsQuery = createQuery({
    queryKey: ['projects', { status: 'active' }],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: ProjectLite[] }>('/api/projects?status=active', signal),
  });

  let workspacesBySlug = $derived(
    new Map(($workspacesQuery.data?.items ?? []).map((w) => [w.slug, w])),
  );
  let projectsBySlug = $derived(
    new Map(($projectsQuery.data?.items ?? []).map((p) => [p.slug, p])),
  );

  let ids = $derived(resolveSelectionIds(selection, projectsBySlug, workspacesBySlug));

  // Debounced search — the raw input updates instantly, the query key
  // only after the pause.
  let qRaw = $state('');
  let q = $state('');
  $effect(() => {
    const next = qRaw;
    const t = setTimeout(() => {
      q = next.trim();
    }, 300);
    return () => clearTimeout(t);
  });

  let statusFilter = $state('any');
  let statusOptions = [
    { value: 'any', label: 'All statuses' },
    ...ENGAGEMENT_STATUSES.map((s) => ({ value: s, label: statusLabel(s) })),
  ];

  let filters = $derived({
    projectIds: ids.projectIds,
    workspaceIds: ids.workspaceIds,
    q: q || undefined,
    status: statusFilter,
    enabled: !ids.unresolved,
  });

  // ── Add contact (ADR-051) ────────────────────────────────────────────
  const queryClient = useQueryClient();

  let addOpen = $state(false);
  let aProject = $state('');
  let aName = $state('');
  let aEmail = $state('');
  let aPhone = $state('');
  let aOrg = $state('');
  let aStatus = $state('contacted');
  let aNextAt = $state('');
  let aNextNote = $state('');

  let projectOptions = $derived(
    ($projectsQuery.data?.items ?? []).map((p) => ({
      value: p.id,
      label: p.name ?? p.slug,
    })),
  );
  let addStatusOptions = ENGAGEMENT_STATUSES.map((s) => ({
    value: s,
    label: statusLabel(s),
  }));

  function openAdd() {
    // Open fresh every time — leftover text from a cancelled attempt must
    // never ride into a new contact.
    aName = '';
    aEmail = '';
    aPhone = '';
    aOrg = '';
    aNextAt = '';
    aNextNote = '';
    aStatus = ENGAGEMENT_STATUSES[0];
    // Pre-select when the sidebar filter collapses to one project.
    aProject = '';
    const selected = [...selection.effectiveProjects()];
    if (selected.length === 1) {
      aProject = projectsBySlug.get(selected[0])?.id ?? '';
    } else if (projectOptions.length === 1) {
      aProject = projectOptions[0].value;
    }
    addOpen = true;
  }

  const addMutation = createMutation({
    mutationFn: () =>
      mutateJSON<{ engagement: unknown }>('POST', '/api/engagements', {
        project_id: aProject,
        person: {
          full_name: aName.trim(),
          email: aEmail.trim() || null,
          phone: aPhone.trim() || null,
          organization_name: aOrg.trim() || null,
        },
        status: aStatus,
        next_action_at: aNextAt || null,
        next_action_note: aNextNote.trim() || null,
      }),
    onSuccess: () => {
      addOpen = false;
      aName = '';
      aEmail = '';
      aPhone = '';
      aOrg = '';
      aNextAt = '';
      aNextNote = '';
      void queryClient.invalidateQueries({ queryKey: ['engagements'] });
      addToast({ tone: 'success', message: 'Contact added.' });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: 'Contact not added',
        message: `${err instanceof Error ? err.message : 'Unexpected error'}`,
      });
    },
  });

  function submitAdd() {
    if (!aProject) {
      addToast({ tone: 'warning', message: 'Pick a project.' });
      return;
    }
    if (!aName.trim()) {
      addToast({ tone: 'warning', message: 'The contact needs a name.' });
      return;
    }
    $addMutation.mutate();
  }
</script>

<svelte:head>
  <title>Contacts — Hour</title>
</svelte:head>

<section class="contacts">
  <header class="contacts__head">
    <p class="eyebrow">Contacts</p>
    <div class="contacts__controls">
      <div class="contacts__search">
        <Input
          label="Search"
          type="search"
          placeholder="People or organizations…"
          bind:value={qRaw}
        />
      </div>
      <Select label="Status" options={statusOptions} bind:value={statusFilter} />
      <Button size="s" onclick={openAdd}>Add contact</Button>
    </div>
  </header>

  <EngagementTable {filters} personBase={`/h/${page.params.workspace}/person`} />
</section>

<Dialog bind:open={addOpen} title="Add contact" size="m">
  <p class="contacts__dialog-hint">
    A known email links the existing person instead of duplicating it.
  </p>
  <div class="contacts__form-grid">
    <Select label="Project" options={projectOptions} bind:value={aProject} required />
    <Select label="Status" options={addStatusOptions} bind:value={aStatus} />
  </div>
  <div class="contacts__form-grid">
    <Input label="Full name" bind:value={aName} required />
    <Input label="Organization" bind:value={aOrg} placeholder="Theatre, festival…" />
    <Input label="Email" type="email" bind:value={aEmail} />
    <Input label="Phone" type="tel" bind:value={aPhone} />
  </div>
  <div class="contacts__form-grid">
    <Input label="Next action" type="date" bind:value={aNextAt} />
    <Input label="Next action note" bind:value={aNextNote} placeholder="Call back after summer…" />
  </div>
  {#snippet actions()}
    <Button variant="outline" onclick={() => (addOpen = false)}>Cancel</Button>
    <Button onclick={submitAdd} loading={$addMutation.isPending}>Add contact</Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .contacts {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
    }

    .contacts__head {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }

    .contacts__controls {
      display: flex;
      gap: var(--space-m);
      align-items: end;
      flex-wrap: wrap;
    }

    .contacts__search {
      flex: 1;
      min-inline-size: 16rem;
      max-inline-size: 28rem;
    }

    .contacts__dialog-hint {
      font-size: var(--text-xs);
      color: var(--text-faint);
    }

    .contacts__form-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
      gap: var(--space-s) var(--space-m);
      margin-block-start: var(--space-s);
    }
  }
</style>
