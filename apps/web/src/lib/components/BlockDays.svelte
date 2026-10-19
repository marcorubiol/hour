<script lang="ts">
  /**
   * BlockDays — the "which days" panel (ADR-084 §1; design "Hour Block
   * Create").
   *
   * Deliberately NOT a form and NOT a type. A block is a CARDINALITY, not a
   * kind of thing: a five-week run of rehearsals is still a rehearsal
   * (Marco, 2026-07-20). So the host form keeps owning what the event IS —
   * project, kind, hours, place, status — and this panel only answers
   * "which days", handing back a resolved list.
   *
   * The days come from a RULE (span + weekday set) with single days punched
   * out, never from enumerating 25 checkboxes.
   *
   * THE SPAN IS NOT ASKED HERE (ADR-139 p3): the host's one «Cuándo» control
   * already holds the day and its «hasta», so this panel only takes them. And
   * it does not scold before anything is done: the limit is said only once
   * the host has tried to save (`checked`).
   */
  import { weekdayLabels } from '$lib/datetime';
  import { appLocaleTag } from '$lib/i18n';
  import { addDaysIso } from '$lib/planner';
  import { blockDays, blockLimit, weekdayOf, WEEKDAY_ORDER, BLOCK_MAX_DAYS } from '$lib/block';

  interface Props {
    from?: string;
    to?: string;
    /** JS getDay() numbers. Defaults to every day — see the note below. */
    weekdays?: number[];
    exceptions?: string[];
    /** Project accent, so the picked days wear the colour they will land in. */
    accent?: string | null;
    locale?: string;
    /** The host tried to save: now a span over the limit says so. */
    checked?: boolean;
    labels: {
      weekdays: string;
      pickSpan: string;
      daysUnit: string;
      tooFew: string;
      tooMany: string;
      removed: (n: number) => string;
    };
  }

  let {
    from = '',
    to = '',
    weekdays = $bindable([0, 1, 2, 3, 4, 5, 6]),
    exceptions = $bindable([]),
    accent = null,
    locale = appLocaleTag(),
    checked = false,
    labels,
  }: Props = $props();

  let wdLabels = $derived(weekdayLabels(locale));
  let days = $derived(blockDays({ from, to, weekdays, exceptions }));
  let limit = $derived(blockLimit(days.length));
  let daySet = $derived(new Set(days));
  let exceptionSet = $derived(new Set(exceptions));
  /** Only the punch-outs that still remove something (see the count). */
  let liveExceptions = $derived(
    exceptions.filter((d) => d >= from && d <= to && weekdays.includes(weekdayOf(d))),
  );

  /** Whole weeks covering the span, so a day can be punched out where the
      eye already expects to find it. */
  let calendarDays = $derived.by(() => {
    if (!from || !to || to < from) return [] as string[];
    const back = (weekdayOf(from) + 6) % 7;
    const fwd = 6 - ((weekdayOf(to) + 6) % 7);
    const out: string[] = [];
    let d = addDaysIso(from, -back);
    const end = addDaysIso(to, fwd);
    // Same 700-day bound as blockDays: past it the rule is over the cap
    // anyway, so the grid can stop without hiding a valid block.
    for (let walked = 0; d <= end && walked < 700; walked++) {
      out.push(d);
      d = addDaysIso(d, 1);
    }
    return out;
  });

  function toggleWeekday(w: number) {
    weekdays = weekdays.includes(w) ? weekdays.filter((x) => x !== w) : [...weekdays, w];
  }
  function toggleException(day: string) {
    if (day < from || day > to) return;
    if (!weekdays.includes(weekdayOf(day))) return; // the rule already excludes it
    exceptions = exceptionSet.has(day)
      ? exceptions.filter((x) => x !== day)
      : [...exceptions, day];
  }
</script>

