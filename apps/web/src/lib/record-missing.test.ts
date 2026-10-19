import { describe, expect, it } from 'vitest';
import {
  MISSING_MAX,
  ROADSHEET_SHARE_DAYS,
  boloMissing,
  conversationMissing,
  dateMissing,
  lineMissing,
  performanceMissing,
  personMissing,
  stepShortcuts,
  stepsDue,
  type ConversationMissingInput,
  type PerformanceMissingInput,
} from './record-missing';
import { addDaysIso } from './planner';
import { invoicesByBolo, type MoneyBolo } from './money';

// ── Función ────────────────────────────────────────────────────────────────

const TODAY = '2026-10-20'; // martes

function perf(over: Partial<PerformanceMissingInput> = {}): PerformanceMissingInput {
  return {
    status: 'confirmed',
    day: addDaysIso(TODAY, 30),
    hold_notice_days: null,
    readiness: { hotel: true, technical: true },
    roster: ['p1'],
    commitments: [],
    hasBolo: true,
    roadsheetLinks: 1,
    ...over,
  };
}

describe('performanceMissing', () => {
  it('a confirmed performance with everything in place asks for nothing', () => {
    expect(performanceMissing(perf(), TODAY)).toEqual([]);
  });

  it('names each preparation item not ticked, in the checklist order', () => {
    expect(performanceMissing(perf({ readiness: null }), TODAY)).toEqual([
      { kind: 'ready', key: 'hotel' },
      { kind: 'ready', key: 'technical' },
    ]);
    expect(performanceMissing(perf({ readiness: { hotel: true } }), TODAY)).toEqual([
      { kind: 'ready', key: 'technical' },
    ]);
  });

  it('nobody going: no roster and nobody said «voy»; a «voy» or a roster is enough', () => {
    expect(performanceMissing(perf({ roster: [] }), TODAY)).toEqual([{ kind: 'nobody_going' }]);
    expect(performanceMissing(perf({ roster: [], commitments: [{ person_id: 'p2', state: 'not_going' }] }), TODAY)).toEqual([
      { kind: 'nobody_going' },
    ]);
    expect(performanceMissing(perf({ roster: [], commitments: [{ person_id: 'p2', state: 'going' }] }), TODAY)).toEqual([]);
  });

  it('preparation and people are asked only of a confirmed one still to come', () => {
    const empty = { roster: [], readiness: null };
    expect(performanceMissing(perf({ ...empty, day: addDaysIso(TODAY, -1) }), TODAY)).toEqual([]);
    expect(performanceMissing(perf({ ...empty, status: 'done' }), TODAY)).toEqual([]);
    expect(performanceMissing(perf({ ...empty, status: 'proposed' }), TODAY)).toEqual([]);
    // Today still counts as to come.
    expect(performanceMissing(perf({ ...empty, day: TODAY }), TODAY)).toHaveLength(3);
  });

  it('a hold asks for a decision when its deadline is within the coming week or past', () => {
    // 30 days of notice by default: a hold in 35 days decides in 5.
    expect(performanceMissing(perf({ status: 'hold_1', day: addDaysIso(TODAY, 35) }), TODAY)).toEqual([
      { kind: 'hold_deadline', day: addDaysIso(TODAY, 5) },
    ]);
    // In 40 days it decides in 10: not yet.
    expect(performanceMissing(perf({ status: 'hold', day: addDaysIso(TODAY, 40) }), TODAY)).toEqual([]);
    // Past deadline, show still to come: still asks.
    expect(performanceMissing(perf({ status: 'hold_2', day: addDaysIso(TODAY, 10) }), TODAY)).toEqual([
      { kind: 'hold_deadline', day: addDaysIso(TODAY, -20) },
    ]);
    // Notice 0 = no deadline at all.
    expect(performanceMissing(perf({ status: 'hold', day: addDaysIso(TODAY, 3), hold_notice_days: 0 }), TODAY)).toEqual([]);
  });

  it('without a bolo, says so; when the reader cannot know, says nothing', () => {
    expect(performanceMissing(perf({ hasBolo: false }), TODAY)).toEqual([{ kind: 'no_bolo' }]);
    expect(performanceMissing(perf({ hasBolo: null }), TODAY)).toEqual([]);
    // A past one without bolo still has nowhere for its money.
    expect(performanceMissing(perf({ hasBolo: false, status: 'done', day: addDaysIso(TODAY, -3) }), TODAY)).toEqual([
      { kind: 'no_bolo' },
    ]);
  });

  it('the road sheet without links counts only when the performance is close, and only if known', () => {
    const close = addDaysIso(TODAY, ROADSHEET_SHARE_DAYS);
    expect(performanceMissing(perf({ day: close, roadsheetLinks: 0 }), TODAY)).toEqual([{ kind: 'roadsheet_unshared' }]);
    expect(performanceMissing(perf({ day: addDaysIso(close, 1), roadsheetLinks: 0 }), TODAY)).toEqual([]);
    expect(performanceMissing(perf({ day: close, roadsheetLinks: null }), TODAY)).toEqual([]);
  });

  it('a cancelled performance asks for nothing', () => {
    expect(performanceMissing(perf({ status: 'cancelled', hasBolo: false, roster: [] }), TODAY)).toEqual([]);
  });

  it(`never says more than ${MISSING_MAX}, most pressing first`, () => {
    const all = performanceMissing(
      perf({ day: addDaysIso(TODAY, 7), roster: [], readiness: null, hasBolo: false, roadsheetLinks: 0 }),
      TODAY,
    );
    expect(all).toEqual([{ kind: 'nobody_going' }, { kind: 'ready', key: 'hotel' }, { kind: 'ready', key: 'technical' }]);
  });
});

