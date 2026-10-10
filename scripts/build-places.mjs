#!/usr/bin/env node
/**
 * Builds the offline gazetteer the Worker answers `/api/places` from.
 * Travel v2 P2: a stage's zone is KNOWN from the place the person picks,
 * never guessed.
 *
 *   node scripts/build-places.mjs <cities500.txt> <airports.csv> .cache/places <XX.txt>...
 *   scripts/upload-places.sh            # then, to R2 (see that script)
 *
 * The output goes to `.cache/places/`, which is ignored (Marco, 2026-10-10:
 * the index lives in R2 under `places/v1/`, not in the repo), and `vite dev`
 * reads it from there. Attribution and licences:
 * `scripts/places-ATTRIBUTION.txt`, uploaded with it.
 *
 * Inputs (download them by hand; nothing here fetches):
 *   - GeoNames `cities500.zip` → `cities500.txt`: the world, every place over
 *     500 people or seat of a fourth-level division, each with its IANA zone.
 *   - GeoNames per-country dumps `XX.zip` → `XX.txt` for the countries a
 *     company tours (ES FR PT IT AD BE NL LU CH DE GB IE): EVERY populated
 *     place (feature class P), down to the village of 200 that shares a
 *     theatre with the next one.
 *     https://download.geonames.org/export/dump/ · CC BY 4.0, «GeoNames»
 *     (https://www.geonames.org). The app credits it under the candidates.
 *   - `airports.csv` of airportsdata (MIT, © Mike Borsetti)
 *     https://raw.githubusercontent.com/mborsetti/airportsdata/main/airportsdata/airports.csv
 *     Only airports with an IATA code are kept.
 *
 * Output, SHARDED BY PREFIX of each name a place answers to, so a search
 * reads one small file and never the whole gazetteer (a Worker on the free
 * plan has 10 ms of CPU per request; parsing ~35 MB would not fit):
 *   - `s/<prefix>.json`: every place with a name starting with that prefix,
 *     carrying only those names. Two letters to start; a shard over
 *     `MAX_SHARD` bytes splits into three letters, and so on («sa» is every
 *     Saint-… of France). The file name is the prefix in base-36 code points
 *     (`shardName` in `$lib/places`), so any script is a safe name.
 *   - `index.json`: `{ split: [...] }`, the prefixes that were split, so a
 *     search knows how long a prefix to read (`shardFor`).
 *   - `airports.json`: the airports, read only for a code (`LGW`, `LEAL`).
 *
 * Names: the GeoNames name plus its Latin-script alternate names (that is
 * where «Londres», «Saragossa» or «Nova York» come from), normalised with the
 * same `normPlace` the search uses.
 */
import fs from 'node:fs';
import path from 'node:path';
import { normPlace, shardName } from '../apps/web/src/lib/places.ts';

const [citiesPath, airportsPath, outDir, ...countryPaths] = process.argv.slice(2);
if (!citiesPath || !airportsPath || !outDir) {
  console.error('usage: build-places.mjs <cities500.txt> <airports.csv> <outDir> <XX.txt>...');
  process.exit(2);
}

/**
 * Populated places that are not a place to travel to: historical, abandoned,
 * destroyed, and sections of a bigger place (a neighbourhood is not where a
 * train arrives, and it would repeat its city's name and zone).
 */
const SKIP_CODES = new Set(['PPLH', 'PPLQ', 'PPLW', 'PPLX', 'PPLCH']);
const LATIN = /^[\p{Script=Latin}\p{N}\s'’.\-()]+$/u;

const places = [];
function addPlace(f) {
  const [name, ascii, alts, cc, pop, tz] = [f[1], f[2], f[3], f[8], Number(f[14]) || 0, f[17]];
  if (!tz || !cc) return;
  const keys = new Set([normPlace(name), normPlace(ascii)]);
  for (const a of alts ? alts.split(',') : []) {
    if (a && LATIN.test(a) && !/^\d/.test(a)) keys.add(normPlace(a));
  }
  keys.delete('');
  places.push({ name, cc, tz, pop, keys: [...keys] });
}
function* rows(file) {
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) if (line) yield line.split('\t');
}

const touring = countryPaths.map((p) => path.basename(p, '.txt').toUpperCase());
for (const p of countryPaths) for (const f of rows(p)) if (f[6] === 'P' && !SKIP_CODES.has(f[7])) addPlace(f);
for (const f of rows(citiesPath)) if (!touring.includes(f[8])) addPlace(f);

