import { describe, expect, test } from 'vitest';
import {
  clockText,
  endFor,
  inputsOf,
  instantFor,
  kindForLabel,
  moveSlot,
  outOfTime,
  recognisedWords,
  namedSlot,
  parseClock,
  placeByTime,
  slotWord,
} from './running-order';
import type { ScheduleSlotInput } from './schedule-slot';

const TZ = 'Europe/Madrid';
const WORDS = [
  ['load_in', 'load-in'],
  ['soundcheck', 'soundcheck'],
  ['start', 'función'],
  ['loadout', 'load-out'],
  ['wrap', 'wrap'],
] as const;

describe('parseClock', () => {
  test.each([
    ['20h30', { h: 20, m: 30 }],
    ['20h', { h: 20, m: 0 }],
    ['20:30', { h: 20, m: 30 }],
    ['20.30', { h: 20, m: 30 }],
    ['2030', { h: 20, m: 30 }],
    ['930', { h: 9, m: 30 }],
    ['9', { h: 9, m: 0 }],
    [' 09H05 ', { h: 9, m: 5 }],
    ['0', { h: 0, m: 0 }],
  ])('%s', (text, clock) => {
    expect(parseClock(text)).toEqual(clock);
  });

  test.each(['', '24', '2575', '20h7', 'ocho', '20:30:00', '12345', '-1'])(
    'refuses %s',
    (text) => {
      expect(parseClock(text)).toBeNull();
    },
  );
});

describe('clockText', () => {
  test('the Planner clock, in the zone asked for', () => {
    expect(clockText('2026-10-10T18:30:00Z', TZ)).toBe('20h30');
    expect(clockText('2026-10-10T14:00:00Z', TZ)).toBe('16h');
  });
  test('no leading zero, as the strip writes it', () => {
    expect(clockText('2026-10-10T07:05:00Z', TZ)).toBe('9h05');
    expect(clockText('2026-10-10T22:30:00Z', TZ)).toBe('0h30');
  });
});

describe('instantFor', () => {
  test('a clock on the day, in the zone of the running order', () => {
    expect(instantFor('2026-10-10', { h: 20, m: 30 }, TZ)).toBe('2026-10-10T18:30:00.000Z');
  });

  test('an early hour on an empty order is just early', () => {
    expect(instantFor('2026-10-10', { h: 1, m: 30 }, TZ)).toBe('2026-10-09T23:30:00.000Z');
  });

  test('the night runs long: after an afternoon, 1h30 is tomorrow', () => {
    const order = [{ at: '2026-10-10T18:30:00.000Z' }];
    expect(instantFor('2026-10-10', { h: 1, m: 30 }, TZ, order)).toBe('2026-10-10T23:30:00.000Z');
  });

  test('a morning order does not push an early hour to tomorrow', () => {
    const order = [{ at: '2026-10-10T07:00:00.000Z' }]; // 9h
    expect(instantFor('2026-10-10', { h: 5, m: 0 }, TZ, order)).toBe('2026-10-10T03:00:00.000Z');
  });

  test('six in the morning is morning again', () => {
    const order = [{ at: '2026-10-10T18:30:00.000Z' }];
    expect(instantFor('2026-10-10', { h: 6, m: 0 }, TZ, order)).toBe('2026-10-10T04:00:00.000Z');
  });
});

describe('endFor', () => {
  test('an end after its start, same day', () => {
    expect(endFor('2026-10-10T15:00:00.000Z', { h: 18, m: 30 }, TZ)).toBe(
      '2026-10-10T16:30:00.000Z',
    );
  });
  test('an end earlier on the clock is after midnight', () => {
    expect(endFor('2026-10-10T20:00:00.000Z', { h: 1, m: 0 }, TZ)).toBe(
      '2026-10-10T23:00:00.000Z',
    );
  });
});

describe('words and kinds', () => {
  const word = (k: string) => Object.fromEntries(WORDS)[k as 'start'] ?? k;

  test('a slot says its label, or its kind’s word', () => {
    expect(slotWord({ label: 'photo call', kind: null }, word)).toBe('photo call');
    expect(slotWord({ label: null, kind: 'start' }, word)).toBe('función');
  });

  test('a typed word that is a kind becomes the kind', () => {
    expect(kindForLabel('  Función ', WORDS)).toBe('start');
    expect(kindForLabel('LOAD-IN', WORDS)).toBe('load_in');
    expect(kindForLabel('photo call', WORDS)).toBeNull();
  });

  test('namedSlot: kind word → kind, free word → free moment', () => {
    expect(namedSlot('función', null, WORDS)).toEqual({ kind: 'start', label: null });
    expect(namedSlot('photo call', 'soundcheck', WORDS)).toEqual({
      kind: null,
      label: 'photo call',
    });
    expect(namedSlot('  ', 'soundcheck', WORDS)).toEqual({ kind: 'soundcheck', label: null });
    expect(namedSlot('', null, WORDS)).toBeNull();
  });
});

