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
   * this is it. Nothing varies by place yet, so there is no placing axis; when
   * something does, it is a prop here (the `Slip`'s `placing`/`ground` rule),
   * never a copy.
   *
   * WHAT IT DRAWS: only what somebody wrote down, the strip's law. No
   * estimated durations, no placeholder five. An empty order is one line.
   *
   * THE ORDER RULE (`placeByTime` in `$lib/running-order`): the hand-made
   * order is the order. The hour places a moment once, when it is added;
   * after that only a move changes its place: drag a row, Alt+↑/↓ on a
   * focused row, or the up/down verbs while editing it.
   *
   * HOW IT WRITES: the whole order to `PUT /api/schedule/:target/:id`
   * (`replace_schedule_slots`), a move to `PATCH` (`reorder_schedule_slots`).
   * P2 (live editing over the collab DO) changes only those two lines: the
   * order will be a `Y.Array` in the same doc as the notes, and this component
   * will edit the array instead. The editing UI and the rules stay.
   */
  import { tick } from 'svelte';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import { LOCALES, t, type Locale } from '$lib/i18n';
  import { addToast } from './Toast.svelte';
  import type { ScheduleSlotInput, ScheduleSlotRow } from '$lib/schedule-slot';
  import {
    KIND_WORD_KEYS,
    LEGACY_KINDS,
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
  }

  let { target, id, dayIso, tz, viewerTz, locale, name = null }: Props = $props();

  const queryClient = useQueryClient();
  const queryKey = $derived(['schedule', target, id] as const);

  type Feed = { slots: ScheduleSlotRow[]; can_edit: boolean };
  const feedStore = toStore(() => ({
    queryKey,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<Feed>(`/api/schedule/${target}/${id}`, signal),
  }));
  const feed = createQuery(feedStore);

  let order = $derived(inputsOf($feed.data?.slots ?? []));
  let canEdit = $derived($feed.data?.can_edit ?? false);
  let isToday = $derived(dayOf(new Date().toISOString(), tz) === dayIso);

  /** The word for a kind, in the app's language (the strip's, Desk's). */
  function kindWord(kind: string): string {
    const key = KIND_WORD_KEYS[kind];
    return key ? t(key, locale) : kind.replace(/_/g, ' ');
  }
  /** Offered while typing: the five in the reader's language. */
  let offered = $derived(LEGACY_KINDS.map((k) => [k, kindWord(k)] as const));
  /** Recognised when written: the five in every language the app speaks, and synonyms. */
  const known = recognisedWords((key, loc) => t(key, loc as Locale), LOCALES);

  /** The other hour, only when the reader's clock says something else. */
  function viewerClock(iso: string): string | null {
    if (!viewerTz || viewerTz === tz) return null;
    const mine = clockText(iso, viewerTz);
    return mine === clockText(iso, tz) ? null : mine;
  }

  function settle(rows: ScheduleSlotRow[]) {
    queryClient.setQueryData<Feed>(queryKey, (prev) => ({
      slots: rows,
      can_edit: prev?.can_edit ?? true,
    }));
    // The strip, the agenda, Desk and the performance page read the order
    // from their own feeds.
    for (const key of [
      ['planner-performances'],
      ['today-performances'],
      ['planner-dates'],
      ['performance'],
    ]) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  }

  function failed(err: unknown) {
    const msg = err instanceof Error ? err.message : '';
    addToast({
      tone: 'danger',
      message: msg.startsWith('Timeslots must be ordered')
        ? t('planner.ro_out_of_order', locale)
        : t('planner.ro_save_error', locale),
    });
  }

  const save = createMutation({
    mutationFn: (slots: ScheduleSlotInput[]) =>
      mutateJSON<{ slots: ScheduleSlotRow[] }>('PUT', `/api/schedule/${target}/${id}`, { slots }),
    onSuccess: (res) => res && settle(res.slots),
    onError: failed,
  });

  /* A MOVE IS DRAWN BEFORE IT IS WRITTEN: the row goes where the hand put it
     at once, and comes back (with a word) only if the write fails. */
  const reorder = createMutation({
    mutationFn: (ids: string[]) =>
      mutateJSON<{ slots: ScheduleSlotRow[] }>('PATCH', `/api/schedule/${target}/${id}`, { order: ids }),
    onMutate: (ids: string[]) => {
      const prev = queryClient.getQueryData<Feed>(queryKey);
      if (prev) {
        const byId = new Map(prev.slots.map((s) => [s.id, s]));
        queryClient.setQueryData<Feed>(queryKey, {
          ...prev,
          slots: ids.map((sid, i) => ({ ...byId.get(sid)!, sort: i + 1 })),
        });
      }
      return { prev };
    },
    onSuccess: (res) => res && settle(res.slots),
    onError: (err, _ids, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKey, ctx.prev);
      failed(err);
    },
  });
  let pending = $derived($save.isPending || $reorder.isPending);

  async function write(next: ScheduleSlotInput[]): Promise<boolean> {
    try {
      await $save.mutateAsync(next);
      return true;
    } catch {
      return false;
    }
  }

  let listEl = $state<HTMLOListElement | null>(null);

  /** Move a moment and keep the keyboard on it. */
  async function move(from: number, to: number, refocus: 'line' | 'edit' = 'line') {
    if (pending || to < 0 || to >= order.length || from === to) return;
    const ids = moveSlot(order, from, to).map((s) => s.id!);
    if (editing === from) editing = to;
    $reorder.mutate(ids);
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

  async function add(e: SubmitEvent) {
    e.preventDefault();
    const clock = parseClock(aClock);
    const named = namedSlot(aWord, null, known);
    aBad = clock === null;
    if (!clock || !named || pending) return;
    const at = instantFor(dayIso, clock, tz, order);
    if (!at) {
      aBad = true;
      return;
    }
    const slot: ScheduleSlotInput = { ...named, at, ends_at: null, notes: null };
    if (await write(placeByTime(order, slot))) {
      aClock = '';
      aWord = '';
    }
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

  async function commitEdit(e: SubmitEvent) {
    e.preventDefault();
    if (editing === null || pending) return;
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
    if (await write(next)) editing = null;
  }

  async function remove() {
    if (editing === null || pending) return;
    const i = editing;
    if (await write(order.filter((_, j) => j !== i))) editing = null;
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
    name ? `${t('planner.ro_title', locale)} · ${name}` : t('planner.ro_title', locale),
  );
</script>

<section class="hours" aria-busy={$feed.isPending}>
  <button type="button" class="lid" aria-expanded={open} onclick={() => (open = !open)}>
    <span class="lid__w">{lidWord}</span>
    <span class="lid__n"
      >{order.length === 0 ? t('planner.lid_empty', locale) : order.length} {open ? '−' : '+'}</span
    >
  </button>

  {#if open}
    <datalist id={listId}>
      {#each offered as [k, w] (k)}<option value={w}></option>{/each}
    </datalist>

    {#if viewerTz && order.some((s) => viewerClock(s.at))}
      <!-- Said once, not on every row: whose clock the hours are, and that
           the small one under each is the reader's. -->
      <p class="ro__zone">{t('planner.ro_zones', locale, { tz, yours: viewerTz })}</p>
    {/if}
    <ol class="hours__list" bind:this={listEl}>
      {#each order as s, i (s.id ?? i)}
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
                  disabled={pending}
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
                  disabled={pending}
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
                  disabled={pending}
                />
                <input
                  class="hours__in hours__in--notes"
                  aria-label={t('planner.ro_notes', locale)}
                  placeholder={t('planner.ro_notes_ph', locale)}
                  autocomplete="off"
                  bind:value={eNotes}
                  onkeydown={onEditKey}
                  disabled={pending}
                />
              </span>
              <span class="hours__acts">
                <button type="submit" class="hours__act" disabled={pending}>{t('planner.ro_save', locale)}</button>
                <button type="button" class="hours__act" onclick={cancelEdit} disabled={pending}
                  >{t('planner.ro_cancel', locale)}</button
                >
                <button
                  type="button"
                  class="hours__act hours__act--quiet ro__act--move"
                  onclick={() => move(i, i - 1, 'edit')}
                  disabled={pending || i === 0}>{t('planner.ro_up', locale)}</button
                >
                <button
                  type="button"
                  class="hours__act hours__act--quiet"
                  onclick={() => move(i, i + 1, 'edit')}
                  disabled={pending || i === order.length - 1}>{t('planner.ro_down', locale)}</button
                >
                <button type="button" class="hours__act hours__act--quiet" onclick={remove} disabled={pending}
                  >{t('planner.ro_remove', locale)}</button
                >
              </span>
            </form>
          </li>
        {:else}
          <li
            class="hours__row"
            class:ro__row--drop={dragOver === i && dragFrom !== null && dragFrom !== i}
            class:ro__row--dragging={dragFrom === i}
            data-index={i}
            data-kind={s.kind ?? undefined}
            draggable={canEdit && !pending}
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
          </li>
        {/if}
      {/each}

      {#if canEdit}
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
                disabled={pending}
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
                disabled={pending}
              />
            </span>
            <span class="hours__acts">
              <button
                type="submit"
                class="hours__act"
                disabled={pending || !aClock.trim() || !aWord.trim()}>{t('planner.ro_add', locale)}</button
              >
            </span>
          </form>
        </li>
      {:else if order.length === 0 && !$feed.isPending}
        <li class="hours__row hours__row--empty">{t('planner.ro_empty', locale)}</li>
      {/if}
    </ol>
    {#if aBad}<p class="hours__hint" role="status">{t('planner.ro_bad_clock', locale)}</p>{/if}
    {#if eBad}<p class="hours__hint" role="status">{t('planner.ro_bad_clock', locale)}</p>{/if}
  {/if}
</section>

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
      inline-size: 6px;
      block-size: 12px;
      background: radial-gradient(circle, var(--text-faint) 1px, transparent 1.2px) 0 0 / 3px 3px;
      opacity: 0;
      cursor: grab;
      transition: opacity 0.1s;
    }
    .hours__row:hover .ro__grip,
    .hours__line:focus-visible .ro__grip {
      opacity: 1;
    }
    .ro__row--dragging {
      opacity: 0.4;
    }
    .hours__row.ro__row--drop {
      border-block-start: 1px solid var(--text-muted);
    }
    .ro__zone {
      margin: var(--space-2xs) 0 0;
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.08em;
      color: var(--text-faint);
    }
    @container (max-width: 30rem) {
      .ro__grip {
        display: none;
      }
    }
  }
</style>
