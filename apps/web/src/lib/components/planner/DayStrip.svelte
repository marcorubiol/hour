<script lang="ts">
  /**
   * THE DAY · one drawing, and it is the strip (ADR-095 §1).
   *
   * The design compared «strip + a list of the day in words» against «strip
   * only», and went with the second: a control that only says «the way it used
   * to be» is not a control. So there is no document column here. What the
   * list used to carry, THE LABEL now finishes: the exact range, the city, the
   * cast, and the step nobody has set — the things a bar cannot draw.
   *
   * A ROW IS A THREAD, not an event: a gig with its run sheet is one row, a
   * rehearsal with two sessions is one row. One row per world.
   *
   * WHAT THE TRACK MAY SAY: only what somebody wrote down. The marks are the
   * run-sheet steps the data holds and nothing else — no derivation, no
   * estimate, no dash. See `$lib/day-strip`, where that law is tested.
   */
  import { accentVarFor } from '$lib/utils/accent';
  import IdentityMark from '$lib/components/IdentityMark.svelte';
  import type { ProjectLite, SlipKind } from '$lib/month-events';
  import { pct, overlaps, type StripThread } from '$lib/day-strip';

  interface Props {
    threads: Array<
      StripThread & {
        project: ProjectLite | null;
        /** Names on file for classes that HAVE a cast (show/studio); [] says
            «no cast on file»; null = a class where cast would be a lie (a
            press call is not four people at a radio at 10h). Data only —
            the project-team inference is never drawn here. */
        cast?: string[] | null;
        /** The document this row acts through — shows only. */
        roadSheetHref?: string | null;
        /** The pair's rule: soft while both are options, hard once one is ink. */
        clash?: 'soft' | 'hard' | null;
      }
    >;
    /** The track's window, in fractional hours. */
    win: { from: number; to: number };
    /** Now, in fractional hours — only drawn when this IS today. */
    now?: number | null;
    kindLabel: (kind: SlipKind) => string;
    /** The step's word: `load-in`, `soundcheck`… */
    stepLabel: (step: string) => string;
    /** `20:30` for a fractional hour, in the reader's format. */
    hourLabel: (hour: number) => string;
    /** «nothing on this day» */
    emptyLabel?: string;
    axisLabel?: string;
    /** «no cast on file» — the Board's word, shared on purpose. */
    noCastWord?: string;
    roadSheetWord?: string;
  }

  let {
    threads,
    win,
    now = null,
    kindLabel,
    stepLabel,
    hourLabel,
    emptyLabel = 'Nothing on this day.',
    axisLabel = 'the day',
    noCastWord = 'no cast on file',
    roadSheetWord = 'road sheet',
  }: Props = $props();

  /** The now label, one cell per character: a digit that changes remounts
      alone and rises — one movement per minute, and it means something. */
  let nowChars = $derived(now !== null ? hourLabel(now).split('') : []);

  /** A rule every two hours, labelled once at the top. */
  let ticks = $derived.by(() => {
    const out: number[] = [];
    for (let h = Math.ceil(win.from / 2) * 2; h < win.to; h += 2) out.push(h);
    return out;
  });
  let live = $derived(overlaps(threads, win));
  let sorted = $derived([...threads].sort((a, b) => a.a - b.a || a.b - b.b));
</script>

