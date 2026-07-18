<script lang="ts">
  /**
   * Blackout dialog (ADR-078 §4/§5) — marks a person (or the whole
   * company) unavailable for a day range. Deliberately NO kind/reason
   * axis: certainty + free note is complete information ("no cal dir per
   * què"). Write-target is always ONE workspace — no fan-out; the person
   * select is the workspace's TEAM (cast ∪ crew via /api/team), not the
   * contact book.
   *
   * POST /api/availability with the house optimistic pattern: the block
   * lands in every ['calendar-availability'] cache immediately, rolls
   * back with a toast on failure. Reachable from the unified create
   * dialog's quiet footer action and the toolbar's "⋯" overflow — both
   * hidden while the availability/team feeds are absent, so a failing
   * POST here is a real error, never the pre-migration 502.
   */
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { ApiError, fetchJSON, mutateJSON } from '$lib/api';
  import Button from '../Button.svelte';
  import Dialog from '../Dialog.svelte';
  import Input from '../Input.svelte';
  import Select from '../Select.svelte';
  import { addToast } from '../Toast.svelte';
  import { dayKeyInTz } from '$lib/calendar';
  import { detectLocale, t } from '$lib/i18n';
  import { workspacesQueryOptions } from '$lib/nav-queries';
  import type { AvailabilityCertainty, AvailabilityItem } from '$lib/availability';
  import { AVAILABILITY_CERTAINTIES } from '$lib/availability';

  type TeamItem = { person_id: string; workspace_id: string; slug: string; full_name: string };

  interface Props {
    open?: boolean;
    /** Preselected space — the pinned scope collapsed to one workspace. */
    presetWorkspaceId?: string | null;
    /** ISO day to prefill both range ends; defaults to today. */
    presetDate?: string | null;
  }

  let {
    open = $bindable(false),
    presetWorkspaceId = null,
    presetDate = null,
  }: Props = $props();

  const locale = detectLocale(navigator.language);
  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const queryClient = useQueryClient();

  let bWorkspace = $state('');
  let bPerson = $state('');
  let bFrom = $state('');
  let bTo = $state('');
  let bCertainty = $state<AvailabilityCertainty>('unavailable');
  let bNote = $state('');

  const workspacesQuery = createQuery(workspacesQueryOptions());
  let workspaceOptions = $derived(
    ($workspacesQuery.data?.items ?? []).map((w) => ({ value: w.id, label: w.name })),
  );

  // Same key construction as the calendar page — one warm team cache.
  const teamStore = toStore(() => {
    const ids = ($workspacesQuery.data?.items ?? []).map((w) => w.id);
    return {
      queryKey: ['calendar-team', ids] as const,
      enabled: open && ids.length > 0,
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        try {
          return await fetchJSON<{ items: TeamItem[] }>(
            `/api/team?workspace_ids=${ids.join(',')}`,
            signal,
          );
        } catch (err) {
          if (err instanceof Error && err.message === 'Unauthorized') throw err;
          console.warn('[calendar] team feed absent:', err);
          return { items: [] as TeamItem[], absent: true };
        }
      },
    };
  });
  const teamQuery = createQuery(teamStore);

  let teamOfWorkspace = $derived(
    ($teamQuery.data?.items ?? []).filter((item) => item.workspace_id === bWorkspace),
  );
  let personOptions = $derived([
    { value: '', label: t('blackout.person_company', locale) },
    ...teamOfWorkspace.map((item) => ({ value: item.person_id, label: item.full_name })),
  ]);

  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) {
      const day = presetDate ?? dayKeyInTz(new Date().toISOString(), viewerTz);
      bFrom = day;
      bTo = day;
      bPerson = '';
      bCertainty = 'unavailable';
      bNote = '';
      bWorkspace =
        presetWorkspaceId ??
        (workspaceOptions.length === 1 ? workspaceOptions[0].value : bWorkspace || '');
    }
    wasOpen = open;
  });

  type AvailabilityCache = { items: AvailabilityItem[] };

  const createBlock = createMutation({
    mutationFn: (input: {
      workspace_id: string;
      person_id: string | null;
      starts_on: string;
      ends_on: string;
      certainty: AvailabilityCertainty;
      note: string | null;
    }) => mutateJSON('POST', '/api/availability', input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ['calendar-availability'] });
      const snapshots = queryClient.getQueriesData<AvailabilityCache>({
        queryKey: ['calendar-availability'],
      });
      const person = input.person_id
        ? (teamOfWorkspace.find((item) => item.person_id === input.person_id) ?? null)
        : null;
      const now = new Date().toISOString();
      const optimistic: AvailabilityItem = {
        id: `optimistic-${Math.random().toString(36).slice(2)}`,
        workspace_id: input.workspace_id,
        person_id: input.person_id,
        starts_on: input.starts_on,
        ends_on: input.ends_on,
        certainty: input.certainty,
        note: input.note,
        created_at: now,
        updated_at: now,
        person: person
          ? { id: person.person_id, slug: person.slug, full_name: person.full_name }
          : null,
      };
      for (const [key, data] of snapshots) {
        if (!data) continue;
        const items = [...data.items, optimistic].sort((a, b) =>
          a.starts_on < b.starts_on ? -1 : a.starts_on > b.starts_on ? 1 : 0,
        );
        queryClient.setQueryData(key, { ...data, items });
      }
      return { snapshots };
    },
    onError: (err, _input, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) queryClient.setQueryData(key, data);
      addToast({
        tone: 'danger',
        title: t('blackout.not_saved', locale),
        message: err instanceof ApiError ? err.message : 'Unexpected error',
      });
    },
    onSuccess: () => {
      open = false;
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['calendar-availability'] }),
  });

  function submit() {
    if (!bWorkspace) {
      addToast({ tone: 'warning', message: t('blackout.pick_space', locale) });
      return;
    }
    if (!bFrom || !bTo) {
      addToast({ tone: 'warning', message: t('blackout.pick_range', locale) });
      return;
    }
    if (bTo < bFrom) {
      addToast({ tone: 'warning', message: t('blackout.range_invalid', locale) });
      return;
    }
    $createBlock.mutate({
      workspace_id: bWorkspace,
      person_id: bPerson || null,
      starts_on: bFrom,
      ends_on: bTo,
      certainty: bCertainty,
      note: bNote.trim() || null,
    });
  }
