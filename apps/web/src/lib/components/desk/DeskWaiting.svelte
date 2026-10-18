<script lang="ts">
  /**
   * «TE ESPERA» — band 2 of the Desk (ADR-117). The short list by weight
   * (`rankWaiting`): at most seven rows, each a verb and its action. «Ver
   * todo» turns the band into the whole list by days, the Desk feed as it
   * was minus the agenda (that is the Planner's).
   *
   * One list at a time, never both: a task drawn twice is two checkboxes
   * with one name.
   */
  import { dayMonth } from '$lib/datetime';
  import { relativeContactDate } from '$lib/conversation';
  import { t, type Locale } from '$lib/i18n';
  import { plannerDayHref } from '$lib/planner';
  import type { DeskBucket, DeskConcern, DeskItem, DeskRun, Waiting } from '$lib/desk-feed';

  interface Props {
    waiting: Waiting;
    feed: DeskBucket[];
    later: { count: number; from: string; until: string } | null;
    loading: boolean;
    errored: boolean;
    locale: Locale;
    contextPath: (i: DeskItem) => string;
    personHref: (slug: string | null) => string | null;
    money: (n: number, cur: string | null) => string;
    /** Proposals accepted this session (the persistent «Añadir» is a known gap). */
    isGhost: (i: DeskItem) => boolean;
    ontoggle: (taskId: string, done: boolean) => void;
    onremove: (taskId: string) => void;
    onaccept: (taskId: string) => void;
    onanswer: (going: NonNullable<DeskItem['going']>, state: 'going' | 'not_going') => void;
  }

  let {
    waiting,
    feed,
    later,
    loading,
    errored,
    locale,
    contextPath,
    personHref,
    money,
    isGhost,
    ontoggle,
    onremove,
    onaccept,
    onanswer,
  }: Props = $props();

  let all = $state(false);
  let feedCount = $derived(feed.reduce((n, b) => n + b.runs.reduce((m, r) => m + r.items.length, 0), 0));

  const LENS_HREF: Record<DeskConcern, string | null> = {
    task: null,
    going: '/h/planner',
    conversation: '/h/conversations',
    money: '/h/books',
  };
  const runHref = (run: DeskRun) => run.items[0]?.href ?? LENS_HREF[run.concern];
  const concernLabel = (c: DeskConcern) => t(`desk.concern_${c}`, locale);
  const laterText = (l: NonNullable<typeof later>) =>
    t(l.count === 1 ? 'desk.later_one' : 'desk.later_many', locale, { n: l.count, day: dayMonth(l.until) });

  /** When, in words: the day label of the row's bucket, or the task's own due. */
  function whenOf(i: DeskItem): string {
    if (i.concern === 'task') {
      if (i.dueLabel === 'overdue') return t('desk.due_overdue', locale);
      if (i.dueLabel === 'due' && i.dueDay) return `${t('desk.due_due', locale)} ${dayMonth(i.dueDay)}`;
      return i.dueDay ? dayMonth(i.dueDay) : '';
    }
    if (i.repliedAt) return relativeContactDate(i.repliedAt, locale);
    // A proposal (revive) is Hour's suggestion, not a deadline: no date.
    if (i.isProposal) return '';
    if (!i.day) return '';
    if (i.overdue) return t('desk.due_overdue', locale);
    return dayMonth(i.day);
  }
  const subjectHref = (i: DeskItem) => (i.concern === 'conversation' ? personHref(i.personSlug) : null) ?? i.href;
</script>

