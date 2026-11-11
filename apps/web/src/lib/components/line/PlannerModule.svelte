<script lang="ts">
  /**
   * Planner module (ADR-056): the line's upcoming performances, as a list,
   * which is what fits in a module. The month, the board and the rest are
   * the Planner's own: «Ver en el Planificador» opens it pinned to this line
   * (tarea 135: one view here, no second toggle).
   *
   * «+ función» opens the shell's one quick add («Añadir al plan», ADR-139)
   * with the project and this line already said (tarea 135: one way to add
   * a performance).
   */

  import { createQuery } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON } from '$lib/api';
  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import StateBadge from '$lib/components/StateBadge.svelte';
  import LineModule from './LineModule.svelte';
  import type { PerformanceEvent } from '$lib/month-events';
  import { linePlannerHref } from '$lib/planner';
  import { performanceStatusLabel, performanceStatusTone } from '$lib/performance';
  import { dayLabel } from '$lib/datetime';
  import { useCreation } from '$lib/stores/creation.svelte';
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
    title: string;
  }

  let { line, workspaceSlug, title }: Props = $props();

  const locale = appLocale();
  const creation = useCreation();

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

  let upcoming = $derived.by(() => {
    const todayIso = new Date().toISOString().slice(0, 10);
    return perfs.filter((p) => p.performed_at >= todayIso && p.status !== 'cancelled');
  });
  let pastCount = $derived(perfs.length - upcoming.length);

  function addFunction() {
    creation.openEvent({ type: 'performance', projectId: line.project_id, lineId: line.id });
  }
</script>

{#snippet action(cls: string)}
  <span class="lcal__acts">
    <a class={cls} href={linePlannerHref(line.id)}>{t('line.planner_see', locale)}</a>
    <button type="button" class={cls} onclick={addFunction}>{t('books.add_function', locale)}</button>
  </span>
{/snippet}

<LineModule {title} empty={$perfsQuery.isSuccess && perfs.length === 0} {action}>
  {#if $perfsQuery.isError}
    <p class="load-fail" role="alert">{t('line.planner_error', locale)}</p>
  {:else if $perfsQuery.isPending}
    <EmptyLine text={t('desk.loading', locale)} busy />
  {:else}
    {#if upcoming.length > 0}
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
      <p class="lcal__past">{t('line.planner_past_see', locale, { n: pastCount })}</p>
    {/if}
  {/if}
</LineModule>

<style>
  @layer components {
    /* Two actions at the end of the head (or of the empty line). */
    .lcal__acts {
      display: inline-flex;
      flex-wrap: wrap;
      gap: var(--space-m);
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
  }
</style>
