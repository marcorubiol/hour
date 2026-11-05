<script lang="ts">
  /**
   * The project page's conversations block (ADR-141 § 1, ADR-102): the lens's
   * chat row (`ChatRow`, mesa, punto 6: «la fila de los demás sitios como la
   * del chat»), the venue first, in the lens's order «lo que pide». Each row
   * says with whom in words (`chatLine`), the last thing said, the turn in
   * words and its nearest bolo. Ten at most; past that, «ver las N» to the
   * lens scoped to the project. Read-only: the row is the link to the
   * conversation's file, where the relation, the step and the bolos are edited.
   */

  import BlockHead from '$lib/components/BlockHead.svelte';
  import ChatRow from '$lib/components/ChatRow.svelte';
  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import { lensOn } from '$lib/lenses.svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { appLocale, t } from '$lib/i18n';
  import { viewerTimeZone } from '$lib/datetime';
  import { conversationTitle, relationInputOf, type ConversationItem } from '$lib/conversation';
  import { lastActivity, relationLabel } from '$lib/conversation-relation';
  import { boloLabel, nearestBolo } from '$lib/conversation-row';
  import { chatLine, chatWhen, type ChatContext } from '$lib/chat-row';
  import { relationStubQueryOptions } from '$lib/relation-stub';

  interface Props {
    /** The resolved project's id; null while the page resolves it. */
    projectId: string | null;
    /** The project's space: the conversation's file lives there. */
    workspaceSlug: string;
  }

  let { projectId, workspaceSlug }: Props = $props();

  const locale = appLocale();
  const tz = viewerTimeZone();

  // By id, not slug: a slug repeats across spaces (ADR-024). `toStore`
  // re-runs the query when navigation changes the project.
  const query = createQuery(toStore(() => relationStubQueryOptions(projectId)));

  let items = $derived($query.data?.items ?? []);
  let total = $derived($query.data?.total ?? 0);
  let loading = $derived($query.isPending);
  let errored = $derived($query.isError);

  const now = new Date();

  function rowView(item: ConversationItem) {
    const chat = chatLine(item, now, locale);
    const bolo = item.bolos ? nearestBolo(item.bolos, now) : null;
    // The project is this page: the context is the turn, else the relation, and the bolo.
    const context: ChatContext[] = [chat.turn ?? { text: relationLabel(item.relation, locale) }];
    if (bolo) context.push({ text: boloLabel(bolo, locale) });
    const at = lastActivity(relationInputOf(item));
    const unread = item.unread_count ?? 0;
    return {
      item,
      chat,
      context,
      title: conversationTitle(item) || t('conversations.conversation', locale),
      at,
      unread,
      unreadLabel: unread > 0 ? t(unread === 1 ? 'threads.unread_one' : 'threads.unread', locale, { n: unread }) : null,
    };
  }

  let rows = $derived(items.map(rowView));
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
    <ul class="crow-list" data-testid="project-conversations">
      {#each rows as r (r.item.id)}
        <li data-testid="project-conversation">
          <ChatRow
            href={`/h/${workspaceSlug}/conversation/${r.item.id}`}
            title={r.title}
            shape={r.chat.shape}
            words={r.chat.words}
            at={r.at}
            when={r.at ? chatWhen(r.at, locale, tz) : ''}
            unread={r.unread}
            unreadLabel={r.unreadLabel}
            lead={r.chat.lead}
            last={r.chat.last}
            context={r.context}
          />
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
