import { describe, expect, test } from 'vitest';
import { matchPeople } from './persons';

const people = [
  { person_id: 'a', full_name: 'Anouk Llaurens' },
  { person_id: 'b', full_name: 'Loïs Dupont' },
  { person_id: 'c', full_name: 'Anna Ribas' },
];

describe('matchPeople (ADR-107)', () => {
  test('nothing typed: everybody, and nothing to add', () => {
    expect(matchPeople(people, '  ')).toEqual({ matches: people, canAdd: false });
  });

  test('matches every word, in any order, without case or accents', () => {
    expect(matchPeople(people, 'lois').matches.map((p) => p.person_id)).toEqual(['b']);
    expect(matchPeople(people, 'ribas an').matches.map((p) => p.person_id)).toEqual(['c']);
    expect(matchPeople(people, 'an').matches.map((p) => p.person_id)).toEqual(['a', 'c']);
  });

  test('a name that is nobody yet is offered to add, even with partial matches', () => {
    expect(matchPeople(people, 'Ann')).toMatchObject({ canAdd: true });
    expect(matchPeople(people, 'Manou')).toEqual({ matches: [], canAdd: true });
  });

  test('a name that is exactly somebody is not offered again', () => {
    expect(matchPeople(people, 'anouk  LLAURENS').canAdd).toBe(false);
    expect(matchPeople(people, 'Lois Dupont').canAdd).toBe(false);
  });
});
