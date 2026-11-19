import { describe, expect, test } from 'vitest';
import { foldKeeps, jsonSummary, passEyebrow, passFigure, passWhenWord, peopleSummary, showStartAt } from './pass-read';

describe('passWhenWord / passEyebrow', () => {
  test('the day counted from today', () => {
    expect(passWhenWord('2026-11-18', '2026-11-18', 'es')).toBe('hoy');
    expect(passWhenWord('2026-11-18', '2026-11-19', 'es')).toBe('mañana');
    expect(passWhenWord('2026-11-18', '2026-11-17', 'es')).toBe('ayer');
    expect(passWhenWord('2026-11-18', '2026-11-21', 'es')).toBe('en 3 días');
    expect(passWhenWord('2026-11-18', '2026-11-14', 'es')).toBe('hace 4 días');
  });
  test('a timestamp is read by its day', () => {
    expect(passEyebrow('Función', '2026-11-18', '2026-11-21T19:30:00Z', 'es')).toBe('Función · en 3 días');
  });
});

describe('passFigure', () => {
  test('the hour on the venue clock', () => {
    expect(passFigure('2026-11-21T19:30:00Z', 'Europe/Madrid')).toBe('20:30');
  });
  test('no start, or a broken one, says nothing', () => {
    expect(passFigure(null, 'Europe/Madrid')).toBeNull();
    expect(passFigure('nope', 'Europe/Madrid')).toBeNull();
  });
});

describe('showStartAt', () => {
  test('the field first, else the running order\'s start', () => {
    expect(showStartAt({ start_at: 'A', moments: [{ kind: 'start', at: 'B' }] })).toBe('A');
    expect(showStartAt({ start_at: null, moments: [{ kind: 'load_in', at: 'L' }, { kind: 'start', at: 'B' }] })).toBe('B');
    expect(showStartAt({ start_at: null, moments: [] })).toBeNull();
    expect(showStartAt(null)).toBeNull();
  });
});

describe('peopleSummary', () => {
  test('with and without contact data', () => {
    expect(peopleSummary(5, true, 'es')).toBe('5 personas, con su teléfono');
    expect(peopleSummary(1, false, 'es')).toBe('1 persona, nombre y oficio');
  });
});

describe('jsonSummary', () => {
  test('first filled keys, humanised, cut at max', () => {
    expect(jsonSummary({ stage_size: '10x8', empty: '', rider: 'x', plot: 'y', extra: 'z' })).toBe('Stage size · Rider · Plot …');
    expect(jsonSummary({ parking: 'si' })).toBe('Parking');
  });
  test('lists count, scalars say themselves, empty is empty', () => {
    expect(jsonSummary([1, 2])).toBe('2');
    expect(jsonSummary('Furgo')).toBe('Furgo');
    expect(jsonSummary({})).toBe('');
    expect(jsonSummary(null)).toBe('');
  });
});

describe('foldKeeps', () => {
  test('joins what is there', () => {
    expect(foldKeeps('Rider', '', null, 'Plano')).toBe('Rider · Plano');
  });
});
