import { describe, expect, it } from 'vitest';
import { initials } from './monogram';

describe('el monograma de con quién se habla (ADR-176)', () => {
  it('dos palabras con sentido, dos letras; una, la primera; sin nombre, nada', () => {
    expect(initials('Teatre de la Llum')).toBe('TL');
    expect(initials('Mercat de les Flors')).toBe('MF');
    expect(initials("L'Auditori de Girona")).toBe('AG');
    expect(initials('The Place')).toBe('TP');
    expect(initials('Festival Temporada Alta')).toBe('FT');
    expect(initials('Théâtre du Rond-Point')).toBe('TR');
    expect(initials('Beckett')).toBe('B');
    expect(initials('«El Periódico»')).toBe('EP');
    expect(initials('De la')).toBe('DL');
    expect(initials('  ')).toBe('');
    expect(initials(null)).toBe('');
  });
});
