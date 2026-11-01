<script lang="ts">
  /**
   * The project page's conversations block (ADR-141 § 1, ADR-102): the lens's
   * own row (`ConversationRow`), the venue first, in the lens's order «lo que
   * pide». Ten at most; past that, «ver las N» to the lens scoped to the
   * project. Read-only: the row is the link to the conversation's file, where
   * the relation, the step and the bolos are edited.
   */

  import BlockHead from '$lib/components/BlockHead.svelte';
  import ConversationRow from '$lib/components/ConversationRow.svelte';
  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import StateBadge from '$lib/components/StateBadge.svelte';
  import { lensOn } from '$lib/lenses.svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { appLocale, t } from '$lib/i18n';
  import { dayMonth } from '$lib/datetime';
  import { conversationTitle, relationInputOf, relativeContactDate, type ConversationItem } from '$lib/conversation';
  import { lastActivity, relationLabel, relationTone } from '$lib/conversation-relation';
  import { boloLabel, nearestBolo, rowLast, rowTurn } from '$lib/conversation-row';
  import { relationStubQueryOptions } from '$lib/relation-stub';

  interface Props {
    /** The resolved project's id; null while the page resolves it. */
    projectId: string | null;
    /** The project's space: the conversation's file lives there. */
    workspaceSlug: string;
  }

  let { projectId, workspaceSlug }: Props = $props();

  const locale = appLocale();

  // By id, not slug: a slug repeats across spaces (ADR-024). `toStore`
  // re-runs the query when navigation changes the project.
  const query = createQuery(toStore(() => relationStubQueryOptions(projectId)));

  let items = $derived($query.data?.items ?? []);
  let total = $derived($query.data?.total ?? 0);
  let loading = $derived($query.isPending);
  let errored = $derived($query.isError);

  const now = new Date();

  function rowView(item: ConversationItem) {
    const relation = relationInputOf(item);
    const title = conversationTitle(item) || t('conversations.conversation', locale);
    // The real contact under the venue, not the venue's name again (ADR-102 § 1).
    const person = item.person && item.person.full_name !== title ? item.person : null;
    const role = item.contacts.find((c) => c.is_primary)?.role ?? null;
    const city = item.person?.city || item.organization?.city || null;
    const contact = person ? [person.full_name, role].filter(Boolean).join(', ') : null;
    return {
      item,
      title,
      meta: [contact, city].filter(Boolean).join(' · '),
      turn: rowTurn({ ...relation, reply_settled_at: item.reply_settled_at, next_action_at: item.next_action_at }, now, locale),
      bolo: item.bolos ? nearestBolo(item.bolos, now) : null,
      last: rowLast(
        { last: relation.last ? (item.last_turn?.[0] ?? null) : null, last_in: relation.last_in, last_mailout: item.last_mailout },
        locale,
      ),
      lastAt: lastActivity(relation),
      stepDate: item.next_action_at ? dayMonth(item.next_action_at) : null,
      stepNote: item.next_action_note || null,
    };
  }

  let rows = $derived(items.map(rowView));
  let withBolos = $derived(rows.some((r) => r.bolo !== null));
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
  {:else if rows.length > 0}
    <ul class="crow-list crow-list--relation" class:crow-list--bolos={withBolos} data-testid="project-conversations">
      {#each rows as r (r.item.id)}
        <li>
          <ConversationRow
            href={`/h/${workspaceSlug}/conversation/${r.item.id}`}
            title={r.title}
            turn={r.turn?.word}
            since={r.turn?.since}
            tone={r.turn?.tone}
            unread={r.item.unread_count
              ? t(r.item.unread_count === 1 ? 'threads.unread_one' : 'threads.unread', locale, { n: r.item.unread_count })
              : null}
            where={r.meta || undefined}
            lead={r.last.lead}
            last={r.last.last}
            at={r.lastAt}
            when={r.lastAt ? relativeContactDate(r.lastAt, locale) : ''}
          >
            {#snippet relation()}
              <StateBadge label={relationLabel(r.item.relation, locale)} tone={relationTone(r.item.relation)} />
            {/snippet}
            {#snippet bolos()}
              {#if r.bolo}{boloLabel(r.bolo, locale)}{/if}
            {/snippet}
            {#snippet next()}
              {#if r.stepDate || r.stepNote}
                <span class="crow-next">
                  {#if r.stepDate}<span class="crow-next__date">{r.stepDate}</span>{/if}
                  {#if r.stepNote}<span class="crow-next__note" title={r.stepNote}>{r.stepNote}</span>{/if}
                </span>
              {/if}
            {/snippet}
          </ConversationRow>
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

  .rel-stub__footer {
    padding-block-start: var(--space-xs);
  }
</style>
