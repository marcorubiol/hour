<script lang="ts">
  /**
   * THE RUNNING ORDER · the day of one thing, hour by hour (ADR-090 P3).
   *
   * The order of a gig or a rehearsal day: load-in, soundcheck, photo call,
   * show, load-out… It is the road sheet's schedule grown into a list anybody
   * can extend, and it is filled IN THE MOMENT: during a rehearsal somebody
   * types `17h05 photo call` and it lands where its hour says.
   *
   * ONE COMPONENT, TWO PLACES (Marco, 2026-10-10): the Planner's Day view,
   * under the strip (the only place that holds both parents: a rehearsal has
   * no page), and the performance's own page, where it replaces the fixed
   * five-slot table. There is one way to write an hour in the whole app, and
   * this is it. What varies by place is ONE axis, `placing` (the `Slip`'s
   * rule), never a copy:
   *
   * - `list` (the Planner's day): the hours list, as it always was.
   * - `stops` (the record's «pase», ADR-213): the same rows as stops on a
   *   line, the show the big one, with the page's read-only stops woven in
   *   (`extras`: a trip's departure and arrival, the show without an hour,
   *   the night) and the page's facts hung under their stop (`hangs`). An
   *   editor of a performance gets the card that asks for the show's hour,
   *   and once it has one, «Rellenar el día» (`$lib/pass-stops`).
   *
   * WHAT IT DRAWS: only what somebody wrote down, the strip's law. No
   * estimated durations, no placeholder five. An empty order is one line.
   *
   * THE ORDER RULE (`placeByTime` in `$lib/running-order`): the hand-made
   * order is the order. The hour places a moment once, when it is added;
   * after that only a move changes its place: drag a row, Alt+↑/↓ on a
   * focused row, or the up/down verbs while editing it.
   *
   * HOW IT WRITES (ADR-090 P2, Marco 2026-10-10: the doc manda, like the
   * notes): into the `schedule` Y.Array of the target's collab doc, the same
   * doc that holds a performance's notes. Every change is still the WHOLE next
   * order, and `writeSchedule` turns it into the fewest CRDT operations, so
   * two people editing during a rehearsal merge instead of overwriting. The
   * Durable Object materializes the array into `schedule_slot` and says so;
   * then the other surfaces refetch. Nothing else writes these rows.
   *
   * WHO SEES WHAT: an editor reads the live doc once it has synced (before
   * that, the rows, read-only). A reader cannot open the doc (the upgrade
   * gates on the edit permission) and reads the rows from `GET
   * /api/schedule`.
   */
  import { tick, type Snippet } from 'svelte';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON } from '$lib/api';
  import { loadAllLocales, LOCALES, type Locale, tHere } from '$lib/i18n';
  import { addToast } from './Toast.svelte';
  import { openCollabDoc } from '$lib/collab-doc';
  import { readSchedule, scheduleArray, writeSchedule } from '$lib/schedule-doc';
  import {
    timeslotsFromSlots,
    timeslotsOrdered,
    type ScheduleSlotInput,
    type ScheduleSlotRow,
  } from '$lib/schedule-slot';
  import type * as Y from 'yjs';
  import {
    KIND_WORD_KEYS,
    NAMED_KINDS,
    clockText,
    dayOf,
    endFor,
    inputsOf,
    instantFor,
    moveSlot,
    namedSlot,
    outOfTime,
    parseClock,
    placeByTime,
    recognisedWords,
    slotWord,
    type RunningOrderTarget,
  } from '$lib/running-order';
  import {
    fillDay,
    templateAt,
    templateClockAt,
    templateFor,
    hangPlaces,
    weaveStops,
    type ExtraStop,
    type HangAt,
    type StopItem,
  } from '$lib/pass-stops';

  interface Props {
    target: RunningOrderTarget;
    id: string;
    /** The day being looked at, `YYYY-MM-DD`: where a typed hour lands. */
    dayIso: string;
    /** The zone a typed hour means (ADR-078 §11: the venue's wall clock,
        else the space's). */
    tz: string;
    /** The reader's zone. When it reads another hour, the row says it too
        (D-PRE-10, the road sheet's dual time). */
    viewerTz?: string;
    locale: Locale;
    /** Whose order this is, when the day holds more than one. */
    name?: string | null;
    /** Where it is drawn: the Planner's list, or the record's stops (ADR-213). */
    placing?: 'list' | 'stops';
    /** `stops`: the page's own stops, read-only, woven in by time. */
    extras?: readonly ExtraStop[];
    /** `stops`: what an extra stop says (the page knows its words and links). */
    extra?: Snippet<[ExtraStop]>;
    /** `stops`: the page's facts, each hung under its stop (`hangPlaces`):
        the address under the arrival, the contact under the load-in. */
    hangs?: { address?: Snippet; contact?: Snippet };
    /** `stops`: the lid's word, when it is not the running order's. */
    title?: string | null;
    /** Called once the doc says the rows moved (the page refetches itself). */
    onwritten?: () => void;
  }

  let {
    target,
    id,
    dayIso,
    tz,
    viewerTz,
    locale,
    name = null,
    placing = 'list',
    extras = [],
    extra,
    hangs = {},
    title = null,
    onwritten,
  }: Props = $props();
  let stops = $derived(placing === 'stops');
  const t = tHere();

  const queryClient = useQueryClient();
  const queryKey = $derived(['schedule', target, id] as const);

  type Feed = { slots: ScheduleSlotRow[]; can_edit: boolean };
  const feedStore = toStore(() => ({
    queryKey,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<Feed>(`/api/schedule/${target}/${id}`, signal),
  }));
  const feed = createQuery(feedStore);

  let canEdit = $derived($feed.data?.can_edit ?? false);

  // ── The live doc: opened for an editor, closed when this order goes ────
  /** The doc, once it has synced with the server: only then is it written. */
  let live = $state.raw<Y.Doc | null>(null);
  /** The order as the doc has it; null until it has synced. */
  let liveOrder = $state.raw<ScheduleSlotInput[] | null>(null);
  let connection = $state<'connecting' | 'live' | 'offline'>('connecting');

  $effect(() => {
    if (!canEdit) return;
    const collab = openCollabDoc(target, id);
    const { doc } = collab;
    const array = scheduleArray(doc);
    let synced = false;
    const pull = () => {
      if (synced) liveOrder = readSchedule(doc);
    };
    array.observeDeep(pull);
    collab.onSynced(() => {
      synced = true;
      live = doc;
      pull();
    });
    collab.onStatus((connected) => {
      connection = connected ? 'live' : 'offline';
    });
    // The DO wrote the rows: every surface that reads them refetches.
    collab.onMessage((message) => {
      if (message === 'schedule:materialized') settle();
    });
    return () => {
      array.unobserveDeep(pull);
      collab.close();
      live = null;
      liveOrder = null;
      connection = 'connecting';
    };
  });

  let order = $derived(liveOrder ?? inputsOf($feed.data?.slots ?? []));
  /** An editor whose doc has not arrived yet: drawn, not written. */
  let waiting = $derived(live === null);
  let isToday = $derived(dayOf(new Date().toISOString(), tz) === dayIso);

  /** The word for a kind, in the app's language (the strip's, Desk's). */
  function kindWord(kind: string): string {
    const key = KIND_WORD_KEYS[kind];
    return key ? t(key, locale) : kind.replace(/_/g, ' ');
  }
  /** Offered while typing: the five in the reader's language. */
  let offered = $derived(NAMED_KINDS.map((k) => [k, kindWord(k)] as const));
  /** Recognised when written: the five in every language the app speaks, and synonyms. */
  const recognised = () => recognisedWords((key, loc) => t(key, loc as Locale), LOCALES);
  let known = $state(recognised());
  // The other languages' dictionaries load on demand (lib/i18n).
  void loadAllLocales().then(() => (known = recognised()));

  /** The other hour, only when the reader's clock says something else. */
  function viewerClock(iso: string): string | null {
    if (!viewerTz || viewerTz === tz) return null;
    const mine = clockText(iso, viewerTz);
    return mine === clockText(iso, tz) ? null : mine;
  }

  /** The rows moved: this order's feed and every surface that reads them. */
  function settle() {
    // The strip, the agenda, Desk and the performance page read the order
    // from their own feeds.
    onwritten?.();
    for (const key of [
      queryKey,
      ['planner-performances'],
      ['today-performances'],
      ['pulse-performances'],
      ['pulse-dates'],
      ['planner-dates'],
      ['performance'],
    ]) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  }

  /**
   * Write the whole next order into the doc. Synchronous and local: the CRDT
   * takes it at once, here and offline, and syncs when it can. The one rule
   * a CRDT cannot refuse later is checked HERE, before writing: the five of
   * the road sheet keep their order (load in ≤ soundcheck ≤ show ≤ load out
   * ≤ wrap), as the PUT of P3 and the old CHECK held it. A move only changes
   * places, never an hour, and is not checked (the reorder of P3 was not).
   */
  function write(next: ScheduleSlotInput[], checkOrder = true): boolean {
    if (!live) return false;
    if (checkOrder && !timeslotsOrdered(timeslotsFromSlots(next.map((s, i) => ({ ...s, sort: i + 1 }))))) {
      addToast({ tone: 'danger', message: t('planner.ro_out_of_order', locale) });
      return false;
    }
    writeSchedule(live, next);
    return true;
  }

  let listEl = $state<HTMLOListElement | null>(null);

  /** Move a moment and keep the keyboard on it. */
  async function move(from: number, to: number, refocus: 'line' | 'edit' = 'line') {
    if (waiting || to < 0 || to >= order.length || from === to) return;
    if (!write(moveSlot(order, from, to), false)) return;
    if (editing === from) editing = to;
    await tick();
    const sel = refocus === 'line' ? `[data-index="${to}"] .hours__line` : `[data-index="${to}"] .ro__act--move`;
    listEl?.querySelector<HTMLElement>(sel)?.focus();
  }

  function onLineKey(e: KeyboardEvent, i: number) {
    if (!e.altKey) return;
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      void move(i, i - 1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      void move(i, i + 1);
    }
  }

  // ── Dragging: the native medium (HTML drag and drop), rows as targets ──
  let dragFrom = $state<number | null>(null);
  let dragOver = $state<number | null>(null);

  function onDragStart(e: DragEvent, i: number) {
    dragFrom = i;
    e.dataTransfer?.setData('text/plain', String(i));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }
  function onDragOver(e: DragEvent, i: number) {
    if (dragFrom === null) return;
    e.preventDefault();
    dragOver = i;
  }
  function onDrop(e: DragEvent, i: number) {
    e.preventDefault();
    if (dragFrom !== null) void move(dragFrom, i);
    dragFrom = null;
    dragOver = null;
  }
  function onDragEnd() {
    dragFrom = null;
    dragOver = null;
  }

  let open = $state(true);

  // ── Adding: an hour and a word, Enter. The hour places it, once. ───────
  let aClock = $state('');
  let aWord = $state('');
  let aBad = $state(false);

  function add(e: SubmitEvent) {
    e.preventDefault();
    const clock = parseClock(aClock);
    const named = namedSlot(aWord, null, known);
    aBad = clock === null;
    if (!clock || !named || waiting) return;
    const at = instantFor(dayIso, clock, tz, order);
    if (!at) {
      aBad = true;
      return;
    }
    const slot: ScheduleSlotInput = { ...named, at, ends_at: null, notes: null };
    if (write(placeByTime(order, slot))) {
      aClock = '';
      aWord = '';
      adding = false;
    }
  }
  async function openAdd() {
    adding = true;
    await tick();
    listEl?.querySelector<HTMLInputElement>('.hours__row--add input')?.focus();
  }

  // ── Editing one moment: the row becomes its form, in its place. ────────
  let editing = $state<number | null>(null);
  let eClock = $state('');
  let eEnd = $state('');
  let eWord = $state('');
  let eNotes = $state('');
  let eBad = $state(false);

  function startEdit(i: number) {
    const s = order[i];
    editing = i;
    eClock = clockText(s.at, tz);
    eEnd = s.ends_at ? clockText(s.ends_at, tz) : '';
    eWord = slotWord(s, kindWord);
    eNotes = s.notes ?? '';
    eBad = false;
  }

  function cancelEdit() {
    editing = null;
  }

  function commitEdit(e: SubmitEvent) {
    e.preventDefault();
    if (editing === null || waiting) return;
    const i = editing;
    const prev = order[i];
    const clock = parseClock(eClock);
    const endClock = eEnd.trim() ? parseClock(eEnd) : null;
    const named = namedSlot(eWord, prev.kind, known);
    eBad = clock === null || (eEnd.trim() !== '' && endClock === null);
    if (eBad || !clock || !named) return;
    // An untouched hour keeps its instant (a 1h30 that already ran past
    // midnight stays tomorrow); a new hour is read on the day, like a new
    // moment. Either way the moment KEEPS ITS PLACE: the order is the hand's.
    const unchanged = parseClock(clockText(prev.at, tz));
    const same = unchanged !== null && unchanged.h === clock.h && unchanged.m === clock.m;
    const others = order.filter((_, j) => j !== i);
    const at = same ? prev.at : instantFor(dayIso, clock, tz, others);
    if (!at) {
      eBad = true;
      return;
    }
    const ends_at = endClock ? endFor(at, endClock, tz) : null;
    const slot: ScheduleSlotInput = { ...prev, ...named, at, ends_at, notes: eNotes.trim() || null };
    const next = order.map((s, j) => (j === i ? slot : s));
    if (write(next)) editing = null;
  }

  function remove() {
    if (editing === null || waiting) return;
    const i = editing;
    if (write(order.filter((_, j) => j !== i))) editing = null;
  }

  function onEditKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  }

  /** Focus the first field of a row the moment it becomes a form. */
  function focusFirst(node: HTMLElement) {
    node.querySelector<HTMLInputElement>('input')?.select();
  }

  let listId = $derived(`ro-words-${id}`);
  let lidWord = $derived(
    title ?? (name ? `${t('planner.ro_title', locale)} · ${name}` : t('planner.ro_title', locale)),
  );

  // ── The stops (placing `stops`, ADR-213) ─────────────────────────────
  let hasStart = $derived(order.some((s) => s.kind === 'start'));
  /** The show's dashed stop only while no row is the show. */
  let shown = $derived(extras.filter((e) => e.kind !== 'show' || !hasStart));
  let items = $derived<StopItem[]>(
    stops ? weaveStops(order, shown) : order.map((_, index) => ({ type: 'row' as const, index })),
  );
  /** Where each fact hangs, by the kinds the day has (`hangPlaces`). */
  let hangAt = $derived.by(() => {
    const out = new Map<HangAt, Snippet[]>();
    if (!stops) return out;
    const places = hangPlaces(
      order.map((s) => s.kind),
      shown.some((e) => e.kind === 'arrive'),
    );
    for (const [what, at] of [
      ['address', places.address],
      ['contact', places.contact],
    ] as const) {
      const snippet = hangs[what];
      if (snippet) out.set(at, [...(out.get(at) ?? []), snippet]);
    }
    return out;
  });
  /** The rows that carry a hang: the first of each kind. */
  let hangRow = $derived.by(() => {
    const at = new Map<number, Snippet[]>();
    for (const k of ['load_in', 'start'] as const) {
      const list = hangAt.get(k);
      const i = order.findIndex((s) => s.kind === k);
      if (list && i >= 0) at.set(i, list);
    }
    return at;
  });
  /** The extras that carry a hang: the last arrival, the show's dashed stop. */
  function extraHangs(stop: ExtraStop): Snippet[] {
    if (stop.kind === 'show') return hangAt.get('show') ?? [];
    if (stop.kind === 'arrive') {
      const last = shown.filter((e) => e.kind === 'arrive').at(-1);
      return last?.key === stop.key ? (hangAt.get('arrive') ?? []) : [];
    }
    return [];
  }
  /** No moment has an hour yet: the line is dotted and the card asks for one. */
  let noHours = $derived(stops && order.length === 0);
  let canAsk = $derived(stops && canEdit && target === 'performance');

  // «Pon la hora de la función»: one hour, the show's, written as its row.
  /** The hour proposed on the card: written, so the button is always ready. */
  const SHOW_CLOCK = '20h30';
  let sClock = $state(SHOW_CLOCK);
  let sBad = $state(false);
  /** `stops`: the last stop's form is closed until it is asked for. */
  let adding = $state(false);
  function putShow(e: SubmitEvent) {
    e.preventDefault();
    const clock = parseClock(sClock);
    sBad = clock === null;
    if (!clock || waiting) return;
    const at = instantFor(dayIso, clock, tz, order);
    if (!at) {
      sBad = true;
      return;
    }
    if (write(placeByTime(order, { kind: 'start', label: null, at, ends_at: null, notes: null }))) sClock = SHOW_CLOCK;
  }

  // «Rellenar el día» (ADR-213, an exception to ADR-090 by the person's
  // touch only): the moments the day lacks, each with its proposed hour,
  // editable before anything is written.
  let offer = $derived(canAsk && hasStart ? templateFor(order.map((s) => s.kind)) : []);
  let fillOpen = $state(false);
  let fillDismissed = $state(false);
  let fillClocks = $state<Record<string, string>>({});
  let fillBad = $state(false);
  function openFill() {
    const start = order.find((s) => s.kind === 'start');
    if (!start) return;
    fillClocks = Object.fromEntries(offer.map((m) => [m.kind, clockText(templateAt(start.at, m), tz)]));
    fillBad = false;
    fillOpen = true;
  }
  function doFill(e: SubmitEvent) {
    e.preventDefault();
    if (waiting) return;
    const start = order.find((s) => s.kind === 'start');
    if (!start) return;
    const moments: { kind: string; at: string }[] = [];
    // By kind, not by place: another hand may have written one of them
    // meanwhile, and the offer shrinks under the open form.
    for (const m of offer) {
      const clock = parseClock(fillClocks[m.kind] ?? '');
      const at = clock ? templateClockAt(templateAt(start.at, m), clock, tz) : null;
      if (!at) {
        fillBad = true;
        return;
      }
      moments.push({ kind: m.kind, at });
    }
    if (write(fillDay(order, moments, placeByTime))) fillOpen = false;
  }

