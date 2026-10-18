<script lang="ts">
  /**
   * «HA CAMBIADO» — band 3 of the Desk (ADR-117): what moved since your last
   * visit, nothing to act on. The rows are `changesSince` ($lib/desk-bands);
   * each opens its own sheet. With nothing in it the band stays, as one line
   * that says since when (amends ADR-121 § 5); if a source failed it says so,
   * because a silent band would claim «nothing changed».
   */
  import { t, type Locale } from '$lib/i18n';
  import { feedHref, feedThreadName, feedTitle } from '$lib/threads';
  import type { Change } from '$lib/desk-bands';

  interface Props {
    changes: Change[];
    loading: boolean;
    errored: boolean;
    /** «Nada nuevo desde tu última visita, hace 3 h»: what an empty band says. */
    quietLabel: string;
    /** The instant «since» means, already formatted for the eyebrow. */
    sinceLabel: string;
    workspaceSlugById: Map<string, string>;
    locale: Locale;
  }

  let { changes, loading, errored, quietLabel, sinceLabel, workspaceSlugById, locale }: Props = $props();

  function line(c: Change): { text: string; kind: string; href: string | null } {
    if (c.kind === 'thread') {
      const th = c.thread;
      const n = th.unread_count;
      const where = [feedThreadName(th, locale), feedTitle(th)].filter(Boolean).join(' · ');
      return {
        text: t(n === 1 ? 'desk.changed_thread_one' : 'desk.changed_thread_many', locale, { n, thread: where }),
        kind: t('desk.changed_kind_thread', locale),
        href: feedHref(th, workspaceSlugById.get(th.workspace_id)),
      };
    }
    if (c.kind === 'reply') {
      const ws = workspaceSlugById.get(c.row.workspace_id);
      return {
        text: t('desk.changed_reply', locale, { name: c.row.title }),
        kind: t('desk.changed_kind_reply', locale),
        href: ws ? `/h/${ws}/conversation/${c.row.id}` : null,
      };
    }
    const f = c.mailout.figures;
    return {
      text: t('desk.changed_mailout', locale, {
        subject: c.mailout.subject ?? '—',
        sent: f.sent,
        replies: f.replies,
        unsub: f.unsubscribed,
      }),
      kind: t('desk.changed_kind_mailout', locale),
      href: '/h/conversations',
    };
  }
</script>

<section class="dband changed" aria-labelledby="desk-changed-h" aria-busy={loading} data-testid="desk-changed">
  <h2 class="dband__h" id="desk-changed-h">{t('desk.changed_since', locale, { when: sinceLabel })}</h2>
  {#if loading}
    <ul class="feed" aria-hidden="true">
      <li class="feed__wait"></li>
      <li class="feed__wait"></li>
    </ul>
  {:else}
    {#if changes.length > 0}
      <ul class="feed">
        {#each changes as c (c.kind + c.at)}
          {@const l = line(c)}
          <li>
            <span class="feed__dot" class:feed__dot--quiet={c.kind === 'mailout'}></span>
            {#if l.href}<a href={l.href}>{l.text}<small>{l.kind}</small></a>{:else}<span>{l.text}<small>{l.kind}</small></span>{/if}
          </li>
        {/each}
      </ul>
    {:else if !errored}
      <p class="dband__empty">{quietLabel}</p>
    {/if}
    {#if errored}<p class="dband__err">{t('desk.changed_error', locale)}</p>{/if}
  {/if}
</section>

<style>
  .feed {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-s);
  }
  .feed li {
    display: grid;
    grid-template-columns: 0.5rem 1fr;
    gap: var(--space-s);
    align-items: baseline;
    font-size: var(--text-s);
  }
  .feed a,
  .feed span {
    display: flex;
    flex-direction: column;
    color: var(--text-color);
    text-decoration: none;
    min-inline-size: 0;
  }
  .feed a:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .feed small {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing);
    color: var(--text-faint);
  }
  .feed__dot {
    inline-size: 0.4rem;
    block-size: 0.4rem;
    border-radius: 50%;
    background: var(--primary);
    transform: translateY(-0.1em);
  }
  .feed__dot--quiet {
    background: var(--text-faint);
  }
  .feed__wait {
    block-size: 1.8rem;
    border-radius: var(--radius);
    background: var(--bg-hover);
  }
</style>
