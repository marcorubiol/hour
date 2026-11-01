import { describe, expect, test } from 'vitest';
import { TEXT_TITLE_MAX, cleanText, sortTexts, textPreview } from './workspace-texts';

describe('cleanText', () => {
  test('trims the title and the edges of the body, keeps its inner lines', () => {
    expect(cleanText('  Condiciones ', '\n  Espacio 8 × 6 m\n\nToma de 32 A\n\n')).toEqual({
      title: 'Condiciones',
      body: '  Espacio 8 × 6 m\n\nToma de 32 A',
    });
  });

  test('refuses an empty part or a title too long', () => {
    expect(cleanText('', 'algo')).toBeNull();
    expect(cleanText('Título', '   \n ')).toBeNull();
    expect(cleanText('x'.repeat(TEXT_TITLE_MAX + 1), 'algo')).toBeNull();
  });
});

test('the preview is the first line with text, cut', () => {
  expect(textPreview('\n\nHola, somos MüK.\nSegunda')).toBe('Hola, somos MüK.');
  expect(textPreview('a'.repeat(100), 10)).toBe(`${'a'.repeat(9)}…`);
});

test('sorted by title, case and accents aside', () => {
  const t = (title: string) => ({ id: title, title, body: 'x', updated_at: '' });
  expect(sortTexts([t('condiciones'), t('Álbum'), t('Bio')]).map((x) => x.title)).toEqual(['Álbum', 'Bio', 'condiciones']);
});
