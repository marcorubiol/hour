<script lang="ts">
  /**
   * The Board (Planner v3, ADR-094/ADR-095) — ONE CSS grid, and that is the
   * whole architecture: a frozen label column, one column per drawn day, one
   * row per lane, and a band row per group with a real (empty) cell in every
   * column. The old ribbon drew pips on a percentage track; the v3 board
   * draws THE SLIP — the app's one card (ADR-095: never a lookalike) —
   * inside cells whose width is a container query away from the month's.
   *
   * Two structural laws, both paid for in the design prototype:
   *
   * 1. **The band is a row of cells, never a `1 / -1` spanner.** The spanner
   *    version put two boxes in track 1, dropped a 10px phantom row per
   *    group (70px of dead space over seven groups) and broke the frozen
   *    column's vertical rule five times. If a fact crosses the drawing —
   *    the who|when rule, a week edge, a month edge — EVERY row draws it.
   *
   * 2. **One writer per fact.** Counts come from the engine
   *    ($lib/board-lanes): tallies, group sums, clash weights, away
   *    segments and fold ticks are all computed there and only WORDED here,
   *    through t()-backed callbacks the page passes down. This component
   *    never re-derives a number the engine owns — the prototype's lane
   *    count said «12 lanes» over nine rows because two sites each counted
   *    their own way.
   *
   * WHAT IS STILL STATIC, on purpose (the measured passes are the next
   * step, each with a seam left here):
   * - the pinned axis (`--hdy`) and the travelling group label (`--gy`):
   *   the head keeps an inert `position: sticky` as belt-and-braces;
   * - the away band sits at a CSS `bottom` inside its grid area instead of
   *   the measured 21px-above-floor drawer;
   * - the now line, the minute flap and the growing horizon do not exist
   *   yet — the page still hands down the month window;
   * - the hold's hover CONFIRM verb (law 28's second half) and the identity
   *   quick panel on the monogram are not wired.
   */
  import { SvelteSet } from 'svelte/reactivity';
  import Slip from '$lib/components/planner/Slip.svelte';
  import IdentityMark from '$lib/components/IdentityMark.svelte';
  import type { LaneAxis } from '$lib/carrils';
  import {
    awayFloorCols,
    awaySegments,
    clashDayMarks,
    clashMarks,
    foldTicks,
    groupTally,
    laneTally,
    type AwayRun,
    type BoardClash,
    type BoardColumn,
    type BoardGroup,
    type BoardLaneRef,
    type LaneTally,
    type PlacedEvent,
  } from '$lib/board-lanes';
  import type { Slip as SlipVM, SlipKind } from '$lib/month-events';

  interface Props {
    /** The dial — 'scope' | 'person'. Decides what the + door knows. */
    axis: LaneAxis;
    /** The engine's folded timeline. The page words the month names before
        passing (the engine speaks its own lowercase register). */
    columns: BoardColumn[];
    /** Groups + lanes, post-`laneEvents` (nocast lanes already born). */
    groups: BoardGroup[];
    /** laneKey → isoDay → placed events, from the engine's `laneEvents`. */
    cells: ReadonlyMap<string, ReadonlyMap<string, readonly PlacedEvent[]>>;
    /** Normalised absence runs — both record shapes already one fact. */
    awayRuns: AwayRun[];
    /** The day's clashes, resolved to their ISO day by the page. */
    clashes: BoardClash[];

    /* ── words · every one t()-backed by the page ───────────────────── */
    /** The corner: the axis's own name ('Scope' | 'Person'). */
    axisWord: string;
    todayWord: string;
    weekdayWord: (iso: string) => string;
    /** The italic month name at a month start. */
    monthWord: (iso: string) => string;
    /** The lane's total line — counts and the three silences, worded. */
    laneTallyText: (tally: LaneTally) => string;
    /** The shut lid's line — units + summed counts, worded. */
    groupTallyText: (sums: {
      units: number;
      confirmed: number;
      options: number;
      notCast: number;
    }) => string;
    sharedWord: string;
    /** The ghost lane's name — the engine says 'team', the page words it. */
    teamWord: string;
    /** The nocast lane's suffix — «{project} · no cast». */
    noCastWord: string;
    /** The absence band's kind word ('away'). */
    awayWord: string;
    /** The band's terminus phrase ('until 20 jul'). */
    untilLabel: (iso: string) => string;
    emptyLabel: string;
    createLabel: (iso: string) => string;
    clashDayLabel: (iso: string) => string;

    /* ── the slip's contract, passed straight through ───────────────── */
    kindLabel: (kind: SlipKind) => string;
    stateLabel: (slip: SlipVM) => string | null;
    stateUrgent?: (slip: SlipVM) => boolean;

    /* ── gestures ───────────────────────────────────────────────────── */
    /** The empty cell is the door: day + the lane's project (null on the
        person axis — the dialog asks, ADR-094 §3b). */
    onDayCreate: (iso: string, projectId: string | null) => void;
    /** The head's red '!' — the page opens the decision at that day. */
    onClashDay: (iso: string) => void;
    /** A date slip has no page of its own; its edit dialog opens here. */
    onDateOpen?: (dateId: string) => void;
    /** The group band's monogram/ring — identity is the page's to resolve. */
    groupMark?: (group: BoardGroup) => { accent: string; initials: string | null } | null;
  }

  let {
    axis,
    columns,
    groups,
    cells,
    awayRuns,
    clashes,
    axisWord,
    todayWord,
    weekdayWord,
    monthWord,
    laneTallyText,
    groupTallyText,
    sharedWord,
    teamWord,
    noCastWord,
    awayWord,
    untilLabel,
    emptyLabel,
    createLabel,
    clashDayLabel,
    kindLabel,
    stateLabel,
    stateUrgent = () => false,
    onDayCreate,
    onClashDay,
    onDateOpen,
    groupMark,
  }: Props = $props();

  /* Lid state is FURNITURE, not URL (ADR-094 §4 draws that line): folding a
     group is arranging your desk, and it dies with the component. */
  const shut = new SvelteSet<string>();

  /** 168px frozen labels + 118px per day / 58px per fold — the proto's
      measured widths, TODAY INCLUDED: equal width, its marks are ink (the
      number, the word, and — next step — the hour line), never extra room. */
  let gridTemplate = $derived(
    `168px ${columns.map((c) => (c.kind === 'gap' ? '58px' : '118px')).join(' ')}`,
  );

  /* ── the engine's facts, worded below, never re-derived ───────────── */
  let marks = $derived(clashMarks(clashes, cells));
  let clashDays = $derived(clashDayMarks(clashes));
  let segs = $derived(awaySegments(awayRuns, columns));
  let floors = $derived(awayFloorCols(awayRuns, columns));

  let tallies = $derived.by(() => {
    const touched = new Set(awayRuns.map((r) => r.laneKey));
    const m = new Map<string, LaneTally>();
    for (const g of groups) {
      for (const l of g.lanes) {
        const placed = [...(cells.get(l.key)?.values() ?? [])].flat();
        m.set(l.key, {
          ...laneTally({ placed, ghost: l.kind === 'ghost', touched: touched.has(l.key) }),
        });
      }
    }
    return m;
  });

  /** Each visible lane's grid ROW — the away bands are absolutely
      positioned INTO their grid area, so this map must mirror the template
      below exactly: row 1 is the head, every group adds its band row, every
      open group adds one row per lane. */
  let laneRow = $derived.by(() => {
    const m = new Map<string, number>();
    let r = 1;
    for (const g of groups) {
      r++;
      if (shut.has(g.key)) continue;
      for (const l of g.lanes) {
        r++;
        m.set(l.key, r);
      }
    }
    return m;
  });

  function placedAt(lane: BoardLaneRef, col: BoardColumn): readonly PlacedEvent[] {
    return cells.get(lane.key)?.get(col.from) ?? [];
  }
  /** A multi-day fold can hold a marked day whose events are off the sheet —
      the '!' never asked the filter, so the fold's head still carries it. */
  function gapClash(col: BoardColumn): boolean {
    for (const d of clashDays) if (d >= col.from && d <= col.to) return true;
    return false;
  }
  /** The fold's ruler step, or null when a day stops being a mark (law 15:
      under 6px a measure becomes a texture, and a texture is not drawn). */
  function foldStep(col: BoardColumn): number | null {
    const ticks = foldTicks(col.span, 58);
    return ticks.length > 1 ? ticks[1] : null;
  }
  function laneName(lane: BoardLaneRef): string {
    if (lane.kind === 'ghost') return teamWord;
    if (lane.kind === 'nocast') return `${lane.name} · ${noCastWord}`;
    return lane.name;
  }
  function toggle(key: string) {
    if (shut.has(key)) shut.delete(key);
    else shut.add(key);
  }
