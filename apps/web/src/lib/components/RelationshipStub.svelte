<script lang="ts">
  /**
   * RelationshipStub — Project detail block showing engagements summary
   * (Phase 0.1 trabajo #4).
   *
   * Shows the 10 most actionable engagements for a given Project (ordered by
   * next_action_at asc nullslast, then updated_at desc — same as the API
   * default). Header carries total count. "View all" link sends the user
   * to the Contacts lens scoped to this Project — which is Phase 0.3 work; for
   * now the link falls back to /booking (the legacy full-list view) so the
   * user can still get to all 154 contacts.
   *
   * Anti-CRM vocabulary: surfaces the conversation state without using
   * "lead/pipeline/funnel/prospect" anywhere. Status labels are humane.
   */

  import { createQuery } from '@tanstack/svelte-query';
  import { goto } from '$app/navigation';
  import { writable, derived } from 'svelte/store';
  import {
    statusBadgeClass,
    statusLabel,
    type EngagementItem,
    type PersonLite,
  } from '$lib/engagement';

  interface Props {
    projectSlug: string;
  }

  let { projectSlug }: Props = $props();

  // Mirror the rune-prop into a legacy store so `createQuery` (which
  // accepts StoreOrVal<options>) re-runs when the slug changes via
  // SvelteKit navigation (same component instance, new params). The
  // synchronous read on init is intentional — the $effect below keeps it
  // in sync on every prop change, which is the actual reactive contract.
  // svelte-ignore state_referenced_locally
  const slugStore = writable(projectSlug);
  $effect(() => {
    slugStore.set(projectSlug);
  });

  type Response = {
    total: number;
    limit: number;
    items: EngagementItem[];
  };

  function clearAuthAndBounce() {
    localStorage.removeItem('hour_jwt');
    localStorage.removeItem('hour_refresh');
    localStorage.removeItem('hour_expires_at');
    goto('/login', { replaceState: true });
  }

  async function fetchJSON<T>(url: string, signal: AbortSignal): Promise<T> {
    const jwt = localStorage.getItem('hour_jwt');
    if (!jwt) {
      clearAuthAndBounce();
      throw new Error('Missing JWT');
    }
    const res = await fetch(url, { signal, headers: { Authorization: `Bearer ${jwt}` } });
    if (res.status === 401) {
      clearAuthAndBounce();
      throw new Error('Unauthorized');
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        detail?: string;
        error?: string;
      };
      throw new Error(body.detail || body.error || `Error ${res.status}`);
    }
    return (await res.json()) as T;
  }

  const LIMIT = 10;

  const queryOptions = derived(slugStore, ($slug) => ({
    queryKey: ['engagements', { project_slug: $slug, status: 'any', limit: LIMIT }] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<Response>(
        `/api/engagements?project_slug=${encodeURIComponent($slug)}&status=any&limit=${LIMIT}`,
        signal,
      ),
  }));

  const query = createQuery(queryOptions);

  let items = $derived($query.data?.items ?? []);
  let total = $derived($query.data?.total ?? 0);
  let loading = $derived($query.isPending);
  let errored = $derived($query.isError);

  function locationStr(p: PersonLite | null): string {
    if (!p) return '';
    return [p.city, p.country].filter(Boolean).join(', ');
  }
</script>

<section class="rel-stub" aria-labelledby="rel-stub-title">
  <header class="rel-stub__header">
    <div class="rel-stub__head-lead">
      <p class="eyebrow">Conversations</p>
      <h2 class="rel-stub__title" id="rel-stub-title">Relationships</h2>
    </div>
    {#if !loading && !errored}
      <span class="rel-stub__count">
        {total === 1 ? '1 engagement' : `${total} engagements`}
      </span>
    {/if}
  </header>

  {#if loading}
    <p class="rel-stub__state">Loading…</p>
  {:else if errored}
    <p class="rel-stub__state rel-stub__state--danger">Couldn't load engagements.</p>
  {:else if items.length === 0}
    <p class="rel-stub__state">No engagements in this Project yet.</p>
  {:else}
    <ul class="rel-stub__list">
      {#each items as e (e.id)}
        <li class="rel-stub__item">
          <div class="rel-stub__main">
            <strong class="rel-stub__name">{e.person?.full_name ?? '—'}</strong>
            {#if e.person?.organization_name}
              <span class="rel-stub__org">{e.person.organization_name}</span>
            {/if}
            {#if locationStr(e.person)}
              <span class="rel-stub__location">{locationStr(e.person)}</span>
            {/if}
          </div>
          <span class={statusBadgeClass(e.status)}>
            {statusLabel(e.status)}
          </span>
        </li>
      {/each}
    </ul>

    {#if total > items.length}
      <footer class="rel-stub__footer">
        <a class="rel-stub__view-all" href="/booking">
          View all {total} engagements →
        </a>
      </footer>
    {/if}
  {/if}
</section>

<style>
  .rel-stub {
    display: flex;
    flex-direction: column;
    gap: var(--space-s);
    max-inline-size: 56rem;
  }

  .rel-stub__header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-s);
    flex-wrap: wrap;
  }

  .rel-stub__head-lead {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }

  .rel-stub__title {
    font-family: var(--font-display);
    font-size: var(--text-xl);
    font-weight: 400;
    letter-spacing: -0.015em;
    margin: 0;
    color: var(--text-color);
  }

  .rel-stub__count {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.04em;
    color: var(--text-faint);
  }

  .rel-stub__list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0;
    border-block-start: 1px solid var(--border-color-light);
  }

  .rel-stub__item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-s);
    padding-block: var(--space-s);
    padding-inline: 0;
    border-block-end: 1px solid var(--border-color-light);
  }

  .rel-stub__main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-inline-size: 0;
  }

  .rel-stub__name {
    font-size: var(--text-m);
    color: var(--text-color);
    font-weight: 500;
  }

  .rel-stub__org {
    font-size: var(--text-s);
    color: var(--text-muted);
  }

  .rel-stub__location {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-faint);
    letter-spacing: 0.04em;
  }

  .rel-stub__state {
    margin: 0;
    padding-block: var(--space-s);
    font-size: var(--text-s);
    color: var(--text-faint);
  }

  .rel-stub__state--danger {
    color: var(--danger);
  }

  .rel-stub__footer {
    padding-block-start: var(--space-xs);
  }

  .rel-stub__view-all {
    font-size: var(--text-s);
    color: var(--text-muted);
    text-decoration: none;
    transition: color var(--transition);
  }

  .rel-stub__view-all:hover {
    color: var(--text-color);
  }
</style>
