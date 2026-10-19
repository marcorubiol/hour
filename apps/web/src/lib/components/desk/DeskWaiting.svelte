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
  import { lensOn } from '$lib/lenses.svelte';
  import Button from '$lib/components/Button.svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import { localeDayMonth } from '$lib/datetime';
  import { relativeContactDate } from '$lib/conversation';
  import { tick } from 'svelte';
  import { t, type Locale } from '$lib/i18n';
  import type { DeskBucket, DeskConcern, DeskItem, DeskRun, Waiting } from '$lib/desk-feed';

  interface Props {
    waiting: Waiting;
    /** The viewer's day (YYYY-MM-DD). */
    today: string;
    /** Calm keeps overdue and today: what it folds is not offered back here. */
    calm?: boolean;
    feed: DeskBucket[];
    later: { count: number; from: string; until: string } | null;
    loading: boolean;
    errored: boolean;
    /** «Reintentar»: read again what failed (the one voice of a failure). */
    onretry: () => void;
    locale: Locale;
    contextPath: (i: DeskItem) => string;
    /** A conversation row opens its conversation, where the call is resolved. */
    conversationHref: (i: DeskItem) => string | null;
    money: (n: number, cur: string | null) => string;
    /** An AI proposal still waiting for «Añadir» or «Descartar». */
    isGhost: (i: DeskItem) => boolean;
    ontoggle: (taskId: string, done: boolean) => void;
    onremove: (taskId: string) => void;
    onaccept: (taskId: string) => void;
    onanswer: (going: NonNullable<DeskItem['going']>, state: 'going' | 'not_going') => void;
  }

  let {
    waiting,
    today,
    calm = false,
    feed,
    later,
    loading,
    errored,
    onretry,
    locale,
    contextPath,
    conversationHref,
    money,
    isGhost,
    ontoggle,
    onremove,
    onaccept,
    onanswer,
  }: Props = $props();

  let all = $state(false);
  let headEl = $state<HTMLElement | null>(null);
  /** Swapping the lists removes the button that was pressed: the focus goes to
      the band's heading instead of falling to <body> (móvil #9). */
  async function showAll(on: boolean) {
    all = on;
    await tick();
    headEl?.focus();
  }
  let laterOpen = $state(false);
  let feedCount = $derived(feed.reduce((n, b) => n + b.runs.reduce((m, r) => m + r.items.length, 0), 0));

  // A lens the space does not use (ADR-132) is no destination.
  let LENS_HREF = $derived<Record<DeskConcern, string | null>>({
    task: null,
    going: lensOn('planner') ? '/h/planner' : null,
    conversation: lensOn('conversations') ? '/h/conversations' : null,
    money: lensOn('books') ? '/h/books' : null,
  });
  const runHref = (run: DeskRun) => run.items[0]?.href ?? LENS_HREF[run.concern];
  const concernLabel = (c: DeskConcern) => t(`desk.concern_${c}`, locale);
  const laterText = (l: NonNullable<typeof later>) =>
    t(l.count === 1 ? 'desk.later_one' : 'desk.later_many', locale, { n: l.count, day: day(l.until) });

  /** «2 nov», never «02 nov»; today is «hoy». */
  const day = (iso: string) => (iso === today ? t('desk.next_today', locale) : localeDayMonth(iso, locale));

  /** «para el 22 oct», «para hoy»: a date in this column is a deadline unless it says otherwise. */
  const forDay = (iso: string) =>
    iso === today ? t('desk.when_for_today', locale) : t('desk.when_for', locale, { day: localeDayMonth(iso, locale) });

  /** When, in words, and which when (chat 19-10): an answer says when they
      wrote («escribió hace 6 días»), everything else when it is yours
      («para el 22 oct», «vence 25 oct», «vencido»). */
  function whenOf(i: DeskItem): string {
    if (i.concern === 'task') {
      if (i.dueLabel === 'overdue') return t('desk.due_overdue', locale);
      if (i.dueLabel === 'due' && i.dueDay) return `${t('desk.due_due', locale)} ${day(i.dueDay)}`;
      return i.dueDay ? forDay(i.dueDay) : '';
    }
    if (i.repliedAt) return t('desk.when_wrote', locale, { when: relativeContactDate(i.repliedAt, locale) });
    // A proposal (revive) is Hour's suggestion, not a deadline: no date.
    if (i.isProposal) return '';
    if (!i.day) return '';
    if (i.overdue) return t('desk.due_overdue', locale);
    return forDay(i.day);
  }
  const subjectHref = (i: DeskItem) => i.href ?? (i.concern === 'conversation' ? conversationHref(i) : null);
