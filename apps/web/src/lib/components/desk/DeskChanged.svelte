<script lang="ts">
  /**
   * «HA CAMBIADO» — band 3 of the Desk (ADR-117): what moved since your last
   * visit, nothing to act on. The rows are `changesSince` ($lib/desk-bands);
   * each opens its own sheet. With nothing in it the band stays, as one line
   * that says since when (amends ADR-121 § 5); if a source failed it says so,
   * because a silent band would claim «nothing changed».
   */
  import Button from '$lib/components/Button.svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import { t, type Locale } from '$lib/i18n';
  import { feedHref, feedThreadName, feedTitle } from '$lib/threads';
  import type { Change } from '$lib/desk-bands';
  import MailoutFigures from '$lib/components/MailoutFigures.svelte';

  interface Props {
    changes: Change[];
    loading: boolean;
    errored: boolean;
    /** «Reintentar»: read again what failed (the one voice of a failure). */
    onretry: () => void;
    /** «Nada nuevo desde tu última visita, hace 3 h»: what an empty band says. */
    quietLabel: string;
    /** The instant «since» means, already formatted for the eyebrow. */
    sinceLabel: string;
    workspaceSlugById: Map<string, string>;
    locale: Locale;
  }

  let { changes, loading, errored, onretry, quietLabel, sinceLabel, workspaceSlugById, locale }: Props = $props();

  function line(c: Change): { text: string; kind: string; href: string | null } {
    if (c.kind === 'thread') {
      const th = c.thread;
      const n = th.unread_count;
      const where = [feedThreadName(th, locale), feedTitle(th)].filter(Boolean).join(' · ');
      return {
        text: t(n === 1 ? 'desk.changed_thread_one' : 'desk.changed_thread_many', locale, { n, thread: where }),
        // A bolo's facet thread («Técnica») is the bolo's, not «the team's».
        kind: t(th.anchor_kind === 'bolo' ? 'desk.changed_kind_bolo' : 'desk.changed_kind_thread', locale),
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
    const ws = workspaceSlugById.get(c.mailout.workspace_id);
    return {
      text: t('desk.changed_mailout', locale, { subject: c.mailout.subject || t('overview.no_subject', locale) }),
      kind: t('desk.changed_kind_mailout', locale),
      // The send itself, as «Abrir el envío» in the lens.
      href: ws ? `/h/${ws}/mailout/${c.mailout.id}` : '/h/conversations',
    };
  }
</script>

<section class="dband changed" aria-labelledby="desk-changed-h" aria-busy={loading} data-testid="desk-changed">
  <BlockHead id="desk-changed-h" title={t('desk.changed_since', locale, { when: sinceLabel })} />
  {#if loading}
    <ul class="feed" aria-hidden="true">
      {#each [0, 1] as i (i)}
        <li>
          <span class="feed__dot feed__dot--quiet"></span>
          <div class="feed__body">
            <span class="ghost-line" style:inline-size="{70 - i * 15}%">&nbsp;</span>
            <small><span class="ghost-line" style:inline-size="25%">&nbsp;</span></small>
          </div>
        </li>
      {/each}
    </ul>
  {:else}
    {#if changes.length > 0}
      <ul class="feed">
        {#each changes as c (c.kind + c.at)}
          {@const l = line(c)}
          <li>
            <span class="feed__dot" class:feed__dot--quiet={c.kind === 'mailout'}></span>
            <div class="feed__body">
              {#if l.href}<a href={l.href}>{l.text}</a>{:else}<span>{l.text}</span>{/if}
              {#if c.kind === 'mailout'}
                {@const f = c.mailout.figures}
                <!-- One voice for a send's figures, the lens's (ADR-126 § 9). -->
                <MailoutFigures
                  {locale}
                  figures={[
                    { key: 'delivered', n: f.delivered },
                    { key: 'replies', n: f.replies },
                    { key: 'bounced', n: f.bounced, warn: true },
                    { key: 'unsubscribed', n: f.unsubscribed },
                  ]}
                />
              {/if}
              <small
                >{l.kind}{#if c.kind === 'mailout' && c.mailout.simulated}{' · '}{t('mailout.simulated_mark', locale)}{/if}</small
              >
            </div>
          </li>
        {/each}
      </ul>
    {:else if !errored}
      <p class="dband__empty">{quietLabel}</p>
    {/if}
    {#if errored}<p class="load-fail" role="alert"><span>{t('desk.changed_error', locale)}</span><Button size="xs" variant="outline" onclick={onretry}>{t('ui.retry', locale)}</Button></p>{/if}
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
  .feed__body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-inline-size: 0;
    color: var(--text-color);
  }
  .feed__body > a {
    color: inherit;
    text-decoration: none;
  }
  .feed__body > a:hover {
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

</style>
