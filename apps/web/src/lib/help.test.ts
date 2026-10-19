import { describe, expect, test } from 'vitest';
import ca from './i18n/ca.json';
import en from './i18n/en.json';
import es from './i18n/es.json';
import fr from './i18n/fr.json';
import {
  CONCEPTS,
  EVENTS,
  HELP_KEY,
  cardKey,
  cardVisible,
  conceptKeys,
  eventKey,
  hasSeen,
  noteVisible,
  presentSteps,
  type HelpState,
} from './help';

const state = (over: Partial<HelpState> = {}): HelpState => ({ seen: {}, ready: true, reopened: null, ...over });

describe('help keys', () => {
  test('every card and event key passes the rule mark_help_seen applies', () => {
    for (const k of [cardKey('desk'), cardKey('planner'), ...EVENTS.map(eventKey)]) {
      expect(k).toMatch(HELP_KEY);
    }
  });

  test('the rule refuses what the RPC refuses', () => {
    for (const k of ['card:', 'tip:desk', 'card:Desk', 'card:desk planner', `card:${'a'.repeat(49)}`]) {
      expect(k).not.toMatch(HELP_KEY);
    }
  });

  test('hasSeen asks for the key, not for a truthy value', () => {
    expect(hasSeen({ 'card:desk': '' }, 'card:desk')).toBe(true);
    expect(hasSeen({}, 'card:desk')).toBe(false);
    expect(hasSeen({}, 'toString')).toBe(false);
  });
});

describe('cardVisible', () => {
  test('shows once: before it is seen, not after', () => {
    expect(cardVisible(state(), 'card:desk')).toBe(true);
    expect(cardVisible(state({ seen: { 'card:desk': '2026-10-20' } }), 'card:desk')).toBe(false);
  });

  test('says nothing on its own until what was seen has arrived', () => {
    expect(cardVisible(state({ ready: false }), 'card:desk')).toBe(false);
  });

  test('the «?» opens it again, seen or not, loaded or not', () => {
    const seen = { 'card:desk': '2026-10-20' };
    expect(cardVisible(state({ seen, reopened: 'card:desk' }), 'card:desk')).toBe(true);
    expect(cardVisible(state({ ready: false, reopened: 'card:desk' }), 'card:desk')).toBe(true);
    expect(cardVisible(state({ seen, reopened: 'card:planner' }), 'card:desk')).toBe(false);
  });
});

describe('noteVisible', () => {
  test('only when the block has that content, once', () => {
    expect(noteVisible(state(), 'event:first_clash', false)).toBe(false);
    expect(noteVisible(state(), 'event:first_clash', true)).toBe(true);
    expect(noteVisible(state({ seen: { 'event:first_clash': 'x' } }), 'event:first_clash', true)).toBe(false);
    expect(noteVisible(state({ ready: false }), 'event:first_clash', true)).toBe(false);
  });
});

describe('presentSteps', () => {
  const steps = [
    { target: 'a', text: '1' },
    { target: 'b', text: '2' },
    { target: 'c', text: '3' },
  ];

  test('skips a step whose block is not drawn and keeps the order', () => {
    expect(presentSteps(steps, (t) => t !== 'b').map((s) => s.text)).toEqual(['1', '3']);
  });

  test('none drawn, no tour', () => {
    expect(presentSteps(steps, () => false)).toEqual([]);
  });
});

describe('help texts', () => {
  const dicts = { ca, en, es, fr } as Record<string, Record<string, string>>;

  test('every concept has its title and text in the four languages', () => {
    for (const [name, dict] of Object.entries(dicts)) {
      const missing = CONCEPTS.flatMap((c) => Object.values(conceptKeys(c))).filter((k) => !dict[k]);
      expect({ [name]: missing }).toEqual({ [name]: [] });
    }
  });

  test('every first-time note and card speaks the four languages', () => {
    const keys = [
      ...EVENTS.map((e) => `help.event.${e}`),
      ...['desk', 'planner'].flatMap((s) => [
        `help.card.${s}`,
        `help.card.${s}_body`,
        `help.card.${s}_step_1`,
        `help.card.${s}_step_2`,
        `help.card.${s}_step_3`,
      ]),
    ];
    for (const [name, dict] of Object.entries(dicts)) {
      expect({ [name]: keys.filter((k) => !dict[k]) }).toEqual({ [name]: [] });
    }
  });
});
