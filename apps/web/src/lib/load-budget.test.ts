/**
 * WHAT A PHONE DOWNLOADS TO OPEN HOY, AS A CAP (ADR-158).
 *
 * The initial load of `/h/desk`: SvelteKit's entry, the three route nodes on
 * the way (root layout, the /h frame, the Desk page), every chunk and
 * stylesheet they import statically, and the dictionary of the language the
 * phone speaks (es; English always ships). Measured in brotli,
 * as Cloudflare serves it.
 *
 * It reads the client build, so it only says something about a fresh one:
 * with no build, or one older than the code, it skips and says so. The
 * deploy script builds and then runs this file with LOAD_BUDGET_REQUIRED=1,
 * where a skip is a failure: nothing goes out over the cap.
 *
 * Where the cap comes from: the build of 2026-11-01 (`claude/mobile-open-speed`,
 * after the per-language dictionaries) loads 427 kB br in 173 files (139 JS,
 * 34 CSS); with the four languages in one chunk it was about 36 kB more. The
 * cap is that plus about 5 %. Same spirit as the tokens guard: if it trips, make
 * the load lighter (split a chunk, lazy-load a dialog), do not raise the cap.
 * Raise it only for a decision that is worth its weight, and say which in the
 * commit.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';
import { describe, expect, test } from 'vitest';

export const LOAD_BUDGET_KB = 450;

const WEB = join(import.meta.dirname, '..', '..');
const CLIENT = join(WEB, '.svelte-kit', 'output', 'client');
const MANIFEST = join(CLIENT, '.vite', 'manifest.json');
const NODES = join(WEB, '.svelte-kit', 'generated', 'client-optimized', 'nodes');
const ROUTE_FILES = ['src/routes/+layout.svelte', 'src/routes/h/+layout.svelte', 'src/routes/h/desk/+page.svelte'];
const DICTIONARY = 'src/lib/i18n/es.json';

type Chunk = { file: string; imports?: string[]; css?: string[]; isEntry?: boolean };

function newestSource(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestSource(path));
    else if (!/\.(test|spec)\.ts$/.test(entry.name)) newest = Math.max(newest, statSync(path).mtimeMs);
  }
  return newest;
}

/** Why the build cannot be judged, or null when it can. */
function staleReason(): string | null {
  if (!existsSync(MANIFEST)) return 'no client build (run `vite build`)';
  if (statSync(MANIFEST).mtimeMs < newestSource(join(WEB, 'src'))) return 'the client build is older than src/';
  return null;
}

/** The manifest key of the generated node that renders `route`. */
function nodeKeyOf(route: string): string {
  const file = readdirSync(NODES).find((f) => readFileSync(join(NODES, f), 'utf8').includes(`/${route}"`));
  if (!file) throw new Error(`no route node renders ${route}`);
  return `.svelte-kit/generated/client-optimized/nodes/${file}`;
}

export function initialLoad(): { files: string[]; kb: number } {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Record<string, Chunk>;
  const roots = [
    ...Object.keys(manifest).filter((k) => manifest[k].isEntry && !k.includes('/nodes/')),
    ...ROUTE_FILES.map(nodeKeyOf),
    DICTIONARY,
  ];
  const files = new Set<string>();
  const seen = new Set<string>();
  const walk = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    const chunk = manifest[key];
    if (!chunk) throw new Error(`not in the manifest: ${key}`);
    files.add(chunk.file);
    for (const css of chunk.css ?? []) files.add(css);
    for (const dep of chunk.imports ?? []) walk(dep);
  };
  roots.forEach(walk);
  let bytes = 0;
  for (const file of files) {
    bytes += brotliCompressSync(readFileSync(join(CLIENT, file)), {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).length;
  }
  return { files: [...files], kb: Math.round(bytes / 1024) };
}

describe('the load of Hoy', () => {
  const reason = staleReason();
  if (reason && process.env.LOAD_BUDGET_REQUIRED) {
    test('a fresh build to judge', () => {
      expect.fail(`LOAD_BUDGET_REQUIRED but ${reason}`);
    });
    return;
  }
  test.skipIf(reason !== null)(`stays under ${LOAD_BUDGET_KB} kB brotli${reason ? ` (skipped: ${reason})` : ''}`, () => {
    const { files, kb } = initialLoad();
    expect(kb, `${files.length} files`).toBeLessThanOrEqual(LOAD_BUDGET_KB);
  });
});
