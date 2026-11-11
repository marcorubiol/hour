/**
 * Dictionary keys nothing in `src/` asks for (tarea 133).
 *
 * `keys.test.ts` guards the other direction: a key the app asks for that the
 * dictionaries cannot answer. This one finds the dead weight: a key that no
 * source file names, so a translator keeps it alive for nobody.
 *
 * A key counts as used when:
 * - a source file names it whole, in quotes or backticks (`t('x.y')`, a map
 *   `{ venue: 'peek.kind_venue' }`);
 * - a template builds it from a static prefix (`t(\`desk.anchor_${k}\`)`) or a
 *   string is concatenated onto one (`'books.status_' + s`): the whole family
 *   behind that prefix is kept, since a regex cannot know which members run;
 * - a quoted string that is not a key itself is the stem of keys
 *   (`'bulk.done_next_step'` + `_one`): that family is kept too;
 * - it is `key@<trade>` and `key` is used (ADR-129).
 *
 * The rule leans on keeping: a family is only as dead as its prefix.
 *
 * Run: `node scripts/i18n-orphans.ts` lists them; `--write` removes them from
 * the four dictionaries.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const LANGS = ['en', 'es', 'ca', 'fr'] as const;

/** Every .svelte/.ts/.js file under `dir`, tests left out: a key only a
    test names is not a key the app uses. */
export function sourceTexts(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      out.push(...sourceTexts(path));
    } else if (/\.(svelte|ts|js)$/.test(entry.name) && !/\.(test|spec)\.(ts|js)$/.test(entry.name)) {
      out.push(readFileSync(path, 'utf8'));
    }
  }
  return out;
}

const QUOTED = /['"`]([a-z][\w]*\.[\w.@]+)['"`]/g;
const TEMPLATE_PREFIX = /`([a-z][\w]*\.[\w.]*)\$\{/g;
const CONCAT_PREFIX = /['"]([a-z][\w]*\.[\w.]*)['"]\s*\+/g;

/** The keys of `keys` that some text uses, by the rules above. */
export function usedKeys(keys: readonly string[], texts: readonly string[]): Set<string> {
  const keySet = new Set(keys);
  const whole = new Set<string>();
  const prefixes = new Set<string>();
  for (const text of texts) {
    for (const m of text.matchAll(QUOTED)) {
      if (keySet.has(m[1])) whole.add(m[1]);
      else prefixes.add(m[1].endsWith('.') || m[1].endsWith('_') ? m[1] : `${m[1]}_`);
    }
    for (const m of text.matchAll(TEMPLATE_PREFIX)) prefixes.add(m[1]);
    for (const m of text.matchAll(CONCAT_PREFIX)) prefixes.add(m[1]);
  }
  const stems = [...prefixes];
  const used = new Set<string>();
  for (const key of keys) {
    const base = key.split('@')[0];
    if (whole.has(base) || stems.some((p) => base.startsWith(p))) used.add(key);
  }
  return used;
}

/** Keys of `dict` nothing in `texts` uses, sorted. */
export function orphanKeys(dict: Record<string, string>, texts: readonly string[]): string[] {
  const keys = Object.keys(dict);
  const used = usedKeys(keys, texts);
  return keys.filter((k) => !used.has(k)).sort();
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const web = join(import.meta.dirname, '..');
  const i18n = join(web, 'src', 'lib', 'i18n');
  const read = (lang: string) => JSON.parse(readFileSync(join(i18n, `${lang}.json`), 'utf8')) as Record<string, string>;
  const orphans = orphanKeys(read('en'), sourceTexts(join(web, 'src')));
  for (const key of orphans) console.log(key);
  console.log(`${orphans.length} orphan keys`);
  if (process.argv.includes('--write')) {
    const dead = new Set(orphans);
    for (const lang of LANGS) {
      const dict = read(lang);
      const kept = Object.fromEntries(Object.entries(dict).filter(([k]) => !dead.has(k)));
      writeFileSync(join(i18n, `${lang}.json`), `${JSON.stringify(kept, null, 2)}\n`);
    }
    console.log('removed from', LANGS.join(', '));
  }
}