</script>

<!-- Empty and not yours to write: no lid (ADR-154). While it loads, or when
     the read fails, it is drawn, so an editor's lid does not jump in. -->
{#if canEdit || order.length > 0 || $feed.isPending || $feed.isError || (stops && shown.length > 0)}
<section class="hours" class:ro--stops={stops} class:ro--open={noHours} aria-busy={$feed.isPending} data-placing={placing}>
  {#if stops}
    <!-- On the record the day is not a section with a lid: a word, and the
         line right under it (the drawing's «El día, parada a parada»). -->
    <h2 class="ro__label">{lidWord}</h2>
  {:else}
    <button type="button" class="lid" aria-expanded={open} onclick={() => (open = !open)}>
      <span class="lid__w">{lidWord}</span>
      <span class="lid__n"
        >{order.length === 0 ? t('planner.lid_empty', locale) : order.length}<span class="lid__sign" aria-hidden="true">{open ? '▴' : '▾'}</span></span
      >
    </button>
  {/if}

  {#if open || stops}
    <datalist id={listId}>
      {#each offered as [k, w] (k)}<option value={w}></option>{/each}
    </datalist>

    {#if live && connection === 'offline'}
      <!-- Written offline is still written: the doc syncs on reconnect. -->
      <p class="ro__zone" role="status">{t('perf.notes_offline', locale)}</p>
    {/if}
    {#if viewerTz && order.some((s) => viewerClock(s.at))}
      <!-- Said once, not on every row: whose clock the hours are, and that
           the small one under each is the reader's. -->
      <p class="ro__zone">{t('planner.ro_zones', locale, { tz, yours: viewerTz })}</p>
    {/if}
    {#if canAsk && !hasStart && !$feed.isPending}
      <!-- Sin horas (ADR-213): the card asks for ONE hour, the show's. -->
      <form class="ro__ask" onsubmit={putShow} data-testid="ro-ask-time">
        <p class="ro__ask-title">{t('pass.ask_time', locale)}</p>
        <p class="ro__ask-body">{t('pass.ask_time_body', locale)}</p>
        <span class="ro__ask-row">
          <input
            class="hours__in hours__in--clock"
            aria-label={t('pass.show_time', locale)}
            aria-invalid={sBad}
            placeholder="20h30"
            inputmode="numeric"
            autocomplete="off"
            bind:value={sClock}
            disabled={waiting}
          />
          <button type="submit" class="ro__ask-go" disabled={waiting}>{t('pass.put_time', locale)}</button>
        </span>
        {#if sBad}<span class="hours__hint" role="status">{t('planner.ro_bad_clock', locale)}</span>{/if}
      </form>
    {:else if offer.length > 0 && !fillDismissed}
      <!-- «Rellenar el día»: proposed, never written until pressed. -->
      {#if fillOpen}
        <form class="ro__ask" onsubmit={doFill} data-testid="ro-fill">
          <p class="ro__ask-body">{t('pass.fill_body', locale)}</p>
          <span class="ro__fill">
            {#each offer as m (m.kind)}
              <label class="ro__fill-one">
                <span class="ro__fill-w">{kindWord(m.kind)}</span>
                <input
                  class="hours__in hours__in--clock"
                  aria-invalid={fillBad}
                  inputmode="numeric"
                  autocomplete="off"
                  bind:value={fillClocks[m.kind]}
                  disabled={waiting}
                />
              </label>
            {/each}
          </span>
          <span class="ro__ask-row">
            <button type="submit" class="ro__ask-go" disabled={waiting}>{t('pass.fill', locale)}</button>
            <button type="button" class="hours__act" onclick={() => (fillOpen = false)}>{t('planner.ro_cancel', locale)}</button>
          </span>
          {#if fillBad}<span class="hours__hint" role="status">{t('planner.ro_bad_clock', locale)}</span>{/if}
        </form>
      {:else}
        <p class="ro__offer">
          <button type="button" class="ro__ask-go ro__ask-go--quiet" onclick={openFill} data-testid="ro-fill-open"
            >{t('pass.fill', locale)}</button
          >
          <button type="button" class="hours__act hours__act--quiet" onclick={() => (fillDismissed = true)}
            >{t('pass.fill_not_now', locale)}</button
          >
        </p>
      {/if}
    {/if}
    <ol class="hours__list" bind:this={listEl}>
      {#each items as item (item.type === 'row' ? (order[item.index]?.id ?? `row-${item.index}`) : `x-${item.stop.key}`)}
        {#if item.type === 'extra'}
          <li class="hours__row ro__extra" data-stop={item.stop.kind}>
            <div class="ro__xline">
              <span class="hours__at"
                >{#if item.stop.at}{clockText(item.stop.at, tz)}{:else if item.stop.kind === 'night'}{t('pass.night', locale)}{:else}–{/if}</span
              >
              <span class="hours__body">{@render extra?.(item.stop)}</span>
            </div>
            {#if extraHangs(item.stop).length > 0}
              <div class="ro__hang">{#each extraHangs(item.stop) as h, k (k)}{@render h()}{/each}</div>
            {/if}
          </li>
        {:else}
        {@const i = item.index}
        {@const s = order[i]}
        {@const tomorrow = dayOf(s.at, tz) !== dayIso}
        {@const alt = viewerClock(s.at)}
        {@const off = outOfTime(order, i)}
        {#if editing === i}
          <li class="hours__row hours__row--edit" data-index={i}>
            <form class="hours__form" onsubmit={commitEdit} use:focusFirst>
              <span class="hours__at hours__at--edit">
                <input
                  class="hours__in hours__in--clock"
                  aria-label={t('planner.ro_clock', locale)}
                  aria-invalid={eBad}
                  placeholder="20h30"
                  inputmode="numeric"
                  autocomplete="off"
                  bind:value={eClock}
                  onkeydown={onEditKey}
                  disabled={waiting}
                />
                <span class="hours__dash" aria-hidden="true">–</span>
                <input
                  class="hours__in hours__in--clock"
                  aria-label={t('planner.ro_until', locale)}
                  placeholder={t('planner.ro_until', locale)}
                  inputmode="numeric"
                  autocomplete="off"
                  bind:value={eEnd}
                  onkeydown={onEditKey}
                  disabled={waiting}
                />
              </span>
              <span class="hours__body">
                <input
                  class="hours__in hours__in--word"
                  aria-label={t('planner.ro_moment', locale)}
                  placeholder={t('planner.ro_moment_ph', locale)}
                  list={listId}
                  autocomplete="off"
                  bind:value={eWord}
                  onkeydown={onEditKey}
                  disabled={waiting}
                />
                <input
                  class="hours__in hours__in--notes"
                  aria-label={t('planner.ro_notes', locale)}
                  placeholder={t('planner.ro_notes_ph', locale)}
                  autocomplete="off"
                  bind:value={eNotes}
                  onkeydown={onEditKey}
                  disabled={waiting}
                />
              </span>
              <span class="hours__acts">
                <button type="submit" class="hours__act" disabled={waiting}>{t('planner.ro_save', locale)}</button>
                <button type="button" class="hours__act" onclick={cancelEdit} disabled={waiting}
                  >{t('planner.ro_cancel', locale)}</button
                >
                <button
                  type="button"
                  class="hours__act hours__act--quiet ro__act--move"
                  onclick={() => move(i, i - 1, 'edit')}
                  disabled={waiting || i === 0}>{t('planner.ro_up', locale)}</button
                >
                <button
                  type="button"
                  class="hours__act hours__act--quiet"
                  onclick={() => move(i, i + 1, 'edit')}
                  disabled={waiting || i === order.length - 1}>{t('planner.ro_down', locale)}</button
                >
                <button type="button" class="hours__act hours__act--quiet" onclick={remove} disabled={waiting}
                  >{t('planner.ro_remove', locale)}</button
                >
              </span>
            </form>
          </li>
        {:else}
          <li
            class="hours__row"
            class:ro__show={s.kind === 'start'}
            class:ro__row--drop={dragOver === i && dragFrom !== null && dragFrom !== i}
            class:ro__row--dragging={dragFrom === i}
            data-index={i}
            data-kind={s.kind ?? undefined}
            draggable={canEdit && !waiting}
            ondragstart={(e) => onDragStart(e, i)}
            ondragover={(e) => onDragOver(e, i)}
            ondrop={(e) => onDrop(e, i)}
            ondragend={onDragEnd}
          >
            <svelte:element
              this={canEdit ? 'button' : 'div'}
              class="hours__line"
              {...canEdit
                ? {
                    type: 'button',
                    'aria-label': t('planner.ro_edit', locale, { moment: slotWord(s, kindWord) }),
                    'aria-keyshortcuts': 'Alt+ArrowUp Alt+ArrowDown',
                    onclick: () => startEdit(i),
                    onkeydown: (e: KeyboardEvent) => onLineKey(e, i),
                  }
                : {}}
            >
              <span class="hours__at" class:ro__at--off={off} title={off ? t('planner.ro_out_of_time', locale) : undefined}
                >{clockText(s.at, tz)}{#if tomorrow}<sup
                    class="hours__plus"
                    title={t('planner.ro_next_day', locale)}>+1</sup
                  >{/if}{#if s.ends_at}<span class="hours__end">–{clockText(s.ends_at, tz)}</span>{/if}{#if alt}<span
                    class="ro__alt"
                    title={t('planner.ro_yours', locale)}>{alt}</span
                  >{/if}</span
              >
              <span class="hours__body">
                <span class="hours__w" class:ro__w--show={s.kind === 'start'}>{slotWord(s, kindWord)}</span>
                {#if s.notes}<span class="hours__n">{s.notes}</span>{/if}
              </span>
              {#if canEdit}<span class="ro__grip" aria-hidden="true"></span>{/if}
            </svelte:element>
            {#if hangRow.get(i)}
              <div class="ro__hang">{#each hangRow.get(i) ?? [] as h, k (k)}{@render h()}{/each}</div>
            {/if}
          </li>
        {/if}
        {/if}
      {/each}

      {#if canEdit && stops && !adding}
        <!-- «Añadir un momento…»: the last stop of the line, not a loose row. -->
        <li class="hours__row hours__row--add ro__add-stop">
          <span class="hours__at" aria-hidden="true"></span>
          <span class="hours__body">
            <button type="button" class="ro__add-open" data-testid="ro-add-open" disabled={waiting} onclick={openAdd}
              >{t('pass.add_moment', locale)}</button
            >
          </span>
        </li>
      {:else if canEdit}
        <li class="hours__row hours__row--add">
          <form class="hours__form" onsubmit={add}>
            <span class="hours__at hours__at--edit">
              <input
                class="hours__in hours__in--clock"
                aria-label={t('planner.ro_clock', locale)}
                aria-invalid={aBad}
                placeholder="20h30"
                inputmode="numeric"
                autocomplete="off"
                bind:value={aClock}
                disabled={waiting}
              />
              {#if isToday}
                <button
                  type="button"
                  class="hours__act hours__act--quiet"
                  onclick={() => {
                    aClock = clockText(new Date().toISOString(), tz);
                    aBad = false;
                  }}>{t('planner.ro_now', locale)}</button
                >
              {/if}
            </span>
            <span class="hours__body">
              <input
                class="hours__in hours__in--word"
                aria-label={t('planner.ro_moment', locale)}
                placeholder={t('planner.ro_moment_ph', locale)}
                list={listId}
                autocomplete="off"
                bind:value={aWord}
                disabled={waiting}
              />
            </span>
            <span class="hours__acts">
              <button
                type="submit"
                class="hours__act"
                disabled={waiting || !aClock.trim() || !aWord.trim()}>{t('planner.ro_add', locale)}</button
              >
            </span>
          </form>
        </li>
      {:else if order.length === 0 && !$feed.isPending && !stops}
        <li class="hours__row hours__row--empty">{t('planner.ro_empty', locale)}</li>
      {/if}
    </ol>
    {#if aBad}<p class="hours__hint" role="status">{t('planner.ro_bad_clock', locale)}</p>{/if}
    {#if eBad}<p class="hours__hint" role="status">{t('planner.ro_bad_clock', locale)}</p>{/if}
  {/if}
</section>
{/if}

<style>
  @layer components {
    /* The list itself (columns, rows, fields, verbs) lives in
       `styles/hours.css`, shared with the travel stages. Only what is the
       running order's own stays here. */
    /* The show is why the day exists: the serif, the strip's full ink. */
    .ro__w--show {
      font-family: var(--font-display);
      font-size: var(--text-m);
    }
    /* The reader's own hour, when it is another (D-PRE-10): a gloss under
       the hour, never beside it, so the column keeps its width. */
    .ro__alt {
      display: block;
      font-size: var(--text-xs);
      color: var(--text-faint);
    }
    /* The hand put it after a later hour: allowed, and said quietly. */
    .ro__at--off {
      font-style: italic;
      color: var(--text-muted);
    }
    /* Moving: the grip says a row can be dragged; the line shows where
       it lands. Alt+Up/Down does the same from the keyboard. */
    .ro__grip {
      align-self: center;
      justify-self: end;
      inline-size: var(--dot-m);
      block-size: 0.75rem;
      background: radial-gradient(circle, var(--text-faint) 1px, transparent 1.2px) 0 0 / 3px 3px;
      opacity: 0;
      cursor: grab;
      transition: opacity var(--duration-fast);
    }
    .hours__row:hover .ro__grip,
    .hours__line:focus-visible .ro__grip {
      opacity: 1;
    }
    .ro__row--dragging {
      opacity: 0.4;
    }
    .hours__row.ro__row--drop {
      border-block-start: var(--line-hairline) solid var(--text-muted);
    }
    .ro__zone {
      margin: var(--space-2xs) 0 0;
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      letter-spacing: var(--tracking-l);
      color: var(--text-faint);
    }
    @container (max-width: 30rem) {
      .ro__grip {
        display: none;
      }
    }

    /* ── STOPS (placing `stops`, ADR-213): the same rows on a line ───────
       The hour on the left, quiet and right-aligned; a dot on the line;
       what happens to the right. The line is the list's own background, a
       hairline at the dot's centre: solid while the day has hours, dotted
       while it has none. The show is the big stop. */
    .ro--stops {
      --stop-ink: var(--text-muted);
      --stop-line: var(--border-color-dark);
      /* Where the dot's centre sits, from the top of a row. */
      --stop-mid: calc(var(--space-xs) + 0.7em);
    }
    /* The line, row by row: a hairline in the moment's column (an absolute
       grid child takes its column as containing block), from the first
       dot to the last one. */
    .ro--stops .hours__row {
      position: relative;
    }
    /* The hour column is as wide as its widest hour at any width, so the
       line sits at the same place on a phone, in the vistazo on the right
       and on the page (ADR-216): the stops read as one column, never as a
       table with an empty margin on its left. */
    .ro--stops .hours__list {
      grid-template-columns: max-content minmax(0, 1fr) auto;
      column-gap: var(--space-s);
    }
    .ro--stops .hours__row::before {
      content: '';
      position: absolute;
      grid-column: 2 / 3;
      inset-block: 0;
      inset-inline-start: calc(0.375rem - var(--line-hairline) / 2);
      inline-size: var(--line-hairline);
      background: var(--stop-line);
    }
    .ro--stops.ro--open .hours__row::before {
      background: repeating-linear-gradient(to bottom, var(--stop-line) 0 3px, transparent 3px 6px);
    }
    .ro--stops .hours__list > .hours__row:first-child::before {
      inset-block-start: var(--stop-mid);
    }
    .ro--stops .ro__add-stop::before,
    .ro--stops .hours__list > .hours__row:not(.hours__row--add):last-child::before {
      inset-block-end: auto;
      block-size: var(--stop-mid);
    }
    .ro--stops .hours__list > .hours__row:only-child::before,
    .ro--stops .hours__row--add:not(.ro__add-stop)::before {
      display: none;
    }
    .ro--stops .hours__row + .hours__row {
      border-block-start: 0;
    }
    .ro--stops .hours__at {
      justify-self: end;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }
    /* An extra stop's line: the read row's columns, never a button. */
    .ro__xline {
      display: grid;
      grid-column: 1 / -1;
      grid-template-columns: subgrid;
      align-items: baseline;
      padding-block: var(--space-xs);
    }
    .ro--stops .hours__line > .hours__body,
    .ro--stops .ro__xline > .hours__body,
    .ro--stops .ro__hang {
      position: relative;
      padding-inline-start: 1.5rem;
    }
    .ro--stops .hours__line > .hours__body::before,
    .ro--stops .ro__xline > .hours__body::before {
      content: '';
      position: absolute;
      inset-inline-start: 0;
      inset-block-start: 0.35em;
      inline-size: 0.75rem;
      block-size: 0.75rem;
      border: var(--line-hairline) solid var(--stop-ink);
      border-radius: var(--radius-50);
      background: var(--bg);
    }
    .ro--stops .ro__hang {
      grid-column: 2 / 3;
      display: grid;
      gap: var(--space-2xs);
      padding-block-end: var(--space-xs);
    }
    .ro--stops .ro__show .hours__at {
      font-weight: 600;
      color: var(--text-color);
    }
    .ro--stops .ro__show .hours__line > .hours__body::before,
    .ro--stops .ro__extra[data-stop='show'] .hours__body::before {
      inset-inline-start: -0.125rem;
      inset-block-start: 0.3em;
      inline-size: 1rem;
      block-size: 1rem;
      border-color: var(--text-color);
      background: var(--text-color);
    }
    .ro--stops .ro__show .hours__w {
      font-family: var(--font-display);
      font-size: var(--text-l);
    }
    /* The day has no section of its own: a mono word, the line right under
       it, no big gap above (the pass's right column starts with it). */
    .ro__label {
      margin: 0 0 var(--space-s);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      font-weight: 400;
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-faint);
    }
    /* «Añadir un momento…»: the last stop of the line, with its own hollow dot. */
    .ro--stops .ro__add-stop {
      display: grid;
      grid-column: 1 / -1;
      grid-template-columns: subgrid;
      align-items: baseline;
      padding-block: var(--space-xs);
    }
    .ro--stops .ro__add-stop .hours__body {
      position: relative;
      padding-inline-start: 1.5rem;
    }
    .ro--stops .ro__add-stop .hours__body::before {
      content: '';
      position: absolute;
      inset-inline-start: 0;
      inset-block-start: 0.35em;
      inline-size: 0.75rem;
      block-size: 0.75rem;
      border: var(--line-hairline) solid var(--stop-ink);
      border-radius: var(--radius-50);
      background: var(--bg);
    }
    .ro__add-open {
      appearance: none;
      padding: 0;
      border: 0;
      background: none;
      font: inherit;
      color: var(--text-color);
      text-align: start;
      cursor: pointer;
    }
    .ro__add-open:hover {
      text-decoration: underline;
      text-underline-offset: 3px;
    }
    .ro--stops .ro__extra[data-stop='night'] .hours__body::before {
      border-color: var(--missing-ink);
    }

    /* The card that asks for the show's hour, and «Rellenar el día». */
    .ro__ask {
      display: grid;
      gap: var(--space-xs);
      margin-block: var(--space-s);
      padding: var(--space-m);
      border: var(--line-hairline) solid var(--border-color-light);
      border-radius: var(--radius-l);
    }
    .ro__ask-title {
      margin: 0;
      font-family: var(--font-display);
      font-size: var(--text-l);
      line-height: 1.2;
    }
    .ro__ask-body {
      margin: 0;
      font-size: var(--text-s);
      color: var(--text-muted);
    }
    .ro__ask-row {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-s) var(--space-m);
    }
    .ro__ask-go {
      min-block-size: var(--touch-target);
      padding: var(--space-xs) var(--space-m);
      border: var(--line-hairline) solid var(--text-color);
      border-radius: var(--radius);
      background: var(--text-color);
      color: var(--bg);
      font: inherit;
      font-size: var(--text-s);
      font-weight: 500;
      cursor: pointer;
    }
    .ro__ask-go:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .ro__ask-go--quiet {
      min-block-size: 0;
      padding: var(--space-2xs) var(--space-s);
      background: transparent;
      border-color: var(--border-color-dark);
      color: var(--text-color);
    }
    .ro__offer {
      display: flex;
      align-items: baseline;
      gap: var(--space-m);
      margin: var(--space-xs) 0;
    }
    .ro__fill {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-s) var(--space-l);
    }
    .ro__fill-one {
      display: inline-flex;
      align-items: baseline;
      gap: var(--space-xs);
      font-size: var(--text-s);
    }
    .ro__fill-w {
      color: var(--text-muted);
    }
  }
</style>
