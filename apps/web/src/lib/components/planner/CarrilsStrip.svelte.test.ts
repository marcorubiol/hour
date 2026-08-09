/**
 * The Board's DOM grammar (Planner v3). The ENGINE's laws live in
 * board-lanes.test.ts; here the fixtures go through the engine itself
 * (scopeGroups/personGroups → laneEvents → buildColumns) so the component
 * is tested against the only shapes it will ever be handed — and the
 * assertions are the drawing's own laws: the band is a row of real cells
 * (never a spanner), the three silences are three different words, the
 * slip in the cell is THE Slip, the '!' and the '+' report through their
 * contracts, and the weekend is an attribute with no wash.
 */
import { SvelteSet } from 'svelte/reactivity';
import { render, fireEvent } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import CarrilsStrip from './CarrilsStrip.svelte';
import {
  buildColumns,
  laneEvents,
  normalizeAway,
  personGroups,
  scopeGroups,
  type BoardClash,
  type BoardEventIn,
  type LaneTally,
} from '$lib/board-lanes';
import type { Slip } from '$lib/month-events';

const TODAY = '2026-07-18';

const workspaces = [{ id: 'w1', name: 'MüK Cia' }];
const projects = [
  { id: 'p1', workspace_id: 'w1', name: 'MaMeMi', accent: 'var(--accent-3)', initials: 'MM' },
  { id: 'p2', workspace_id: 'w1', name: 'Última', accent: 'var(--accent-5)', initials: 'ÚL' },
  { id: 'p3', workspace_id: 'w1', name: 'Tres Veus', accent: 'var(--accent-7)', initials: 'TV' },
];

function slipOf(id: string, cert: Slip['cert'], name: string, projectId = 'p1'): Slip {
  const p = projects.find((x) => x.id === projectId)!;
  return {
    id,
    kind: 'show',
    cert,
    name,
    lead: null,
    origin: null,
    city: 'Igualada',
    country: 'ES',
    time: { primary: '20h', end: null, secondary: null },
    project: { id: p.id, slug: p.name.toLowerCase(), name: p.name, workspace_id: 'w1' },
    hold: cert === 'hold' ? { rank: 1, expires: '2026-07-20' } : null,
    href: null,
    title: `${p.name} · ${name}`,
  };
}

/* Two gigs stacked on one day (the clash pair), an absence on Última, and
   Tres Veus left empty — the '—' lane. */
const events: BoardEventIn[] = [
  {
    id: 'e1',
    day: '2026-07-11',
    project_id: 'p1',
    kind: 'perf',
    cert: 'confirmed',
    roster: null,
    venue_id: 'v-aurora',
    slip: slipOf('e1', 'confirmed', "Teatre de l'Aurora"),
  },
  {
    id: 'e2',
    day: '2026-07-11',
    project_id: 'p1',
    kind: 'perf',
    cert: 'hold',
    roster: null,
    venue_id: 'v-tarrega',
    slip: slipOf('e2', 'hold', 'Fira Tàrrega'),
  },
];

const scopeBase = laneEvents({
  axis: 'scope',
  groups: scopeGroups({ scopeProjectIds: null, workspaces, projects }),
  events,
  castByProject: new Map(),
  awayByDay: new Map(),
});
const p2Key = scopeBase.groups[0].lanes.find((l) => l.id === 'p2')!.key;
const awayRuns = [
  normalizeAway({ f: '2026-07-14', t: '2026-07-15', tent: false, who: 'Mia' }, p2Key),
];
const active = new Set(['2026-07-11', '2026-07-14', TODAY]);
const columns = buildColumns({
  baseIso: '2026-07-01',
  endIso: '2026-07-31',
  active,
  todayIso: TODAY,
});
const clashes: BoardClash[] = [
  {
    severity: 'people',
    title: 'Same person, two bookings',
    body: 'Mia is on both',
    rows: [],
    event_ids: ['e1', 'e2'],
    day: '2026-07-11',
  },
];

function laneTallyText(ta: LaneTally): string {
  if (ta.silence === 'dash') return '—';
  if (ta.silence === 'no_dates') return 'no dates';
  if (ta.silence === 'no_data_yet') return 'no data yet';
  return `${ta.confirmed} confirmed · ${ta.options} options · ${ta.notCast} not cast`;
}