function emptyIndex() {
  return { v: 1, zones: [], cities: { n: [], c: [], z: [], p: [], k: [] }, airports: [], zi: new Map() };
}
function zoneOf(ix, tz) {
  if (!ix.zi.has(tz)) {
    ix.zi.set(tz, ix.zones.length);
    ix.zones.push(tz);
  }
  return ix.zi.get(tz);
}
function save(ix, file) {
  const { zi: _zi, ...out } = ix;
  fs.writeFileSync(file, JSON.stringify(out));
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, 's'), { recursive: true });

/** Bytes a shard may weigh before it splits one letter longer. */
const MAX_SHARD = 200_000;

/** Places (with only the names under `prefix`) → one shard, split if heavy. */
const split = [];
let shardCount = 0;
function emit(prefix, entries) {
  const ix = emptyIndex();
  for (const { pl, keys } of entries) {
    ix.cities.n.push(pl.name);
    ix.cities.c.push(pl.cc);
    ix.cities.z.push(zoneOf(ix, pl.tz));
    ix.cities.p.push(pl.pop);
    ix.cities.k.push(`|${keys.join('|')}|`);
  }
  const { zi: _zi, ...out } = ix;
  const text = JSON.stringify(out);
  if (text.length > MAX_SHARD) {
    const deeper = new Map();
    const here = [];
    const len = [...prefix].length + 1;
    for (const e of entries) {
      for (const k of e.keys) {
        const chars = [...k];
        if (chars.length < len) {
          here.push({ pl: e.pl, keys: [k] });
          continue;
        }
        const pre = chars.slice(0, len).join('');
        if (!deeper.has(pre)) deeper.set(pre, new Map());
        const m = deeper.get(pre);
        if (!m.has(e.pl)) m.set(e.pl, []);
        m.get(e.pl).push(k);
      }
    }
    split.push(prefix);
    // Names exactly as long as the prefix stay findable: they live in the
    // prefix's own file, which now holds only them.
    writeShard(prefix, here);
    for (const [pre, m] of deeper) emit(pre, [...m].map(([pl, keys]) => ({ pl, keys })));
    return;
  }
  fs.writeFileSync(path.join(outDir, 's', `${shardName(prefix)}.json`), text);
  shardCount++;
}
function writeShard(prefix, entries) {
  const ix = emptyIndex();
  for (const { pl, keys } of entries) {
    ix.cities.n.push(pl.name);
    ix.cities.c.push(pl.cc);
    ix.cities.z.push(zoneOf(ix, pl.tz));
    ix.cities.p.push(pl.pop);
    ix.cities.k.push(`|${keys.join('|')}|`);
  }
  save(ix, path.join(outDir, 's', `${shardName(prefix)}.json`));
  shardCount++;
}

const byShard = new Map();
for (const pl of places) {
  const mine = new Map();
  for (const k of pl.keys) {
    const pre = [...k].slice(0, 2).join('');
    if ([...pre].length < 2) continue;
    if (!mine.has(pre)) mine.set(pre, []);
    mine.get(pre).push(k);
  }
  for (const [pre, keys] of mine) {
    if (!byShard.has(pre)) byShard.set(pre, []);
    byShard.get(pre).push({ pl, keys });
  }
}
for (const [pre, entries] of byShard) emit(pre, entries);
fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify({ v: 1, split: split.sort() }));
console.log(`${places.length} places in ${shardCount} shards (${split.length} prefixes split)`);

/** A CSV line with quoted fields (airportsdata quotes every string). */
function csv(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
const air = emptyIndex();
const lines = fs.readFileSync(airportsPath, 'utf8').split('\n');
const head = csv(lines[0]);
const [I_ICAO, I_IATA, I_NAME, I_CITY, I_CC, I_TZ] = ['icao', 'iata', 'name', 'city', 'country', 'tz'].map((c) =>
  head.indexOf(c),
);
for (const line of lines.slice(1)) {
  if (!line) continue;
  const f = csv(line);
  if (!f[I_IATA] || !f[I_TZ]) continue;
  air.airports.push([f[I_IATA], f[I_ICAO], f[I_NAME], f[I_CITY], f[I_CC], zoneOf(air, f[I_TZ])]);
}
save(air, path.join(outDir, 'airports.json'));
console.log(`${air.airports.length} airports → ${outDir}`);