// ── Conversación ───────────────────────────────────────────────────────────

// Viernes 16 de octubre de 2026, 10:00, hora local.
const NOW = new Date(2026, 9, 16, 10, 0, 0);
function ago(days: number): string {
  return new Date(2026, 9, 16 - days, 9, 0, 0).toISOString();
}
function day(offset: number): string {
  const d = new Date(2026, 9, 16 + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function conv(over: Partial<ConversationMissingInput> = {}): ConversationMissingInput {
  return {
    not_now_at: null,
    not_now_until: null,
    last: { direction: 'outbound', occurred_at: ago(2) },
    last_in: { occurred_at: ago(5) },
    last_contacted_at: ago(2),
    first_contacted_at: ago(40),
    contacted_undated: false,
    reply_settled_at: null,
    next_action_at: day(7),
    next_action_note: 'Llamar',
    ...over,
  };
}

describe('conversationMissing', () => {
  it('our word sent and a dated step ahead: nothing', () => {
    expect(conversationMissing(conv(), NOW)).toEqual([]);
  });

  it('the last word came from outside: our turn to reply', () => {
    const since = ago(1);
    expect(conversationMissing(conv({ last: { direction: 'inbound', occurred_at: since } }), NOW)).toEqual([
      { kind: 'reply', since },
    ]);
  });

  it('a settled reply is not ours any more', () => {
    const since = ago(1);
    expect(
      conversationMissing(conv({ last: { direction: 'inbound', occurred_at: since }, reply_settled_at: since }), NOW),
    ).toEqual([]);
  });

  it('a step for today or before is due', () => {
    expect(conversationMissing(conv({ next_action_at: day(0) }), NOW)).toEqual([{ kind: 'step_due', day: day(0) }]);
    expect(conversationMissing(conv({ next_action_at: day(-3) }), NOW)).toEqual([{ kind: 'step_due', day: day(-3) }]);
  });

  it('a step written without a day', () => {
    expect(conversationMissing(conv({ next_action_at: null }), NOW)).toEqual([{ kind: 'step_undated' }]);
  });

  it('in talks with no step at all; contacted only, it is not asked', () => {
    expect(conversationMissing(conv({ next_action_at: null, next_action_note: null }), NOW)).toEqual([{ kind: 'no_step' }]);
    expect(
      conversationMissing(conv({ next_action_at: null, next_action_note: '  ', last_in: null }), NOW),
    ).toEqual([]);
  });

  it('a reply due already says what to do: no «no step» on top of it', () => {
    const since = ago(1);
    expect(
      conversationMissing(
        conv({ last: { direction: 'inbound', occurred_at: since }, next_action_at: null, next_action_note: null }),
        NOW,
      ),
    ).toEqual([{ kind: 'reply', since }]);
  });

  it('a reply and a due step, together', () => {
    const since = ago(1);
    expect(
      conversationMissing(conv({ last: { direction: 'inbound', occurred_at: since }, next_action_at: day(-1) }), NOW),
    ).toEqual([
      { kind: 'reply', since },
      { kind: 'step_due', day: day(-1) },
    ]);
  });

  it('«no esta vez» in force asks for nothing', () => {
    expect(
      conversationMissing(
        conv({ not_now_at: ago(1), next_action_at: day(-2), last: { direction: 'inbound', occurred_at: ago(3) } }),
        NOW,
      ),
    ).toEqual([]);
  });
});

describe('personMissing', () => {
  const row = (id: string, next: string | null, relation = 'talking') => ({ id, relation, next_action_at: next });

  it('names the conversations whose step is due, oldest first, at most three', () => {
    const out = personMissing(
      [row('a', '2026-10-19'), row('b', '2026-10-21'), row('c', '2026-10-01'), row('d', '2026-10-20'), row('e', '2026-10-10'), row('f', null)],
      TODAY,
    );
    expect(out).toEqual([
      { kind: 'step_due', conversationId: 'c', day: '2026-10-01' },
      { kind: 'step_due', conversationId: 'e', day: '2026-10-10' },
      { kind: 'step_due', conversationId: 'a', day: '2026-10-19' },
    ]);
  });

  it('«no esta vez» asks for nothing', () => {
    expect(personMissing([row('a', '2026-10-01', 'not_now')], TODAY)).toEqual([]);
  });
});

describe('lineMissing', () => {
  const row = (id: string, next: string | null, relation = 'talking') => ({ id, relation, next_action_at: next });

  it('three or fewer due steps are each named, oldest first', () => {
    expect(lineMissing([row('a', '2026-10-19'), row('b', '2026-10-21'), row('c', '2026-10-20'), row('d', null)], TODAY)).toEqual([
      { kind: 'step_due', conversationId: 'a', day: '2026-10-19' },
      { kind: 'step_due', conversationId: 'c', day: '2026-10-20' },
    ]);
  });

  it('past three, the two oldest and the rest as one count', () => {
    const rows = [row('a', '2026-10-19'), row('b', '2026-10-01'), row('c', '2026-10-05'), row('d', '2026-10-10'), row('e', '2026-10-20')];
    expect(lineMissing(rows, TODAY)).toEqual([
      { kind: 'step_due', conversationId: 'b', day: '2026-10-01' },
      { kind: 'step_due', conversationId: 'c', day: '2026-10-05' },
      { kind: 'steps_due_more', count: 3, atLeast: false },
    ]);
  });

  it('a page of more that is due to its last row: the count is a floor', () => {
    const rows = [row('a', '2026-10-01'), row('b', '2026-10-02'), row('c', '2026-10-03')];
    expect(lineMissing(rows, TODAY, { total: 3 })).toHaveLength(3);
    expect(lineMissing(rows, TODAY, { total: 40 })).toEqual([
      { kind: 'step_due', conversationId: 'a', day: '2026-10-01' },
      { kind: 'step_due', conversationId: 'b', day: '2026-10-02' },
      { kind: 'steps_due_more', count: 1, atLeast: true },
    ]);
  });

  it('a page of more that reaches a row not due holds every due one', () => {
    const rows = [row('a', '2026-10-01'), row('b', '2026-10-02'), row('c', '2026-11-03')];
    expect(lineMissing(rows, TODAY, { total: 40 })).toEqual([
      { kind: 'step_due', conversationId: 'a', day: '2026-10-01' },
      { kind: 'step_due', conversationId: 'b', day: '2026-10-02' },
    ]);
  });

  it('«no esta vez» and a step still to come ask for nothing', () => {
    expect(lineMissing([row('a', '2026-10-01', 'not_now'), row('b', '2026-11-01')], TODAY)).toEqual([]);
  });

  it('the line\'s count is the same rule', () => {
    expect(stepsDue([row('a', '2026-10-20'), row('b', '2026-10-01', 'not_now'), row('c', '2026-10-21')], TODAY)).toHaveLength(1);
  });
});

describe('stepShortcuts', () => {
  it('tomorrow, the coming Monday and two weeks', () => {
    // 2026-10-20 is a Tuesday.
    expect(stepShortcuts('2026-10-20')).toEqual({ tomorrow: '2026-10-21', monday: '2026-10-26', two_weeks: '2026-11-03' });
  });

  it('on a Monday, «Monday» is the next one; on a Sunday, tomorrow', () => {
    expect(stepShortcuts('2026-10-19').monday).toBe('2026-10-26');
    expect(stepShortcuts('2026-10-25').monday).toBe('2026-10-26');
  });

  it('crosses months and years', () => {
    expect(stepShortcuts('2026-12-25')).toEqual({ tomorrow: '2026-12-26', monday: '2026-12-28', two_weeks: '2027-01-08' });
  });
});

// ── Fecha ──────────────────────────────────────────────────────────────────

describe('dateMissing', () => {
  const date = (over: Partial<Parameters<typeof dateMissing>[0]> = {}) => ({
    kind: 'rehearsal',
    status: 'confirmed',
    day: addDaysIso(TODAY, 3),
    stages: null,
    ...over,
  });

  it('a confirmed rehearsal to come asks for nothing', () => {
    expect(dateMissing(date(), TODAY)).toEqual([]);
  });

  it('an option to come asks to be confirmed or let go', () => {
    expect(dateMissing(date({ status: 'tentative' }), TODAY)).toEqual([{ kind: 'date_tentative' }]);
  });

  it('a trip to come with no stage says nothing tells how to get there', () => {
    expect(dateMissing(date({ kind: 'travel_day', stages: 0 }), TODAY)).toEqual([{ kind: 'trip_no_stages' }]);
    expect(dateMissing(date({ kind: 'travel_day', stages: 2 }), TODAY)).toEqual([]);
  });

  it('stages not read yet are not «no stages»', () => {
    expect(dateMissing(date({ kind: 'travel_day', stages: null }), TODAY)).toEqual([]);
  });

  it('a past, cancelled or done date asks for nothing', () => {
    expect(dateMissing(date({ status: 'tentative', day: addDaysIso(TODAY, -1) }), TODAY)).toEqual([]);
    expect(dateMissing(date({ status: 'cancelled', kind: 'travel_day', stages: 0 }), TODAY)).toEqual([]);
    expect(dateMissing(date({ status: 'done', kind: 'travel_day', stages: 0 }), TODAY)).toEqual([]);
  });

  it('today still counts as to come, read from an instant too', () => {
    expect(dateMissing(date({ status: 'tentative', day: `${TODAY}T08:00:00Z` }), TODAY)).toEqual([
      { kind: 'date_tentative' },
    ]);
  });
});

// ── Bolo ───────────────────────────────────────────────────────────────────

describe('boloMissing', () => {
  const bolo = (over: Partial<MoneyBolo> = {}): MoneyBolo => ({
    id: 'b',
    project_id: 'p',
    line_id: null,
    conversation_id: null,
    venue_name: 'Teatre',
    city: 'Girona',
    country: 'ES',
    fee_amount: 1000,
    fee_currency: 'EUR',
    status: 'done',
    collected: 0,
    function_count: 1,
    first_performed_at: '2026-09-20T18:00:00Z',
    last_performed_at: '2026-09-20T18:00:00Z',
    project: { id: 'p', slug: 'obra', name: 'Obra', accent: null, workspace_id: 'w' },
    ...over,
  });
  const ctx = { invoicesByBolo: invoicesByBolo([]), termsByPayer: new Map(), modeOf: () => 'legal' as const, today: new Date(`${TODAY}T10:00:00Z`) };

  it('says what Cuentas says of it: a function done without an invoice', () => {
    expect(boloMissing(bolo(), ctx).map((i) => i.kind)).toEqual(['to_invoice']);
  });

  it('a function done without a fee asks for the fee', () => {
    expect(boloMissing(bolo({ fee_amount: null }), ctx).map((i) => i.kind)).toEqual(['no_fee']);
  });

  it('a bolo still to perform asks for nothing', () => {
    expect(boloMissing(bolo({ status: 'confirmed', first_performed_at: '2026-12-01T19:00:00Z', last_performed_at: '2026-12-01T19:00:00Z' }), ctx)).toEqual([]);
  });

  it('with invoicing off, nothing to invoice', () => {
    expect(boloMissing(bolo(), { ...ctx, modeOf: () => 'off' as const })).toEqual([]);
  });
});