{#if sorted.length === 0}
  <p class="ds__empty">{emptyLabel}</p>
{:else}
  <div class="ds">
    <div class="ds__hd">
      <span class="ds__l ds__l--k">{axisLabel}</span>
      <span class="ds__t">
        {#each ticks as h (h)}
          <span class="ds__gl" style="left: {pct(h, win)}%">{hourLabel(h)}</span>
        {/each}
      </span>
    </div>

    <div class="ds__rows">
      <span class="ds__grid" aria-hidden="true">
        {#each ticks as h (h)}<span class="ds__g" style="left: {pct(h, win)}%"></span>{/each}
        <!-- Two threads live at once: the column says so before you read. -->
        {#each live as o, i (i)}
          <span
            class="ds__ov"
            style="left: {pct(o.from, win)}%; width: {pct(o.to, win) - pct(o.from, win)}%"
          ></span>
        {/each}
        {#if now !== null && now >= win.from && now <= win.to}
          <!-- NOW IS A TIME, NOT A CALL TO MAKE: ink, never colour. It says
               its hour on ONE side always — a mark that changes sides is two —
               and when the minute turns, ONLY the digit that changed rises
               (a keyed cell per character; tabular cifras so 9→10 cannot
               reflow its neighbours). -->
          <span class="ds__now" style="left: {pct(now, win)}%">
            <b>
              {#each nowChars as c, i (`${i}:${c}`)}<i class="ds__nowd">{c}</i>{/each}
            </b>
          </span>
        {/if}
      </span>

      {#each sorted as t (t.id)}
        <div
          class="ds__r"
          data-family={t.cert}
          data-kind={t.kind}
          data-steps={t.steps.join(',')}
          data-clash={t.clash ?? undefined}
        >
          <!-- THE LABEL FINISHES THE SENTENCE. The clash's rule lives on the
               label as a pseudo-element, never a border: a border on the row
               would push the TRACK off the grid it is measured against. The
               indent is eaten here; the label's outer width does not change. -->
          <span class="ds__l" style={t.project ? `--c: ${accentVarFor(t.project)}` : undefined}>
            <span class="ds__pack">
              {#if t.project}<IdentityMark
                  variant="compact"
                  accent={accentVarFor(t.project)}
                  initials={t.project.initials}
                  name={t.project.name}
                  size="15px"
                />{/if}
              <span class="ds__kind">{kindLabel(t.kind)}</span>
              {#if t.roadSheetHref}
                <a class="ds__rs" href={t.roadSheetHref}>{roadSheetWord} ↗</a>
              {/if}
            </span>
            <span class="ds__n">{t.name}</span>
            <span class="ds__c">
              <b class="ds__hr"
                >{#if t.spans.length}{hourLabel(t.spans[0].from)}–{hourLabel(
                    t.spans[t.spans.length - 1].to,
                  )}{:else}{hourLabel(t.marks[0].at)}{/if}</b
              >{#if t.city}<span>{t.city}</span>{/if}
            </span>
            {#if t.cast !== null && t.cast !== undefined}
              <!-- Who is inside the thread — data or the honest word, never
                   the inference. -->
              <span class="ds__cast" class:ds__cast--none={t.cast.length === 0}
                >{t.cast.length > 0 ? t.cast.join(' · ') : noCastWord}</span
              >
            {/if}
          </span>

          <span class="ds__t">
            {#each t.spans as sp, i (i)}
              <span
                class="ds__b"
                style="left: {pct(sp.from, win)}%; width: {Math.max(
                  0.4,
                  pct(sp.to, win) - pct(sp.from, win),
                )}%"
              ></span>
            {/each}
            {#each t.marks as m, i (i)}
              <span
                class="ds__m"
                class:ds__m--show={m.show}
                class:ds__m--solo={m.solo}
                class:ds__m--up={i % 2 === 1}
                data-step={m.step}
                style="left: {pct(m.at, win)}%"
              >
                <i></i>
                <b
                  >{hourLabel(m.at)}{#if !m.show && !m.solo}<em>{stepLabel(m.step)}</em>{/if}</b
                >
              </span>
            {/each}
          </span>
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  @layer components {
    .ds {
      --ds-l: 214px;
      border-block: 1px solid var(--border-color-light);
    }
    .ds__empty {
      padding: var(--space-l) 0;
      font-family: var(--font-display);
      font-style: italic;
      color: var(--text-faint);
    }
    .ds__hd {
      display: flex;
      align-items: center;
      padding-block: 7px 6px;
      border-block-end: 1px solid color-mix(in oklch, var(--border-color-light) 55%, transparent);
    }
    .ds__l {
      flex: 0 0 var(--ds-l);
      inline-size: var(--ds-l);
      min-inline-size: 0;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: baseline;
      column-gap: 8px;
      row-gap: 1px;
      padding: 8px 14px 8px 2px;
    }
    .ds__l--k {
      display: flex;
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-faint);
    }
    .ds__pack {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    /* The document this row acts through — a quiet door, far right of the
       kind word. */
    .ds__rs {
      margin-inline-start: auto;
      font-family: var(--font-mono);
      font-size: 8.5px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-faint);
      text-decoration: none;
      white-space: nowrap;
    }
    .ds__rs:hover {
      color: var(--text-color);
    }
    /* Who is on file. The honest absence is quieter than a name. */
    .ds__cast {
      grid-column: 1 / -1;
      font-family: var(--font-mono);
      font-size: 8.5px;
      letter-spacing: 0.08em;
      color: var(--text-muted);
    }
    .ds__cast--none {
      color: var(--text-faint);
      text-transform: uppercase;
      letter-spacing: 0.1em;
    }
    /* ── THE PAIR'S RULE — on the label, never a border on the row ─────
       2px dashed while both are options; 3px solid the moment one is ink.
       Red is conflict, and only conflict. */
    .ds__r[data-clash] .ds__l {
      position: relative;
      padding-inline-start: 10px;
    }
    .ds__r[data-clash] .ds__l::before {
      content: '';
      position: absolute;
      inset-block: 8px;
      inset-inline-start: 0;
      border-inline-start: 2px dashed var(--danger);
    }
    .ds__r[data-clash='hard'] .ds__l::before {
      border-inline-start: 3px solid var(--danger);
    }
    .ds__kind {
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-faint);
    }
    .ds__n {
      grid-column: 1 / -1;
      font-size: var(--text-s);
      color: var(--text-color);
      text-wrap: pretty;
      overflow-wrap: break-word;
    }
    .ds__r[data-kind='show'] .ds__n {
      font-family: var(--font-display);
      font-size: var(--text-m);
    }
    /* The line the list used to carry: the exact range, then where. */
    .ds__c {
      grid-column: 1 / -1;
      font-size: var(--text-xs);
      color: var(--text-faint);
      line-height: 1.42;
    }
    .ds__hr {
      font-family: var(--font-mono);
      font-weight: 400;
      font-variant-numeric: tabular-nums;
      color: var(--text-muted);
      margin-inline-end: 8px;
      /* An hour is never broken in two: the en-dash inside a range must not
         become a line-break opportunity. */
      white-space: nowrap;
    }
    .ds__t {
      position: relative;
      flex: 1;
      min-inline-size: 0;
      block-size: 100%;
    }
    .ds__hd .ds__t {
      block-size: 13px;
    }
    .ds__gl {
      position: absolute;
      inset-block-start: 0;
      transform: translateX(-50%);
      font-family: var(--font-mono);
      font-size: 9px;
      color: var(--text-faint);
      font-variant-numeric: tabular-nums;
    }
    .ds__rows {
      position: relative;
      padding-block: 3px 5px;
    }
    .ds__grid {
      position: absolute;
      inset-block: 0;
      inset-inline: var(--ds-l) 0;
      pointer-events: none;
    }
    .ds__g {
      position: absolute;
      inset-block: 0;
      inline-size: 1px;
      background: color-mix(in oklch, var(--border-color-light) 62%, transparent);
    }
    .ds__ov {
      position: absolute;
      inset-block: 0;
      background: color-mix(in oklch, var(--text-color) 3%, transparent);
    }
    .ds__now {
      position: absolute;
      inset-block: 0;
      inline-size: 1px;
      background: color-mix(in oklch, var(--text-color) 40%, transparent);
    }
    .ds__now b {
      position: absolute;
      inset-block-start: 2px;
      inset-inline-start: 6px;
      display: inline-flex;
      overflow: hidden;
      font-family: var(--font-mono);
      font-size: 8.5px;
      font-weight: 400;
      color: var(--text-muted);
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    /* One movement per minute: a changed digit is a NEW cell, and it rises
       into place — its neighbours, keyed unchanged, never move. */
    .ds__nowd {
      font-style: normal;
      animation: ds-minute 130ms ease-out;
    }
    @keyframes ds-minute {
      from {
        transform: translateY(0.9em);
      }
      to {
        transform: none;
      }
    }
    .ds__now::before {
      content: '';
      position: absolute;
      inset-block-start: -3px;
      inset-inline-start: -2px;
      inline-size: 5px;
      block-size: 5px;
      border-radius: 50%;
      background: var(--text-muted);
    }

    .ds__r {
      position: relative;
      display: flex;
      align-items: center;
      min-block-size: 70px;
    }
    .ds__r + .ds__r {
      border-block-start: 1px solid color-mix(in oklch, var(--border-color-light) 38%, transparent);
    }
    /* The bar: a rule with a tint, never a box. */
    .ds__b {
      position: absolute;
      inset-block-start: 50%;
      block-size: 9px;
      margin-block-start: -4.5px;
      border-radius: 2px;
      background: color-mix(in oklch, var(--c, var(--text-faint)) 14%, transparent);
      border: 1px solid color-mix(in oklch, var(--c, var(--text-faint)) 38%, var(--border-color-light));
    }
    .ds__r[data-family='hold'] .ds__b,
    .ds__r[data-family='proposed'] .ds__b {
      border-style: dashed;
      background: none;
    }
    .ds__r[data-family='released'] .ds__n {
      color: var(--text-faint);
      text-decoration: line-through;
    }
    .ds__r[data-family='hold'] .ds__n,
    .ds__r[data-family='proposed'] .ds__n {
      color: var(--text-muted);
      font-style: italic;
    }

    /* A step is a tick; only the show is ink. */
    .ds__m {
      position: absolute;
      inset-block-start: 50%;
      transform: translate(-50%, -50%);
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .ds__m i {
      inline-size: 1px;
      block-size: 15px;
      background: color-mix(in oklch, var(--c, var(--text-faint)) 58%, var(--text-faint));
    }
    .ds__m b {
      position: absolute;
      inset-block-start: calc(50% + 9px);
      inset-inline-start: 50%;
      transform: translateX(-50%);
      font-family: var(--font-mono);
      font-size: 9px;
      font-weight: 400;
      color: var(--text-faint);
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .ds__m--up b {
      inset-block-start: auto;
      inset-block-end: calc(50% + 9px);
    }
    .ds__m b em {
      position: absolute;
      inset-inline-start: 100%;
      inset-block-start: 0;
      margin-inline-start: 6px;
      font-style: normal;
      letter-spacing: 0.09em;
      text-transform: uppercase;
      color: var(--text-faint);
    }
    .ds__m--show i {
      inline-size: 7px;
      block-size: 7px;
      border-radius: 50%;
      background: var(--c, var(--text-color));
      border: 1px solid var(--card);
    }
    .ds__m--show b {
      color: var(--text-color);
      font-size: 11px;
    }
    /* AN INSTANT IS DRAWN AS AN INSTANT. When one hour is all the data has, a
       lone ring reads as a bar that failed to draw — the stem says «a point on
       an axis», and that is the whole of what is known. */
    .ds__m--solo::before {
      content: '';
      position: absolute;
      inset-inline-start: 50%;
      inset-block-start: 50%;
      transform: translate(-50%, -50%);
      block-size: 34px;
      border-inline-start: 1px solid color-mix(in oklch, var(--c, var(--text-faint)) 26%, transparent);
    }
    /* THE GLOSS FALLS BEFORE THE ASSERTION: on a narrow track the step's NAME
       goes first, and the hour — the assertion — is what stays. */
    @container (max-width: 560px) {
      .ds__m b em {
        display: none;
      }
    }
  }
</style>
