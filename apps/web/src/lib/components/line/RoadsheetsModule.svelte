<script lang="ts">
  /**
   * RoadsheetsModule — "Road sheets" module of the line detail stack
   * (ADR-056). Content-only: the page owns the section frame + heading.
   *
   * Lists the line's performances (API-ordered by performed_at asc) with a
   * per-row jump into that gig's road sheet. Deliberately NO fee fields —
   * money lives in the Money lens (ADR-043/046).
   */

  import { createQuery } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON } from '$lib/api';
  import StateBadge from '$lib/components/StateBadge.svelte';
  import { dayLabel } from '$lib/datetime';
  import { performanceStatusLabel, performanceStatusTone } from '$lib/performance';

  type PerformanceItem = {
    id: string;
    slug: string | null;
    performed_at: string;
    status: string;
    venue_name: string | null;
    city: string | null;
    country: string | null;
    venue: { name: string; city: string | null } | null;
  };

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

  // Reactive to line.id — the route component is reused across lines.
  const performancesOptions = toStore(() => ({
    queryKey: ['line-performances', line.id] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: PerformanceItem[] }>(
        `/api/performances?line_id=${line.id}&status=any&limit=200`,
        signal,
      ),
  }));
  const performancesQuery = createQuery(performancesOptions);

  let items = $derived($performancesQuery.data?.items ?? []);
  let loading = $derived($performancesQuery.isLoading);
  let errorMsg = $derived(
    $performancesQuery.error instanceof Error ? $performancesQuery.error.message : '',
  );

  function whereLabel(p: PerformanceItem): string {
    const name = p.venue?.name ?? p.venue_name ?? '—';
    const city = p.venue?.city ?? p.city;
    return city ? `${name} · ${city}` : name;
  }
</script>

{#if errorMsg}
  <p class="rsm__state rsm__state--danger">{errorMsg}</p>
{:else if loading}
  <p class="rsm__state">Loading…</p>
{:else if items.length === 0}
  <p class="rsm__state">No performances on this line yet.</p>
{:else}
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Status</th>
          <th>Where</th>
          <th aria-label="Road sheet"></th>
        </tr>
      </thead>
      <tbody>
        {#each items as p (p.id)}
          <tr>
            <td class="rsm__cell-date">{dayLabel(p.performed_at)}</td>
            <td>
              <StateBadge
                label={performanceStatusLabel(p.status)}
                tone={performanceStatusTone(p.status)}
              />
            </td>
            <td class="rsm__cell-muted">{whereLabel(p)}</td>
            <td class="rsm__cell-sheet">
              {#if p.slug}
                <a class="link-arrow" href={`/h/${workspaceSlug}/performance/${p.slug}/roadsheet`}>
                  Road sheet →
                </a>
              {:else}
                <span class="rsm__sheet--unlinked">Road sheet →</span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
  @layer components {
    .rsm__state {
      font-size: var(--text-s);
      color: var(--text-faint);
    }
    .rsm__state--danger {
      color: var(--danger);
    }

    .rsm__cell-date {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-muted);
      white-space: nowrap;
    }

    .rsm__cell-muted {
      color: var(--text-dark-muted);
      font-size: var(--text-s);
    }

    .rsm__cell-sheet {
      text-align: end;
      white-space: nowrap;
    }

    .rsm__sheet--unlinked {
      font-size: var(--text-s);
      color: var(--text-faint);
    }
  }
</style>
