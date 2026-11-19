import { describe, expect, it } from 'vitest';
import {
  ROADSHEET_SHARE_DAYS,
  boloMissing,
  conversationMissing,
  dateMissing,
  lineMissing,
  manualOpenSoon,
  missingSoon,
  performanceMissing,
  isUrgentMissing,
  isUrgentThing,
  performanceReadiness,
  personMissing,
  stepShortcuts,
  stepsDue,
  type ConversationMissingInput,
  type PerformanceMissingInput,
} from './record-missing';
import { dateReadiness } from './record-missing';
import { addDaysIso } from './planner';
import { addManualThing, readPreparation } from './preparation';
import { invoicesByBolo, type MoneyBolo } from './money';

// ── Función ────────────────────────────────────────────────────────────────

const TODAY = '2026-10-20'; // martes

function perf(over: Partial<PerformanceMissingInput> = {}): PerformanceMissingInput {
  return {
    status: 'confirmed',
    day: addDaysIso(TODAY, 30),
    hold_notice_days: null,
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

  it('hotel and technical are not asked for (ADR-164 § 2)', () => {
    const kinds = performanceMissing(perf({ day: addDaysIso(TODAY, 3) }), TODAY).map((m) => m.kind);
    expect(kinds).toEqual([]);
  });

  it('nobody going: no roster and nobody said «voy»; a «voy» or a roster is enough', () => {
    expect(performanceMissing(perf({ roster: [] }), TODAY)).toEqual([{ kind: 'nobody_going' }]);
    expect(performanceMissing(perf({ roster: [], commitments: [{ person_id: 'p2', state: 'not_going' }] }), TODAY)).toEqual([
      { kind: 'nobody_going' },
    ]);
    expect(performanceMissing(perf({ roster: [], commitments: [{ person_id: 'p2', state: 'going' }] }), TODAY)).toEqual([]);
  });

  it('people are asked only of a confirmed one still to come', () => {
    const empty = { roster: [] };
    expect(performanceMissing(perf({ ...empty, day: addDaysIso(TODAY, -1) }), TODAY)).toEqual([]);
    expect(performanceMissing(perf({ ...empty, status: 'done' }), TODAY)).toEqual([]);
    expect(performanceMissing(perf({ ...empty, status: 'proposed' }), TODAY)).toEqual([]);
    // Today still counts as to come.
    expect(performanceMissing(perf({ ...empty, day: TODAY }), TODAY)).toEqual([{ kind: 'nobody_going' }]);
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

  it('says everything that is open (no cap), what blocks before what prepares', () => {
    const all = performanceMissing(
      perf({ day: addDaysIso(TODAY, 7), roster: [], hasBolo: false, roadsheetLinks: 0, status: 'hold', hold_notice_days: 3 }),
      TODAY,
    );
    expect(all).toEqual([{ kind: 'hold_deadline', day: addDaysIso(TODAY, 4) }, { kind: 'no_bolo' }]);
    const five = performanceMissing(
      perf({ day: addDaysIso(TODAY, 7), roster: [], hasBolo: false, roadsheetLinks: 0, start_at: null }),
      TODAY,
    );
    expect(five.map((m) => m.kind)).toEqual(['no_bolo', 'no_time', 'roadsheet_unshared', 'nobody_going']);
    const many = performanceMissing(
      perf({ day: addDaysIso(TODAY, 7), roster: [], hasBolo: false, roadsheetLinks: 0 }),
      TODAY,
    );
    expect(many).toEqual([{ kind: 'no_bolo' }, { kind: 'roadsheet_unshared' }, { kind: 'nobody_going' }]);
  });

  it('confirmed with no start says so after the bolo; unknown start or a hold asks nothing', () => {
    expect(performanceMissing(perf({ start_at: null, hasBolo: false }), TODAY)).toEqual([{ kind: 'no_bolo' }, { kind: 'no_time' }]);
    expect(performanceMissing(perf({ start_at: undefined }), TODAY)).toEqual([]);
    expect(performanceMissing(perf({ start_at: null, status: 'hold', day: addDaysIso(TODAY, 40) }), TODAY)).toEqual([]);
  });

  it('a roster the reader cannot know asks for nobody', () => {
    expect(performanceMissing(perf({ roster: null }), TODAY)).toEqual([]);
  });
});

describe('performanceReadiness · the stub of the pass', () => {
  const box = (id: string, done: boolean, verb: string, urgent = false) => ({ id, done, verb, urgent });
  const ready = (over: Partial<PerformanceMissingInput> = {}) => performanceReadiness(perf({ start_at: '2026-11-19T19:00:00Z', ...over }), TODAY);

  it('a ready confirmed performance: four boxes, all done', () => {
    expect(ready()).toEqual([
      box('status', true, 'confirm'),
      box('hours', true, 'add_time'),
      box('team', true, 'sign_up'),
      box('sheet', true, 'share'),
    ]);
  });

  it('each missing thing is an open box with its verb', () => {
    const open = ready({ day: addDaysIso(TODAY, 3), start_at: null, roster: [], roadsheetLinks: 0 });
    expect(open).toEqual([
      box('status', true, 'confirm'),
      box('hours', false, 'add_time'),
      box('team', false, 'sign_up'),
      box('sheet', false, 'share', true),
    ]);
  });

  it('a «voy» fills the team box without a roster', () => {
    const b = ready({ roster: [], commitments: [{ person_id: 'p2', state: 'going' }] });
    expect(b.find((x) => x.id === 'team')?.done).toBe(true);
  });

  it('a hold: status is open (with its deadline when close), team and sheet are not asked yet', () => {
    const b = ready({ status: 'hold', day: addDaysIso(TODAY, 35), roster: [], roadsheetLinks: null });
    expect(b).toEqual([{ ...box('status', false, 'confirm', true), holdDay: addDaysIso(TODAY, 5) }, box('hours', true, 'add_time')]);
    expect(ready({ status: 'proposed' })[0]).toEqual(box('status', false, 'confirm'));
  });

  it('a box the reader cannot know is not drawn', () => {
    const ids = (over: Partial<PerformanceMissingInput>) => ready(over).map((x) => x.id);
    expect(ids({ roster: null })).toEqual(['status', 'hours', 'sheet']);
    expect(ids({ roadsheetLinks: null })).toEqual(['status', 'hours', 'team']);
    expect(performanceReadiness(perf(), TODAY).map((x) => x.id)).toEqual(['status', 'team', 'sheet']); // start_at undefined
  });

  it('an unshared sheet is a box only within the share window; with a link it is done at any distance', () => {
    const far = addDaysIso(TODAY, ROADSHEET_SHARE_DAYS + 1);
    expect(ready({ day: far, roadsheetLinks: 0 }).map((x) => x.id)).toEqual(['status', 'hours', 'team']);
    expect(ready({ day: far, roadsheetLinks: 2 }).at(-1)).toEqual(box('sheet', true, 'share'));
    expect(ready({ day: addDaysIso(TODAY, ROADSHEET_SHARE_DAYS), roadsheetLinks: 0 }).at(-1)).toEqual(box('sheet', false, 'share', true));
  });

  it('only a closing deadline is urgent: a hold in the week and a sheet in its window; the rest is neutral', () => {
    const b = ready({ day: addDaysIso(TODAY, 3), start_at: null, roster: [], roadsheetLinks: 0 });
    expect(b.filter((x) => x.urgent).map((x) => x.id)).toEqual(['sheet']);
    expect(ready({ status: 'hold', day: addDaysIso(TODAY, 40) })[0].urgent).toBe(false);
    const day = addDaysIso(TODAY, 3);
    expect(isUrgentMissing({ kind: 'no_time' }, { day, today: TODAY })).toBe(false);
    expect(isUrgentMissing({ kind: 'roadsheet_unshared' }, { day, today: TODAY })).toBe(true);
    expect(isUrgentMissing({ kind: 'hold_deadline', day: TODAY }, { day, today: TODAY })).toBe(true);
  });

  it('cancelled and past performances have no stub; today still does', () => {
    expect(ready({ status: 'cancelled' })).toEqual([]);
    expect(ready({ day: addDaysIso(TODAY, -1) })).toEqual([]);
    expect(ready({ day: TODAY })).not.toEqual([]);
  });

  it('agrees with «Falta»: whatever it asks of a confirmed one is an open box', () => {
    const input = perf({ day: addDaysIso(TODAY, 7), roster: [], roadsheetLinks: 0, start_at: null });
    const open = performanceReadiness(input, TODAY).filter((b) => !b.done).map((b) => b.id);
    expect(open).toEqual(['hours', 'team', 'sheet']);
    expect(performanceMissing(input, TODAY).map((m) => m.kind)).toEqual(['no_time', 'roadsheet_unshared', 'nobody_going']);
  });
});

describe('missingSoon · the one rule of the dot, the amber and the strip', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    status: 'confirmed',
    performed_at: addDaysIso(TODAY, 5),
    start_at: '2026-10-25T19:00:00Z',
    person_ids: ['p1'],
    has_bolo: true,
    roadsheet_links: 1,
    ...over,
  });
  it('a ready performance asks for nothing', () => {
    expect(missingSoon(row(), TODAY)).toEqual([]);
  });
  it('fourteen days and no further, today included, the past never', () => {
    expect(missingSoon(row({ has_bolo: false, performed_at: TODAY }), TODAY)).toEqual([{ kind: 'no_bolo' }]);
    expect(missingSoon(row({ has_bolo: false, performed_at: addDaysIso(TODAY, 14) }), TODAY)).toEqual([{ kind: 'no_bolo' }]);
    expect(missingSoon(row({ has_bolo: false, performed_at: addDaysIso(TODAY, 15) }), TODAY)).toEqual([]);
    expect(missingSoon(row({ has_bolo: false, performed_at: addDaysIso(TODAY, -1) }), TODAY)).toEqual([]);
  });
  it('confirmed with no hour counts; the facts the feed did not bring do not', () => {
    expect(missingSoon(row({ start_at: null }), TODAY)).toEqual([{ kind: 'no_time' }]);
    expect(missingSoon(row({ person_ids: undefined, has_bolo: undefined, roadsheet_links: undefined }), TODAY)).toEqual([]);
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

  it('a confirmed deal next week without a signed contract asks for it (ADR-163)', () => {
    const soon = new Date(Date.parse(`${TODAY}T10:00:00Z`) + 7 * 86_400_000).toISOString();
    expect(boloMissing(bolo({ status: 'confirmed', first_performed_at: soon, last_performed_at: soon }), ctx).map((i) => i.kind)).toEqual(['contract']);
    expect(
      boloMissing(
        bolo({ status: 'confirmed', first_performed_at: soon, last_performed_at: soon, contract_sent_at: soon, contract_signed_at: soon }),
        ctx,
      ),
    ).toEqual([]);
  });

  it('with invoicing off, nothing to invoice', () => {
    expect(boloMissing(bolo(), { ...ctx, modeOf: () => 'off' as const })).toEqual([]);
  });
});

describe('dateReadiness', () => {
  const test = it;
  const base = { kind: 'rehearsal', status: 'confirmed', day: '2026-11-21', timed: true, stages: null, going: true, place: true };
  const ids = (b: { id: string; done: boolean }[]) => b.map((x) => `${x.id}:${x.done ? 'done' : 'open'}`);

  test('three boxes: the hour, who goes and where', () => {
    expect(ids(dateReadiness(base, '2026-11-18'))).toEqual(['hours:done', 'team:done', 'place:done']);
    expect(ids(dateReadiness({ ...base, timed: false, going: false, place: false }, '2026-11-18'))).toEqual([
      'hours:open',
      'team:open',
      'place:open',
    ]);
  });

  test('a trip asks for its stages, not an hour', () => {
    expect(ids(dateReadiness({ ...base, kind: 'travel_day', stages: 0 }, '2026-11-18'))).toEqual([
      'stages:open',
      'team:done',
      'place:done',
    ]);
    expect(ids(dateReadiness({ ...base, kind: 'travel_day', stages: null }, '2026-11-18'))).toEqual(['team:done', 'place:done']);
  });

  test('what the reader cannot know is not drawn', () => {
    expect(ids(dateReadiness({ ...base, going: null }, '2026-11-18'))).toEqual(['hours:done', 'place:done']);
  });

  test('a day off, a past, cancelled or done date has no stub', () => {
    expect(dateReadiness({ ...base, kind: 'day_off' }, '2026-11-18')).toEqual([]);
    expect(dateReadiness(base, '2026-11-22')).toEqual([]);
    expect(dateReadiness({ ...base, status: 'cancelled' }, '2026-11-18')).toEqual([]);
    expect(dateReadiness({ ...base, status: 'done' }, '2026-11-18')).toEqual([]);
  });
});

describe('the project\'s preparation list (ADR-221, fase 2)', () => {
  const open = perf({ day: addDaysIso(TODAY, 3), start_at: null, roster: [], roadsheetLinks: 0 });
  const ids = (l: ReturnType<typeof readPreparation>) => performanceReadiness(open, TODAY, l).map((b) => b.id);

  it('without a list, or with the default, nothing changes', () => {
    expect(ids(readPreparation(null))).toEqual(['status', 'hours', 'team', 'sheet']);
    expect(performanceReadiness(open, TODAY).map((b) => b.id)).toEqual(['status', 'hours', 'team', 'sheet']);
  });

  it('a thing turned off is not a box (not even «confirmada» or «hora») and asks for nothing', () => {
    const l = readPreparation({ items: [{ id: 'hours', on: false }, { id: 'status', on: false }] });
    expect(ids(l)).toEqual(['team', 'sheet']);
    expect(performanceMissing(open, TODAY, l).map((m) => m.kind)).toEqual(['roadsheet_unshared', 'nobody_going']);
    expect(missingSoon({ status: 'confirmed', performed_at: open.day, start_at: null, person_ids: [], roadsheet_links: 0 }, TODAY, l).map((m) => m.kind)).toEqual([
      'roadsheet_unshared',
      'nobody_going',
    ]);
  });

  it('the boxes follow the project\'s order', () => {
    expect(ids(readPreparation({ items: [{ id: 'sheet', on: true }, { id: 'team', on: true }] }))).toEqual(['sheet', 'team', 'status', 'hours']);
  });

  it('«sin bolo» is not on the list: it is asked whatever the list says', () => {
    const off = readPreparation({ items: ['status', 'hours', 'team', 'sheet'].map((id) => ({ id, on: false })) });
    expect(performanceMissing(perf({ hasBolo: false }), TODAY, off)).toEqual([{ kind: 'no_bolo' }]);
    expect(performanceReadiness(open, TODAY, off)).toEqual([]);
  });

  it('a hold with its deadline turned off in status is not urgent anywhere', () => {
    const l = readPreparation({ items: [{ id: 'status', on: false }] });
    const hold = perf({ status: 'hold', day: addDaysIso(TODAY, 35) });
    expect(performanceMissing(hold, TODAY, l)).toEqual([]);
    expect(performanceReadiness(hold, TODAY, l).map((b) => b.id)).not.toContain('status');
  });
});

describe('manualOpenSoon · the project\'s own things on a feed row (ADR-221, fase 3)', () => {
  const list = addManualThing(addManualThing(readPreparation(null), 'Rider', 'm_rider001'), 'Hotel', 'm_hotel001');
  const row = (over: Record<string, unknown> = {}) => ({
    status: 'confirmed',
    performed_at: addDaysIso(TODAY, 5),
    start_at: '2026-11-19T19:00:00Z',
    prep: null,
    ...over,
  });

  it('a confirmed performance in the window asks for what is not closed, in order', () => {
    expect(manualOpenSoon(row(), TODAY, list).map((m) => m.name)).toEqual(['Rider', 'Hotel']);
    expect(manualOpenSoon(row({ prep: { m_rider001: { estado: 'hecho' } } }), TODAY, list).map((m) => m.name)).toEqual(['Hotel']);
    expect(manualOpenSoon(row({ prep: { m_rider001: { estado: 'no_aplica' }, m_hotel001: { estado: 'hecho' } } }), TODAY, list)).toEqual([]);
  });

  it('asks nothing of a hold, a past or far one, or a row that did not bring its state', () => {
    expect(manualOpenSoon(row({ status: 'hold' }), TODAY, list)).toEqual([]);
    expect(manualOpenSoon(row({ performed_at: addDaysIso(TODAY, -1) }), TODAY, list)).toEqual([]);
    expect(manualOpenSoon(row({ performed_at: addDaysIso(TODAY, 15) }), TODAY, list)).toEqual([]);
    expect(manualOpenSoon({ status: 'confirmed', performed_at: addDaysIso(TODAY, 5), start_at: null }, TODAY, list)).toEqual([]);
  });
});

describe('the hurry of each thing (ADR-221, fase 4)', () => {
  const within = (n: number) => addDaysIso(TODAY, n);
  const open = (n: number, list: ReturnType<typeof readPreparation>) =>
    performanceReadiness(perf({ day: within(n), start_at: null, roster: [], roadsheetLinks: 0 }), TODAY, list).filter((b) => b.urgent).map((b) => b.id);

  it('by default only the road sheet has hurry (its 14 days); hours and team never', () => {
    expect(open(3, readPreparation(null))).toEqual(['sheet']);
  });

  it('a thing has hurry inside the days its project gave it, and not before', () => {
    const l = readPreparation({ items: [{ id: 'hours', on: true, days: 5 }, { id: 'team', on: true, days: 2 }] });
    expect(open(5, l)).toEqual(['hours', 'sheet']);
    expect(open(6, l)).toEqual(['sheet']);
    expect(open(2, l)).toEqual(['hours', 'team', 'sheet']);
  });

  it('null days is never, even for the road sheet', () => {
    expect(open(1, readPreparation({ items: [{ id: 'sheet', on: true, days: null }] }))).toEqual([]);
  });

  it('the sheet\'s days can be shorter than the 14 it is asked in', () => {
    const l = readPreparation({ items: [{ id: 'sheet', on: true, days: 3 }] });
    expect(open(3, l)).toEqual(['sheet']);
    expect(open(4, l)).toEqual([]);
  });

  it('isUrgentThing counts the performance\'s own day; a hand thing too', () => {
    const l = addManualThing(readPreparation(null), 'Rider', 'm_rider001').map((x) => (x.id === 'm_rider001' ? { ...x, days: 7 } : x));
    expect(isUrgentThing('m_rider001', within(7), TODAY, l)).toBe(true);
    expect(isUrgentThing('m_rider001', within(8), TODAY, l)).toBe(false);
    expect(isUrgentThing('hours', within(0), TODAY, l)).toBe(false);
  });
});