function props(over: Record<string, unknown> = {}) {
  return {
    axis: 'scope' as const,
    // The fold set is the PAGE's (one writer with the meta); tests own one.
    shut: new SvelteSet<string>(),
    columns,
    groups: scopeBase.groups,
    cells: scopeBase.cells,
    awayRuns,
    clashes,
    axisWord: 'Scope',
    todayWord: 'today',
    weekdayWord: (iso: string) => `wd${iso.slice(8)}`,
    monthWord: () => 'jul',
    laneTallyText,
    groupTallyText: (g: { units: number; confirmed: number }) =>
      `${g.units} projects · ${g.confirmed} confirmed`,
    sharedWord: 'shared',
    teamWord: 'team',
    noCastWord: 'no cast',
    awayWord: 'away',
    untilLabel: (iso: string) => `until ${iso.slice(8)}`,
    emptyLabel: 'Nothing this month.',
    createLabel: (iso: string) => `Add on ${iso}`,
    clashDayLabel: (iso: string) => `Conflict on ${iso}`,
    kindLabel: (k: string) => k,
    stateLabel: () => null,
    onDayCreate: vi.fn(),
    onClashDay: vi.fn(),
    ...over,
  };
}

describe('CarrilsStrip — the board grid', () => {
  it('is ONE grid: frozen corner with the axis word, a head per column, 118/58 tracks', () => {
    const { container } = render(CarrilsStrip, props());
    expect(container.querySelector('.board__corner')!.textContent).toBe('Scope');
    expect(container.querySelectorAll('.board__head')).toHaveLength(columns.length);
    const tpl = (container.querySelector('.board') as HTMLElement).style.gridTemplateColumns;
    expect(tpl.startsWith('168px')).toBe(true);
    expect(tpl).toContain('118px');
    expect(tpl).toContain('58px');
  });

  it('today is the word and the ink — never a fill class', () => {
    const { container } = render(CarrilsStrip, props());
    const today = container.querySelector('.board__head.today')!;
    expect(today.textContent).toContain('today');
    // Equal width (no wider track) and no wash: the class list carries no
    // fill of any kind on a today DAY column.
    expect(today.classList.contains('we')).toBe(false);
  });

  it("the group band is a row of real cells — one per column, never a '1 / -1' spanner", () => {
    const { container } = render(CarrilsStrip, props());
    expect(container.querySelectorAll('.board__grpc')).toHaveLength(columns.length);
    for (const el of container.querySelectorAll<HTMLElement>('.board *')) {
      expect(el.style.gridColumn).not.toBe('1 / -1');
    }
  });

  it('the three silences are three different words, each said by its own lane', () => {
    const { container } = render(CarrilsStrip, props());
    const tallies = [...container.querySelectorAll('.board__tally')].map((n) =>
      n.textContent?.trim(),
    );
    // p1 played (two gig units: one confirmed, one option), p2 was touched
    // by an absence but played nowhere, p3 has nothing at all.
    expect(tallies).toContain('1 confirmed · 1 options · 0 not cast');
    expect(tallies).toContain('no dates');
    expect(tallies).toContain('—');
  });

  it('the cell renders THE Slip — data-family certainty, the grain on the held one', () => {
    const { container } = render(CarrilsStrip, props());
    expect(container.querySelector('.board__cell .slip[data-family="confirmed"]')).not.toBeNull();
    const held = container.querySelector('.board__cell .slip[data-family="hold"]')!;
    expect(held.classList.contains('grain')).toBe(true);
    // Both halves of the clash are on the sheet → both slips carry the rule.
    expect(container.querySelectorAll('.slip[data-clash]')).toHaveLength(2);
    expect(container.querySelectorAll('.slip[data-clash-people]')).toHaveLength(2);
  });

  it("the head's red '!' reports its day through the contract", async () => {
    const p = props();
    const { container } = render(CarrilsStrip, p);
    const mark = container.querySelector('.board__dmk') as HTMLButtonElement;
    expect(mark).not.toBeNull();
    await fireEvent.click(mark);
    expect(p.onClashDay).toHaveBeenCalledWith('2026-07-11');
  });

  it('the empty cell is the door: day + the lane\'s project, nothing chosen twice', async () => {
    const p = props();
    const { container } = render(CarrilsStrip, p);
    const door = container.querySelector(
      `.board__cell[data-lane="${p2Key}"][data-day="${TODAY}"] .board__add`,
    ) as HTMLButtonElement;
    expect(door).not.toBeNull();
    await fireEvent.click(door);
    expect(p.onDayCreate).toHaveBeenCalledWith(TODAY, 'p2');
  });

  it('the weekend is an attribute on every cell — and no wash class exists to read it', () => {
    const { container } = render(CarrilsStrip, props());
    // 11 and 18 July 2026 are Saturdays; the fact is stamped even on cells
    // that hold slips or absences (law 17), and no body cell carries a
    // weekend class — the wash CSS simply is not written (ruling 3).
    const we = container.querySelectorAll('.board__cell[data-weekend]');
    expect(we.length).toBeGreaterThan(0);
    for (const el of container.querySelectorAll('.board__cell')) {
      expect(el.className).not.toMatch(/\bwe\b/);
    }
  });

  it('a shut group keeps its filler cells and still says what it holds', async () => {
    const { container } = render(CarrilsStrip, props());
    const lid = container.querySelector('.board__grpl') as HTMLButtonElement;
    await fireEvent.click(lid);
    // The lanes are gone, the vertical row of cells is not, and the lid
    // prints the tally INSIDE the label (law 11).
    expect(container.querySelectorAll('.board__lab')).toHaveLength(0);
    expect(container.querySelectorAll('.board__grpc')).toHaveLength(columns.length);
    expect(container.querySelector('.board__grp-c')!.textContent).toBe(
      '3 projects · 1 confirmed',
    );
    expect(lid.getAttribute('aria-expanded')).toBe('false');
  });

  it('the absence draws ONE band into its grid area and reserves the row floor', () => {
    const { container } = render(CarrilsStrip, props());
    const band = container.querySelector('.board__aw') as HTMLElement;
    expect(band).not.toBeNull();
    expect(band.textContent).toContain('away');
    expect(band.textContent).toContain('Mia');
    expect(band.textContent).toContain('until 15');
    // Column 14 is index 3 → grid tracks 5/6; Última is the second lane of
    // the first (only) group → grid row 4. The map and the markup must
    // agree or the band floats over the wrong lane.
    expect(band.style.gridColumn).toBe('5 / 6');
    expect(band.style.gridRow).toBe('4');
    // The touched ISO week reserves the 15px floor on BOTH its day columns
    // (14 and 18) — the row grows, not the marked cell.
    expect(
      container.querySelectorAll(`.board__cell[data-lane="${p2Key}"] .board__awsp`),
    ).toHaveLength(2);
  });
});