describe('order', () => {
  const s = (id: string, at: string): ScheduleSlotInput => ({
    id,
    kind: null,
    label: id,
    at,
    ends_at: null,
    notes: null,
  });
  const order = [
    s('a', '2026-10-10T08:00:00Z'),
    s('b', '2026-10-10T12:00:00Z'),
    s('c', '2026-10-10T18:00:00Z'),
  ];

  test('inputsOf keeps the stored order', () => {
    const rows = order.map((x, i) => ({ ...x, id: x.id!, sort: 3 - i }));
    expect(inputsOf(rows).map((x) => x.id)).toEqual(['c', 'b', 'a']);
  });

  test('a new moment lands where its hour says', () => {
    const next = placeByTime(order, s('n', '2026-10-10T15:00:00Z'));
    expect(next.map((x) => x.id)).toEqual(['a', 'b', 'n', 'c']);
  });

  test('equal hours keep arrival order', () => {
    const next = placeByTime(order, s('n', '2026-10-10T12:00:00Z'));
    expect(next.map((x) => x.id)).toEqual(['a', 'b', 'n', 'c']);
  });

  test('an edited moment leaves its place and takes the new one', () => {
    const next = placeByTime(order, { ...order[0], at: '2026-10-10T20:00:00Z' }, 0);
    expect(next.map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });

  test('only the moved slot moves: a hand-made order stays', () => {
    const hand = [order[2], order[0], order[1]];
    const next = placeByTime(hand, s('n', '2026-10-10T23:00:00Z'));
    expect(next.map((x) => x.id)).toEqual(['c', 'a', 'b', 'n']);
  });
});

describe('moving by hand (the hand-made order is the order)', () => {
  test('moveSlot moves one and keeps the rest', () => {
    expect(moveSlot(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveSlot(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'c', 'b']);
  });
  test('out of range is a no-op, never a wrap-around', () => {
    expect(moveSlot(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(moveSlot(['a', 'b'], 1, 2)).toEqual(['a', 'b']);
  });
  test('outOfTime says when the hand put a moment after a later hour', () => {
    const o = [
      { at: '2026-10-10T18:00:00Z' },
      { at: '2026-10-10T17:00:00Z' },
      { at: '2026-10-11T00:30:00Z' },
    ];
    expect(outOfTime(o, 0)).toBe(false);
    expect(outOfTime(o, 1)).toBe(true);
    expect(outOfTime(o, 2)).toBe(false);
  });
});

describe('the five words in every language', () => {
  const dict: Record<string, Record<string, string>> = {
    es: {
      'desk.anchor_loadin': 'carga',
      'desk.anchor_soundcheck': 'prueba de sonido',
      'desk.anchor_show': 'función',
      'desk.anchor_loadout': 'desmontaje',
      'desk.anchor_wrap': 'fin',
    },
    ca: {
      'desk.anchor_loadin': 'càrrega',
      'desk.anchor_soundcheck': 'prova de so',
      'desk.anchor_show': 'funció',
      'desk.anchor_loadout': 'desmuntatge',
      'desk.anchor_wrap': 'fi',
    },
    en: {
      'desk.anchor_loadin': 'load-in',
      'desk.anchor_soundcheck': 'soundcheck',
      'desk.anchor_show': 'show',
      'desk.anchor_loadout': 'load-out',
      'desk.anchor_wrap': 'wrap',
    },
  };
  const known = recognisedWords((k, l) => dict[l][k], ['ca', 'es', 'en']);

  test.each([
    ['Prova de so', 'soundcheck'],
    ['técnica', 'soundcheck'],
    ['carga', 'load_in'],
    ['load in', 'load_in'],
    ['funció', 'start'],
    ['show', 'start'],
    ['desmuntatge', 'loadout'],
    ['fin', 'wrap'],
  ])('%s → %s', (word, kind) => {
    expect(kindForLabel(word, known)).toBe(kind);
  });

  test('anything else is a free moment', () => {
    expect(kindForLabel('photo call', known)).toBeNull();
  });
});
