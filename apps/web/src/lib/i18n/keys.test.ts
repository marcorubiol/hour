/**
 * The dictionaries have no compile-time guard: `t()` takes a plain string
 * and a key that does not exist renders ITSELF on screen, in dotted
 * lowercase, silently. That is not theoretical — renaming the planner's
 * stats strip (2026-08-10) left one call site pointing at a key that had
 * moved, and nothing caught it: not svelte-check, not the unit suite, not
 * the build. A screenshot caught it.
 *
 * So: this file is the guard. It reads what the app actually asks for and
 * checks the three files can answer.
 *
 * Template-literal keys (`desk.anchor_${step}`) are deliberately invisible
 * to it — a regex cannot resolve them, and pretending otherwise would be
 * worse than the honest gap. The vocabularies behind those are small and
 * pinned by the tests of the modules that produce them.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import ca from './ca.json';
import en from './en.json';
import es from './es.json';
import fr from './fr.json';
import { LOCALES } from './index';
import { TRADES } from './trade.svelte';

const SRC = join(import.meta.dirname, '..', '..');

/** Login runs before a session exists, so it never picks a locale — those
    keys live in English only, on purpose (routes/login/+page.svelte). */
const EN_ONLY = new Set(
  Object.keys(en).filter((k) => k.startsWith('login.')),
);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      out.push(...sourceFiles(path));
    } else if (/\.(svelte|ts)$/.test(entry.name) && !/\.(test|spec)\.ts$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

/** `t('some.key'` — never `.at(`, never a template literal. */
const CALL = /(?<![\w.$])t\(\s*['"]([a-z][\w.]*)['"]/g;

function askedKeys(): Map<string, string> {
  const asked = new Map<string, string>();
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(CALL)) {
      if (!asked.has(m[1])) asked.set(m[1], file.slice(SRC.length + 1));
    }
  }
  return asked;
}

describe('i18n keys', () => {
  test('every literal key the app asks for exists in en.json', () => {
    const dict = en as Record<string, string>;
    const missing = [...askedKeys()]
      .filter(([key]) => !(key in dict))
      .map(([key, file]) => `${key} (${file})`);
    expect(missing).toEqual([]);
  });

  /** Every language but the reference one. Adding a dictionary to
      index.ts without listing it here fails the next test. */
  const others = { ca, es, fr } as Record<string, Record<string, string>>;

  test('the app speaks exactly the languages this guard checks', () => {
    expect([...LOCALES].sort()).toEqual(['en', ...Object.keys(others)].sort());
  });

  test('every other language answers everything en does, bar the pre-session screen', () => {
    const expected = Object.keys(en).filter((k) => !EN_ONLY.has(k));
    for (const [name, dict] of Object.entries(others)) {
      const have = new Set(Object.keys(dict));
      expect({ [name]: expected.filter((k) => !have.has(k)) }).toEqual({ [name]: [] });
    }
  });

  test('and none carries a key en has never heard of', () => {
    for (const [name, dict] of Object.entries(others)) {
      const orphans = Object.keys(dict).filter((k) => !(k in en));
      expect({ [name]: orphans }).toEqual({ [name]: [] });
    }
  });

  /** ADR-128: `key@<trade>` is the trade's wording of `key`. A variant of a
      key that does not exist, or of a trade the app does not know, is a typo
      that would never render. */
  test('every trade variant names a known trade and an existing key', () => {
    const dict = en as Record<string, string>;
    const bad = Object.keys(dict)
      .filter((k) => k.includes('@'))
      .filter((k) => {
        const [base, trade] = k.split('@');
        return !(base in dict) || !(TRADES as readonly string[]).includes(trade) || trade === TRADES[0];
      });
    expect(bad).toEqual([]);
  });

  test('a variant keeps the placeholders of its key', () => {
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const [name, dict] of Object.entries({ en, ...others }) as [string, Record<string, string>][]) {
      const off = Object.keys(dict)
        .filter((k) => k.includes('@'))
        .filter((k) => holes(dict[k]).join() !== holes(dict[k.split('@')[0]]).join());
      expect({ [name]: off }).toEqual({ [name]: [] });
    }
  });
});
