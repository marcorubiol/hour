/**
 * The guard of the named cuts ($lib/breakpoints, tarea 134). A media query
 * cannot read a custom property, so the width of every `@media` in a
 * component or a shared stylesheet is written by hand; this test keeps those
 * widths on the three cuts the app has (mobile under 48rem, wide from 64rem,
 * the rail's, and two panes from 75rem). Any other width is allowed only with
 * its reason written right above it, in a comment that says `cut:` (the
 * login's two columns). Container queries measure their own box and are not cuts of the
 * screen: they are left alone.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { MOBILE_QUERY, MOBILE_UNDER, TWO_PANES_FROM, WIDE_FROM } from '$lib/breakpoints';

const SRC = join(import.meta.dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walk(path, out);
    } else if (/\.(svelte|css)$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

/** The cuts a query may use without a reason: each side of each named cut. */
const NAMED = new Set([
  `max-width:${MOBILE_QUERY.match(/max-width:\s*([\d.]+rem)/)![1]}`,
  `min-width:${MOBILE_UNDER}`,
  `min-width:${WIDE_FROM}`,
  `max-width:${(parseFloat(WIDE_FROM) - 0.001).toFixed(3)}rem`,
  `min-width:${TWO_PANES_FROM}`,
  `max-width:${(parseFloat(TWO_PANES_FROM) - 0.001).toFixed(3)}rem`,
]);

/** How many lines above a query its `cut:` comment may start. */
const REASON_REACH = 6;

interface Finding {
  where: string;
  what: string;
}

function findings(): Finding[] {
  const out: Finding[] = [];
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8');
    if (!text.includes('@media')) continue;
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      const at = line.indexOf('@media');
      if (at < 0) return;
      // A string in script (a mail's own stylesheet) is not one of ours.
      if (/['"`]\s*@media|replace\(/.test(line)) return;
      const widths = [...line.matchAll(/\((min|max)-width:\s*([\d.]+)(rem|px|em)\)/g)];
      for (const [, side, n, unit] of widths) {
        if (NAMED.has(`${side}-width:${n}${unit}`)) continue;
        const above = lines.slice(Math.max(0, i - REASON_REACH), i).join('\n');
        if (/cut:/.test(above)) continue;
        out.push({
          where: `${file.slice(SRC.length + 1)}:${i + 1}`,
          what: `${side}-width: ${n}${unit} is neither a named cut nor explained by a «cut:» comment`,
        });
      }
    });
  }
  return out;
}

describe('media query cuts', () => {
  test('every screen cut is a named one, or says why it is not', () => {
    expect(findings()).toEqual([]);
  });

  test('the named cuts are the ones the script reads', () => {
    expect(NAMED).toEqual(
      new Set([
        'max-width:47.999rem',
        'min-width:48rem',
        'min-width:64rem',
        'max-width:63.999rem',
        'min-width:75rem',
        'max-width:74.999rem',
      ]),
    );
  });
});
