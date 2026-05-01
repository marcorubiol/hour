<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';

  type EngagementItem = {
    id: string;
    status: string;
    next_action_at: string | null;
    person: {
      full_name: string | null;
      organization_name: string | null;
      city: string | null;
      country: string | null;
    } | null;
  };

  const LIMIT = 50;
  const STATUS_LABELS: Record<string, string> = {
    contacted: 'Contacted',
    in_conversation: 'In conversation',
    hold: 'Hold',
    confirmed: 'Confirmed',
    declined: 'Declined',
    dormant: 'Dormant',
    recurring: 'Recurring',
  };
  const PREVIEW_STATUSES = [
    'contacted',
    'in_conversation',
    'hold',
    'confirmed',
    'declined',
    'dormant',
    'recurring',
  ];

  let offset = $state(0);
  let total = $state(0);
  let items = $state<EngagementItem[]>([]);
  let loading = $state(true);
  let errorMsg = $state('');

  function clearAuth() {
    localStorage.removeItem('hour_jwt');
    localStorage.removeItem('hour_refresh');
    localStorage.removeItem('hour_expires_at');
  }

  function formatDate(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
    });
  }

  function badgeMod(status: string): string {
    return status.replace(/_/g, '-');
  }

  function locationOf(item: EngagementItem): string {
    if (!item.person) return '—';
    return [item.person.city, item.person.country].filter(Boolean).join(', ') || '—';
  }

  async function load() {
    loading = true;
    errorMsg = '';

    const jwt = localStorage.getItem('hour_jwt');
    if (!jwt) {
      goto('/login', { replaceState: true });
      return;
    }

    try {
      const url = `/api/engagements?status=any&project_slug=mamemi&season=2026-27&limit=${LIMIT}&offset=${offset}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${jwt}` },
      });

      if (res.status === 401) {
        clearAuth();
        goto('/login', { replaceState: true });
        return;
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          detail?: string;
          error?: string;
        };
        throw new Error(body.detail || body.error || `Error ${res.status}`);
      }

      const data = (await res.json()) as {
        total?: number;
        items?: EngagementItem[];
      };
      total = data.total ?? 0;
      const fetched = (data.items ?? []) as EngagementItem[];

      // TEMP VISUAL MOCK — overwrite first 7 items with one of each status
      // so all badge colours appear side-by-side. Remove before deploy.
      items = fetched.map((item, i) =>
        i < PREVIEW_STATUSES.length ? { ...item, status: PREVIEW_STATUSES[i] } : item,
      );
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
      items = [];
    } finally {
      loading = false;
    }
  }

  function logout() {
    clearAuth();
    goto('/login', { replaceState: true });
  }

  function prev() {
    offset = Math.max(0, offset - LIMIT);
    load();
  }

  function next() {
    offset += LIMIT;
    load();
  }

  let showPagination = $derived(total > LIMIT);
  let prevDisabled = $derived(offset === 0);
  let nextDisabled = $derived(offset + LIMIT >= total);
  let rangeEnd = $derived(Math.min(offset + LIMIT, total));

  onMount(load);
</script>

<svelte:head>
  <title>Hour — Booking 2026-27</title>
</svelte:head>

<header class="app-header">
  <h1 class="h4">
    Hour <span class="text--dark-muted">/ Booking 2026-27</span>
  </h1>
  <button class="btn--outline" onclick={logout}>Sign out</button>
</header>

<div class="status-bar">
  {#if loading}
    <span>Loading...</span>
  {:else if !errorMsg}
    <span class="status-bar__count">{total} contacts</span>
    <span>Showing {offset + 1}-{rangeEnd}</span>
  {/if}
</div>

<div class="table-wrap">
  <table>
    <thead>
      <tr>
        <th>Name</th>
        <th>Organization</th>
        <th>Location</th>
        <th>Status</th>
        <th>Next action</th>
      </tr>
    </thead>
    <tbody>
      {#each items as item (item.id)}
        <tr>
          <td class="cell--name">{item.person?.full_name ?? '—'}</td>
          <td class="cell--muted">{item.person?.organization_name ?? '—'}</td>
          <td class="cell--meta">{locationOf(item)}</td>
          <td>
            <span class="badge--{badgeMod(item.status)}">
              {STATUS_LABELS[item.status] ?? item.status}
            </span>
          </td>
          <td class="cell--meta">{formatDate(item.next_action_at)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

{#if errorMsg}
  <div class="msg msg--error">{errorMsg}</div>
{:else if !loading && items.length === 0}
  <div class="msg">No results.</div>
{/if}

{#if showPagination}
  <div class="pagination">
    <button class="btn--outline" onclick={prev} disabled={prevDisabled}>Previous</button>
    <button class="btn--outline" onclick={next} disabled={nextDisabled}>Next</button>
  </div>
{/if}

<style>
  @layer components {
    .app-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-m);
      border-block-end: var(--divider);
    }

    .status-bar {
      display: flex;
      align-items: center;
      gap: var(--space-m);
      padding-block: var(--space-s);
      padding-inline: var(--gutter);
      border-block-end: var(--divider);
      font-size: var(--text-s);
      color: var(--text-dark-muted);
      flex-wrap: wrap;
    }
    .status-bar__count {
      color: var(--heading-color);
      font-weight: 500;
    }

    .table-wrap {
      overflow-x: auto;
      padding-inline: var(--gutter);
    }

    .msg {
      text-align: center;
      padding-block: var(--space-xxl);
      padding-inline: var(--gutter);
      color: var(--text-dark-muted);
    }
    .msg--error {
      color: var(--danger-dark);
    }

    .pagination {
      display: flex;
      justify-content: center;
      gap: var(--space-s);
      padding-block: var(--space-m);
      padding-inline: var(--gutter);
    }

    /* Cell-content + status-badge styles. Now that rows render through Svelte,
       these no longer need to be global — Svelte injects scope hashes
       consistently across each iteration. */
    tbody td {
      max-inline-size: 16rem;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    tbody tr:hover td {
      background: var(--bg-ultra-light);
    }
    .cell--name {
      font-weight: 500;
      color: var(--heading-color);
    }
    .cell--muted {
      color: var(--text-dark-muted);
    }
    .cell--meta {
      color: var(--text-dark-muted);
      font-size: var(--text-s);
    }

    .badge--contacted {
      --badge-background: var(--info-ultra-light);
      --badge-color: var(--info-ultra-dark);
    }
    .badge--in-conversation {
      --badge-background: var(--warning-ultra-light);
      --badge-color: var(--warning-ultra-dark);
    }
    .badge--hold {
      --badge-background: var(--neutral-ultra-light);
      --badge-color: var(--neutral-dark);
    }
    .badge--confirmed {
      --badge-background: var(--success-ultra-light);
      --badge-color: var(--success-ultra-dark);
    }
    .badge--declined {
      --badge-background: var(--danger-ultra-light);
      --badge-color: var(--danger-ultra-dark);
    }
    .badge--dormant {
      --badge-background: var(--neutral-ultra-light);
      --badge-color: var(--neutral-semi-dark);
      opacity: 0.75;
    }
    .badge--recurring {
      --badge-background: var(--primary-ultra-light);
      --badge-color: var(--primary-ultra-dark);
    }
  }
</style>
