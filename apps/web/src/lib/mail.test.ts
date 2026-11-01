import { describe, expect, test } from 'vitest';
import { insertBlock, materialLine } from './mail';

describe('insertBlock (ADR-169, punto 89)', () => {
  test('into an empty body, the line alone', () => {
    expect(insertBlock('', 'Rider: https://x.example/r.pdf')).toEqual({
      text: 'Rider: https://x.example/r.pdf',
      caret: 30,
    });
  });

  test('at the end of a body, on its own line', () => {
    expect(insertBlock('Hola,', 'L').text).toBe('Hola,\nL');
  });

  test('at the caret in the middle, on its own line', () => {
    const r = insertBlock('Hola, aquí va. Un abrazo', 'L', 14);
    expect(r.text).toBe('Hola, aquí va.\nL\n Un abrazo');
    expect(r.caret).toBe(16);
  });

  test('replacing a selection', () => {
    expect(insertBlock('a\nXX\nb', 'L', 2, 4).text).toBe('a\nL\nb');
  });

  test('the line says what and where', () => {
    expect(materialLine('Rider', 'https://x.example/r.pdf')).toBe('Rider: https://x.example/r.pdf');
  });
});
