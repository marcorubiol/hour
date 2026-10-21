<script lang="ts">
  /**
   * «HA CAMBIADO» — band 3 of the Desk (ADR-117): what moved since your last
   * visit, nothing to act on. The rows are `changesSince` ($lib/desk-bands);
   * each opens its own sheet. With nothing in it the band stays, as one line
   * that says since when (amends ADR-121 § 5); if a source failed it says so,
   * because a silent band would claim «nothing changed».
   */
  import FirstTimeNote from '$lib/components/FirstTimeNote.svelte';
  import Button from '$lib/components/Button.svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import { t, type Locale } from '$lib/i18n';
  import { lensOn } from '$lib/lenses.svelte';
  import { feedHref, feedThreadName, feedTitle } from '$lib/threads';
  import { changedLensChip, type Change } from '$lib/desk-bands';
  import { ALL, TEAM, chipHref, keyLabel, otherTagsName, type WorkspaceTag } from '$lib/conversation-tags';
  import { fmtCurrency } from '$lib/money';
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
    /** The tags of the scope, to name a reply's when it is not Difusión (ADR-138). */
    tagNames?: readonly WorkspaceTag[];
    locale: Locale;
  }

  let { changes, loading, errored, onretry, quietLabel, sinceLabel, workspaceSlugById, tagNames = [], locale }: Props = $props();

  // The way into Conversations, on the chip the band's news share (ADR-138
  // fase 3): threads only, Equipo; replies under one tag, that tag; a mix, Todas.
  let lensChip = $derived(lensOn('conversations') ? changedLensChip(changes) : null);
  let lensLabel = $derived(
    lensChip === null
      ? ''
      : lensChip === TEAM
        ? t('conversations.view_team', locale)
        : lensChip === ALL
          ? t('lens.conversations', locale)
          : keyLabel(lensChip, tagNames, locale),
  );

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
    if (c.kind === 'payment') {
      const p = c.payment;
      const subject = p.bolo
        ? [p.bolo.venue_name, p.bolo.city].filter(Boolean).join(' · ') || (p.bolo.project?.name ?? '')
        : (p.payer ?? '');
      return {
        text: t(subject ? 'desk.changed_payment' : 'desk.changed_payment_bare', locale, {
          amount: fmtCurrency(p.amount, p.currency, locale),
          subject,
        }),
        kind: t('desk.changed_kind_payment', locale),
        // The deal in Cuentas, as «Te espera» sends an overdue invoice.
        href: lensOn('books') ? (p.bolo ? `/h/books#bolo-${p.bolo.id}` : '/h/books') : null,
      };
    }
    if (c.kind === 'reply') {
      const ws = workspaceSlugById.get(c.row.workspace_id);
      return {
        text: t('desk.changed_reply', locale, { name: c.row.title }),
        kind: [t('desk.changed_kind_reply', locale), otherTagsName(c.row.tags, tagNames, locale)].filter(Boolean).join(' · '),
        href: ws ? `/h/${ws}/conversation/${c.row.id}` : null,
      };
    }
    const ws = workspaceSlugById.get(c.mailout.workspace_id);
    return {
      text: t('desk.changed_mailout', locale, { subject: c.mailout.subject || t('overview.no_subject', locale) }),
      kind: t('desk.changed_kind_mailout', locale),
      // The send itself, as «Abrir el envío» in the lens.
      href: ws ? `/h/${ws}/mailout/${c.mailout.id}` : lensOn('conversations') ? '/h/conversations' : null,
    };
  }
</script>

<section class="dband changed" aria-labelledby="desk-changed-h" aria-busy={loading} data-testid="desk-changed">
  <BlockHead id="desk-changed-h" concept="changed" title={t('desk.changed_since', locale, { when: sinceLabel })}>
    {#if lensChip !== null}<a class="block-head__act" href={chipHref(lensChip, new URLSearchParams())} data-testid="desk-to-conversations" data-chip={lensChip}>{lensLabel} →</a>{/if}
  </BlockHead>
  <FirstTimeNote event="first_team_thread" when={!loading && changes.some((c) => c.kind === 'thread')} />
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
      <EmptyLine text={quietLabel} />
    {/if}
    {#if errored}<p class="load-fail" role="alert"><span>{t('desk.changed_error', locale)}</span><Button size="xs" variant="secondary" onclick={onretry}>{t('ui.retry', locale)}</Button></p>{/if}
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
    gap: var(--space-2xs);
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
    background: var(--brand);
    transform: translateY(-0.1em);
  }
  .feed__dot--quiet {
    background: var(--text-faint);
  }

</style>
