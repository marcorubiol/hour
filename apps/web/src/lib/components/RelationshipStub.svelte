<script lang="ts">
  /**
   * RelationshipStub — Project detail block showing conversations summary
   * (Phase 0.1 trabajo #4).
   *
   * Shows the 10 most actionable conversations for a given Project (ordered by
   * next_action_at asc nullslast, then updated_at desc — same as the API
   * default). Header carries total count. "View all" link sends the user
   * to the Conversations lens (the /booking wrapper it used to point at was
   * retired in the ADR-056 cleanup).
   *
   * Anti-CRM vocabulary: surfaces the conversation state without using
   * "lead/pipeline/funnel/prospect" anywhere. Status labels are humane.
   */

  import { createQuery } from '@tanstack/svelte-query';
  import { writable, derived } from 'svelte/store';
  import { fetchJSON } from '$lib/api';
  import {
    statusBadgeClass,
    statusLabel,
    type ConversationItem,
    type PersonLite,
  } from '$lib/conversation';

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
    items: ConversationItem[];
  };

  const LIMIT = 10;

  const queryOptions = derived(slugStore, ($slug) => ({
    queryKey: ['conversations', { project_slug: $slug, status: 'any', limit: LIMIT }] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<Response>(
        `/api/conversations?project_slug=${encodeURIComponent($slug)}&status=any&limit=${LIMIT}`,
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
        {total === 1 ? '1 conversation' : `${total} conversations`}
      </span>
    {/if}
  </header>

  {#if loading}
    <p class="rel-stub__state">Loading…</p>
  {:else if errored}
    <p class="rel-stub__state rel-stub__state--danger">Couldn't load conversations.</p>
  {:else if items.length === 0}
    <p class="rel-stub__state">No conversations on this project yet.</p>
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
        <a class="link-arrow" href="/h/conversations">
          View all {total} conversations →
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
    letter-spacing: var(--mono-letter-spacing-loose);
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
    padding-block: var(--space-xs);
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
    letter-spacing: var(--mono-letter-spacing-loose);
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

</style>
