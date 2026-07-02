<script lang="ts">
  /**
   * Contacts lens — Phase 0.3 item 1, v1 (ADR-044). The difusión work
   * surface inside the shell: engagement list filtered by the sidebar
   * selection (ADR-038 union; empty = everything RLS allows), free-text
   * search over person name/organization, status filter, and the ADR-040
   * inline editors via the shared EngagementTable.
   */

  import { createQuery } from '@tanstack/svelte-query';
  import { page } from '$app/state';
  import { fetchJSON } from '$lib/api';
  import EngagementTable from '$lib/components/EngagementTable.svelte';
  import Input from '$lib/components/Input.svelte';
  import Select from '$lib/components/Select.svelte';
  import { ENGAGEMENT_STATUSES, statusLabel } from '$lib/engagement';
  import { resolveSelectionIds } from '$lib/selection-filter';
  import { useSelection } from '$lib/stores/selection.svelte';

  type WorkspaceLite = { id: string; slug: string };
  type ProjectLite = { id: string; slug: string };

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
    </div>
  </header>

  <EngagementTable {filters} personBase={`/h/${page.params.workspace}/person`} />
</section>

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
  }
</style>
