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

  import BlockHead from '$lib/components/BlockHead.svelte';
  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import StateBadge from '$lib/components/StateBadge.svelte';
  import { lensOn } from '$lib/lenses.svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { appLocale, t } from '$lib/i18n';
  import { type PersonLite } from '$lib/conversation';
  import { relationLabel, relationTone } from '$lib/conversation-relation';
  import { relationStubQueryOptions } from '$lib/relation-stub';

  interface Props {
    /** The resolved project's id; null while the page resolves it. */
    projectId: string | null;
  }

  let { projectId }: Props = $props();

  const locale = appLocale();

  // By id, not slug: a slug repeats across spaces (ADR-024). `toStore`
  // re-runs the query when navigation changes the project.
  const query = createQuery(toStore(() => relationStubQueryOptions(projectId)));

  let items = $derived($query.data?.items ?? []);
  let total = $derived($query.data?.total ?? 0);
  let loading = $derived($query.isPending);
  let errored = $derived($query.isError);

  function locationStr(p: PersonLite | null): string {
    if (!p) return '';
    return [p.city, p.country].filter(Boolean).join(', ');
  }
</script>

<section class="rel-stub" aria-label={t('lens.conversations', locale)} aria-busy={loading}>
  {#if !loading && !errored && items.length === 0}
    <EmptyLine label={t('lens.conversations', locale)} text={t('perf.rel_empty', locale)} />
  {:else}
    <BlockHead title={t('lens.conversations', locale)} count={loading || errored ? null : total} id="rel-stub-title" />
  {/if}

  {#if loading}
    <EmptyLine text={t('desk.loading', locale)} busy />
  {:else if errored}
    <p class="load-fail" role="alert">{t('perf.rel_error', locale)}</p>
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
          <StateBadge label={relationLabel(e.relation)} tone={relationTone(e.relation)} />
        </li>
      {/each}
    </ul>

    {#if total > items.length && lensOn('conversations')}
      <footer class="rel-stub__footer">
        <a class="link-arrow" href={projectId ? `/h/conversations?scope=p:${projectId}` : '/h/conversations'}>
          {t('perf.rel_view_all', locale, { n: total })}
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

  .rel-stub__list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0;
    border-block-start: var(--line-hairline) solid var(--border-color-light);
  }

  .rel-stub__item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-s);
    padding-block: var(--space-xs);
    padding-inline: 0;
    border-block-end: var(--line-hairline) solid var(--border-color-light);
  }

  .rel-stub__main {
    display: flex;
    flex-direction: column;
    gap: var(--space-2xs);
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

  .rel-stub__footer {
    padding-block-start: var(--space-xs);
  }

</style>