</script>

{#snippet task(item: DeskItem)}
  <input
    type="checkbox"
    class="row__check"
    id="desk-task-{item.taskId}"
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
        <button type="button" class="row__act btn--outline btn--xs" onclick={() => item.taskId && onaccept(item.taskId)}
          >{t('desk.proposal_add', locale)}</button
        ><button type="button" class="row__act row__act--quiet btn--outline btn--xs" onclick={() => item.taskId && onremove(item.taskId)}
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
        {#if href}<a href={href}>{item.subject}</a>{:else if item.concern === 'task'}<!-- The name is the checkbox's
            label: tapping it ticks, a finger's target the size of the line. --><label for="desk-task-{item.taskId}"
            >{item.subject}</label
          >{:else}{item.subject}{/if}
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
          <button
            type="button"
            class="row__act btn--outline btn--xs"
            aria-label={t('desk.going_aria', locale, { subject: item.subject })}
            onclick={() => onanswer(g, 'going')}>{t('pulse.going', locale)}</button
          ><button
            type="button"
            class="row__act row__act--quiet btn--outline btn--xs"
            aria-label={t('desk.not_going_aria', locale, { subject: item.subject })}
            onclick={() => onanswer(g, 'not_going')}
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

{#snippet runs(bucket: DeskBucket)}
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
{/snippet}

<section class="dband waits" aria-labelledby="desk-waits-h" aria-busy={loading}>
  <!-- The region is named by the words alone, not by the count beside them. -->
  <BlockHead
    title={t('desk.band_waiting', locale)}
    titleId="desk-waits-h"
    focusable
    bind:el={headEl}
    count={!loading && !errored && waiting.total > waiting.rows.length && !all
      ? t('desk.waiting_count', locale, { shown: waiting.rows.length, total: waiting.total })
      : null}
  />

  {#if loading}
    <ul class="list" aria-hidden="true">
      {#each [0, 1, 2] as i (i)}<li class="row row--wait">
          <span class="row__subject"
            ><span class="ghost-line" style:inline-size="{60 - i * 8}%">&nbsp;</span><span class="row__ctx"
              ><span class="ghost-line" style:inline-size="30%">&nbsp;</span></span
            ></span
          >
        </li>{/each}
    </ul>
  {:else if errored}
    <p class="load-fail" role="alert"><span>{t('desk.error', locale)}</span><Button size="xs" variant="outline" onclick={onretry}>{t('ui.retry', locale)}</Button></p>
  {:else if all}
    <div class="timeline">
      {#each feed as bucket (bucket.sortKey)}
        {#if bucket.labelKey === 'later'}
          {#if later}
            <section class="bucket">
              <button type="button" class="bucket__head later" aria-expanded={laterOpen} onclick={() => (laterOpen = !laterOpen)}>
                <span class="bucket__label eyebrow eyebrow--sub">{t('desk.bucket_later', locale)}</span>
                <span class="bucket__date">{laterText(later)}</span>
                <span class="bucket__count" aria-hidden="true">{laterOpen ? '↑' : '↓'}</span>
              </button>
              {#if laterOpen}{@render runs(bucket)}{/if}
            </section>
          {/if}
        {:else}
          <section class="bucket" class:bucket--today={bucket.sortKey === 0}>
            <header class="bucket__head" class:bucket__head--overdue={bucket.overdue}>
              <span class="bucket__label eyebrow eyebrow--sub"
                >{bucket.labelKey === 'weekday' ? bucket.weekday : t(`desk.bucket_${bucket.labelKey}`, locale)}</span
              >
              {#if bucket.dateLabel}<span class="bucket__date">{bucket.dateLabel}</span>{/if}
              <span class="bucket__count">{bucket.runs.reduce((n, r) => n + r.items.length, 0)}</span>
            </header>
            {@render runs(bucket)}
          </section>
        {/if}
      {/each}
    </div>
    <button type="button" class="more" onclick={() => showAll(false)}>{t('desk.see_less', locale)}</button>
  {:else if waiting.rows.length === 0}
    <!-- One voice for an empty band, the one «Lo siguiente» and «Ha cambiado» use. -->
    <p class="dband__empty">{t('desk.caughtup_l', locale)} <span class="caughtup__s">{t('desk.caughtup_s', locale)}</span></p>
    {#if feedCount > waiting.rows.length && !calm}
      <button type="button" class="more" onclick={() => showAll(true)}>{t('desk.see_all', locale)} →</button>
    {/if}
  {:else}
    <ul class="list">
      {#each waiting.rows as item (item.id)}{@render row(item)}{/each}
    </ul>
    {#if feedCount > waiting.rows.length && !calm}
      <button type="button" class="more" onclick={() => showAll(true)}>{t('desk.see_all', locale)} →</button>
    {/if}
  {/if}
</section>

<style>
  /* The columns belong to the list, not to each row: verb, subject, when
     and actions fall in one vertical down the whole list (subgrid). */
  .list {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto;
    column-gap: var(--space-s);
    list-style: none;
    margin: 0;
    padding: 0;
    border-block-start: 1px solid var(--border-color-light);
  }
  .row {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
    align-items: baseline;
    padding-block: var(--space-xs);
    border-block-end: 1px solid var(--border-color-light);
  }
  /* The wait row is a row's own lines in ghost: subject and context. */
  .row--wait {
    display: block;
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
    color: var(--suggest-ink);
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
    /* A checkbox's baseline is its bottom edge: down to the subject's line. */
    translate: 0 0.15em;
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
  .row__subject label {
    font: inherit;
    color: inherit;
    cursor: pointer;
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
  /* The system's outline button (base.css) at its own size, as Cuentas'
     row actions; the quiet one drops its edge. */
  .row__act--quiet {
    --btn-border-color: transparent;
    --btn-background-hover: transparent;
    --btn-text-color: var(--text-faint);
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
  /* A finger's room without moving a pixel: the hit area grows, the line
     does not (subject links, the box, the band's own buttons). */
  @media (pointer: coarse) {
    .row__check {
      inline-size: 1.25rem;
      block-size: 1.25rem;
    }
    .row__subject :is(a, label) {
      padding-block: var(--space-xs);
      margin-block: calc(-1 * var(--space-xs));
    }
    .more {
      min-block-size: var(--touch-target);
    }
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
  /* Today is the app's one «today» (tokens.css `--today-*`), never a colour. */
  .bucket--today .bucket__label {
    --eyebrow-color: var(--today-ink);
    font-weight: var(--today-weight);
  }
  .bucket__head--overdue .bucket__label {
    --eyebrow-color: var(--danger);
  }
  .bucket__date {
    font-family: var(--font-display);
    font-style: italic;
    font-size: var(--text-xs);
    color: var(--text-faint);
  }
  .later {
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    color: inherit;
    text-align: start;
    cursor: pointer;
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
  .caughtup__s {
    color: var(--text-faint);
  }

  /* Phone: the action stays on the right, the context drops under the
     subject instead of disappearing. */
  /* Phone: when on the subject's line, the context under the subject, and
     the actions on a line of their own (room for a thumb, the name whole). */
  @media (max-width: 47.999rem) {
    .list {
      display: block;
    }
    .row {
      grid-template-columns: 4.25rem minmax(0, 1fr) auto;
      grid-template-areas: 'verb subject when' 'verb acts acts';
      column-gap: var(--space-s);
      row-gap: 0;
    }
    .row:not(:has(.row__acts > *)) {
      grid-template-areas: 'verb subject when';
    }
    /* A task's only action is its ×: it stays at the end of the line. */
    .row--task {
      grid-template-columns: 4.25rem minmax(0, 1fr) auto auto;
      grid-template-areas: 'verb subject when acts';
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
      justify-self: start;
    }
    .row__acts:not(:has(*)) {
      display: none;
    }
    .run {
      grid-template-columns: 1fr;
    }
  }
</style>
