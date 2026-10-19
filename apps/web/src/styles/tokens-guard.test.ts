/**
 * The guard of the rule of values (tokens.css, header). A theme can only
 * repaint what reads a token: a colour written in a component, a 9px, a
 * 0.1em or a `var(--primary)` is a place the theme never reaches. The
 * cleanup of 2026-10-19 (build/plans/2026-10-19-cleanup.md) moved ~1.000 of
 * those into tokens; this test keeps the count at zero.
 *
 * It reads every `<style>` block of every .svelte under src and the shared
 * stylesheets in src/styles (tokens.css excluded: that is where values
 * live). It is a scanner, not a CSS parser: declarations are matched by
 * regex after comments and query preludes are stripped, which is exactly
 * enough for a rule that is about VALUES, never about selectors.
 *
 * The escape, written and visible: a declaration carrying the comment
 * `/* material *\/` is a drawn pattern or a measured shadow the rule
 * allows (rule 8d) and the test skips. Nothing else is skipped.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const SRC = join(import.meta.dirname, '..');
const STYLES = join(SRC, 'styles');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walk(path, out);
    } else if (entry.name.endsWith('.svelte')) {
      out.push(path);
    }
  }
  return out;
}

interface Block {
  file: string;
  css: string;
  /** Line of the file where the block starts (1-based). */
  line: number;
}

function blocksOf(file: string): Block[] {
  const text = readFileSync(file, 'utf8');
  const rel = file.slice(SRC.length + 1);
  if (file.endsWith('.css')) return [{ file: rel, css: text, line: 1 }];
  const out: Block[] = [];
  for (const m of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    const start = m.index! + m[0].indexOf(m[1]);
    out.push({ file: rel, css: m[1], line: text.slice(0, start).split('\n').length });
  }
  return out;
}

const MATERIAL = '__material__';

/** Comments out, the escape marker kept, query preludes blanked (their px
 *  are breakpoints, rule 8a), line count preserved. */
function clean(css: string): string {
  return css
    .replace(/\/\*\s*material\s*\*\//g, MATERIAL)
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/@(media|container)[^{]*/g, (q) => q.replace(/[^\n]/g, ' '));
}

interface Finding {
  where: string;
  what: string;
}

const PX_OK_PROPS = new Set([
  // optical nudges of a drawn stroke (rule 8b), at most 4px
  'transform',
  'translate',
  'vertical-align',
  'text-underline-offset',
  'outline-offset',
  'inset',
  'inset-block',
  'inset-inline',
  'inset-block-start',
  'inset-block-end',
  'inset-inline-start',
  'inset-inline-end',
  'top',
  'left',
  'right',
  'bottom',
  // drawn material (rule 8d)
  'background',
  'background-image',
  'background-size',
  'background-position',
  'mask',
  'mask-image',
  'mask-size',
  'mask-position',
  '-webkit-mask-image',
  '-webkit-mask-size',
  'backdrop-filter',
  'filter',
]);
const NUDGE_MAX = 4;

const BASE_HUE = /var\(--(primary|neutral|base|white|black)(?:-[a-z-]+)?\)/;
const LITERAL_COLOUR = /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?)\(|\b(oklch|oklab)\((?!\s*from\s+var\(|\s*var\()/i;
const MIXED_WITH_WORD = /color-mix\([^)]*\b(white|black)\b/i;

function scan(block: Block): Finding[] {
  const out: Finding[] = [];
  const css = clean(block.css);
  const decl = /(?:^|[;{]|\n)\s*(-{0,2}[a-zA-Z][\w-]*)\s*:([^;{}]*)(?=;|\n\s*\})/g;
  for (const m of css.matchAll(decl)) {
    const prop = m[1].toLowerCase();
    const value = m[2];
    if (prop === 'src' || prop === 'content' || prop === 'grid-area' || prop === 'grid-column' || prop === 'grid-row') continue;
    const line = block.line + css.slice(0, m.index! + m[0].indexOf(m[1])).split('\n').length - 1;
    const where = `${block.file}:${line}`;
    const material = value.includes(MATERIAL);
    const say = (what: string) => out.push({ where, what: `${prop}: ${value.replace(MATERIAL, '').trim()}  (${what})` });

    if (BASE_HUE.test(value)) say('a base hue; read a contextual token');
    if (LITERAL_COLOUR.test(value)) say('a literal colour');
    if (MIXED_WITH_WORD.test(value)) say('mixed with white/black; mix with a token');
    if (prop === '--chip-bg-image' || material) continue;

    if (prop === 'font-size' && /\d(px|rem)\b/.test(value)) say('type is never px or rem; the scale or em');
    if (prop === 'letter-spacing' && /\d(em|px|rem)\b/.test(value)) say('tracking from --tracking-*');
    if (prop === 'font-family' && !/var\(--|inherit/.test(value)) say('a font family that is not a token');
    if ((prop === 'transition' || prop === 'animation' || prop.endsWith('-duration') || prop.endsWith('-delay')) &&
      /(?<![\w.-])(?!0s\b|0\.0\d*m?s\b)\d*\.?\d+(ms|s)\b/.test(value)) say('a duration from --duration-* or --transition');
    if (prop === 'z-index') {
      const n = Number(value.trim());
      if (!Number.isNaN(n) && n >= 20) say('z-index 20+ takes the --z-* scale');
    }
    if (prop === 'box-shadow' && /\dpx/.test(value)) say('a shadow from --box-shadow-* (a ring is 0 0 0 var(--line-*))');

    const pxs = [...value.matchAll(/(?<![\w.-])(-?\d*\.?\d+)px\b/g)].map((x) => Number(x[1]));
    if (pxs.length === 0) continue;
    if (pxs.every((n) => n === 0)) continue;
    if (/gradient\(/.test(value)) continue;
    if (prop.startsWith('--')) {
      say('a component contract holds a px; give it a token or a rem');
      continue;
    }
    if (PX_OK_PROPS.has(prop)) {
      if (prop.startsWith('background') || prop.includes('mask') || prop.endsWith('filter')) continue;
      if (pxs.every((n) => Math.abs(n) <= NUDGE_MAX)) continue;
      say(`a nudge over ${NUDGE_MAX}px; a token or a rem`);
      continue;
    }
    if (prop === 'box-shadow') continue; // already said
    say('a px outside the rule');
  }
  return out;
}

describe('the rule of values (tokens.css)', () => {
  const files = [
    ...walk(SRC),
    ...readdirSync(STYLES)
      .filter((f) => f.endsWith('.css') && f !== 'tokens.css')
      .map((f) => join(STYLES, f)),
  ];

  test('no component holds a value the theme cannot reach', () => {
    const findings = files.flatMap((f) => blocksOf(f).flatMap(scan));
    expect(findings.map((f) => `${f.where}  ${f.what}`)).toEqual([]);
  });

  test('!important only where the reset must win', () => {
    const offenders = files
      .filter((f) => !f.endsWith('/styles/base.css'))
      .flatMap((f) => blocksOf(f))
      .filter((b) => /!important/.test(clean(b.css)))
      .map((b) => b.file);
    expect(offenders).toEqual([]);
  });
});
