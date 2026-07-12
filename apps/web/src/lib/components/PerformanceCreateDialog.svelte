<script module lang="ts">
  /**
   * "New performance" dialog (ADR-043) — extracted from the Calendar page
   * so any lens (calendar, line detail) can create a gig. The caller owns
   * the trigger and any preselection context (pins, current line); this
   * component owns the form, the POST, and the cache invalidations.
   *
   * The create RPC returns the full row — this is the slice consumers
   * need (workspace_id resolves the navigation target's slug).
   */
  export type CreatedPerformance = {
    id: string;
    slug: string | null;
    workspace_id: string;
  };
</script>

<script lang="ts">
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import Button from './Button.svelte';
  import Dialog from './Dialog.svelte';
  import Input from './Input.svelte';
  import Select from './Select.svelte';
  import { addToast } from './Toast.svelte';
  import { dayKeyInTz } from '$lib/calendar';
  import { allLinesQueryOptions } from '$lib/nav-queries';
  import { performanceStatusLabel, type PerformanceCreate } from '$lib/performance';

  type ProjectLite = { id: string; slug: string; name: string };

  interface Props {
    open?: boolean;
    /** Preselect this project on open (applied only if none picked yet). */
    presetProjectId?: string | null;
    /** Preselect this line on open — hides the Line select entirely. */
    presetLineId?: string | null;
    /** Freeze the Project select (e.g. creating from inside a project). */
    lockProject?: boolean;
    /** ISO day to prefill on open; defaults to the viewer's today. */
    presetDate?: string | null;
    onCreated?: (perf: CreatedPerformance) => void;
  }

  let {
    open = $bindable(false),
    presetProjectId = null,
    presetLineId = null,
    lockProject = false,
    presetDate = null,
    onCreated,
  }: Props = $props();

  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const queryClient = useQueryClient();

  let cProject = $state('');
  let cDay = $state('');
  let cVenue = $state('');
  let cCity = $state('');
  let cStatus = $state('proposed');
  let cLine = $state('');

  // Only the statuses that make sense at creation time — later lifecycle
  // states (done/invoiced/paid/cancelled) are reached from the detail page.
  const CREATE_STATUSES = ['proposed', 'hold', 'hold_1', 'hold_2', 'hold_3', 'confirmed'];
  let statusOptions = $derived(
    CREATE_STATUSES.map((s) => ({ value: s, label: performanceStatusLabel(s) })),
  );

  const projectsQuery = createQuery({
    queryKey: ['projects', { status: 'active' }],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: ProjectLite[] }>('/api/projects?status=active', signal),
  });
  const linesQuery = createQuery(allLinesQueryOptions());

  let projectOptions = $derived(
    ($projectsQuery.data?.items ?? []).map((p) => ({ value: p.id, label: p.name })),
  );

  // Lines of the selected project — client-side narrowing over the shared
  // ['lines','all'] cache. No lines (or a preset line) → no select at all.
  let projectLines = $derived(
    ($linesQuery.data?.items ?? []).filter((l) => l.project?.id === cProject),
  );
  let lineOptions = $derived([
    { value: '', label: 'No line' },
    ...projectLines.map((l) => ({ value: l.id, label: l.name })),
  ]);
  let showLineSelect = $derived(!presetLineId && projectLines.length > 0);

  // Apply presets on each open transition. Project/line preselection never
  // overrides a project the user already picked (same contract as the old
  // in-page openCreate); day is refreshed every open.
  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) {
      cDay = presetDate ?? dayKeyInTz(new Date().toISOString(), viewerTz);
      if (!cProject) {
        cProject =
          presetProjectId ?? (projectOptions.length === 1 ? projectOptions[0].value : '');
        cLine = presetLineId ?? '';
      }
    }
    wasOpen = open;
  });

  const createPerf = createMutation({
    mutationFn: async (input: PerformanceCreate) => {
      const body = await mutateJSON<{ performance: CreatedPerformance }>(
        'POST',
        '/api/performances',
        input,
      );
      if (!body?.performance) throw new Error('Malformed response');
      return body.performance;
    },
    onSuccess: (perf) => {
      open = false;
      cVenue = '';
      cCity = '';
      void queryClient.invalidateQueries({ queryKey: ['calendar-performances'] });
      void queryClient.invalidateQueries({ queryKey: ['line-performances'] });
      onCreated?.(perf);
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: 'Not created',
        message: `${err instanceof Error ? err.message : 'Unexpected error'} — try again.`,
      });
    },
  });

  function submitCreate() {
    if (!cProject) {
      addToast({ tone: 'warning', message: 'Pick a project.' });
      return;
    }
    if (!cDay) {
      addToast({ tone: 'warning', message: 'Pick a date.' });
      return;
    }
    $createPerf.mutate({
      project_id: cProject,
      performed_at: cDay,
      venue_name: cVenue.trim() || null,
      city: cCity.trim() || null,
      status: cStatus as PerformanceCreate['status'],
      line_id: cLine || null,
    });
  }
</script>

<Dialog bind:open title="New performance" size="s">
  <div class="pcreate__form">
    <Select
      label="Project"
      placeholder="Pick a project…"
      options={projectOptions}
      bind:value={cProject}
      required
      disabled={lockProject}
      onchange={() => (cLine = '')}
    />
    <Input label="Date" type="date" bind:value={cDay} required />
    <Input label="Venue" bind:value={cVenue} placeholder="Venue name (optional)" />
    <Input label="City" bind:value={cCity} placeholder="City (optional)" />
    <Select label="Status" options={statusOptions} bind:value={cStatus} />
    {#if showLineSelect}
      <Select label="Line" options={lineOptions} bind:value={cLine} />
    {/if}
  </div>
  {#snippet actions()}
    <Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
    <Button onclick={submitCreate} loading={$createPerf.isPending}>Create</Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .pcreate__form {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }
  }
</style>
