import { describe, it, expect } from 'vitest';
import { deriveInitials, markText, MONOGRAM_MAX } from './identity';

describe('deriveInitials', () => {
  it('takes the first letter of up to 3 words, upper-cased', () => {
    expect(deriveInitials('Memorias del agua')).toBe('MDA');
    expect(deriveInitials('one two three four')).toBe('OTT'); // capped at MONOGRAM_MAX
  });

  it('takes the first two chars of a single word (first upper)', () => {
    expect(deriveInitials('MaMeMi')).toBe('Ma');
    expect(deriveInitials('Zero')).toBe('Ze');
  });

  it('preserves diacritics', () => {
    expect(deriveInitials('Última órbita')).toBe('ÚÓ');
  });

  it('falls back to a dot for empty / nullish names', () => {
    expect(deriveInitials('')).toBe('·');
    expect(deriveInitials('   ')).toBe('·');
    expect(deriveInitials(null)).toBe('·');
    expect(deriveInitials(undefined)).toBe('·');
  });

  it('never exceeds MONOGRAM_MAX', () => {
    expect(deriveInitials('alpha beta gamma delta').length).toBeLessThanOrEqual(MONOGRAM_MAX);
  });
});

describe('markText', () => {
  it('prefers the stored monogram over the derived one', () => {
    expect(markText({ initials: 'MdA', name: 'Memorias del agua' })).toBe('MdA');
  });

  it('is case-sensitive — stored value wins verbatim', () => {
    expect(markText({ initials: 'MdM', name: 'x' })).toBe('MdM');
    expect(markText({ initials: 'MDM', name: 'x' })).toBe('MDM');
  });

  it('derives from the name when initials are blank / null', () => {
    expect(markText({ initials: '   ', name: 'Memorias del agua' })).toBe('MDA');
    expect(markText({ initials: null, name: 'MaMeMi' })).toBe('Ma');
    expect(markText({ name: 'Cuaderno cero' })).toBe('CC');
  });
});
