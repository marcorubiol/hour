<script lang="ts">
  import Checkbox from '../Checkbox.svelte';
  /**
   * «TE ESPERA», Hoy's third block (ADR-202 § 7, ADR-203 § 3, § 5, § 9). On
   * the ground of the page, no box: one pill per kind with its figure, which
   * always stays, and under them the rows of most weight (`rankWaiting`):
   * three on a normal day, five on a day with nothing, none on a gig day
   * nor in calm (`$lib/hoy` waitingRowCount; the page says how many).
   *
   * THE DOOR IS THE PILL (§ 8): calls and replies open «Te toca» in
   * Conversaciones, a payment Cuentas, a decision the Planner. Tasks have no
   * list of their own, so theirs opens the whole list here, by days (the
   * Desk feed as it was minus the agenda, that is the Planner's).
   *
   * One list at a time, never both: a task drawn twice is two checkboxes
   * with one name. The red is the block's, once (ADR-139 § 6): «3
   * vencidas» in the head; a row says «vencido» in its own ink. The «+» of
   * Hoy lives in this head (ADR-203 § 1), where what it makes appears.
   */
  import type { Snippet } from 'svelte';
  import { lensOn } from '$lib/lenses.svelte';
  import Button from '$lib/components/Button.svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import { localeDayMonth } from '$lib/datetime';
  import { relativeContactDate } from '$lib/conversation';
  import { tick } from 'svelte';
  import { t, type Locale } from '$lib/i18n';
  import type { DeskBucket, DeskConcern, DeskItem, DeskRun, Waiting } from '$lib/desk-feed';
  import { waitingDrawsPills, waitingPills, type WaitingKind } from '$lib/hoy';
  import ChatRow from '$lib/components/ChatRow.svelte';
  import Menu from '$lib/components/Menu.svelte';
  import { SET_ASIDE_SPANS, plusDays } from '$lib/set-aside';
  import type { ChatContext, ChatLine } from '$lib/chat-row';

  interface Props {
    /** Everything that waits, ranked (`rankWaiting` without a cut). */
    waiting: Waiting;
    /** How many of its rows to draw under the pills (`waitingRowCount`). */
    rows: number;
    /** The viewer's day (YYYY-MM-DD). */
    today: string;
    /** The head's act: Hoy's «+» (ADR-203 § 1). */
    add?: Snippet;
    /** What the «+» opens, under the head. */
    composer?: Snippet;
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
    /** The row being released (its id), while the write is in flight. */
    deciding?: string | null;
    /** «Liberar» on a «liberar» row (ADR-165 § 1, ADR-167 § 1). */
    ondecide?: (item: DeskItem) => void;
    /**
     * A conversation row's chat line (mesa, punto 6; `chatLine`): with whom in
     * words and the last thing said. Null draws the plain subject.
     */
    chat?: (item: DeskItem) => ChatLine | null;
    /** Set aside by the viewer («Ahora no», ADR-232), soonest back first. */
    aside?: { item: DeskItem; until: string }[];
    /** What has waited more than a month (ADR-232), oldest first. */
    old?: DeskItem[];
    /** «Ahora no» until a day, or back now with null. Without it, no «ahora no». */
    onaside?: (item: DeskItem, until: string | null) => void;
    /** A gig day (ADR-234): the block is one line, «Te espera · 4 · ver», until opened. */
    folded?: boolean;
    /** «Te han convocado» (ADR-235): «Voy» or «No puedo», right on the row. */
    onanswer?: (item: DeskItem, state: 'going' | 'not_going') => void;
  }

  let {
    waiting,
    rows: rowsIn,
    today,
    add,
    composer,
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
    deciding = null,
    ondecide,
    chat,
    aside = [],
    old = [],
    onaside,
    folded = false,
    onanswer,
  }: Props = $props();

  /** Opened on a gig day: the three rows of a normal day. */
  let unfold = $state(false);
  let rows = $derived(folded && unfold ? 3 : rowsIn);
  let line = $derived(folded && !unfold && !loading && !errored && waiting.total > 0);

  let asideOpen = $state(false);
  let oldOpen = $state(false);
  const asideSpanWord = (n: number) => t(`desk.aside_span_${n}`, locale);
  /** «vuelve el 23 nov», «vuelve mañana». */
  const backWord = (iso: string) =>
    iso === plusDays(today, 1)
      ? t('desk.aside_back_tomorrow', locale)
      : t('desk.aside_back', locale, { day: localeDayMonth(iso, locale) });

  /**
   * The chat row's context in Hoy: the verb is already the turn's word
   * («responder», mesa, punto 6), so the turn joins only when it says what
   * the verb does not («esperando su respuesta»); then where it belongs.
   */
  function chatContext(item: DeskItem, line: ChatLine): ChatContext[] {
    const out: ChatContext[] = [];
    if (line.turn?.reason === 'theirs') out.push({ text: line.turn.text });
    const path = contextPath(item);
    if (path) out.push({ text: path });
    return out;
  }

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
  const overdueWord = (n: number) => t(n === 1 ? 'desk.title_overdue_one' : 'desk.title_overdue_many', locale, { n });
  let feedCount = $derived(feed.reduce((n, b) => n + b.runs.reduce((m, r) => m + r.items.length, 0), 0));
  let shown = $derived(waiting.rows.slice(0, rows));

  // A lens the space does not use (ADR-132) is no destination.
  let LENS_HREF = $derived<Record<DeskConcern, string | null>>({
    task: null,
    conversation: lensOn('conversations') ? '/h/conversations' : null,
    decision: lensOn('planner') ? '/h/planner' : null,
    money: lensOn('books') ? '/h/books' : null,
  });
  /* Each pill's list (§ 8): «Te toca» for calls and replies, Cuentas for a
     payment, the Planner for a decision. Tasks: null, the list here. */
  let PILL_HREF = $derived<Record<WaitingKind, string | null>>({
    calls: lensOn('conversations') ? '/h/conversations?turno=nuestro' : null,
    replies: lensOn('conversations') ? '/h/conversations?turno=nuestro' : null,
    tasks: null,
    money: LENS_HREF.money,
    decisions: LENS_HREF.decision,
  });
  let pills = $derived(waitingPills(waiting.rows));
  const pillWord = (kind: WaitingKind, n: number) => t(`desk.pill_${kind}_${n === 1 ? 'one' : 'many'}`, locale);
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
  <Checkbox
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
        <button type="button" class="row__act btn--secondary btn--xs" onclick={() => item.taskId && onaccept(item.taskId)}
          >{t('desk.proposal_add', locale)}</button
        ><button type="button" class="row__act row__act--quiet btn--secondary btn--xs" onclick={() => item.taskId && onremove(item.taskId)}
          >{t('desk.proposal_dismiss', locale)}</button
        >
      </span>
    </li>
  {:else}
    {@const href = subjectHref(item)}
    {@const line = item.concern === 'conversation' ? (chat?.(item) ?? null) : null}
    <li class="row row--{item.concern}" class:row--over={item.overdue} class:row--proposal={item.isProposal} class:row--chat={line !== null}>
      {#if item.concern === 'task'}
        <span class="row__verb">{@render task(item)}</span>
      {:else}
        <span class="row__verb">{t(`desk.verb_${item.verbKey}`, locale)}</span>
      {/if}
      {#if line}
        <!-- The chat row (mesa, punto 6): with whom in words, the last thing
             said; the verb on its left is the turn. -->
        <div class="row__subject" data-testid="desk-chat">
          <ChatRow
            flush
            {href}
            title={item.subject}
            shape={line.shape}
            words={line.words}
            lead={line.lead}
            last={line.last}
            context={chatContext(item, line)}
          />
        </div>
      {:else}
      <span class="row__subject">
        {#if href}<a href={href}>{item.subject}</a>{:else if item.concern === 'task'}<!-- The name is the checkbox's
            label: tapping it ticks, a finger's target the size of the line. --><label for="desk-task-{item.taskId}"
            >{item.subject}</label
          >{:else}{item.subject}{/if}
        {#if item.convocation || contextPath(item) || item.amount != null}<span class="row__ctx"
            >{[item.convocation ? t('desk.convoked', locale) : null, contextPath(item), item.amount != null ? money(item.amount, item.currency) : null]
              .filter(Boolean)
              .join(' · ')}</span
          >{/if}
      </span>
      {/if}
      <span class="row__when" class:row__when--over={item.overdue}>{whenOf(item)}</span>
      <span class="row__acts">
        {#if onaside}
          <!-- «Ahora no» (ADR-232): the row leaves for a few days, only for
               whoever sets it aside; nothing is deleted. -->
          <Menu
            align="end"
            label={t('desk.aside_aria', locale, { subject: item.subject })}
            triggerClass="row__aside"
            items={SET_ASIDE_SPANS.map((n) => ({ label: asideSpanWord(n), onclick: () => onaside(item, plusDays(today, n)) }))}
          >
            {#snippet trigger()}{t('desk.aside', locale)}{/snippet}
          </Menu>
        {/if}
        {#if item.convocation && onanswer}
          <!-- Convoked (ADR-235): the answer is two words, here. -->
          <button
            type="button"
            class="row__act btn--primary btn--xs"
            data-testid="desk-voy"
            onclick={() => onanswer(item, 'going')}>{t('desk.voy', locale)}</button
          ><button
            type="button"
            class="row__act row__act--quiet btn--secondary btn--xs"
            onclick={() => onanswer(item, 'not_going')}>{t('desk.no_puedo', locale)}</button
          >
        {:else if item.concern === 'task'}
          <button
            type="button"
            class="row__remove"
            aria-label={t('desk.remove_aria', locale, { subject: item.subject })}
            onclick={() => item.taskId && onremove(item.taskId)}>×</button
          >
        {:else if item.option && ondecide}
          <!-- A release is answered here (ADR-165 § 1): only «Liberar», the
               row's own verb (ADR-167 § 1); «Deshacer» comes in the notice. -->
          <button
            type="button"
            class="row__act btn--secondary btn--xs"
            aria-label={t('desk.decision_release_aria', locale, { name: item.subject })}
            disabled={deciding !== null}
            onclick={() => ondecide(item)}>{t('desk.decision_release', locale)}</button
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
  {#if line}
  <!-- A GIG DAY (ADR-234): the day is the piece; what waits is one line. -->
  <p class="waits__line" data-testid="desk-waits-line">
    <span id="desk-waits-h">{t('desk.band_waiting', locale)}</span> · {waiting.total} ·
    <button type="button" class="waits__open" onclick={() => (unfold = true)}>{t('desk.open_see', locale)}</button>
  </p>
  {:else}
  <!-- The region is named by the words alone, not by the count beside them. -->
  <BlockHead
    title={t('desk.band_waiting', locale)}
    titleId="desk-waits-h"
    focusable
    bind:el={headEl}
    count={loading || errored || waiting.total === 0 ? null : waiting.total}
    alertNote={!loading && !errored && waiting.overdue > 0 ? overdueWord(waiting.overdue) : null}
  >
    {#if add}{@render add()}{/if}
  </BlockHead>
  {#if composer}{@render composer()}{/if}

  {#if !loading && !errored && pills.length > 0 && waitingDrawsPills(waiting.total, rows)}
    <!-- One pill per kind and its figure, calm and gig day included; with
         three things or fewer all drawn as rows, only the rows (ADR-229). -->
    <ul class="tallies" data-testid="desk-pills">
      {#each pills as p (p.kind)}
        {@const href = PILL_HREF[p.kind]}
        <li>
          {#if href}
            <a class="tally" {href} data-kind={p.kind}><b>{p.n}</b> {pillWord(p.kind, p.n)}</a>
          {:else if p.kind === 'tasks'}
            <button type="button" class="tally" data-kind={p.kind} aria-pressed={all} onclick={() => showAll(!all)}
              ><b>{p.n}</b> {pillWord(p.kind, p.n)}</button
            >
          {:else}
            <span class="tally" data-kind={p.kind}><b>{p.n}</b> {pillWord(p.kind, p.n)}</span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

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
    <p class="load-fail" role="alert"><span>{t('desk.error', locale)}</span><Button size="xs" variant="secondary" onclick={onretry}>{t('ui.retry', locale)}</Button></p>
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
  {:else if waiting.total === 0}
    <!-- Nothing this week: the head stays for its «+», and says so once. -->
    <EmptyLine text={t('desk.all_quiet', locale)} />
    {#if rows > 0 && feedCount > 0}
      <button type="button" class="more" onclick={() => showAll(true)}>{t('desk.see_all', locale)} →</button>
    {/if}
  {:else if rows > 0}
    <ul class="list" data-testid="desk-waiting-rows">
      {#each shown as item (item.id)}{@render row(item)}{/each}
    </ul>
    {#if feedCount > shown.length}
      <button type="button" class="more" onclick={() => showAll(true)}>{t('desk.see_all', locale)} →</button>
    {/if}
  {/if}

  {#if !loading && !errored && (rows > 0 || (folded && waiting.total === 0)) && (aside.length > 0 || old.length > 0)}
    <!-- The two folds at the foot (ADR-232): what you set aside, and what has
         waited more than a month. Folded; neither counts in the head. -->
    <div class="folds">
      {#if aside.length > 0}
        <button type="button" class="fold" aria-expanded={asideOpen} data-testid="desk-aside" onclick={() => (asideOpen = !asideOpen)}
          >{t('desk.aside_fold', locale)} · {aside.length} <span aria-hidden="true">{asideOpen ? '↑' : '↓'}</span></button
        >
        {#if asideOpen}
          <ul class="list list--aside">
            {#each aside as a (a.item.id)}
              <li class="row row--away">
                <span class="row__verb">{a.item.concern === 'task' ? t('desk.concern_task', locale) : t(`desk.verb_${a.item.verbKey}`, locale)}</span>
                <span class="row__subject">{a.item.subject}</span>
                <span class="row__when">{backWord(a.until)}</span>
                <span class="row__acts">
                  {#if onaside}<button
                      type="button"
                      class="row__act btn--secondary btn--xs"
                      aria-label={t('desk.aside_bring_aria', locale, { subject: a.item.subject })}
                      onclick={() => onaside(a.item, null)}>{t('desk.aside_bring', locale)}</button
                    >{/if}
                </span>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
      {#if old.length > 0}
        <button type="button" class="fold" aria-expanded={oldOpen} data-testid="desk-old" onclick={() => (oldOpen = !oldOpen)}
          >{t('desk.old_fold', locale)} · {old.length} <span aria-hidden="true">{oldOpen ? '↑' : '↓'}</span></button
        >
        {#if oldOpen}
          <ul class="list list--old">
            {#each old as item (item.id)}{@render row(item)}{/each}
          </ul>
        {/if}
      {/if}
    </div>
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
    border-block-start: var(--line-hairline) solid var(--border-color-light);
  }
  .row {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
    align-items: baseline;
    padding-block: var(--space-xs);
    border-block-end: var(--line-hairline) solid var(--border-color-light);
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
  /* NO RED ON THE ROW (ADR-139 § 6): the block says «3 vencidas» once, in
     its head; the row keeps its concern's ink and says «vencido» in words. */
  .row--conversation .row__verb {
    color: color-mix(in oklch, var(--brand) 60%, var(--text-muted));
  }
  .row--money .row__verb {
    color: color-mix(in oklch, var(--success) 60%, var(--text-muted));
  }
  .row--ai .row__verb,
  .row--proposal .row__verb {
    color: var(--suggest-ink);
  }
  /* A proposal leans in its subject only; verb and date keep their mono. */
  .row--proposal .row__subject,
  .row--ai .row__subject {
    font-style: italic;
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
  }
  /* WHOLE TEXT IN TWO LINES BEFORE AN ELLIPSIS (ADR-229): «Teatre d…» said
     nothing. The chat row's one-line cut is the list's; here it wraps. */
  .row__subject :global(.chat__name) {
    flex-wrap: wrap;
    column-gap: var(--space-xs);
  }
  .row__subject :global(.chat__title),
  .row__subject :global(.chat__words),
  .row__subject :global(.chat__last),
  .row__subject :global(.chat__ctx) {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    white-space: normal;
    overflow-wrap: anywhere;
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
  /* The overdue date is the row's strongest word, in ink, not in red. */
  .row__when--over {
    color: var(--text-color);
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
  /* «Ahora no» (ADR-232): a word in the verb's mono, faint; on a mouse it
     shows with the row, like the ×. Its button is the Menu's. */
  .row__acts :global(.row__aside) {
    padding: 0;
    border: 0;
    background: none;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing);
    color: var(--text-faint);
    white-space: nowrap;
    cursor: pointer;
  }
  .row__acts :global(.row__aside:hover),
  .row__acts :global(.row__aside[aria-expanded='true']) {
    color: var(--text-color);
  }
  @media (hover: hover) {
    .row__acts :global(.row__aside) {
      opacity: 0;
      transition: opacity var(--transition);
    }
    .row:hover .row__acts :global(.row__aside),
    .row:focus-within .row__acts :global(.row__aside) {
      opacity: 1;
    }
  }
  @media (pointer: coarse) {
    .row__acts :global(.row__aside) {
      min-block-size: var(--touch-target);
    }
  }
  .waits__line {
    margin: 0;
    font-size: var(--text-s);
    color: var(--text-muted);
  }
  .waits__open {
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-color);
    font: inherit;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  @media (pointer: coarse) {
    .waits__open {
      min-block-size: var(--touch-target);
    }
  }
  .folds {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-xs);
    margin-block-start: var(--space-s);
  }
  .fold {
    padding: 0;
    border: 0;
    background: none;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing);
    color: var(--text-faint);
    cursor: pointer;
  }
  .fold:hover {
    color: var(--text-color);
  }
  @media (pointer: coarse) {
    .fold {
      min-block-size: var(--touch-target);
    }
  }
  .list--aside,
  .list--old {
    align-self: stretch;
  }
  .row--away .row__subject {
    color: var(--text-muted);
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

  /* THE PILLS (design-system rules 2 and 9): sunk into the ground, a figure
     and its word; each its own door. Not named `.pill`: base.css reads any
     class containing the word as the filter pill. */
  .tallies {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-xs);
    margin: 0 0 var(--space-s);
    padding: 0;
    list-style: none;
  }
  .tallies > li {
    display: flex;
    min-inline-size: 0;
  }
  /* A tile: the figure in the display serif over its word (drawing S), four
     to a row; a fifth kind, rare, wraps to a second row. */
  .tally {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0;
    inline-size: 100%;
    padding: var(--space-xs) var(--space-s);
    border: 0;
    border-radius: var(--radius-m);
    background: var(--bg-light);
    color: var(--text-muted);
    font: inherit;
    font-size: var(--text-xs);
    text-align: start;
    text-decoration: none;
    cursor: pointer;
  }
  span.tally {
    cursor: default;
  }
  .tally b {
    font-family: var(--font-display);
    font-size: var(--text-xl);
    font-weight: 400;
    line-height: 1.2;
    color: var(--heading-color);
    font-variant-numeric: tabular-nums;
  }
  a.tally:hover,
  button.tally:hover,
  button.tally[aria-pressed='true'] {
    background: var(--bg-hover);
  }
  @media (pointer: coarse) {
    .tally {
      min-block-size: var(--touch-target);
    }
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
    border-block-start: var(--line-hairline) solid var(--border-color-light);
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
    .row:not(:has(.row__acts > :global(*))) {
      grid-template-areas: 'verb subject when';
    }
    /* «Ahora no» and a task's × are small: under the when, at the end, beside
       the subject's second line rather than on a line of their own (ADR-232).
       A row with a real button («Liberar») keeps its own line. */
    .row:has(.row__acts > :global(*)):not(:has(.row__act)) {
      grid-template-areas: 'verb subject when' 'verb subject acts';
    }
    .row:has(.row__acts > :global(*)):not(:has(.row__act)) .row__acts {
      justify-self: end;
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