{#snippet task(item: DeskItem)}
  <input
    type="checkbox"
    class="row__check"
    aria-label={item.subject}
    checked={item.taskDone}
    onchange={(e) => item.taskId && ontoggle(item.taskId, (e.currentTarget as HTMLInputElement).checked)}
  />
{/snippet}

{#snippet row(item: DeskItem)}
  {#if isGhost(item)}
    <li class="row row--ai">
      <span class="row__verb">{t('desk.proposed', locale)}</span>
      <span class="row__subject"
        >{item.subject}{#if item.reason}<span class="row__ctx">{item.reason}</span>{/if}</span
      >
      <span class="row__when">{whenOf(item)}</span>
      <span class="row__acts">
        <button type="button" class="row__act" onclick={() => item.taskId && onaccept(item.taskId)}
          >{t('desk.proposal_add', locale)}</button
        ><button type="button" class="row__act row__act--quiet" onclick={() => item.taskId && ontoggle(item.taskId, true)}
          >{t('desk.proposal_dismiss', locale)}</button
        >
      </span>
    </li>
  {:else}
    {@const href = subjectHref(item)}
    <li class="row row--{item.concern}" class:row--over={item.overdue} class:row--proposal={item.isProposal}>
      {#if item.concern === 'task'}
        <span class="row__verb">{@render task(item)}</span>
      {:else}
        <span class="row__verb">{t(`desk.verb_${item.verbKey}`, locale)}</span>
      {/if}
      <span class="row__subject">
        {#if href}<a href={href}>{item.subject}</a>{:else}{item.subject}{/if}
        {#if contextPath(item) || item.amount != null}<span class="row__ctx"
            >{[contextPath(item), item.amount != null ? money(item.amount, item.currency) : null]
              .filter(Boolean)
              .join(' · ')}</span
          >{/if}
      </span>
      <span class="row__when" class:row__when--over={item.overdue}>{whenOf(item)}</span>
      <span class="row__acts">
        {#if item.concern === 'going' && item.going}
          {@const g = item.going}
          <button type="button" class="row__act" onclick={() => onanswer(g, 'going')}>{t('pulse.going', locale)}</button
          ><button type="button" class="row__act row__act--quiet" onclick={() => onanswer(g, 'not_going')}
            >{t('pulse.not_going', locale)}</button
          >
        {:else if item.concern === 'task'}
          <button
            type="button"
            class="row__remove"
            aria-label={t('desk.remove_aria', locale, { subject: item.subject })}
            onclick={() => item.taskId && onremove(item.taskId)}>×</button
          >
        {/if}
      </span>
    </li>
  {/if}
{/snippet}

<section class="dband waits" aria-labelledby="desk-waits-h" aria-busy={loading}>
  <h2 class="dband__h" id="desk-waits-h">
    {t('desk.band_waiting', locale)}
    {#if !loading && !errored && waiting.total > waiting.rows.length && !all}
      <span class="dband__count">{t('desk.waiting_count', locale, { shown: waiting.rows.length, total: waiting.total })}</span>
    {/if}
  </h2>

  {#if loading}
    <ul class="list" aria-hidden="true">
      {#each [0, 1, 2] as i (i)}<li class="row row--wait"><span class="row__bar"></span></li>{/each}
    </ul>
  {:else if errored}
    <p class="dband__err">{t('desk.error', locale)}</p>
  {:else if all}
    <div class="timeline">
      {#each feed as bucket (bucket.sortKey)}
        {#if bucket.labelKey === 'later'}
          {#if later}
            <section class="bucket">
              <a class="bucket__head later" href={plannerDayHref('agenda', later.from)}>
                <span class="bucket__label">{t('desk.bucket_later', locale)}</span>
                <span class="bucket__date">{laterText(later)}</span>
                <span class="bucket__count" aria-hidden="true">→</span>
              </a>
            </section>
          {/if}
        {:else}
          <section class="bucket" class:bucket--today={bucket.sortKey === 0}>
            <header class="bucket__head" class:bucket__head--overdue={bucket.overdue}>
              <span class="bucket__label"
                >{bucket.labelKey === 'weekday' ? bucket.weekday : t(`desk.bucket_${bucket.labelKey}`, locale)}</span
              >
              {#if bucket.dateLabel}<span class="bucket__date">{bucket.dateLabel}</span>{/if}
              <span class="bucket__count">{bucket.runs.reduce((n, r) => n + r.items.length, 0)}</span>
            </header>
            {#each bucket.runs as run (run.concern + run.items[0].id)}
              <div class="run run--{run.concern}">
                {#if runHref(run)}
                  <a class="run__label" href={runHref(run)}>{concernLabel(run.concern)}</a>
                {:else}
                  <span class="run__label">{concernLabel(run.concern)}</span>
                {/if}
                <ul class="list run__rows">
                  {#each run.items as item (item.id)}{@render row(item)}{/each}
                </ul>
              </div>
            {/each}
          </section>
        {/if}
      {/each}
    </div>
    <button type="button" class="more" onclick={() => (all = false)}>{t('desk.see_less', locale)}</button>
  {:else if waiting.rows.length === 0}
    <div class="caughtup">
      <p class="caughtup__g" aria-hidden="true">·</p>
      <p class="caughtup__l">{t('desk.caughtup_l', locale)}</p>
      <p class="caughtup__s">{t('desk.caughtup_s', locale)}</p>
    </div>
    {#if feedCount > 0}
      <button type="button" class="more" onclick={() => (all = true)}>{t('desk.see_all', locale, { n: feedCount })} →</button>
    {/if}
  {:else}
    <ul class="list">
      {#each waiting.rows as item (item.id)}{@render row(item)}{/each}
    </ul>
    {#if feedCount > 0}
      <button type="button" class="more" onclick={() => (all = true)}>{t('desk.see_all', locale, { n: feedCount })} →</button>
    {/if}
  {/if}
</section>

<style>
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    border-block-start: 1px solid var(--border-color-light);
  }
  .row {
    display: grid;
    grid-template-columns: 5.5rem minmax(0, 1fr) auto auto;
    align-items: baseline;
    gap: var(--space-s);
    padding-block: var(--space-xs);
    border-block-end: 1px solid var(--border-color-light);
  }
  .row--wait {
    grid-template-columns: 1fr;
    block-size: 2.4rem;
    align-items: center;
  }
  .row__bar {
    display: block;
    block-size: 0.6rem;
    inline-size: 60%;
    border-radius: var(--radius);
    background: var(--bg-hover);
  }
  .row__verb {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-faint);
    text-transform: lowercase;
  }
  .row--over .row__verb {
    color: var(--danger);
  }
  .row--conversation .row__verb {
    color: color-mix(in oklch, var(--primary) 60%, var(--text-muted));
  }
  .row--money .row__verb {
    color: color-mix(in oklch, var(--success) 60%, var(--text-muted));
  }
  .row--over.row--money .row__verb,
  .row--over.row--conversation .row__verb {
    color: var(--danger);
  }
  .row--going .row__verb,
  .row--ai .row__verb,
  .row--proposal .row__verb {
    color: var(--accent-7);
  }
  /* A proposal leans in its subject only; verb and date keep their mono. */
  .row--proposal .row__subject,
  .row--ai .row__subject {
    font-style: italic;
  }
  .row__check {
    inline-size: 0.95rem;
    block-size: 0.95rem;
    margin: 0;
    accent-color: var(--primary);
    cursor: pointer;
  }
  .row__subject {
    display: flex;
    flex-direction: column;
    min-inline-size: 0;
    font-size: var(--text-s);
    color: var(--text-color);
  }
  .row__subject a {
    color: inherit;
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .row__subject a:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .row__ctx {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing);
    color: var(--text-faint);
    font-style: normal;
  }
  .row__when {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-muted);
    white-space: nowrap;
  }
  /* After the base rule, so the overdue date is red (it lost the cascade). */
  .row__when--over {
    color: var(--danger);
  }
  .row__acts {
    display: inline-flex;
    gap: var(--space-xs);
    justify-self: end;
  }
  .row__act {
    padding: var(--space-2xs) var(--space-s);
    border: 1px solid var(--border-color-dark);
    border-radius: var(--radius);
    background: var(--bg-ultra-light);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--text-muted);
    cursor: pointer;
    transition:
      color var(--transition),
      border-color var(--transition);
  }
  .row__act:hover {
    color: var(--text-color);
    border-color: var(--text-muted);
  }
  .row__act--quiet {
    border-color: transparent;
    background: none;
    color: var(--text-faint);
  }
  .row__remove {
    border: 0;
    padding: 0;
    background: none;
    color: var(--text-faint);
    font-size: var(--text-m);
    line-height: 1;
    cursor: pointer;
    opacity: 0;
    transition:
      color var(--transition),
      opacity var(--transition);
  }
  .row:hover .row__remove,
  .row__remove:focus-visible {
    opacity: 1;
  }
  /* No hover on a finger: the × is always there, with a finger's room. */
  @media (hover: none) {
    .row__remove {
      opacity: 1;
      min-inline-size: var(--touch-target);
      min-block-size: var(--touch-target);
    }
  }
  .row__remove:hover {
    color: var(--danger);
  }
  .more {
    margin-block-start: var(--space-s);
    padding: 0;
    border: 0;
    background: none;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing);
    color: var(--text-faint);
    cursor: pointer;
  }
  .more:hover {
    color: var(--text-color);
  }

  /* ── The whole list, by days ── */
  .timeline {
    display: flex;
    flex-direction: column;
  }
  .bucket {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    margin-block-start: var(--space-l);
    padding-block-start: var(--space-s);
    border-block-start: 1px solid var(--border-color-light);
  }
  .bucket:first-child {
    margin-block-start: 0;
  }
  .bucket__head {
    display: flex;
    align-items: baseline;
    gap: var(--space-s);
  }
  .bucket__count {
    margin-inline-start: auto;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-faint);
  }
  .bucket__label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .bucket--today .bucket__label {
    color: var(--primary);
  }
  .bucket__head--overdue .bucket__label {
    color: var(--danger);
  }
  .bucket__date {
    font-family: var(--font-display);
    font-style: italic;
    font-size: var(--text-xs);
    color: var(--text-faint);
  }
  .later {
    color: inherit;
    text-decoration: none;
  }
  .later:hover .bucket__date,
  .later:hover .bucket__count {
    color: var(--text-muted);
  }
  .run {
    display: grid;
    grid-template-columns: 7rem 1fr;
    align-items: start;
  }
  .run__label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing-loose);
    text-transform: uppercase;
    color: var(--text-faint);
    text-decoration: none;
    padding-block: var(--space-xs) 0;
  }
  a.run__label:hover {
    color: var(--text-color);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .run__rows {
    border-block-start: 0;
  }
  .run__rows .row:last-child {
    border-block-end: 0;
  }

  /* ── Caught up ── */
  .caughtup {
    text-align: center;
    padding-block: var(--space-l);
    color: var(--text-faint);
  }
  .caughtup__g {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-xxl);
  }
  .caughtup__l {
    margin: var(--space-xs) 0 0;
    font-family: var(--font-display);
    font-style: italic;
    font-size: var(--text-l);
    color: var(--text-muted);
  }
  .caughtup__s {
    margin: var(--space-2xs) 0 0;
    font-size: var(--text-s);
  }

  /* Phone: the action stays on the right, the context drops under the
     subject instead of disappearing. */
  @media (max-width: 47.999rem) {
    .row {
      grid-template-columns: 4.25rem minmax(0, 1fr) auto;
      grid-template-areas: 'verb subject acts' 'verb when acts';
      row-gap: 0;
    }
    .row--wait {
      grid-template-columns: 1fr;
      grid-template-areas: none;
    }
    .row__verb {
      grid-area: verb;
    }
    .row__subject {
      grid-area: subject;
    }
    .row__when {
      grid-area: when;
    }
    .row__acts {
      grid-area: acts;
      align-self: center;
    }
    .run {
      grid-template-columns: 1fr;
    }
  }
</style>
