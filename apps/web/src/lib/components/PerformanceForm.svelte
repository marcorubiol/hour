<script module lang="ts">
  /**
   * The performance creation form — ONE home for "how a gig is created"
   * (ADR-078 §1). Extracted from PerformanceCreateDialog so both that
   * dialog (line modules, hall) and the unified calendar create dialog
   * mount the exact same fields, presets and POST; neither forks it.
   *
   * The host owns the surrounding dialog and its footer buttons: this
   * component exposes `submit()` (instance export) and a bindable
   * `pending`, so each host renders its own actions row without
   * duplicating the mutation.
   *
   * Timezone rule (ADR-078 §11): a typed hour is VENUE-LOCAL. This form
   * carries no hour field — `performed_at` is a plain calendar day, so
   * there is nothing to convert; the rule bites where hours exist: the
   * unified dialog's date form and the performance detail timeslots, both
   * of which convert through `wallClockToInstant(wall, entryTz)`.
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
  import Input from './Input.svelte';
  import Select from './Select.svelte';
  import { addToast } from './Toast.svelte';
  import { dayKeyInTz } from '$lib/planner';
  import { allLinesQueryOptions } from '$lib/nav-queries';
  import { performanceStatusLabel, type PerformanceCreate } from '$lib/performance';

  type ProjectLite = { id: string; slug: string; name: string };

  interface Props {
    /** Host dialog's open state — presets apply on each open transition. */
    open?: boolean;
    /** Preselect this project on open (applied only if none picked yet). */
    presetProjectId?: string | null;
    /** Preselect this line on open — hides the Line select entirely. */
    presetLineId?: string | null;
    /** Freeze the Project select (e.g. creating from inside a project). */
    lockProject?: boolean;
    /** ISO day to prefill on open; defaults to the viewer's today. */
    presetDate?: string | null;
    /** Mirrors the mutation's isPending for the host's footer button. */
    pending?: boolean;
    onCreated?: (perf: CreatedPerformance) => void;
  }

  let {
    open = false,
    presetProjectId = null,
    presetLineId = null,
    lockProject = false,
    presetDate = null,
    pending = $bindable(false),
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

  // Apply presets on each open transition; day is refreshed every open.
  // When the CONTEXT dictates the target (presetProjectId/presetLineId —
  // line modules, locked projects) the preset ALWAYS wins: the component
  // instance survives navigation between lines (same route, new params),
  // so a leftover cProject/cLine from line A must never leak a gig into
  // line B (review 2026-07-12, HIGH). Only the free-form global dialog
  // keeps the "don't override what the user picked" contract.
  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) {
      cDay = presetDate ?? dayKeyInTz(new Date().toISOString(), viewerTz);
      if (presetProjectId) {
        cProject = presetProjectId;
        cLine = presetLineId ?? '';
      } else if (!cProject) {
        cProject = projectOptions.length === 1 ? projectOptions[0].value : '';
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
      cVenue = '';
      cCity = '';
      void queryClient.invalidateQueries({ queryKey: ['planner-performances'] });
      void queryClient.invalidateQueries({ queryKey: ['line-performances'] });
      void queryClient.invalidateQueries({ queryKey: ['line-money-fees'] });
      void queryClient.invalidateQueries({ queryKey: ['today-performances'] });
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

  // The host's footer button reads pending through the bindable — a store
  // value can't cross the instance boundary reactively any other way.
  $effect(() => {
    pending = $createPerf.isPending;
  });

  export function submit() {
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

<form
  class="pform"
  onsubmit={(e) => {
    e.preventDefault();
    submit();
  }}
>
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
  <!-- Hidden submit lets Enter inside an input trigger submit. -->
  <button type="submit" hidden aria-hidden="true"></button>
</form>

<style>
  @layer components {
    .pform {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }
  }
</style>