</script>

<Dialog bind:open title={t('blackout.title', locale)} size="s">
  <form
    class="cbk__form"
    onsubmit={(e) => {
      e.preventDefault();
      submit();
    }}
  >
    <Select
      label={t('blackout.space', locale)}
      options={workspaceOptions}
      bind:value={bWorkspace}
      required
      placeholder={t('blackout.space_placeholder', locale)}
      onchange={() => (bPerson = '')}
    />
    <Select
      label={t('blackout.person', locale)}
      options={personOptions}
      bind:value={bPerson}
      helper={t('blackout.person_hint', locale)}
    />
    <div class="cbk__range">
      <Input label={t('blackout.from', locale)} type="date" bind:value={bFrom} required />
      <Input label={t('blackout.to', locale)} type="date" bind:value={bTo} required />
    </div>
    <div class="cbk__field-group" role="group" aria-label={t('blackout.certainty', locale)}>
      <span class="cbk__field-label">{t('blackout.certainty', locale)}</span>
      <div class="cbk__seg">
        {#each AVAILABILITY_CERTAINTIES as certainty (certainty)}
          <button
            type="button"
            class="cbk__seg-btn"
            class:cbk__seg-btn--on={bCertainty === certainty}
            aria-pressed={bCertainty === certainty}
            onclick={() => (bCertainty = certainty)}
          >
            {t(`blackout.certainty_${certainty}`, locale)}
          </button>
        {/each}
      </div>
    </div>
    <Input
      label={t('blackout.note', locale)}
      bind:value={bNote}
      placeholder={t('blackout.note_placeholder', locale)}
    />
    <!-- Hidden submit lets Enter inside an input trigger submit. -->
    <button type="submit" hidden aria-hidden="true"></button>
  </form>
  {#snippet actions()}
    <Button variant="outline" onclick={() => (open = false)}>{t('create.cancel', locale)}</Button>
    <Button onclick={submit} loading={$createBlock.isPending}>{t('blackout.save', locale)}</Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .cbk__form {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }

    .cbk__range {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 9rem), 1fr));
      gap: var(--space-s);
    }

    .cbk__field-group {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
    }

    .cbk__field-label {
      font-size: var(--text-s);
      color: var(--text-color);
    }

    .cbk__seg {
      display: inline-flex;
      align-self: start;
      border: 1px solid var(--border-color-dark);
      border-radius: var(--radius-circle);
      overflow: hidden;
    }

    .cbk__seg-btn {
      border: none;
      background: none;
      padding: var(--space-2xs) var(--space-m);
      font-size: var(--text-s);
      color: var(--text-muted);
      cursor: pointer;
      white-space: nowrap;
      transition: background var(--transition), color var(--transition);
    }

    .cbk__seg-btn--on {
      background: var(--text-color);
      color: var(--bg);
    }
  }
</style>
