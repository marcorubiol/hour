import { describe, expect, test } from 'vitest';
import {
  firstName,
  knownAmong,
  knownByLabel,
  knownTitle,
  namesList,
  NOT_KNOWN,
  type AcquaintanceView,
} from './acquaintance';

const WS = 'ws-1';
const view: AcquaintanceView = {
  me: 'me',
  items: [
    { workspace_id: WS, person_id: 'ines', user_id: 'me', shared: false },
    { workspace_id: WS, person_id: 'ines', user_id: 'anouk', shared: true },
    { workspace_id: WS, person_id: 'pau', user_id: 'marco', shared: true },
    { workspace_id: WS, person_id: 'pau', user_id: 'anouk', shared: true },
    { workspace_id: WS, person_id: 'lia', user_id: 'me', shared: true },
    // Sin compartir, de otro: la RLS no la deja pasar, pero si llega no cuenta.
    { workspace_id: WS, person_id: 'lia', user_id: 'marco', shared: false },
    // Otro espacio, misma persona.
    { workspace_id: 'ws-2', person_id: 'ines', user_id: 'marco', shared: true },
    // Un dueño que ya no comparte espacio: sin nombre.
    { workspace_id: WS, person_id: 'ona', user_id: 'gone', shared: true },
  ],
  names: { me: 'Yo Mismo', anouk: 'Anouk Vidal', marco: 'Marco Rubiol' },
};

describe('knownAmong', () => {
  test('mine, unshared, with someone else who shares it', () => {
    expect(knownAmong(view, WS, ['ines'])).toEqual({ mine: true, shared: false, others: ['Anouk'] });
  });

  test('not mine: only the others, by first name, sorted, once', () => {
    expect(knownAmong(view, WS, ['pau'])).toEqual({ mine: false, shared: false, others: ['Anouk', 'Marco'] });
    expect(knownAmong(view, WS, ['pau', 'ines']).others).toEqual(['Anouk', 'Marco']);
  });

  test('a row: known if any contact is; shared if any of my marks is', () => {
    expect(knownAmong(view, WS, ['pau', 'lia'])).toEqual({ mine: true, shared: true, others: ['Anouk', 'Marco'] });
  });

  test('another unshared mark, another workspace and a nameless owner do not count', () => {
    expect(knownAmong(view, WS, ['lia']).others).toEqual([]);
    expect(knownAmong(view, 'ws-2', ['ines'])).toEqual({ mine: false, shared: false, others: ['Marco'] });
    expect(knownAmong(view, WS, ['ona'])).toBe(NOT_KNOWN);
  });

  test('nothing to say', () => {
    expect(knownAmong(view, WS, [])).toBe(NOT_KNOWN);
    expect(knownAmong(null, WS, ['ines'])).toBe(NOT_KNOWN);
    expect(knownAmong(view, WS, ['nobody'])).toBe(NOT_KNOWN);
  });
});

describe('names', () => {
  test('first name', () => {
    expect(firstName('  Marco   Rubiol ')).toBe('Marco');
    expect(firstName('Anouk')).toBe('Anouk');
  });

  test('the list of the language', () => {
    expect(namesList(['Marco'], 'es')).toBe('Marco');
    expect(namesList(['Marco', 'Anouk'], 'es')).toBe('Marco y Anouk');
    expect(namesList(['Marco', 'Anouk'], 'ca')).toBe('Marco i Anouk');
    expect(namesList(['Marco', 'Anouk'], 'fr')).toBe('Marco et Anouk');
    expect(namesList(['Anouk', 'Marco', 'Pau'], 'en')).toBe('Anouk, Marco and Pau');
  });
});

describe('labels', () => {
  test('known by, one or many', () => {
    expect(knownByLabel([], 'es')).toBeNull();
    expect(knownByLabel(['Marco'], 'es')).toBe('La conoce Marco');
    expect(knownByLabel(['Anouk', 'Marco'], 'es')).toBe('La conocen Anouk y Marco');
    expect(knownByLabel(['Marco'], 'fr')).toBe('Marco la connaît');
  });

  test('the row tooltip says mine first, then the others', () => {
    expect(knownTitle(NOT_KNOWN, 'es')).toBeNull();
    expect(knownTitle({ mine: true, shared: false, others: [] }, 'es')).toBe('La conoces');
    expect(knownTitle({ mine: true, shared: true, others: ['Anouk'] }, 'es')).toBe('La conoces. La conoce Anouk');
    expect(knownTitle({ mine: false, shared: false, others: ['Anouk', 'Marco'] }, 'en')).toBe('Known by Anouk and Marco');
  });
});