<div class="bd" style={accent ? `--c: ${accent}` : undefined}>
  <div class="bd__wd" role="group" aria-label={labels.weekdays}>
    {#each WEEKDAY_ORDER as w, i (w)}
      <button
        type="button"
        class="bd__wdchip"
        class:bd__wdchip--on={weekdays.includes(w)}
        aria-pressed={weekdays.includes(w)}
        onclick={() => toggleWeekday(w)}>{wdLabels[i]}</button
      >
    {/each}
  </div>

  {#if calendarDays.length === 0}
    <p class="bd__empty">{labels.pickSpan}</p>
  {:else}
    <div class="bd__cal" role="group">
      {#each calendarDays as d (d)}
        {@const inSpan = d >= from && d <= to}
        <button
          type="button"
          class="bd__cald"
          class:bd__cald--out={!inSpan}
          class:bd__cald--sel={daySet.has(d)}
          class:bd__cald--rem={exceptionSet.has(d)}
          disabled={!inSpan || !weekdays.includes(weekdayOf(d))}
          aria-pressed={daySet.has(d)}
          onclick={() => toggleException(d)}>{Number(d.slice(8, 10))}</button
        >
      {/each}
    </div>
  {/if}

  <p class="bd__count" class:bd__count--err={checked && limit !== 'ok'}>
    <b>{days.length}</b>
    <span>{labels.daysUnit}</span>
    {#if checked && limit === 'too_many'}
      <i>{labels.tooMany}</i>
    {:else if checked && limit === 'too_few'}
      <i>{labels.tooFew}</i>
    {:else if liveExceptions.length > 0}
      <i>{labels.removed(liveExceptions.length)}</i>
    {/if}
  </p>
</div>

<style>
  /* Rows, not a sunk panel (ADR-139 p4): the two ends are field rows like
     the rest of the dialog, the rule and the calendar sit under them. */
  .bd {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }
  /* The rule reads like the Segmented it is a cousin of: a day that is IN is
     raised on paper with its word in ink; a day that is out has no paper and
     a faint, struck word. Seven «on» days must never read as seven empty
     fields (review 2026-10-19, hallazgo 4). */
  .bd__wd {
    display: flex;
    gap: var(--seg-inset);
    padding: var(--seg-inset);
    background: var(--seg-track);
    border: var(--border-size) solid var(--seg-edge);
    border-radius: var(--radius);
  }
  .bd__wdchip {
    flex: 1;
    text-align: center;
    appearance: none;
    min-block-size: var(--touch-target);
    padding: var(--space-2xs) 0;
    border: 0;
    border-radius: var(--radius-s);
    background: transparent;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-decoration: line-through;
    cursor: pointer;
  }
  .bd__wdchip--on {
    background: var(--seg-on);
    color: var(--text-color);
    text-decoration: none;
    box-shadow: var(--box-shadow-1);
  }
  .bd__wdchip:focus-visible {
    outline: var(--focus-width) solid var(--focus-color);
    outline-offset: var(--focus-offset);
  }

  /* The calendar shows the RESULT of the rule and is only a way to punch a
     single day out — never the way to build the block. */
  .bd__cal {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
  }
  .bd__cald {
    appearance: none;
    min-block-size: var(--control-size-s);
    border: 1px solid transparent;
    border-radius: var(--radius-s);
    background: none;
    color: var(--text-faint);
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }
  .bd__cald:disabled {
    cursor: default;
  }
  .bd__cald--out {
    visibility: hidden;
  }
  /* Picked days wear the SAME hatch the month will give them: what you choose
     here is recognisably what lands there. */
  .bd__cald--sel {
    border-color: color-mix(in oklch, var(--c, var(--text-color)) 32%, transparent);
    border-style: dashed;
    background-image: repeating-linear-gradient(
      135deg,
      color-mix(in oklch, var(--c, var(--text-color)) 11%, var(--bg-ultra-light)) 0 4px,
      var(--bg-ultra-light) 4px 8px
    );
    color: var(--text-color);
  }
  .bd__cald--rem {
    text-decoration: line-through;
    text-decoration-color: var(--danger, var(--text-muted));
    background-image: none;
    border-color: transparent;
    border-style: solid;
  }

  .bd__count {
    display: flex;
    align-items: baseline;
    gap: var(--space-xs);
    margin: 0;
    padding-block-start: var(--space-xs);
    border-block-start: 1px solid var(--border-color-light);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  .bd__count b {
    font-size: var(--text-l);
    color: var(--heading-color);
    line-height: 1;
  }
  .bd__count i {
    margin-inline-start: auto;
    font-style: normal;
    font-family: var(--font-mono);
    color: var(--text-faint);
  }
  .bd__count--err b,
  .bd__count--err i {
    color: var(--danger, var(--text-color));
  }
  .bd__empty {
    margin: 0;
    padding: var(--space-m) 0;
    text-align: center;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-faint);
  }
</style>
