import { describe, expect, it } from 'vitest';
import { initials } from './monogram';

describe('el monograma de con quién se habla (ADR-176)', () => {
  it('dos palabras, dos letras; una, la primera; sin nombre, nada', () => {
    expect(initials('Teatre de la Llum')).toBe('TD');
    expect(initials('Mercat de les Flors')).toBe('MD');
    expect(initials('Beckett')).toBe('B');
    expect(initials('«El Periódico»')).toBe('EP');
    expect(initials('  ')).toBe('');
    expect(initials(null)).toBe('');
  });
});
