<script lang="ts">
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
  import { localeDayMonth } from '$lib/datetime';
  import { relativeContactDate } from '$lib/conversation';
  import { tick } from 'svelte';
  import { t, type Locale } from '$lib/i18n';
  import type { DeskBucket, DeskConcern, DeskItem, DeskRun, Waiting } from '$lib/desk-feed';
  import { waitingDrawsPills, waitingKind, waitingPills, type WaitingKind } from '$lib/hoy';
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
    /** «Te han convocado» (ADR-235): «Voy» or «No puedo», right on the row. */
    onanswer?: (item: DeskItem, state: 'going' | 'not_going') => void;
    /** ADR-241 Fase 4: «Aplicar» or «Descartar» a remote calendar edit on a date. */
    oncalendarproposal?: (proposalId: string, action: 'apply' | 'dismiss') => void;
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
    onanswer,
    oncalendarproposal,
  }: Props = $props();

  /* No fold outside calm (Marco, 20-11, ADR-238): hiding it is calm's job. */
  let rows = $derived(rowsIn);

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
  let activeKind = $state<WaitingKind | null>(null);
  let headEl = $state<HTMLElement | null>(null);
  /** Swapping the lists removes the button that was pressed: the focus goes to
      the band's heading instead of falling to <body> (móvil #9). */
  async function showAll(on: boolean) {
    activeKind = null;
    all = on;
    await tick();
    headEl?.focus();
  }
  function toggleKind(kind: WaitingKind) {
    all = false;
    activeKind = effectiveKind === kind ? null : kind;
  }
  let laterOpen = $state(false);
  let feedCount = $derived(feed.reduce((n, b) => n + b.runs.reduce((m, r) => m + r.items.length, 0), 0));
  let shown = $derived(waiting.rows.slice(0, rows));

  // A lens the space does not use (ADR-132) is no destination.
  let LENS_HREF = $derived<Record<DeskConcern, string | null>>({
    task: null,
    conversation: lensOn('conversations') ? '/h/conversations' : null,
    decision: lensOn('planner') ? '/h/planner' : null,
    money: lensOn('books') ? '/h/books' : null,
  });
  /* Each pill filters «Te espera» in place; when active, kinds that own a lens
     offer a quiet link at the foot of the filtered list. */
  let PILL_HREF = $derived<Record<WaitingKind, string | null>>({
    calls: lensOn('conversations') ? '/h/conversations?turno=nuestro' : null,
    replies: lensOn('conversations') ? '/h/conversations?turno=nuestro' : null,
    tasks: null,
    money: LENS_HREF.money,
    decisions: LENS_HREF.decision,
  });
  let PILL_LENS_LABEL = $derived<Record<WaitingKind, string | null>>({
    calls: t('lens.conversations', locale),
    replies: t('lens.conversations', locale),
    tasks: null,
    money: t('lens.money', locale),
    decisions: t('lens.planner', locale),
  });
  let pills = $derived(waitingPills(waiting.rows));
  let effectiveKind = $derived<WaitingKind | null>(
    activeKind && pills.some((p) => p.kind === activeKind) ? activeKind : null,
  );
  let filteredRows = $derived(
    effectiveKind ? waiting.rows.filter((i) => waitingKind(i) === effectiveKind) : shown,
  );
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
    if (i.repliedAt) return relativeContactDate(i.repliedAt, locale);
    // A proposal (revive) is Hour's suggestion, not a deadline: no date.
    if (i.isProposal) return '';
    if (!i.day) return '';
    if (i.overdue) return t('desk.due_overdue', locale);
    return forDay(i.day);
  }
  const subjectHref = (i: DeskItem) => i.href ?? (i.concern === 'conversation' ? conversationHref(i) : null);

  /* The row is a sentence (Marco, 23-11-2026): who and what, around the name,
     which stays the link. Only the calls with words of their own; a task, a
     proposal or a calendar row is already its own sentence. */
  const SAYS = new Set(['reply', 'followup', 'chase', 'check', 'revive', 'remind', 'decide', 'release', 'answer']);
  function sayOf(i: DeskItem): { before: string; after: string } {
    if (i.isProposal || !i.verbKey || !SAYS.has(i.verbKey)) return { before: '', after: '' };
    const amount = i.amount != null ? money(i.amount, i.currency) : '';
    const [before, after = ''] = t(`desk.say_${i.verbKey}`, locale, { name: '\u0000', amount }).split('\u0000');
    return { before: before.trim(), after: after.trim() };
  }

  /* What repeats is one row (Marco, 23-11-2026): several calls to say whether
     you go are «You're on the list for 3 shows», answered all at once or one
     by one. */
  let oneByOne = $state(false);
  let calls = $derived(waiting.rows.filter((i) => i.convocation));
  type Entry = { key: string; item: DeskItem | null };
  function grouped(list: readonly DeskItem[]): Entry[] {
    if (oneByOne || calls.length < 2 || !onanswer) return list.map((item) => ({ key: item.id, item }));
    const out: Entry[] = [];
    let placed = false;
    for (const item of list) {
      if (!item.convocation) out.push({ key: item.id, item });
      else if (!placed) {
        out.push({ key: 'calls', item: null });
        placed = true;
      }
    }
    return out;
  }
  function goingToAll() {
    for (const c of calls) onanswer?.(c, 'going');
  }
