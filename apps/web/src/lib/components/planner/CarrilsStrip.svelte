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
   * THE MEASURED PASSES live at the foot of this script — the pinned axis
   * (`--hdy`) with its travelling group labels (`--gy`), the now line
   * measured against today's own column, and the horizon that grows when
   * the scroll reaches for it. Their clamps are pure functions in
   * $lib/board-lanes (fake-rect tested); this component only feeds rects.
   *
   * STILL STATIC, on purpose (seams honest):
   * - the away band sits at a CSS `bottom` inside its grid area instead of
   *   the measured 21px-above-floor drawer;
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
    groupLabelY,
    groupTally,
    laneTally,
    nowLineX,
    pinHeadY,
    type AwayRun,
    type BoardClash,
    type BoardColumn,
    type BoardGroup,
    type BoardLaneRef,
    type LaneTally,
    type PlacedEvent,
  } from '$lib/board-lanes';
  import { spaceName } from '$lib/utils/identity';
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
    /* THE GROUP HAS NO MARK. A space is an address, not a subject — its
       name runs down the rail, and identity belongs to the projects in the
       rows (see IdentityMark's «one mark, two levels»). The `groupMark`
       prop died with the band it decorated. */
    /** Minutes since midnight, viewer clock — null when today is off the
        sheet. The page owns the tick; this component only measures. */
    nowMinutes?: number | null;
    /** The horizon grows when the scroll reaches for it (no arrows on the
        board's own edge): fired once per columns-length near the right rim. */
    onReachEnd?: () => void;
    /** Fold state, owned by the PAGE so the meta's lane count and these
        rows can never disagree (one writer). Still furniture: session
        state, never the URL (ADR-094 §4). */
    shut: SvelteSet<string>;
    /** The book feeds are in flight — an empty board must not say «quiet». */
    loading?: boolean;
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
    nowMinutes = null,
    onReachEnd,
    shut,
    loading = false,
  }: Props = $props();

  /** 168px frozen labels + 118px per day / 58px per fold — the proto's
      measured widths, TODAY INCLUDED: equal width, its marks are ink (the
      number, the word, and — next step — the hour line), never extra room. */
  let gridTemplate = $derived(
    `26px 168px ${columns.map((c) => (c.kind === 'gap' ? '58px' : '118px')).join(' ')}`,
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
  /* EVERY CHILD STATES ITS ROW AND ITS COLUMN, and that is not tidiness —
     it is the fix for two measured defects. The away bands are grid items with an explicit
     `grid-row`, and an explicitly placed item is laid down BEFORE the
     auto-placed ones: the cursor then skips its cells and pushes whole
     rows along, so a band drawn for the first lane surfaced under the
     second (measured 2026-08-09: Mia's absence, cast in Duo Cendra, drew
     in Fira Nova's row). And a band that SPANS columns occupies those
     cells, so with auto-placed columns it shoved a lane's own slips one
     column right (Mia's gigs landed on the 18th and the 30th instead of
     the 11th and the 18th). Explicit everywhere: grid items may then
     overlap — which is exactly what a band over its days is — and nothing
     pushes anything. */
  let rows = $derived.by(() => {
    const lane = new Map<string, number>();
    const group = new Map<string, number>();
    /** An OPEN group has no row of its own — its name runs down the rail
        beside its lanes — so it records the span the rail must cover. */
    const rail = new Map<string, { from: number; to: number }>();
    let r = 1;
    for (const g of groups) {
      // A SPACE runs down the rail; a PROJECT keeps its band, because a
      // project is a subject and a space is an address. Shut, everything
      // lies flat — there is no height left to run along.
      const railed = g.kind === 'workspace' && !shut.has(g.key);
      if (!railed) {
        r++;
        group.set(g.key, r);
      }
      if (shut.has(g.key)) continue;
      const from = r + 1;
      for (const l of g.lanes) {
        r++;
        lane.set(l.key, r);
      }
      // EVERY open group gets the rail span, not only a railed one: the
      // vertical is what says «these rows hang from that heading», and a
      // project needs it as much as a space. It just goes down bare.
      rail.set(g.key, { from, to: r + 1 });
    }
    return { lane, group, rail };
  });
  let laneRow = $derived(rows.lane);

  function placedAt(lane: BoardLaneRef, col: BoardColumn): readonly PlacedEvent[] {
    return cells.get(lane.key)?.get(col.from) ?? [];
  }
  /** A multi-day fold can hold a marked day whose events are off the sheet —
      the '!' never asked the filter, so the fold's head still carries it. */
  function gapClash(col: BoardColumn): { people: boolean } | null {
    let hit: { people: boolean } | null = null;
    for (const [d, m] of clashDays) {
      if (d < col.from || d > col.to) continue;
      hit = { people: (hit !== null && hit.people) || m.people };
    }
    return hit;
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

  /* ══ THE MEASURED PASSES ═══════════════════════════════════════════════
     jsdom cannot see pixels, so every clamp below lives as a pure function
     in $lib/board-lanes (pinHeadY, groupLabelY, nowLineX) with fake-rect
     tests; this component only feeds real rects and writes CSS variables. */
  let wrapEl = $state<HTMLDivElement>();
  let boardEl = $state<HTMLDivElement>();

  /** «7h24» — hours unpadded, minutes two digits, the register the day's
      own now-mark uses. One cell per character so a changed digit rises
      alone (keyed each below). */
  let nowChars = $derived.by(() => {
    if (nowMinutes === null) return [];
    const h = Math.floor(nowMinutes / 60) % 24;
    const m = Math.round(nowMinutes % 60);
    return `${h}h${String(m).padStart(2, '0')}`.split('');
  });

  /* THE NOW LINE IS MEASURED AGAINST TODAY'S OWN COLUMN — folds shift
     everything left of it, so only the DOM knows where today landed. Ink
     at 40%, never blue (Marco's ruling 1): now is an hour, a fact. */
  $effect(() => {
    void columns;
    void groups;
    const board = boardEl;
    if (!board) return;
    const today = board.querySelector<HTMLElement>('.board__head:not(.gap).today');
    if (!today || nowMinutes === null) {
      board.style.removeProperty('--nowx');
      return;
    }
    const apply = () => {
      const b = board.getBoundingClientRect();
      const t = today.getBoundingClientRect();
      const { x, labelLeftMax } = nowLineX({
        todayLeft: t.left - b.left,
        todayWidth: t.width,
        minutes: nowMinutes,
      });
      board.style.setProperty('--nowx', `${x}px`);
      board.style.setProperty('--nowtop', `${Math.round(t.bottom - b.top)}px`);
      // The caption never leaves today's column: pulled left at the rim
      // (the engine's clamp; what cedes is the foot, never the mark).
      const cap = board.querySelector<HTMLElement>('.board__now b');
      if (cap) {
        board.style.setProperty(
          '--nowlx',
          `${Math.min(6, labelLeftMax(cap.offsetWidth) - x)}px`,
        );
      }
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(board);
    return () => ro.disconnect();
  });

  /* THE AXIS PINS BY MEASURE — the wrap's overflow-x makes vertical sticky
     a no-op, so the page's scroll drives a translateY through the engine's
     clamps: the head never leaves the board, and each group label travels
     inside its own group under it. */
  $effect(() => {
    void columns;
    void groups;
    void shut.size; // a fold reshapes the rows — the pin must re-measure
    const board = boardEl;
    if (!board) return;
    let raf = 0;
    const apply = () => {
      raf = 0;
      const b = board.getBoundingClientRect();
      const corner = board.querySelector<HTMLElement>('.board__corner');
      if (!corner) return;
      const chrome =
        document.querySelector('.cal__toolbar')?.getBoundingClientRect().bottom ?? 0;
      const hh = corner.offsetHeight;
      // The chrome folds into boardTop: pinHeadY's travel is «how far the
      // top has scrolled past the reading edge», and the reading edge is
      // the stuck toolbar's underside, not the viewport's zero.
      const y = pinHeadY({
        boardTop: b.top - chrome,
        boardHeight: b.height,
        headOffsetTop: 0,
        headHeight: hh,
      });
      board.style.setProperty('--hdy', `${y}px`);
      const all = [...board.querySelectorAll<HTMLElement>('.board__grpl')];
      all.forEach((g, i) => {
        const gr = g.getBoundingClientRect();
        const groupTop =
          gr.top - b.top - Number.parseFloat(g.style.getPropertyValue('--gy') || '0');
        // the group's floor: the next band's top, or the board's end
        let end = b.height;
        if (i + 1 < all.length) {
          const nr = all[i + 1].getBoundingClientRect();
          end =
            nr.top - b.top - Number.parseFloat(all[i + 1].style.getPropertyValue('--gy') || '0');
        }
        const gy = groupLabelY({
          pinY: y + hh,
          groupTop,
          groupEnd: end,
          labelHeight: g.offsetHeight,
        });
        g.style.setProperty('--gy', `${gy}px`);
      });
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    apply();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  });

  /* THE HORIZON GROWS WHEN THE SCROLL REACHES FOR IT — append-only, so the
     left content never shifts and no correction is owed. One firing per
     columns-length: the latch re-arms when the sheet actually grew. */
  $effect(() => {
    const wrap = wrapEl;
    const len = columns.length;
    if (!wrap || !onReachEnd) return;
    let fired = false;
    const onScroll = () => {
      if (fired) return;
      if (wrap.scrollLeft + wrap.clientWidth > wrap.scrollWidth - 240) {
        fired = true;
        onReachEnd();
      }
    };
    void len;
    wrap.addEventListener('scroll', onScroll, { passive: true });
    // A board that does not overflow never scrolls — ask once on arrival;
    // the probes' honest end bounds the march.
    onScroll();
    return () => wrap.removeEventListener('scroll', onScroll);
  });

  /* First paint lands on today — 40% in, like the old ribbon's centring. */
  let centred = false;
  $effect(() => {
    void columns;
    const wrap = wrapEl;
    const board = boardEl;
    if (centred || !wrap || !board) return;
    const today = board.querySelector<HTMLElement>('.board__head:not(.gap).today');
    if (!today) return;
    centred = true;
    // Property assignment, not scrollTo(): same instant scroll, and jsdom
    // (which has no scroll methods) stays silent in the component tests.
    wrap.scrollLeft = Math.max(0, today.offsetLeft - wrap.clientWidth * 0.4);
  });
</script>

{#if groups.length === 0}
  {#if !loading}<p class="board__empty">{emptyLabel}</p>{/if}
{:else}
  <!-- The strip scrolls sideways INSIDE itself; the page never does. -->
  <div class="board__wrap" bind:this={wrapEl}>
    <div class="board" bind:this={boardEl} style="grid-template-columns: {gridTemplate}">
      <!-- ══ ROW 1 · the date axis ══════════════════════════════════════
           Mono weekday over serif number. TODAY is the word and full ink —
           EQUAL width, NO fill (Marco's ruling 2): its three marks are ink,
           never room. Week and month boundaries are border-lefts drawn by
           every row's cells, so the vertical never blinks. -->
      <span class="board__corner" style="grid-row: 1; grid-column: 1 / 3">{axisWord}</span>
      {#each columns as col, colIdx (col.from)}
        <span
          class="board__head"
          style:grid-row="1"
          style:grid-column={colIdx + 3}
          class:gap={col.kind === 'gap'}
          class:today={col.today}
          class:wstart={col.wstart}
          class:mstart={col.mstart}
          style={col.kind === 'gap' && foldStep(col) !== null ? `--dw: ${foldStep(col)}px` : undefined}
        >
          {#if col.monthStartName}<i class="board__mo">{monthWord(col.from)}</i>{/if}
          {#if col.kind === 'gap'}
            {@const gc = gapClash(col)}
            <span class="board__gaplab"
              >{col.gapLabel}{#if gc}<button
                  type="button"
                  class="board__dmk board__dmk--dim"
                  class:board__dmk--people={gc.people}
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
                  class:board__dmk--people={clashDays.get(col.from)?.people}
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
        <!-- ══ the group band · a LID ═══════════════════════════════════
             The sticky label is a button; folded, it still says what it
             holds (law 11) — the tally prints INSIDE the label, because a
             sibling outside it clipped when the label pins (next step). -->
        <!-- ══ THE SPACE IS A RAIL, NOT A ROW (Marco, 2026-08-09) ═══════
             There is no space MARK in this app: a space is the address a
             project lives at, not a subject. So the workspace runs DOWN THE
             SIDE of its lanes in furniture voice — set low, small, along a
             hairline — and the identity in the rows belongs to the projects.
             Folded there is no height to run along, so the same button lays
             its words flat and says what it keeps: a lid that goes quiet
             about its shape, never about its contents. -->
        {#if group.kind !== 'workspace' || isShut}
          <!-- THE BAND · a project is a SUBJECT: its monogram, its own case,
               its tint. Only a space gives up all three for the rail. -->
          <button
            type="button"
            class="board__grpl"
            class:shut={isShut}
            style:grid-row={rows.group.get(group.key)}
            style:grid-column="1 / 3"
            aria-expanded={!isShut}
            onclick={() => toggle(group.key)}
          >
            <span class="board__grp-l">
              {#if group.kind === 'project' && group.accent}
                <IdentityMark
                  mini
                  accent={group.accent}
                  initials={group.initials}
                  name={group.name}
                />
              {/if}
              <span
                class="board__grp-n"
                class:board__grp-n--proj={group.kind === 'project'}
                >{group.kind === 'workspace' ? spaceName(group.name) : group.name}</span
              >
              <span class="board__grp-x" aria-hidden="true">{isShut ? '+' : '–'}</span>
            </span>
            {#if isShut}
              <span class="board__grp-c">{groupTallyText(groupTally(group, tallies))}</span>
            {/if}
          </button>
          <!-- ONE empty cell per column — never a `1 / -1` spanner (the
               phantom-row law), so the week and month rules cross unbroken. -->
          {#each columns as col, colIdx (`${group.key}:${col.from}`)}
            <span
              class="board__grpc"
              style:grid-row={rows.group.get(group.key)}
              style:grid-column={colIdx + 3}
              class:gap={col.kind === 'gap'}
              class:shut={isShut}
              class:wstart={col.wstart}
              class:mstart={col.mstart}
            ></span>
          {/each}
        {/if}
        {#if !isShut}
          {@const span = rows.rail.get(group.key)}
          {#if span}
            <!-- THE VERTICAL SAYS WHOSE THE ROWS ARE. A space fills it with
                 its own name, set low, and it is the fold's handle; a
                 project already said its name in the band, so its strip
                 goes down bare — the rule alone, hanging from the heading. -->
            <button
              type="button"
              class="board__rail"
              class:board__rail--bare={group.kind !== 'workspace'}
              style:grid-row="{span.from} / {span.to}"
              style:grid-column="1"
              aria-expanded="true"
              aria-label={group.name}
              onclick={() => toggle(group.key)}
            >
              {#if group.kind === 'workspace'}
                <span class="board__rail-n">{spaceName(group.name)}</span>
              {/if}
            </button>
          {/if}
        {/if}

        {#if !isShut}
          {#each group.lanes as lane (lane.key)}
            {@const tally = tallies.get(lane.key)}
            <!-- ══ the lane · frozen label + a cell per column ══════════ -->
            <span
              class="board__lab"
              style:grid-row={rows.lane.get(lane.key)}
              style:grid-column="2"
              class:board__lab--ghost={lane.kind === 'ghost'}
              class:board__lab--nocast={lane.kind === 'nocast'}
            >
              <span class="board__mark">
                {#if lane.accent}
                  <!-- ONE MARK, TWO LEVELS. On the scope axis the rail already
                       says the space beside these rows, so the mark stays a
                       monogram; anywhere the address must travel alone the
                       page hands `space` down and it grows its left cell. -->
                  <IdentityMark
                    mini
                    accent={lane.accent}
                    initials={lane.initials}
                    name={lane.name}
                    space={lane.space ?? null}
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
                style:grid-row={rows.lane.get(lane.key)}
                style:grid-column={colIdx + 3}
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
                    aria-label={`${createLabel(col.from)} · ${laneName(lane)}`}
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
            style="grid-row: {laneRow.get(s.laneKey)}; grid-column: {s.startCol + 3} / {s.endCol +
              4}"
          >
            <i class="board__aw-k">{awayWord}</i><b class="board__aw-n">{s.run.who}</b><em
              class="board__aw-u">{untilLabel(s.run.to)}</em
            ><i class="board__aw-r" aria-hidden="true"></i>
          </span>
        {/if}
      {/each}

      <!-- ══ now · ink at 40%, never blue (ruling 1) ════════════════════
           One measured line from the axis's foot to the board's — a fact
           crossing the whole drawing. The minute label rolls one digit at
           a time (keyed cells, tabular cifras). -->
      {#if nowMinutes !== null && nowChars.length > 0}
        <span class="board__now" aria-hidden="true">
          <b>{#each nowChars as c, i (`${i}:${c}`)}<i class="board__nowd">{c}</i>{/each}</b>
        </span>
      {/if}
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
      /* The measured `--hdy` transform pins (the wrap's overflow makes
         vertical sticky a no-op); sticky stays as inert belt-and-braces. */
      transform: translateY(var(--hdy, 0px));
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
    /* The mark says THAT there is a call to make — the Slip's own ink law
       (--clash-ink): a call is blue, and red is spent on PEOPLE only. The
       board said red for everything while every other drawing said blue;
       Marco caught the drift across two screenshots. */
    .board__dmk {
      --dmk-ink: var(--info);
      margin-inline-start: 3px;
      padding: 0;
      border: 0;
      background: none;
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--dmk-ink);
      vertical-align: super;
      line-height: 0;
      cursor: pointer;
    }
    .board__dmk--people {
      --dmk-ink: var(--danger);
    }
    .board__dmk--dim {
      color: color-mix(in oklch, var(--dmk-ink) 70%, transparent);
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
    /* …EXCEPT ACROSS A HEADING (Marco, 2026-08-09). The band is not part of
       the timeline — it is the sentence that names the rows under it — so
       the calendar's own edges pause there and it reads as ONE merged row,
       with no column seams inside it. The law that says «every row draws a
       fact that crosses the drawing» is about ROWS OF DAYS; a heading has
       no days. The cells stay (that is structure: one per column, so
       nothing shifts) — only their ink goes. */
    .board__grpc.wstart,
    .board__grpc.mstart {
      border-inline-start: 0;
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
      /* OPEN, THE BAND IS A LINE — it names the lanes and gets out of the
         way. It used to keep a lane's worth of padding, so every group cost
         a band of empty sheet nobody asked for; the air above it is the
         group boundary, and that is all it needs. */
      padding: 13px 15px 4px;
      align-self: end;
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
    /* Mono and spaced, but NOT uppercased: this lid is a space on the scope
       axis, and the space is written lowercase by `spaceName` — a stylesheet
       must not fight the norm. */
    .board__grp-n {
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.1em;
      color: var(--text-faint);
    }
    /* A project group is a SUBJECT: its own case, its serif, its monogram
       beside it — the mono-caps register belongs to the space's rail. */
    .board__grp-n--proj {
      font-family: var(--font-display);
      font-size: 14px;
      letter-spacing: 0;
      text-transform: none;
      color: var(--text-color);
    }
    .board__grp-x {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-faint);
    }
    /* THE HEADING'S RULE IS THE ROW'S, AND IT CROSSES EVERYTHING (Marco,
       2026-08-09). With the column seams gone the band needed the other
       axis or it floated: the horizontal is what makes it read as ONE
       merged row instead of a label with a gap after it. Drawn by the
       label AND every filler cell, so it runs the full width of the sheet.
       Shut it also takes its own air, because a closed section is a row of
       a list and still says what it holds (law 11). */
    .board__grpl.shut {
      padding: 11px 15px;
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
    /* Empty and weightless — the heading's height is its WORDS, never a
       cell's padding — but NOT zero-height: a collapsed cell draws its
       bottom rule at the top of the row, which is why the heading's line
       stopped dead at the label column. It stretches to whatever the label
       sets and adds nothing of its own. */
    .board__grpc {
      padding: 0;
      min-block-size: 0;
    }
    .board__grpl,
    .board__grpc {
      border-block-end: 1px solid var(--border-color-light);
    }

    /* ── the lane · frozen name + tally, then cells ───────────────────── */
    /* ── THE RAIL · the space, in furniture voice ─────────────────────
       Set low and small, running up the side of the lanes it addresses,
       along a hairline. It is the fold's handle too: the whole strip is the
       button, so the gesture is where the name is. */
    .board__rail {
      position: sticky;
      inset-inline-start: 0;
      z-index: 7;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding: 14px 0 14px 4px;
      border: 0;
      border-inline-end: 1px solid var(--border-color-light);
      border-block-end: 1px solid var(--border-color-light);
      background: var(--bg);
      cursor: pointer;
    }
    /* Bare: no name, no ground of its own — only the vertical, so it reads
       as a bracket and never as a second column of furniture. */
    .board__rail--bare {
      background: none;
      border-block-end: 0;
    }
    .board__rail-n {
      writing-mode: vertical-rl;
      /* Bottom-up: the reading a spine takes, and the one that puts the
         first letter next to the first lane. */
      transform: rotate(180deg);
      font-family: var(--font-mono);
      font-size: 8.5px;
      letter-spacing: 0.14em;
      color: var(--text-faint);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-block-size: 100%;
    }
    .board__rail:hover .board__rail-n {
      color: var(--text-muted);
    }

    .board__lab {
      position: sticky;
      inset-inline-start: 26px;
      z-index: 6;
      background: var(--bg);
      border-inline-end: 1px solid var(--border-color-light);
      border-block-end: 1px solid var(--border-color-light);
      min-block-size: 58px;
      padding: 14px 15px;
      display: flex;
      /* THE TAG HANGS FROM THE NAME, and only an explicit alignment keeps
         it there. Stretch is the default, and it cascades: the mark column
         grows to the row's height, IdentityMark (inline-flex, no height of
         its own, align-items:center) grows with it and CENTRES the badge —
         so on a row as tall as a slip the monogram floated 35px below its
         name, onto the tally's line. Measured 2026-08-09. */
      align-items: flex-start;
      gap: 7px;
      min-inline-size: 0;
    }
    /* The 22px mark slot — the monogram's, kept even when empty so names
       align down the column whatever kind of lane they head. */
    /* Cap height, not the box's top edge: a 14px chip against a 15px serif
       needs three pixels to sit on the line the eye reads the word from. */
    .board__mark {
      inline-size: 22px;
      flex: none;
      display: inline-flex;
      align-items: flex-start;
      padding-block-start: 3px;
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
    /* INFERRED is a weaker CLAIM, and the claim channel must not borrow
       the certainty stroke: dotted already means RELEASED on a slip. The
       inference speaks OUTSIDE the box — a dotted outline offset off the
       edge — plus the italic name the slot already sets. */
    .board__slot--inf :global(.slip) {
      outline: 1px dotted color-mix(in oklch, var(--text-color) 22%, transparent);
      outline-offset: 2px;
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
    /* THE BAND IS A GRID ITEM, NOT AN ABSOLUTE ONE — measured 2026-08-09:
       `position:absolute` made its containing block the BOARD (the nearest
       positioned ancestor), so `inset-block-end: 4px` pinned it to the foot
       of the whole drawing: an absence drawn for the first lane surfaced
       at the bottom of the last one, 130px from the row it is about. Placed
       by the grid instead — its row, its column span, sitting on its own
       row's floor — the geometry cannot lie, and the 15px `.board__awsp`
       floor is what keeps it off the chips' names. */
    .board__aw {
      z-index: 4;
      align-self: end;
      margin-block-end: 4px;
      display: flex;
      align-items: center;
      gap: 8px;
      block-size: 12px;
      pointer-events: none;
      padding-inline-start: 9px;
      min-inline-size: 0;
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

    /* ── now · ink at 40%, never blue (Marco's ruling 1) ──────────────
       One line from the axis's foot to the board's, at a measured x inside
       today's own column. z 9: under the pinned axis (10), over the group
       labels — the line must never print on the date it names. */
    .board__now {
      position: absolute;
      inset-block-start: var(--nowtop, 0px);
      inset-block-end: 0;
      inset-inline-start: var(--nowx, -9999px);
      inline-size: 1px;
      background: color-mix(in oklch, var(--text-color) 40%, transparent);
      z-index: 9;
      pointer-events: none;
    }
    .board__now::before {
      content: '';
      position: absolute;
      inset-block-start: -2px;
      inset-inline-start: -2px;
      inline-size: 5px;
      block-size: 5px;
      border-radius: 50%;
      background: var(--text-muted);
    }
    .board__now b {
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
    /* One movement per minute: a changed digit is a NEW cell and rises. */
    .board__nowd {
      font-style: normal;
      animation: board-minute 130ms ease-out;
    }
    @keyframes board-minute {
      from {
        transform: translateY(0.9em);
      }
      to {
        transform: none;
      }
    }
    /* The travelling group label — pinned inside its own group's span. */
    .board__grpl {
      transform: translateY(var(--gy, 0px));
    }
  }
</style>
