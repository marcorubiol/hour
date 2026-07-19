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
  import { detectLocale, t } from '$lib/i18n';
  import { allLinesQueryOptions } from '$lib/nav-queries';
  import {
    HOLD_NOTICE_DEFAULT,
    isHoldStatus,
    isValidHoldNotice,
    performanceStatusLabel,
    type PerformanceCreate,
  } from '$lib/performance';

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

  const locale = detectLocale(navigator.language);
  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const queryClient = useQueryClient();

  let cProject = $state('');
  let cDay = $state('');
  let cVenue = $state('');
  let cCity = $state('');
  let cStatus = $state('proposed');
  let cLine = $state('');
  // ADR-080 §2 — hold decision notice; only shown (and only sent) while
  // the picked status is a hold*. null = empty field = standard default.
  let cHoldNotice = $state<number | null>(null);
  let showHoldNotice = $derived(isHoldStatus(cStatus));

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
      // ADR-080 §2 — the create RPC doesn't know hold_notice_days, so a
      // typed notice rides a follow-up PATCH (the column is PATCH-whitelist
      // only; minimal path chosen over widening the RPC). A PATCH failure
      // must not undo a created gig — surface it, keep the create a success.
      const notice = holdNoticeToSend(input.status);
      if (notice !== undefined) {
        try {
          await mutateJSON('PATCH', `/api/performances/${body.performance.id}`, {
            hold_notice_days: notice,
          });
        } catch {
          addToast({ tone: 'warning', message: t('perf.hold_notice_not_saved', locale) });
        }
      }
      return body.performance;
    },
    onSuccess: (perf) => {
      cVenue = '';
      cCity = '';
      cHoldNotice = null;
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

  /**
   * The notice to send after create, or undefined for "nothing to send" —
   * only a hold* status carries one, and an empty field means "standard
   * default", which is exactly what NULL (the column's birth value) says.
   */
  function holdNoticeToSend(status: string | undefined): number | undefined {
    if (!status || !isHoldStatus(status)) return undefined;
    if (cHoldNotice == null || !isValidHoldNotice(cHoldNotice)) return undefined;
    return cHoldNotice;
  }

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
  {#if showHoldNotice}
    <!-- ADR-080 §2 — discreet, hold-only. Empty = default (the placeholder
         says it), 0 = no notice. Raw .field: the house Input doesn't carry
         min/max and the native attributes ARE the constraint here. -->
    <div class="field">
      <label for="c-hold-notice">{t('perf.hold_notice', locale)}</label>
      <div class="field__control">
        <input
          id="c-hold-notice"
          type="number"
          min="0"
          max="365"
          step="1"
          inputmode="numeric"
          bind:value={cHoldNotice}
          placeholder={String(HOLD_NOTICE_DEFAULT)}
          aria-describedby={cHoldNotice === 0 ? 'c-hold-notice-msg' : undefined}
        />
        <span class="field__suffix">{t('perf.hold_notice_suffix', locale)}</span>
      </div>
      {#if cHoldNotice === 0}
        <p id="c-hold-notice-msg" class="field__msg">{t('perf.hold_notice_none', locale)}</p>
      {/if}
    </div>
  {/if}
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