</script>

{#if groups.length === 0}
  <p class="board__empty">{emptyLabel}</p>
{:else}
  <!-- The strip scrolls sideways INSIDE itself; the page never does. -->
  <div class="board__wrap">
    <div class="board" style="grid-template-columns: {gridTemplate}">
      <!-- ══ ROW 1 · the date axis ══════════════════════════════════════
           Mono weekday over serif number. TODAY is the word and full ink —
           EQUAL width, NO fill (Marco's ruling 2): its three marks are ink,
           never room. Week and month boundaries are border-lefts drawn by
           every row's cells, so the vertical never blinks. -->
      <span class="board__corner">{axisWord}</span>
      {#each columns as col (col.from)}
        <span
          class="board__head"
          class:gap={col.kind === 'gap'}
          class:today={col.today}
          class:we={col.kind === 'gap' && col.weekend}
          class:wstart={col.wstart}
          class:mstart={col.mstart}
          style={col.kind === 'gap' && foldStep(col) !== null ? `--dw: ${foldStep(col)}px` : undefined}
        >
          {#if col.monthStartName}<i class="board__mo">{monthWord(col.from)}</i>{/if}
          {#if col.kind === 'gap'}
            <span class="board__gaplab"
              >{col.gapLabel}{#if gapClash(col)}<button
                  type="button"
                  class="board__dmk board__dmk--dim"
                  aria-label={clashDayLabel(col.from)}
                  onclick={() => onClashDay(col.from)}>!</button
                >{/if}</span
            >
          {:else}
            <span class="board__wd">{weekdayWord(col.from)}</span>
            <b class="board__num"
              >{Number(col.from.slice(8, 10))}{#if clashDays.has(col.from)}<button
                  type="button"
                  class="board__dmk"
                  aria-label={clashDayLabel(col.from)}
                  onclick={() => onClashDay(col.from)}>!</button
                >{/if}</b
            >
            {#if col.today}<i class="board__todayw">{todayWord}</i>{/if}
          {/if}
        </span>
      {/each}

      {#each groups as group (group.key)}
        {@const isShut = shut.has(group.key)}
        {@const mark = groupMark?.(group) ?? null}
        <!-- ══ the group band · a LID ═══════════════════════════════════
             The sticky label is a button; folded, it still says what it
             holds (law 11) — the tally prints INSIDE the label, because a
             sibling outside it clipped when the label pins (next step). -->
        <button
          type="button"
          class="board__grpl"
          class:shut={isShut}
          aria-expanded={!isShut}
          onclick={() => toggle(group.key)}
        >
          <span class="board__grp-l">
            <span class="board__mark">
              {#if mark}
                <IdentityMark
                  mini
                  accent={mark.accent}
                  initials={mark.initials}
                  name={group.name}
                  variant={mark.initials ? 'compact' : 'bare'}
                />
              {/if}
            </span>
            <span class="board__grp-n">{group.name}</span>
            <span class="board__grp-x" aria-hidden="true">{isShut ? '+' : '–'}</span>
          </span>
          {#if isShut}
            <span class="board__grp-c">{groupTallyText(groupTally(group, tallies))}</span>
          {/if}
        </button>
        <!-- ONE empty cell per column — never a `1 / -1` spanner (the
             phantom-row law). Empty, but it stretches to the band row's
             height, so the week/month rules cross the band unbroken. -->
        {#each columns as col (`${group.key}:${col.from}`)}
          <span
            class="board__grpc"
            class:gap={col.kind === 'gap'}
            class:shut={isShut}
            class:wstart={col.wstart}
            class:mstart={col.mstart}
          ></span>
        {/each}

        {#if !isShut}
          {#each group.lanes as lane (lane.key)}
            {@const tally = tallies.get(lane.key)}
            <!-- ══ the lane · frozen label + a cell per column ══════════ -->
            <span
              class="board__lab"
              class:board__lab--ghost={lane.kind === 'ghost'}
              class:board__lab--nocast={lane.kind === 'nocast'}
            >
              <span class="board__mark">
                {#if lane.accent}
                  <IdentityMark
                    mini
                    accent={lane.accent}
                    initials={lane.initials}
                    name={lane.name}
                  />
                {/if}
              </span>
              <span class="board__lab-body">
                <span class="board__name"
                  >{laneName(lane)}{#if lane.shared}<i class="board__badge">{sharedWord}</i
                    >{/if}</span
                >
                {#if tally}
                  <span
                    class="board__tally"
                    class:board__tally--q={tally.confirmed === 0 && tally.options === 0}
                    >{laneTallyText(tally)}</span
                  >
                {/if}
              </span>
            </span>
            {#each columns as col, colIdx (`${lane.key}:${col.from}`)}
              {@const placed = col.kind === 'day' ? placedAt(lane, col) : []}
              <span
                class="board__cell"
                class:gap={col.kind === 'gap'}
                class:today={col.today}
                class:wstart={col.wstart}
                class:mstart={col.mstart}
                data-lane={lane.key}
                data-day={col.from}
                data-weekend={col.weekend ? '' : undefined}
              >
                {#each placed as p (p.event.id)}
                  {@const m = marks.get(p.event.id)}
                  <!-- The slot is the slip's size container — the CELL
                       decides what a slip can afford (Slip's own ladder).
                       An INFERRED placement is a weaker CLAIM, not fainter
                       INK: dotted edge, italic name, never an opacity fade
                       — set from outside, Slip internals untouched. -->
                  <span class="board__slot" class:board__slot--inf={p.link === 'inferred'}>
                    <Slip
                      slip={p.event.slip}
                      {kindLabel}
                      {stateLabel}
                      stateUrgent={stateUrgent(p.event.slip)}
                      showCountry={true}
                      clash={m ? m.clash : 'none'}
                      clashPeople={m?.people ?? false}
                      onOpen={onDateOpen && p.event.kind !== 'perf'
                        ? () => onDateOpen(p.event.id)
                        : undefined}
                    />
                  </span>
                {/each}
                {#if placed.length === 0 && (col.kind === 'day' || col.span === 1)}
                  <!-- The empty cell IS the door: day and lane are already
                       known, so nothing is chosen twice. The person axis
                       passes no project — the dialog asks (ADR-094 §3b:
                       never the prototype's silent group default). -->
                  <button
                    type="button"
                    class="board__add"
                    aria-label={createLabel(col.from)}
                    onclick={() => onDayCreate(col.from, axis === 'scope' ? lane.id : null)}
                    >+</button
                  >
                {/if}
                {#if floors.get(lane.key)?.has(colIdx)}
                  <!-- The 15px floor: the ROW grows, not the marked cell —
                       a row is as tall as its tallest cell, and the band's
                       sentence must never land on a chip's name. -->
                  <span class="board__awsp" aria-hidden="true"></span>
                {/if}
              </span>
            {/each}
          {/each}
        {/if}
      {/each}

      <!-- ══ the absence bands · ONE drawn sentence per segment ═════════
           Absolutely positioned INTO their grid area (grid-row × the
           column span), so one band runs unbroken across day cells beneath
           its span. Static seam: `bottom` is CSS for now; the measured
           21px-above-floor drawer is the next step. -->
      {#each segs as s (`${s.laneKey}:${s.run.from}:${s.startCol}`)}
        {#if laneRow.has(s.laneKey)}
          <span
            class="board__aw"
            class:board__aw--tent={s.run.tentative}
            class:board__aw--cont={s.cont}
            class:board__aw--end={s.end}
            style="grid-row: {laneRow.get(s.laneKey)}; grid-column: {s.startCol + 2} / {s.endCol +
              3}"
          >
            <i class="board__aw-k">{awayWord}</i><b class="board__aw-n">{s.run.who}</b><em
              class="board__aw-u">{untilLabel(s.run.to)}</em
            ><i class="board__aw-r" aria-hidden="true"></i>
          </span>
        {/if}
      {/each}
    </div>
  </div>
{/if}

<style>
  @layer components {
    /* ── the scrollport · sideways inside, never the page ────────────── */
    .board__wrap {
      overflow-x: auto;
      overflow-y: clip;
      /* The scrollbar used to sit ON the last row. */
      padding-block-end: 9px;
      scrollbar-width: thin;
    }
    .board {
      display: grid;
      min-inline-size: max-content;
      border-block-start: 1px solid var(--border-color-light);
      position: relative;
    }

    /* ── Z-ORDER, LEGISLATED (law 19): axis 10/11 above group labels 8
       above lane names 6 above away bands 4. No edge gradients anywhere —
       a border is a border, the board cuts where the panel ends. ──────── */

    /* ── the date axis ───────────────────────────────────────────────── */
    .board__head,
    .board__corner {
      /* Inert belt-and-braces: the measured `--hdy` transform is what will
         pin (the wrap's overflow makes sticky a no-op here) — next step. */
      position: sticky;
      inset-block-start: 0;
      background: var(--bg);
      border-block-end: 1px solid var(--border-color-dark);
      padding: 9px 9px 8px;
    }
    .board__head {
      position: sticky;
      z-index: 10;
    }
    .board__corner {
      inset-inline-start: 0;
      z-index: 11;
      border-inline-end: 1px solid var(--border-color-light);
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-faint);
      display: flex;
      align-items: flex-end;
      padding: 9px 15px 8px;
    }
    .board__wd {
      display: block;
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-faint);
    }
    .board__num {
      display: block;
      font-size: 15px;
      font-weight: 500;
      color: var(--text-muted);
    }
    /* Today: ink in the number and the word — and NOTHING else. No fill,
       no width, never gray: the wash CSS simply is not written (ruling 3). */
    .board__head.today .board__num {
      color: var(--text-color);
    }
    .board__todayw {
      display: block;
      font-style: normal;
      font-family: var(--font-mono);
      font-size: 8px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .board__mo {
      display: block;
      font-family: var(--font-display);
      font-style: italic;
      font-size: 11.5px;
      color: var(--text-muted);
    }
    /* The red '!' rides the day NUMBER — red means conflict and only
       conflict (law 2). Dimmed on a fold's head: the fact survives the
       filter, quieter where its evidence is off the sheet. */
    .board__dmk {
      margin-inline-start: 3px;
      padding: 0;
      border: 0;
      background: none;
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--danger);
      vertical-align: super;
      line-height: 0;
      cursor: pointer;
    }
    .board__dmk--dim {
      color: color-mix(in oklch, var(--danger) 70%, transparent);
    }

    /* The day tick: a 7px × 1px MARK off the axis, not a line — suppressed
       on the first column and wherever a week/month rule already stands
       (one mark per pixel). */
    .board__head::before {
      content: '';
      position: absolute;
      inset-inline-start: 0;
      inset-block-end: 0;
      inline-size: 1px;
      block-size: 7px;
      background: color-mix(in oklch, var(--text-color) 30%, transparent);
    }
    .board__head:nth-child(2)::before,
    .board__head.wstart::before,
    .board__head.mstart::before {
      display: none;
    }

    /* The fold's head: the range word, small and faint, centered. */
    .board__head.gap {
      display: flex;
      align-items: flex-end;
      justify-content: center;
    }
    .board__gaplab {
      font-family: var(--font-mono);
      font-size: 8.5px;
      letter-spacing: 0.04em;
      color: var(--text-faint);
      white-space: nowrap;
    }
    /* A fold of ONE day is still that day: it compresses nothing, so its
       head keeps the weekend it has (law 16) — the one wash on the board. */
    .board__head.gap.we {
      background: color-mix(in oklch, var(--text-color) 3%, var(--bg));
    }
    /* The folded run's ruler: one 1px fillet per swallowed day at `--dw`,
       only while a day can still be a mark (the engine's foldTicks said
       so — below 6px no `--dw` is set and one tick per 58px remains). */
    .board__head.gap::after {
      content: '';
      position: absolute;
      inset-inline: 0;
      inset-block-end: 0;
      block-size: 3px;
      background: repeating-linear-gradient(
        90deg,
        color-mix(in oklch, var(--text-color) 20%, transparent) 0 1px,
        transparent 1px var(--dw, 58px)
      );
    }

    /* ── WEEK AND MONTH EDGES · full-height, drawn by EVERY row ───────
       (law 18 as amended: the boundaries ARE border-lefts, and because the
       head, the band's filler cells and the lane cells all draw them, the
       vertical never breaks). The 18px gutter stays countable: 9px flat,
       1px rule + 8px at a week, 3px double + 6px at a month. */
    .wstart {
      border-inline-start: 1px solid
        color-mix(in oklch, var(--text-color) 11%, var(--border-color-light));
      padding-inline-start: 8px;
    }
    .mstart {
      border-inline-start: 3px double
        color-mix(in oklch, var(--text-color) 24%, var(--border-color-light));
      padding-inline-start: 6px;
    }
    .gap.wstart,
    .gap.mstart,
    .board__grpc.wstart,
    .board__grpc.mstart {
      padding-inline-start: 0;
    }

    /* ── the group band · a lid over a row of real cells ─────────────── */
    .board__grpl {
      grid-column: 1;
      position: sticky;
      inset-inline-start: 0;
      z-index: 8;
      background: var(--bg);
      border: 0;
      border-inline-end: 1px solid var(--border-color-light);
      /* Open: air IS the group boundary — no second rule. */
      padding: 22px 15px 5px;
      text-align: start;
      cursor: pointer;
      font-family: inherit;
    }
    .board__grp-l {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 7px;
    }
    .board__grp-n {
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-faint);
    }
    .board__grp-x {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-faint);
    }
    /* Shut: a closed section is a row of a list — the rule comes back,
       drawn by the label AND every filler cell, and the lid still says
       what it holds (law 11). */
    .board__grpl.shut {
      padding: 11px 15px;
      border-block-end: 1px solid var(--border-color-light);
    }
    .board__grp-c {
      display: block;
      margin-block-start: 4px;
      font-family: var(--font-mono);
      font-size: 8.5px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--text-faint);
      line-height: 1.4;
    }
    /* Empty, but it STRETCHES to the band row and draws the verticals. */
    .board__grpc {
      padding: 0;
    }
    .board__grpc.shut {
      border-block-end: 1px solid var(--border-color-light);
    }

    /* ── the lane · frozen name + tally, then cells ───────────────────── */
    .board__lab {
      position: sticky;
      inset-inline-start: 0;
      z-index: 6;
      background: var(--bg);
      border-inline-end: 1px solid var(--border-color-light);
      border-block-end: 1px solid var(--border-color-light);
      min-block-size: 58px;
      padding: 14px 15px;
      display: flex;
      gap: 7px;
      min-inline-size: 0;
    }
    /* The 22px mark slot — the monogram's, kept even when empty so names
       align down the column whatever kind of lane they head. */
    .board__mark {
      inline-size: 22px;
      flex: none;
      display: inline-flex;
      padding-block-start: 2px;
    }
    .board__lab-body {
      min-inline-size: 0;
    }
    .board__name {
      display: block;
      font-family: var(--font-display);
      font-size: 15px;
      line-height: 1.2;
      color: var(--text-color);
      overflow-wrap: anywhere;
    }
    .board__lab--ghost .board__name,
    .board__lab--nocast .board__name {
      font-style: italic;
      color: var(--text-faint);
    }
    .board__tally {
      display: block;
      margin-block-start: 4px;
      font-family: var(--font-mono);
      font-size: 8.5px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--text-faint);
      line-height: 1.4;
    }
    .board__tally--q {
      opacity: 0.7;
    }
    .board__badge {
      font-style: normal;
      font-family: var(--font-mono);
      font-size: 8.5px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-faint);
      margin-inline-start: 6px;
    }

    /* ── the cells · NO CAGE: border-bottom only, never a right edge ──── */
    .board__cell {
      position: relative;
      display: flex;
      flex-direction: column;
      border-block-end: 1px solid var(--border-color-light);
      padding: 10px 9px;
      min-block-size: 0;
      min-inline-size: 0;
    }
    /* NO WEEKEND WASH ON BODY CELLS (Marco's ruling 3): the engine still
       stamps `data-weekend` on every cell unconditionally — the fact is
       kept (law 17), the paint simply is not written. */

    /* The slip's size container — its degradation ladder reads THIS width. */
    .board__slot {
      position: relative;
      display: block;
      container-type: inline-size;
    }
    .board__slot + .board__slot {
      margin-block-start: 4px;
    }
    /* Inferred: a weaker CLAIM is not fainter INK — dotted edge, italic
       name, explicitly NO opacity fade (the old .62 put the venue at
       2.0:1). Set from the slot so Slip's own grammar stays untouched. */
    .board__slot--inf :global(.slip) {
      border-style: dotted;
      border-color: color-mix(in oklch, var(--text-color) 20%, var(--border-color-light));
    }
    .board__slot--inf :global(.slip__n) {
      font-style: italic;
      color: var(--text-muted);
    }

    /* ── the empty cell's door ────────────────────────────────────────── */
    .board__add {
      flex: 1;
      min-block-size: 20px;
      opacity: 0;
      border: 0;
      border-block-start: 1px dashed color-mix(in oklch, var(--text-color) 18%, transparent);
      background: none;
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-muted);
      padding: 4px 0 0;
      cursor: pointer;
      transition: opacity 0.1s;
    }
    .board__cell:hover .board__add,
    .board__add:focus-visible {
      opacity: 1;
    }

    /* ── the absence band · one sentence over its exact days ─────────── */
    .board__aw {
      position: absolute;
      z-index: 4;
      inset-inline: 0;
      /* Static seam: the measured pass lays this 21px above the row floor. */
      inset-block-end: 4px;
      display: flex;
      align-items: center;
      gap: 8px;
      block-size: 12px;
      pointer-events: none;
      padding-inline-start: 9px;
    }
    .board__aw-k {
      font-style: normal;
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .board__aw-n {
      font-weight: 400;
      font-size: 11px;
      color: var(--text-color);
      white-space: nowrap;
    }
    .board__aw-u {
      font-style: normal;
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-faint);
      white-space: nowrap;
    }
    .board__aw-r {
      flex: 1;
      min-inline-size: 14px;
      block-size: 0;
      border-block-start: 1px solid color-mix(in oklch, var(--text-color) 45%, transparent);
      position: relative;
    }
    /* The arrowhead is the TERMINUS: only the final segment draws it. */
    .board__aw--end .board__aw-r::after {
      content: '';
      position: absolute;
      inline-size: 5px;
      block-size: 5px;
      border-block-start: 1px solid color-mix(in oklch, var(--text-color) 58%, transparent);
      border-inline-end: 1px solid color-mix(in oklch, var(--text-color) 58%, transparent);
      transform: rotate(45deg);
      inset-inline-end: -1px;
      inset-block-start: -3.5px;
    }
    /* A RESUMED segment ('away Mia ⟶' after a cut) opens with a left arrow. */
    .board__aw--cont::before {
      content: '';
      position: absolute;
      inset-inline-start: 3px;
      inset-block-start: 3.5px;
      inline-size: 5px;
      block-size: 5px;
      border-block-start: 1px solid color-mix(in oklch, var(--text-color) 30%, transparent);
      border-inline-start: 1px solid color-mix(in oklch, var(--text-color) 30%, transparent);
      transform: rotate(-45deg);
    }
    /* Tentative: the doubt is the register — quieter text, dotted rule. */
    .board__aw--tent .board__aw-k,
    .board__aw--tent .board__aw-n {
      color: var(--text-faint);
    }
    .board__aw--tent .board__aw-r {
      border-block-start-style: dotted;
      border-block-start-color: color-mix(in oklch, var(--text-color) 20%, transparent);
    }
    .board__aw--tent.board__aw--end .board__aw-r::after {
      border-color: color-mix(in oklch, var(--text-color) 24%, transparent);
    }
    /* The floor the row reserves under a band's touched week. */
    .board__awsp {
      block-size: 15px;
      margin-block-start: auto;
      flex: none;
    }

    .board__empty {
      padding-block: var(--space-l);
      font-size: var(--text-s);
      color: var(--text-faint);
      font-style: italic;
    }
  }
</style>