</script>

{#snippet row(item: DeskItem)}
  {@const when = whenOf(item)}
  {#if isGhost(item)}
    <li class="row row--ai row--has-acts">
      <div class="row__body">
        <div class="row__head">
          <span class="row__title">{item.subject}</span>
        </div>
        <div class="row__meta">
          <span>{t('desk.proposed', locale)}</span>
          {#if item.reason}<span class="row__meta-sep" aria-hidden="true">·</span><span>{item.reason}</span>{/if}
          {#if when}<span class="row__meta-sep" aria-hidden="true">·</span><span class="row__meta-when">{when}</span>{/if}
        </div>
      </div>
      <div class="row__tail">
        <span class="row__acts">
          <button type="button" class="row__act row__act--main btn--secondary btn--xs" onclick={() => item.taskId && onaccept(item.taskId)}
            >{t('desk.proposal_add', locale)}</button
          ><button type="button" class="row__act row__act--quiet btn--secondary btn--xs" onclick={() => item.taskId && onremove(item.taskId)}
            >{t('desk.proposal_dismiss', locale)}</button
          >
        </span>
      </div>
    </li>
  {:else}
    {@const href = subjectHref(item)}
    {@const say = sayOf(item)}
    {@const line = item.concern === 'conversation' ? (chat?.(item) ?? null) : null}
    {@const hasInlineActs = Boolean(
      (item.convocation && onanswer) ||
        (item.option && ondecide) ||
        (item.calendarProposal && oncalendarproposal),
    )}
    {@const ctxParts = line
      ? chatContext(item, line).map((c) => c.text)
      : [contextPath(item), item.amount != null && !say.before && !say.after ? money(item.amount, item.currency) : null].filter((x): x is string => Boolean(x))}
    <li
      class="row row--{item.concern}"
      class:row--door={Boolean(href)}
      class:row--over={item.overdue}
      class:row--proposal={item.isProposal}
      class:row--chat={line !== null}
      class:row--has-acts={hasInlineActs}
    >
      <div class="row__body" data-testid={line ? 'desk-chat' : undefined}>
        <div class="row__head">
          {#if say.before}<span class="row__say">{say.before}</span>{/if}
          {#if href}
            <a class="row__title" {href}>{item.subject}</a>
          {:else}
            <span class="row__title">{item.subject}</span>
          {/if}
          {#if say.after}<span class="row__say">{say.after}</span>{/if}
          {#if line && line.words.length > 0}
            <span class="row__qual">{line.words.join(' · ')}</span>
          {/if}
        </div>

        {#if line && (line.lead || line.last)}
          <p class="row__excerpt">
            {#if line.lead}<span class="row__lead">{line.lead}{line.last ? ':' : ''}</span>{#if line.last}{' '}{/if}{/if}{line.last ?? ''}
          </p>
        {/if}

        {#if ctxParts.length > 0 || when}
          <!-- Under the sentence, the why: where it belongs and what it is
               about, in the body's face (no mono verb line, no dot). -->
          <div class="row__meta">
            {#each ctxParts as part, i (i)}
              {#if i > 0}<span class="row__meta-sep" aria-hidden="true">·</span>{/if}
              <span>{part}</span>
            {/each}
            {#if when}
              {#if ctxParts.length > 0}<span class="row__meta-sep" aria-hidden="true">·</span>{/if}
              <span class="row__meta-when" class:row__when--over={item.overdue}>{when}</span>
            {/if}
          </div>
        {/if}
      </div>

      <div class="row__tail">
        <span class="row__acts">
          {#if onaside}
            <!-- «Ahora no» (ADR-232): the row leaves for a few days, only for
                 whoever sets it aside; nothing is deleted. -->
            <span class="row__aside-slot">
              <Menu
                align="end"
                label={t('desk.aside_aria', locale, { subject: item.subject })}
                triggerClass="row__aside"
                items={SET_ASIDE_SPANS.map((n) => ({ label: asideSpanWord(n), onclick: () => onaside(item, plusDays(today, n)) }))}
              >
                {#snippet trigger()}{t('desk.aside', locale)}{/snippet}
              </Menu>
            </span>
          {/if}
          {#if item.convocation && onanswer}
            <!-- Convoked (ADR-235): the answer is two words, here. -->
            <button
              type="button"
              class="row__act row__act--main btn--secondary btn--xs"
              data-testid="desk-voy"
              onclick={() => onanswer(item, 'going')}>{t('desk.voy', locale)}</button
            ><button
              type="button"
              class="row__act row__act--quiet btn--secondary btn--xs"
              onclick={() => onanswer(item, 'not_going')}>{t('desk.no_puedo', locale)}</button
            >
          {:else if item.calendarProposal && oncalendarproposal}
            <!-- ADR-241 Fase 4: remote calendar edit on a date → Aplicar · Descartar. -->
            <button
              type="button"
              class="row__act row__act--main btn--secondary btn--xs"
              data-testid="desk-cal-apply"
              onclick={() => oncalendarproposal(item.calendarProposal!, 'apply')}>{t('calendar.proposal_apply', locale)}</button
            ><button
              type="button"
              class="row__act row__act--quiet btn--secondary btn--xs"
              data-testid="desk-cal-dismiss"
              onclick={() => oncalendarproposal(item.calendarProposal!, 'dismiss')}>{t('calendar.proposal_dismiss', locale)}</button
            >
          {:else if item.concern === 'task'}
            <!-- A task ends with its word, «done», like any row ends with its
                 verb (no checkbox on the left). -->
            <button
              type="button"
              class="row__act row__act--main btn--secondary btn--xs"
              data-testid="desk-task-done"
              aria-label={t('desk.task_done_aria', locale, { subject: item.subject })}
              onclick={() => item.taskId && ontoggle(item.taskId, true)}>{t('desk.task_done', locale)}</button
            ><button
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
              class="row__act row__act--main btn--secondary btn--xs"
              aria-label={t('desk.decision_release_aria', locale, { name: item.subject })}
              disabled={deciding !== null}
              onclick={() => ondecide(item)}>{t('desk.decision_release', locale)}</button
            >
          {:else if href && item.verbKey && item.verbKey !== 'calendar_proposal'}
            <!-- One word when the row opens: what you will do there. The name is
                 already the link, so the word is the same door for the eye
                 only (no second stop for the keyboard). -->
            <a class="row__act row__act--main row__verb btn--secondary btn--xs" {href} tabindex="-1" aria-hidden="true"
              >{t(`desk.verb_${item.verbKey}`, locale)}</a
            >
          {/if}
        </span>
      </div>
    </li>
  {/if}
{/snippet}

{#snippet headWords()}
  {#if !loading && !errored && pills.length > 0 && waitingDrawsPills(waiting.total, rows)}
    <!-- One word per kind and its figure, calm included; a word filters «Te
         espera» in place without leaving Hoy. Only kinds that are there: no
         word at zero. With three things or fewer all drawn as rows, only the
         rows (ADR-229). -->
    <span class="kinds" role="group" aria-label={t('desk.band_waiting', locale)} data-testid="desk-pills">
      {#each pills as p, i (p.kind)}
        {#if i > 0}<span class="kinds__sep" aria-hidden="true">·</span>{/if}
        <button
          type="button"
          class="kind"
          class:kind--off={effectiveKind !== null && effectiveKind !== p.kind}
          data-kind={p.kind}
          aria-pressed={effectiveKind === p.kind}
          onclick={() => toggleKind(p.kind)}><b>{p.n}</b> {pillWord(p.kind, p.n)}</button
        >
      {/each}
      {#if effectiveKind}
        <span class="kinds__sep" aria-hidden="true">·</span>
        <button type="button" class="kind" onclick={() => (activeKind = null)}>{t('desk.kinds_all', locale)}</button>
      {/if}
    </span>
  {:else if !loading && !errored && waiting.total === 0 && !all}
    <span class="kinds__none" data-testid="desk-waiting-none">{t('desk.all_quiet', locale)}</span>
  {/if}
{/snippet}

{#snippet callsRow()}
  <li class="row row--decision row--has-acts" data-testid="desk-calls">
    <div class="row__body">
      <div class="row__head">
        <span class="row__title">{t('desk.calls_many', locale, { n: calls.length })}</span>
      </div>
      <div class="row__meta">
        {#each calls.slice(0, 3) as c, i (c.id)}
          {#if i > 0}<span class="row__meta-sep" aria-hidden="true">·</span>{/if}
          <span>{c.subject}</span>
        {/each}
        {#if calls.length > 3}<span class="row__meta-sep" aria-hidden="true">·</span><span>…</span>{/if}
      </div>
    </div>
    <div class="row__tail">
      <span class="row__acts">
        <button type="button" class="row__act row__act--quiet btn--secondary btn--xs" onclick={() => (oneByOne = true)}
          >{t('desk.calls_one_by_one', locale)}</button
        ><button type="button" class="row__act row__act--main btn--secondary btn--xs" data-testid="desk-voy-all" onclick={goingToAll}
          >{t('desk.calls_going_all', locale)}</button
        >
      </span>
    </div>
  </li>
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
  <!-- The pass's voice (Marco, 23-11-2026): the title alone, no figure and no
       red note (each row says its own «due» in amber); the filter is words on
       the title's line, and an empty block says so there, once. -->
  <BlockHead title={t('desk.band_waiting', locale)} titleId="desk-waits-h" focusable display bind:el={headEl} inline={headWords}>
    {#if add}{@render add()}{/if}
  </BlockHead>
  {#if composer}{@render composer()}{/if}

  {#if loading}
    <ul class="list" aria-hidden="true">
      {#each [0, 1, 2] as i (i)}<li class="row row--wait">
          <div class="row__body">
            <span class="ghost-line" style:inline-size="{60 - i * 8}%">&nbsp;</span>
            <span class="ghost-line" style:inline-size="30%">&nbsp;</span>
          </div>
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
    <!-- Nothing this week: the head says so on its line, once; no prize. -->
    {#if rows > 0 && feedCount > 0}
      <button type="button" class="more" onclick={() => showAll(true)}>{t('desk.see_all', locale)} →</button>
    {/if}
  {:else if effectiveKind || rows > 0}
    <ul class="list" data-testid="desk-waiting-rows">
      {#each grouped(filteredRows) as e (e.key)}{#if e.item}{@render row(e.item)}{:else}{@render callsRow()}{/if}{/each}
    </ul>
    {#if effectiveKind}
      {@const lensHref = PILL_HREF[effectiveKind]}
      {@const lensLabel = PILL_LENS_LABEL[effectiveKind]}
      <div class="waits__foot">
        <button type="button" class="more" onclick={() => (activeKind = null)}>{t('desk.see_less', locale)}</button>
        {#if lensHref && lensLabel}
          <a class="more waits__lens" href={lensHref} data-testid="desk-pill-lens">{lensLabel} →</a>
        {:else if feedCount > filteredRows.length}
          <button type="button" class="more" onclick={() => showAll(true)}>{t('desk.see_all', locale)} →</button>
        {/if}
      </div>
    {:else if feedCount > shown.length}
      <button type="button" class="more" onclick={() => showAll(true)}>{t('desk.see_all', locale)} →</button>
    {/if}
  {/if}

  {#if !loading && !errored && rows > 0 && (aside.length > 0 || old.length > 0)}
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
              <li class="row row--away row--has-acts">
                <div class="row__body">
                  <div class="row__head">
                    <span class="row__title">{a.item.subject}</span>
                  </div>
                  <div class="row__meta">
                    <span>{a.item.concern === 'task' ? t('desk.concern_task', locale) : t(`desk.verb_${a.item.verbKey}`, locale)}</span>
                    <span class="row__meta-sep" aria-hidden="true">·</span>
                    <span>{backWord(a.until)}</span>
                  </div>
                </div>
                <div class="row__tail">
                  <span class="row__acts">
                    {#if onaside}<button
                        type="button"
                        class="row__act btn--secondary btn--xs"
                        aria-label={t('desk.aside_bring_aria', locale, { subject: a.item.subject })}
                        onclick={() => onaside(a.item, null)}>{t('desk.aside_bring', locale)}</button
                      >{/if}
                  </span>
                </div>
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
</section>

<style>
  /* Unified editorial waiting rows: one left axis for every title (conversation,
     convocation, task, invoice), zero stranded middle date column, and tactile
     hover feedback while staying on the page ground (Height 3, design-system). */
  .waits {
    container: waits / inline-size;
  }
  /* Each row in its soft box (Marco, 23-11-2026: «más tranquilo viendo
     cajas», at half the first tint): a touch of ink on the ground, the
     button's radius, a breath between boxes and no hairline. */
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2xs);
    list-style: none;
    margin: var(--space-s) 0 0;
    padding: 0;
  }
  .row {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas: 'body tail';
    column-gap: var(--space-s);
    row-gap: var(--space-2xs);
    align-items: start;
    padding-block: var(--space-s);
    padding-inline: var(--space-s);
    border-radius: var(--radius-m);
    background: var(--bg-box);
    transition: background var(--transition);
  }
  .row--door {
    cursor: pointer;
  }
  .row--has-acts {
    align-items: center;
  }
  @media (hover: hover) and (pointer: fine) {
    .row:not(.row--wait):hover {
      background: var(--bg-box-hover);
    }
    .row--door:active:not(:has(.row__tail :active)) {
      background: color-mix(in oklch, var(--bg), var(--text-color) 9%);
    }
  }
  .row:not(.row--wait):focus-within {
    background: var(--bg-box-hover);
  }
  .row--wait {
    display: block;
  }
  /* Center body: unified title + optional 1-line excerpt + quiet metadata line. */
  .row__body {
    grid-area: body;
    display: flex;
    flex-direction: column;
    gap: var(--space-2xs);
    min-inline-size: 0;
  }
  .row__head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: var(--space-xs);
    min-inline-size: 0;
  }
  .row__title {
    font-size: var(--text-s);
    font-weight: 500;
    line-height: 1.35;
    color: var(--heading-color);
    text-decoration: none;
    overflow-wrap: anywhere;
  }
  a.row__title::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 0;
    border-radius: inherit;
  }
  a.row__title:hover,
  a.row__title:focus-visible {
    text-decoration: none;
  }
  a.row__title:focus-visible {
    outline: none;
  }
  a.row__title:focus-visible::after {
    outline: var(--focus-width) solid var(--focus-color);
    outline-offset: var(--focus-offset);
  }
  .row--proposal .row__title,
  .row--ai .row__title {
    font-style: italic;
  }
  .row--away .row__title {
    color: var(--text-muted);
    font-weight: 400;
  }
  .row__qual {
    font-size: var(--text-xs);
    color: var(--text-faint);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .row__excerpt {
    margin: 0;
    font-size: var(--text-s);
    line-height: 1.35;
    color: var(--text-muted);
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;
    line-clamp: 1;
    overflow: hidden;
  }
  .row__lead {
    color: var(--text-color);
  }
  .row__meta {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: var(--space-xs);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  .row__meta-sep {
    opacity: 0.6;
  }
  .row__meta-when {
    color: var(--text-muted);
  }

  /* Right tail: flush-right date OR flush-right inline action buttons, never
     stranded in the middle of the row. On non-action rows, «not now» sits to
     the left of the date so the date lands flush against the right edge. */
  .row__tail {
    position: relative;
    z-index: 2;
    grid-area: tail;
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-s);
    justify-self: end;
    min-block-size: 1.35em;
  }
  /* The head no longer says «3 vencidas» (Marco, 23-11-2026): each row says
     its own, and only the word that is due goes orange, never the row. */
  .row__when--over {
    color: var(--warning);
    font-weight: 500;
  }
  .row__say {
    font-size: var(--text-s);
    line-height: 1.35;
    color: var(--text-color);
  }
  .row__verb {
    text-transform: lowercase;
    text-decoration: none;
  }
  .row__acts {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
  }
  .row__acts:not(:has(*)) {
    display: none;
  }
  .row__aside-slot {
    display: inline-flex;
    align-items: center;
  }
  /* The verb is a word at rest (Marco, 23-11-2026: «mucho botón»): no edge,
     no fill; you always read what the row will do. Its box comes where you
     are: under the pointer, with the keyboard, and on a finger, where two
     answers need a target. None is ever filled: the filled one is the piece. */
  .row__act {
    --btn-border-color: transparent;
    --btn-border-color-hover: var(--border-color-light);
    --btn-background: transparent;
    --btn-background-hover: var(--bg-ultra-light);
  }
  .row:hover .row__act--main,
  .row:focus-within .row__act--main {
    --btn-border-color: var(--border-color-light);
    --btn-background: var(--bg-ultra-light);
  }
  @media (hover: none) {
    .row__act--main {
      --btn-border-color: var(--border-color-light);
      --btn-background: var(--bg-ultra-light);
    }
  }
  .row__act--quiet {
    --btn-border-color: transparent;
    --btn-border-color-hover: transparent;
    --btn-background-hover: transparent;
    --btn-text-color: var(--text-muted);
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
    .row__title {
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
  .waits__foot {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-s);
    margin-block-start: var(--space-s);
  }
  .waits__foot .more {
    margin-block-start: 0;
  }
  .waits__lens,
  .waits__lens:hover {
    text-decoration: none;
  }

  /* THE FILTER IS WORDS on the head's line (Marco, 23-11-2026), «3
     conversations · 1 payment · 3 tasks»: only what is there, never a zero;
     the one pressed is underlined and the others step back. Not named
     `.pill`: base.css reads any class containing the word as the filter pill. */
  .kinds {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: var(--space-xs);
    font-size: var(--text-s);
    color: var(--text-faint);
  }
  .kind {
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    color: var(--text-muted);
    text-decoration: none;
    text-underline-offset: 0.25em;
    cursor: pointer;
    transition: color var(--transition), opacity var(--transition);
  }
  .kind b {
    font-weight: 500;
    color: var(--text-color);
    font-variant-numeric: tabular-nums;
  }
  .kind:hover {
    color: var(--text-color);
  }
  .kind[aria-pressed='true'] {
    color: var(--heading-color);
    font-weight: 500;
    text-decoration: underline;
  }
  .kind--off {
    opacity: 0.55;
  }
  .kinds__none {
    font-size: var(--text-s);
    color: var(--text-faint);
  }
  @media (pointer: coarse) {
    .kind {
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
  /* The day and the kind in the margin speak in the body face (Hoy,
     23-11-2026): mono capitals stay for nothing in this block. */
  .bucket__label {
    font-family: var(--font-sans);
    font-size: var(--text-s);
    letter-spacing: 0;
    text-transform: none;
  }
  .run__label {
    font-size: var(--text-s);
    color: var(--text-muted);
    text-decoration: none;
    padding-block: var(--space-s) 0;
  }
  a.run__label:hover {
    color: var(--text-color);
    text-decoration: none;
  }
  .run__rows {
    border-block-start: 0;
  }

  /* Narrow (tablets and phones < 34rem): the tail drops neatly below the body
     aligned to the exact same left edge as the title, with primary buttons
     first and «not now» trailing at the end. */
  @container waits (max-width: 34rem) {
    .row {
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas: 'body' 'tail';
      align-items: start;
      row-gap: var(--space-xs);
    }
    .row__excerpt {
      -webkit-line-clamp: 2;
      line-clamp: 2;
    }
    .row__tail {
      justify-self: start;
      justify-content: flex-start;
      flex-wrap: wrap;
    }
    .row__tail:not(:has(*)) {
      display: none;
    }
    .row__aside-slot {
      order: 2;
    }
    .run {
      grid-template-columns: 1fr;
    }
  }
</style>