describe('CarrilsStrip — the person axis', () => {
  const team = [
    { person_id: 'mia', workspace_id: 'w1', slug: 'mia', full_name: 'Mia', project_ids: ['p1'] },
  ];
  const personBase = laneEvents({
    axis: 'person',
    groups: personGroups({
      projects,
      visibleProjectIds: new Set(['p1', 'p2']),
      team,
      personNames: new Map([['mia', 'Mia']]),
      sharedPersonIds: new Set(['mia']),
    }),
    events: [
      // A date with no roster → inferred onto Mia (p1's cast).
      {
        id: 'd1',
        day: '2026-07-14',
        project_id: 'p1',
        kind: 'date',
        cert: 'confirmed',
        roster: null,
        venue_id: null,
        slip: { ...slipOf('d1', 'confirmed', 'Assaig'), kind: 'rehearsal' },
      },
    ],
    castByProject: new Map([['p1', ['mia']]]),
    awayByDay: new Map(),
  });

  function personProps(over: Record<string, unknown> = {}) {
    return props({
      axis: 'person' as const,
      groups: personBase.groups,
      cells: personBase.cells,
      awayRuns: [],
      clashes: [],
      ...over,
    });
  }

  it('an inferred placement is dotted and italic FROM THE SLOT — Slip untouched, no fade', () => {
    const { container } = render(CarrilsStrip, personProps());
    const slot = container.querySelector('.board__slot--inf')!;
    expect(slot).not.toBeNull();
    expect(slot.querySelector('.slip')).not.toBeNull();
  });

  it("the teamless project says 'no data yet' exactly once, in its ghost lane", () => {
    const { container } = render(CarrilsStrip, personProps());
    const text = container.textContent ?? '';
    expect(text.match(/no data yet/g)).toHaveLength(1);
    expect(container.querySelector('.board__lab--ghost .board__name')!.textContent).toContain(
      'team',
    );
  });

  it("a shared person wears the word; the door passes NO project — the dialog asks", async () => {
    const p = personProps();
    const { container } = render(CarrilsStrip, p);
    expect(container.querySelector('.board__badge')!.textContent).toBe('shared');
    const door = container.querySelector(
      `.board__cell[data-day="${TODAY}"] .board__add`,
    ) as HTMLButtonElement;
    await fireEvent.click(door);
    expect(p.onDayCreate).toHaveBeenCalledWith(TODAY, null);
  });
});
