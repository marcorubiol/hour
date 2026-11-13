<script lang="ts">
  /**
   * «Copiar de otra función» (ADR-169, punto 83). Pick another performance
   * (this project's first), tick what to bring (technical, logistics,
   * hospitality, the running order) and copy. When this one already has a
   * part, the dialog asks before touching it: complete (keep what is here,
   * add what is missing) or replace. Reads on demand, not through the query
   * cache: nothing here outlives the dialog.
   */
  import { untrack } from 'svelte';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Checkbox from '$lib/components/Checkbox.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Radio from '$lib/components/Radio.svelte';
  import Select from '$lib/components/Select.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import type { Json } from '$lib/db-types';
  import { dayMonthYear } from '$lib/datetime';
  import { LOCALE_TAG, type Locale, tHere } from '$lib/i18n';
  import type { PerformancePatch } from '$lib/performance';
  import {
    COPY_COLUMNS,
    COPY_PARTS,
    columnHasContent,
    copyCandidates,
    mergeColumn,
    shiftSchedule,
    type CopyCandidate,
    type CopyMode,
    type CopyPart,
  } from '$lib/performance-copy';
  import { copyScheduleIntoDoc } from '$lib/performance-copy-doc';
  import type { ScheduleSlotRow } from '$lib/schedule-slot';

  interface Destination {
    id: string;
    slug: string | null;
    project_id: string;
    workspace_id: string;
    performed_at: string;
    logistics: Json;
    hospitality: Json;
    technical: Json;
  }

  interface Props {
    open?: boolean;
    perf: Destination;
    workspaceSlug: string;
    /** The zone this performance's hours are written in. */
    tz: string;
    /** The space's zone, for a source without a venue zone. */
    fallbackTz: string;
    locale: Locale;
    /** Something was written: the record reads itself again. */
    oncopied?: () => void;
  }

  let { open = $bindable(false), perf, workspaceSlug, tz, fallbackTz, locale, oncopied }: Props = $props();
  const t = tHere();

  type Source = {
    performance: {
      id: string;
      performed_at: string;
      venue_name: string | null;
      logistics: Json;
      hospitality: Json;
      technical: Json;
      venue: { timezone: string | null } | null;
    };
  };

  let candidates = $state<{ project: CopyCandidate[]; others: CopyCandidate[] } | null>(null);
  let destSlots = $state<ScheduleSlotRow[]>([]);
  let sourceId = $state('');
  let source = $state<Source['performance'] | null>(null);
  let sourceSlots = $state<ScheduleSlotRow[]>([]);
  let loadingSource = $state(false);
  let loadError = $state('');
  let picked = $state<Record<CopyPart, boolean>>({ technical: true, logistics: true, hospitality: true, schedule: true });
  let modeGroup = $state<string | null>('fill');
  let mode = $derived<CopyMode>(modeGroup === 'replace' ? 'replace' : 'fill');
  let copying = $state(false);

  // Each opening starts clean and reads the list again.
  $effect(() => {
    if (!open) return;
    candidates = null;
    sourceId = '';
    source = null;
    loadError = '';
    modeGroup = 'fill';
    untrack(() => void loadCandidates());
  });

  async function loadCandidates() {
    try {
      const [mine, space, slots] = await Promise.all([
        fetchJSON<{ items: CopyCandidate[] }>(`/api/performances?project_id=${perf.project_id}&limit=200`),
        fetchJSON<{ items: CopyCandidate[] }>(`/api/performances?workspace_ids=${perf.workspace_id}&limit=200`),
        fetchJSON<{ slots: ScheduleSlotRow[] }>(`/api/schedule/performance/${perf.id}`),
      ]);
      candidates = copyCandidates([...(mine?.items ?? []), ...(space?.items ?? [])], perf);
      destSlots = slots?.slots ?? [];
    } catch (err) {
      candidates = { project: [], others: [] };
      loadError = err instanceof Error ? err.message : t('perf.unexpected', locale);
    }
  }

  async function pickSource(id: string) {
    source = null;
    sourceSlots = [];
    loadError = '';
    if (!id) return;
    loadingSource = true;
    try {
      const [bundle, slots] = await Promise.all([
        fetchJSON<Source>(`/api/performances/${encodeURIComponent(id)}`),
        fetchJSON<{ slots: ScheduleSlotRow[] }>(`/api/schedule/performance/${encodeURIComponent(id)}`),
      ]);
      if (sourceId !== id) return;
      source = bundle?.performance ?? null;
      sourceSlots = slots?.slots ?? [];
      if (!source) loadError = t('perf_copy.load_failed', locale);
      for (const part of COPY_PARTS) picked[part] = sourceHas(part);
    } catch {
      if (sourceId === id) loadError = t('perf_copy.load_failed', locale);
    } finally {
      if (sourceId === id) loadingSource = false;
    }
  }

  function sourceHas(part: CopyPart): boolean {
    if (!source) return false;
    return part === 'schedule' ? sourceSlots.length > 0 : columnHasContent(source[part]);
  }

  function destHas(part: CopyPart): boolean {
    return part === 'schedule' ? destSlots.length > 0 : columnHasContent(perf[part]);
  }

  function partWord(part: CopyPart): string {
    return part === 'schedule' ? t('perf_copy.part_schedule', locale) : t(`perf.${part}`, locale);
  }

  function candidateLabel(c: Pick<CopyCandidate, 'performed_at' | 'venue_name' | 'city'>): string {
    const where = [c.venue_name ?? t('perf_copy.no_venue', locale), c.city].filter(Boolean).join(', ');
    return `${dayMonthYear(c.performed_at, LOCALE_TAG[locale])} · ${where}`;
  }

  let chosen = $derived(COPY_PARTS.filter((p) => picked[p] && sourceHas(p)));
  /** What this performance already has among what is about to arrive. */
  let clashes = $derived(chosen.filter(destHas));
  let clashWords = $derived(
    new Intl.ListFormat(LOCALE_TAG[locale], { type: 'conjunction' }).format(clashes.map((p) => partWord(p).toLowerCase())),
  );

  async function copy() {
    if (!source || chosen.length === 0 || copying) return;
    copying = true;
    let wrote = false;
    try {
      const patch: PerformancePatch = {};
      for (const col of COPY_COLUMNS) {
        if (!chosen.includes(col)) continue;
        const next = mergeColumn(perf[col], source[col], mode);
        if (next) patch[col] = next;
      }
      if (Object.keys(patch).length > 0) {
        await mutateJSON(
          'PATCH',
          `/api/performances/${encodeURIComponent(perf.slug ?? perf.id)}?ws=${encodeURIComponent(workspaceSlug)}`,
          patch,
        );
        wrote = true;
      }
      if (chosen.includes('schedule')) {
        const copied = shiftSchedule(
          sourceSlots,
          { day: source.performed_at.slice(0, 10), tz: source.venue?.timezone ?? fallbackTz },
          { day: perf.performed_at.slice(0, 10), tz },
        );
        try {
          if (await copyScheduleIntoDoc(perf.id, copied, mode)) wrote = true;
        } catch {
          addToast({ tone: 'warning', message: t('perf_copy.schedule_failed', locale) });
        }
      }
      if (wrote) oncopied?.();
      addToast({
        tone: wrote ? 'success' : 'info',
        message: wrote
          ? t('perf_copy.done', locale, { source: candidateLabel({ ...source, city: null }) })
          : t('perf_copy.nothing', locale),
      });
      open = false;
    } catch (err) {
      addToast({
        tone: 'danger',
        message: t('perf_copy.failed', locale, { error: err instanceof Error ? err.message : t('perf.unexpected', locale) }),
      });
    } finally {
      copying = false;
    }
  }
