import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { LANGS, orphanKeys, sourceTexts, usedKeys } from './i18n-orphans';

const web = join(import.meta.dirname, '..');
const dict = (lang: string) =>
  JSON.parse(readFileSync(join(web, 'src', 'lib', 'i18n', `${lang}.json`), 'utf8')) as Record<string, string>;

describe('i18n orphans', () => {
  test('no dictionary key is left that nothing in src/ asks for', () => {
    // Fix by deleting the key (`node scripts/i18n-orphans.ts --write`), not
    // by teaching this test to look away.
    expect(orphanKeys(dict('en'), sourceTexts(join(web, 'src')))).toEqual([]);
  });

  test('the four languages hold the same keys', () => {
    const en = Object.keys(dict('en')).sort();
    for (const lang of LANGS) {
      const have = new Set(Object.keys(dict(lang)));
      const theirs = Object.keys(dict(lang));
      expect({ lang, missing: en.filter((k) => !have.has(k)), extra: theirs.filter((k) => !en.includes(k)) }).toEqual({
        lang,
        missing: [],
        extra: [],
      });
    }
  });

  describe('what counts as a use', () => {
    const keys = [
      'a.whole',
      'a.dead',
      'b.anchor_show',
      'b.anchor_wrap',
      'c.status_one',
      'd.done_step_one',
      'd.done_step_other',
      'e.word',
      'e.word@music',
      'f.dead@music',
    ];
    const used = (text: string) => [...usedKeys(keys, [text])].sort();

    test('a key named whole, in any quotes', () => {
      expect(used(`t('a.whole', locale)`)).toEqual(['a.whole']);
      expect(used('{ k: "a.whole" }')).toEqual(['a.whole']);
    });

    test('a template keeps the family behind its static prefix', () => {
      expect(used('t(`b.anchor_${k}`)')).toEqual(['b.anchor_show', 'b.anchor_wrap']);
    });

    test('a concatenation keeps its family', () => {
      expect(used(`t('c.status_' + s)`)).toEqual(['c.status_one']);
    });

    test('a stem that is not a key keeps the keys built on it', () => {
      expect(used(`const W = { step: 'd.done_step' }`)).toEqual(['d.done_step_one', 'd.done_step_other']);
    });

    test('a trade variant lives and dies with its key', () => {
      expect(used(`t('e.word')`)).toEqual(['e.word', 'e.word@music']);
      expect(orphanKeys(Object.fromEntries(keys.map((k) => [k, ''])), [`t('e.word')`])).toContain('f.dead@music');
    });

    test('words that only look like keys do not count', () => {
      expect(used('// a.dead is gone')).toEqual([]);
    });
  });
});
