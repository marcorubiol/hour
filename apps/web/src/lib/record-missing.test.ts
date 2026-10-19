import { describe, expect, it } from 'vitest';
import {
  MISSING_MAX,
  ROADSHEET_SHARE_DAYS,
  conversationMissing,
  performanceMissing,
  personMissing,
  stepShortcuts,
  type ConversationMissingInput,
  type PerformanceMissingInput,
} from './record-missing';
import { addDaysIso } from './planner';

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