</script>

<Dialog bind:open title={t('perf_copy.title', locale)} description={t('perf_copy.description', locale)}>
  {#if candidates === null}
    <p class="copy__note" role="status">{t('perf_copy.loading_list', locale)}</p>
  {:else if candidates.project.length === 0 && candidates.others.length === 0}
    <p class="copy__note">{loadError || t('perf_copy.none', locale)}</p>
  {:else}
    <div class="copy">
      <Select
        label={t('perf_copy.source', locale)}
        placeholder={t('perf_copy.source_placeholder', locale)}
        bind:value={sourceId}
        onchange={() => void pickSource(sourceId)}
      >
        {#if candidates.project.length > 0}
          <optgroup label={t('perf_copy.group_project', locale)}>
            {#each candidates.project as c (c.id)}<option value={c.id}>{candidateLabel(c)}</option>{/each}
          </optgroup>
        {/if}
        {#if candidates.others.length > 0}
          <optgroup label={t('perf_copy.group_others', locale)}>
            {#each candidates.others as c (c.id)}<option value={c.id}>{candidateLabel(c)}</option>{/each}
          </optgroup>
        {/if}
      </Select>

      {#if loadingSource}
        <p class="copy__note" role="status">{t('perf_copy.loading', locale)}</p>
      {:else if loadError}
        <p class="copy__note" role="alert">{loadError}</p>
      {:else if source}
        <fieldset class="copy__parts">
          <legend class="eyebrow">{t('perf_copy.parts', locale)}</legend>
          {#each COPY_PARTS as part (part)}
            <Checkbox
              label={partWord(part)}
              bind:checked={picked[part]}
              disabled={!sourceHas(part)}
              helper={sourceHas(part) ? undefined : t('perf_copy.part_empty', locale)}
            />
          {/each}
        </fieldset>

        {#if clashes.length > 0}
          <fieldset class="copy__mode" data-testid="perf-copy-clash">
            <legend>{t('perf_copy.clash', locale, { parts: clashWords })}</legend>
            <Radio name="perf-copy-mode" value="fill" label={t('perf_copy.mode_fill', locale)} bind:group={modeGroup} />
            <Radio name="perf-copy-mode" value="replace" label={t('perf_copy.mode_replace', locale)} bind:group={modeGroup} />
          </fieldset>
        {/if}
      {/if}
    </div>
  {/if}

  {#snippet actions()}
    <Button variant="quiet" onclick={() => (open = false)}>{t('create.cancel', locale)}</Button>
    <Button onclick={copy} loading={copying} disabled={!source || chosen.length === 0}>{t('perf_copy.submit', locale)}</Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .copy {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
    }
    .copy__parts,
    .copy__mode {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      margin: 0;
      padding: 0;
      border: 0;
    }
    .copy__mode legend {
      margin-block-end: var(--space-xs);
      color: var(--text-color);
    }
    .copy__note {
      margin: 0;
      color: var(--text-muted);
    }
  }
</style>
