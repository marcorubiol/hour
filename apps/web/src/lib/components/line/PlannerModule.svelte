<script lang="ts">
  /**
   * Planner module (ADR-056) — the line's performances and dates.
   * Content-only component; two view modes:
   *
   *   · list  (default) — dense chronological upcoming rows; a month grid
   *     embedded mid-stack would be a wall (design decision, grill 2026-07-12).
   *   · month — the ONE MonthGrid implementation, line-scoped.
   *
   * Dates carry no line_id (schema fact) — the module shows the dates tied
   * to the line's performances (client join through performance_id);
   * project-level dates stay in the global Planner lens.
   *
   * "New performance" mounts the shared PerformanceCreateDialog with the
   * project locked and the line preset — the context assigns line_id, no
   * select needed.
   */

  import { createQuery } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import StateBadge from '$lib/components/StateBadge.svelte';
  import MonthGrid from '$lib/components/MonthGrid.svelte';
  import { type DateEvent, type PerformanceEvent, formatMonthLabel } from '$lib/month-events';
  import PerformanceCreateDialog from '$lib/components/PerformanceCreateDialog.svelte';
  import { addMonths, addDaysIso, monthGrid } from '$lib/planner';
  import { performanceStatusLabel, performanceStatusTone } from '$lib/performance';
  import { dayLabel } from '$lib/datetime';
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

  const locale = appLocale();

  let mode = $state<'list' | 'month'>('list');
  const today = new Date();
  let ym = $state<{ year: number; month: number }>({
    year: today.getFullYear(),
    month: today.getMonth() + 1,
  });

  // ── Performances (cache shared with the roadsheets module + header) ──
  const perfsOptions = toStore(() => {
    const id = line.id;
    return {
      queryKey: ['line-performances', id] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: PerformanceEvent[] }>(
          `/api/performances?line_id=${id}&status=any&limit=200`,
          signal,
        ),
    };
  });
  const perfsQuery = createQuery(perfsOptions);
  let perfs = $derived($perfsQuery.data?.items ?? []);
  let perfIds = $derived(new Set(perfs.map((p) => p.id)));

  // ── Dates of the visible month, joined to the line's performances ────
  // (declared AFTER the $derived it reads — toStore runs its callback on
  // creation.)
  type LineDate = DateEvent & { performance_id: string | null };
  let gridWindow = $derived.by(() => {
    const weeks = monthGrid(ym.year, ym.month);
    const from = weeks[0][0].iso;
    const to = weeks[weeks.length - 1][6].iso;
    return { from, to };
  });
  const datesOptions = toStore(() => {
    const w = gridWindow;
    return {
      queryKey: ['line-dates', line.id, w.from, w.to] as const,
      enabled: mode === 'month',
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: LineDate[] }>(
          `/api/dates?project_ids=${line.project_id}&from=${addDaysIso(w.from, -1)}&to=${addDaysIso(w.to, 1)}&limit=500`,
          signal,
        ),
    };
  });
  const datesQuery = createQuery(datesOptions);
  let lineDates = $derived(
    ($datesQuery.data?.items ?? []).filter(
      (d) => d.performance_id !== null && perfIds.has(d.performance_id),
    ),
  );

  let upcoming = $derived.by(() => {
    const todayIso = new Date().toISOString().slice(0, 10);
    return perfs.filter((p) => p.performed_at >= todayIso && p.status !== 'cancelled');
  });
  let pastCount = $derived(perfs.length - upcoming.length);

  function prevMonth() {
    ym = addMonths(ym.year, ym.month, -1);
  }
  function nextMonth() {
    ym = addMonths(ym.year, ym.month, 1);
  }

  // ── Create (line context assigns the line — ADR-056) ─────────────────
  let createOpen = $state(false);
  let createDate = $state<string | null>(null);
  function openCreate(isoDate?: string) {
    createDate = isoDate ?? null;
    createOpen = true;
  }
</script>

