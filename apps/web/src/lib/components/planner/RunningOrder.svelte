<script lang="ts">
  /**
   * THE RUNNING ORDER · the day of one thing, hour by hour (ADR-090 P3).
   *
   * The order of a gig or a rehearsal day: load-in, soundcheck, photo call,
   * show, load-out… It is the road sheet's schedule grown into a list anybody
   * can extend, and it is filled IN THE MOMENT: during a rehearsal somebody
   * types `17h05 photo call` and it lands where its hour says.
   *
   * It lives in the Planner's Day view, under the strip, because that is the
   * only place that already holds BOTH kinds of parent: a performance has a
   * page, a rehearsal (`date`) has none. The strip says the shape of the day;
   * this says it in words, one thing at a time.
   *
   * WHAT IT DRAWS: only what somebody wrote down, the strip's law. No
   * estimated durations, no placeholder five. An empty order is one line.
   *
   * HOW IT WRITES: the whole order to `PUT /api/schedule/:target/:id`, which
   * is `replace_schedule_slots`. P2 (live editing over the collab DO) changes
   * only that line: the order will be a `Y.Array` in the same doc as the
   * notes, and this component will edit the array instead of PUTting it. The
   * editing UI and the order rules (`$lib/running-order`) stay.
   */
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import { t, type Locale } from '$lib/i18n';
  import { addToast } from '../Toast.svelte';
  import type { ScheduleSlotInput, ScheduleSlotRow } from '$lib/schedule-slot';
  import {
    LEGACY_KINDS,
    clockText,
    dayOf,
    endFor,
    inputsOf,
    instantFor,
    namedSlot,
    parseClock,
    placeByTime,
    slotWord,
    type RunningOrderTarget,
  } from '$lib/running-order';

  interface Props {
    target: RunningOrderTarget;
    id: string;
    /** The day being looked at, `YYYY-MM-DD`: where a typed hour lands. */
    dayIso: string;
    /** The zone a typed hour means (ADR-078 §11: the space's wall clock). */
    tz: string;
    locale: Locale;
    /** True on today: offers «now» for the moment that is happening. */
    isToday?: boolean;
    /** Whose order this is, when the day holds more than one. */
    name?: string | null;
  }

  let { target, id, dayIso, tz, locale, isToday = false, name = null }: Props = $props();

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

  /** The word for a kind — the strip's and the agenda's, shared on purpose. */
  function kindWord(kind: string): string {
    if (kind === 'load_in') return t('desk.anchor_loadin', locale);
    if (kind === 'start') return t('desk.anchor_show', locale);
    if ((LEGACY_KINDS as readonly string[]).includes(kind)) return t(`desk.anchor_${kind}`, locale);
    return kind.replace(/_/g, ' ');
  }
  let words = $derived(LEGACY_KINDS.map((k) => [k, kindWord(k)] as const));

  const save = createMutation({
    mutationFn: (slots: ScheduleSlotInput[]) =>
      mutateJSON<{ slots: ScheduleSlotRow[] }>('PUT', `/api/schedule/${target}/${id}`, { slots }),
    onSuccess: (res) => {
      if (res) queryClient.setQueryData<Feed>(queryKey, (prev) => ({
        slots: res.slots,
        can_edit: prev?.can_edit ?? true,
      }));
      // The five legacy kinds are read by the strip, the agenda and Desk
      // from the performance feeds. A date's order feeds nothing else yet.
      if (target === 'performance') {
        void queryClient.invalidateQueries({ queryKey: ['planner-performances'] });
        void queryClient.invalidateQueries({ queryKey: ['today-performances'] });
      }
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : '';
      addToast({
        tone: 'danger',
        message: msg.startsWith('Timeslots must be ordered')
          ? t('planner.ro_out_of_order', locale)
          : t('planner.ro_save_error', locale),
      });
    },
  });
  let pending = $derived($save.isPending);

  async function write(next: ScheduleSlotInput[]): Promise<boolean> {
    try {
      await $save.mutateAsync(next);
      return true;
    } catch {
      return false;
    }
  }

  let open = $state(true);

  // ── Adding: an hour and a word, Enter. ────────────────────────────────
  let aClock = $state('');
  let aWord = $state('');
  let aBad = $state(false);

  function nowClock(): string {
    return clockText(new Date().toISOString(), tz);
  }

  async function add(e: SubmitEvent) {
    e.preventDefault();
    const clock = parseClock(aClock);
    const named = namedSlot(aWord, null, words);
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

  // ── Editing one moment: the row becomes its form. ─────────────────────
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
    const named = namedSlot(eWord, prev.kind, words);
    eBad = clock === null || (eEnd.trim() !== '' && endClock === null);
    if (eBad || !clock || !named) return;
    // An untouched hour keeps its instant (a 1h30 that already ran past
    // midnight stays tomorrow); a new hour is placed like a new moment.
    const unchanged = parseClock(clockText(prev.at, tz));
    const same = unchanged !== null && unchanged.h === clock.h && unchanged.m === clock.m;
    const others = order.filter((_, j) => j !== i);
    const at = same ? prev.at : instantFor(dayIso, clock, tz, others);
    if (!at) {
      eBad = true;
      return;
    }
    const ends_at = endClock ? endFor(at, endClock, tz) : null;
    const slot: ScheduleSlotInput = {
      ...prev,
      ...named,
      at,
      ends_at,
      notes: eNotes.trim() || null,
    };
    if (await write(placeByTime(order, slot, i))) editing = null;
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

<section class="ro" aria-busy={$feed.isPending}>
  <button type="button" class="lid" aria-expanded={open} onclick={() => (open = !open)}>
    <span class="lid__w">{lidWord}</span>
    <span class="lid__n"
      >{order.length === 0 ? t('planner.lid_empty', locale) : order.length} {open ? '−' : '+'}</span
    >
  </button>

  {#if open}
    <datalist id={listId}>
      {#each words as [k, w] (k)}<option value={w}></option>{/each}
    </datalist>

    <ol class="ro__list">
      {#each order as s, i (s.id ?? i)}
        {@const tomorrow = dayOf(s.at, tz) !== dayIso}
        {#if editing === i}
          <li class="ro__row ro__row--edit">
            <form class="ro__form" onsubmit={commitEdit} use:focusFirst>
              <span class="ro__at ro__at--edit">
                <input
                  class="ro__in ro__in--clock"
                  aria-label={t('planner.ro_clock', locale)}
                  aria-invalid={eBad}
                  placeholder="20h30"
                  inputmode="numeric"
                  autocomplete="off"
                  bind:value={eClock}
                  onkeydown={onEditKey}
                  disabled={pending}
                />
                <span class="ro__dash" aria-hidden="true">–</span>
                <input
                  class="ro__in ro__in--clock"
                  aria-label={t('planner.ro_until', locale)}
                  placeholder={t('planner.ro_until', locale)}
                  inputmode="numeric"
                  autocomplete="off"
                  bind:value={eEnd}
                  onkeydown={onEditKey}
                  disabled={pending}
                />
              </span>
              <span class="ro__body">
                <input
                  class="ro__in ro__in--word"
                  aria-label={t('planner.ro_moment', locale)}
                  placeholder={t('planner.ro_moment_ph', locale)}
                  list={listId}
                  autocomplete="off"
                  bind:value={eWord}
                  onkeydown={onEditKey}
                  disabled={pending}
                />
                <input
                  class="ro__in ro__in--notes"
                  aria-label={t('planner.ro_notes', locale)}
                  placeholder={t('planner.ro_notes_ph', locale)}
                  autocomplete="off"
                  bind:value={eNotes}
                  onkeydown={onEditKey}
                  disabled={pending}
                />
              </span>
              <span class="ro__acts">
                <button type="submit" class="ro__act" disabled={pending}>{t('planner.ro_save', locale)}</button>
                <button type="button" class="ro__act" onclick={cancelEdit} disabled={pending}
                  >{t('planner.ro_cancel', locale)}</button
                >
                <button type="button" class="ro__act ro__act--quiet" onclick={remove} disabled={pending}
                  >{t('planner.ro_remove', locale)}</button
                >
              </span>
            </form>
          </li>
        {:else}
          <li class="ro__row" data-kind={s.kind ?? undefined}>
            <svelte:element
              this={canEdit ? 'button' : 'div'}
              class="ro__line"
              {...canEdit
                ? {
                    type: 'button',
                    'aria-label': t('planner.ro_edit', locale, { moment: slotWord(s, kindWord) }),
                    onclick: () => startEdit(i),
                  }
                : {}}
            >
              <span class="ro__at"
                >{clockText(s.at, tz)}{#if tomorrow}<sup
                    class="ro__plus"
                    title={t('planner.ro_next_day', locale)}>+1</sup
                  >{/if}{#if s.ends_at}<span class="ro__end">–{clockText(s.ends_at, tz)}</span>{/if}</span
              >
              <span class="ro__body">
                <span class="ro__w" class:ro__w--show={s.kind === 'start'}>{slotWord(s, kindWord)}</span>
                {#if s.notes}<span class="ro__n">{s.notes}</span>{/if}
              </span>
            </svelte:element>
          </li>
        {/if}
      {/each}

      {#if canEdit}
        <li class="ro__row ro__row--add">
          <form class="ro__form" onsubmit={add}>
            <span class="ro__at ro__at--edit">
              <input
                class="ro__in ro__in--clock"
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
                  class="ro__act ro__act--quiet"
                  onclick={() => {
                    aClock = nowClock();
                    aBad = false;
                  }}>{t('planner.ro_now', locale)}</button
                >
              {/if}
            </span>
            <span class="ro__body">
              <input
                class="ro__in ro__in--word"
                aria-label={t('planner.ro_moment', locale)}
                placeholder={t('planner.ro_moment_ph', locale)}
                list={listId}
                autocomplete="off"
                bind:value={aWord}
                disabled={pending}
              />
            </span>
            <span class="ro__acts">
              <button
                type="submit"
                class="ro__act"
                disabled={pending || !aClock.trim() || !aWord.trim()}>{t('planner.ro_add', locale)}</button
              >
            </span>
          </form>
        </li>
      {:else if order.length === 0 && !$feed.isPending}
        <li class="ro__row ro__row--empty">{t('planner.ro_empty', locale)}</li>
      {/if}
    </ol>
    {#if aBad}<p class="ro__hint" role="status">{t('planner.ro_bad_clock', locale)}</p>{/if}
    {#if eBad}<p class="ro__hint" role="status">{t('planner.ro_bad_clock', locale)}</p>{/if}
  {/if}
</section>

<style>
  @layer components {
    /* THREE COLUMNS, DECLARED ONCE: the hour, the moment, the verbs. Every
       row — read, edit, add — takes them by subgrid, so an hour typed in the
       add row sits exactly under the hours above it. Alignment by
       construction, not by matching paddings. */
    .ro {
      --ro-at: 11ch;
      container-type: inline-size;
      margin-block-start: var(--space-m);
    }
    .ro__list {
      display: grid;
      grid-template-columns: var(--ro-at) minmax(0, 1fr) auto;
      column-gap: var(--space-m);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .ro__row {
      display: grid;
      grid-column: 1 / -1;
      grid-template-columns: subgrid;
      align-items: baseline;
    }
    .ro__row + .ro__row {
      border-block-start: 1px dotted var(--border-color-light);
    }
    .ro__line,
    .ro__form {
      display: grid;
      grid-column: 1 / -1;
      grid-template-columns: subgrid;
      align-items: baseline;
      padding-block: var(--space-xs);
    }
    /* The read row is a button only to whoever may edit; it must not look
       like one. */
    .ro__line {
      inline-size: 100%;
      margin: 0;
      padding-inline: 0;
      border: 0;
      background: none;
      font: inherit;
      color: inherit;
      text-align: start;
    }
    button.ro__line {
      cursor: pointer;
    }
    button.ro__line:hover .ro__w {
      text-decoration: underline;
      text-decoration-thickness: 1px;
      text-underline-offset: 3px;
    }
    /* The hour: the Planner's clock, tabular so the column reads down. */
    .ro__at {
      font-size: var(--text-s);
      font-variant-numeric: tabular-nums;
      color: var(--text-color);
      white-space: nowrap;
    }
    .ro__end {
      color: var(--text-faint);
    }
    .ro__plus {
      margin-inline-start: 1px;
      font-size: 0.7em;
      color: var(--text-faint);
    }
    .ro__body {
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-inline-size: 0;
    }
    .ro__w {
      font-size: var(--text-s);
      color: var(--text-color);
      overflow-wrap: anywhere;
    }
    /* The show is why the day exists: the serif, the strip's full ink. */
    .ro__w--show {
      font-family: var(--font-display);
      font-size: var(--text-m);
    }
    .ro__n {
      font-size: var(--text-xs);
      color: var(--text-faint);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .ro__row--empty {
      display: block;
      padding-block: var(--space-xs);
      font-family: var(--font-display);
      font-style: italic;
      font-size: var(--text-s);
      color: var(--text-faint);
    }

    /* ── The forms: bare fields on the same lines as the text they edit ── */
    .ro__at--edit {
      display: flex;
      align-items: baseline;
      gap: 2px;
    }
    .ro__in {
      min-inline-size: 0;
      padding: 0 0 1px;
      border: 0;
      border-block-end: 1px solid var(--border-color-light);
      background: none;
      font: inherit;
      font-size: var(--text-s);
      color: var(--text-color);
    }
    .ro__in:focus {
      outline: none;
      border-block-end-color: var(--text-muted);
    }
    .ro__in::placeholder {
      color: var(--text-faint);
    }
    /* The five words still come up as you type; the arrow is chrome. */
    .ro__in::-webkit-calendar-picker-indicator {
      display: none;
    }
    .ro__in[aria-invalid='true'] {
      border-block-end-color: var(--danger);
    }
    .ro__in--clock {
      inline-size: 5ch;
      font-variant-numeric: tabular-nums;
    }
    .ro__in--notes {
      font-size: var(--text-xs);
    }
    .ro__dash {
      color: var(--text-faint);
    }
    .ro__row--add .ro__in {
      border-block-end-style: dotted;
    }

    /* ── The verbs: margin voice, never buttons that shout ──────────── */
    .ro__acts {
      display: flex;
      gap: var(--space-s);
      justify-content: end;
    }
    .ro__act {
      padding: 0;
      border: 0;
      background: none;
      cursor: pointer;
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--text-muted);
      white-space: nowrap;
    }
    .ro__act:hover:not(:disabled) {
      color: var(--text-color);
    }
    .ro__act:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .ro__act--quiet {
      color: var(--text-faint);
    }
    .ro__hint {
      margin: var(--space-2xs) 0 0;
      font-size: var(--text-xs);
      color: var(--text-faint);
    }

    /* A NARROW HOST (the day on a phone): the hour column shrinks to the
       widest hour it holds — still one column, still aligned — and the verbs
       drop under the moment. The CONTAINER decides, not the viewport. */
    @container (max-width: 30rem) {
      .ro__list {
        grid-template-columns: max-content minmax(0, 1fr);
        column-gap: var(--space-s);
      }
      .ro__acts {
        grid-column: 2;
        justify-content: start;
        padding-block-start: var(--space-2xs);
      }
    }
  }
</style>