<div class="lcal">
  <div class="lcal__bar">
    <div class="lcal__modes" role="group" aria-label={t('line.planner_view', locale)}>
      <button
        type="button"
        class="lcal__mode"
        class:lcal__mode--on={mode === 'list'}
        onclick={() => (mode = 'list')}
      >{t('line.planner_list', locale)}</button>
      <button
        type="button"
        class="lcal__mode"
        class:lcal__mode--on={mode === 'month'}
        onclick={() => (mode = 'month')}
      >{t('planner.view_month', locale)}</button>
    </div>
    {#if mode === 'month'}
      <div class="lcal__nav">
        <button type="button" class="lcal__navbtn" onclick={prevMonth} aria-label={t('planner.prev_month', locale)}>‹</button>
        <span class="lcal__month">{formatMonthLabel(ym.year, ym.month)}</span>
        <button type="button" class="lcal__navbtn" onclick={nextMonth} aria-label={t('planner.next_month', locale)}>›</button>
      </div>
    {/if}
    <Button size="xs" variant="outline" onclick={() => openCreate()}>{t('perf.new_title', locale)}</Button>
  </div>

  {#if $perfsQuery.isError}
    <p class="lcal__state lcal__state--danger">{t('line.planner_error', locale)}</p>
  {:else if $perfsQuery.isPending}
    <p class="lcal__state">{t('desk.loading', locale)}</p>
  {:else if mode === 'list'}
    {#if upcoming.length === 0}
      <p class="lcal__state">{t('line.planner_empty', locale)}</p>
    {:else}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t('perf.date', locale)}</th>
              <th>{t('edit.status', locale)}</th>
              <th>{t('line.where', locale)}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each upcoming as p (p.id)}
              <tr>
                <td class="lcal__cell-date">{dayLabel(p.performed_at)}</td>
                <td>
                  <StateBadge
                    label={performanceStatusLabel(p.status, locale)}
                    tone={performanceStatusTone(p.status)}
                  />
                </td>
                <td class="lcal__cell-venue">
                  {[p.venue?.name ?? p.venue_name, p.venue?.city ?? p.city]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </td>
                <td class="lcal__cell-link">
                  {#if p.slug}
                    <a class="link-arrow" href={`/h/${workspaceSlug}/performance/${p.slug}`}>{t('line.open', locale)}</a>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
    {#if pastCount > 0}
      <p class="lcal__past">{t('line.planner_past', locale, { n: pastCount })}</p>
    {/if}
  {:else}
    <MonthGrid
      year={ym.year}
      month={ym.month}
      performances={perfs}
      dates={lineDates}
      {workspaceSlug}
      loading={$datesQuery.isPending}
      onDayCreate={(iso) => openCreate(iso)}
    />
  {/if}
</div>

<PerformanceCreateDialog
  bind:open={createOpen}
  presetProjectId={line.project_id}
  presetLineId={line.id}
  lockProject
  presetDate={createDate}
/>

<style>
  @layer components {
    .lcal {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }
    .lcal__bar {
      display: flex;
      align-items: center;
      gap: var(--space-m);
    }
    .lcal__modes {
      display: inline-flex;
      border: 1px solid var(--border-color-light);
      border-radius: var(--radius-circle);
      overflow: hidden;
    }
    .lcal__mode {
      border: 0;
      background: none;
      padding-block: var(--space-2xs);
      padding-inline: var(--space-s);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-faint);
      cursor: pointer;
      transition: color var(--transition), background var(--transition);
    }
    .lcal__mode--on {
      background: var(--text-color);
      color: var(--bg);
    }
    .lcal__nav {
      display: inline-flex;
      align-items: center;
      gap: var(--space-s);
      margin-inline-start: auto;
    }
    .lcal__bar > :global([class*='btn--']) {
      margin-inline-start: auto;
    }
    .lcal__nav + :global([class*='btn--']) {
      margin-inline-start: 0;
    }
    .lcal__navbtn {
      border: 0;
      background: none;
      color: var(--text-muted);
      font-size: var(--text-m);
      line-height: 1;
      cursor: pointer;
      padding: var(--space-2xs) var(--space-xs);
      border-radius: var(--radius-s);
    }
    .lcal__navbtn:hover {
      background: var(--bg-light);
      color: var(--text-color);
    }
    .lcal__month {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .lcal__cell-date {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-muted);
      white-space: nowrap;
    }
    .lcal__cell-venue {
      font-size: var(--text-s);
      color: var(--text-dark-muted);
    }
    .lcal__past {
      margin: 0;
      font-size: var(--text-xs);
      color: var(--text-faint);
    }
    .lcal__state {
      margin: 0;
      font-size: var(--text-s);
      color: var(--text-faint);
    }
    .lcal__state--danger {
      color: var(--danger);
    }
  }
</style>
