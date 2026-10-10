#!/usr/bin/env node
/**
 * Directorio global de salas, step 1 of 3: download the public sources.
 *
 *   node scripts/venue-directory/fetch.mjs [--only=wikidata] # → .cache/venue-directory/raw/
 *   node scripts/venue-directory/build.mjs        # → .cache/venue-directory/out/
 *   psql … -f .cache/venue-directory/out/load.sql # the load (service role / postgres)
 *
 * Everything lands in `.cache/` (ignored): the raw data never goes to the
 * repo. Nothing downloaded is executed; build.mjs only parses it as data.
 * Each source has its own folder. The sizes are printed, for the record.
 *
 * Sources and licences (the credits page reads them from
 * `venue_directory_source`, which load.sql fills):
 *   - Basilic, Ministère de la Culture (data.gouv.fr), Licence Ouverte 2.0.
 *   - Equipaments culturals de Catalunya (Generalitat, dataset 48s6-82h2),
 *     Llicència oberta d'ús d'informació de Catalunya.
 *   - Junta de Castilla y León: Red de Teatros and Red de Circuitos
 *     Escénicos, CC BY 4.0. (Castilla-La Mancha is CC BY-SA: NOT used.)
 *   - Wikidata (SPARQL), CC0: the rest of Spain, and the QID bridge.
 *   - GeoNames (ES, FR, cities500), CC BY 4.0: only to derive each venue's
 *     IANA zone (and, for Wikidata, its region) from its coordinates.
 * OpenStreetMap is NOT used in this phase (Marco, 2026-10-10).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const RAW = path.resolve(flag('raw') ?? '.cache/venue-directory/raw');
/** `--only=wikidata` (or a folder: basilic, gencat, cyl, geonames) re-fetches just that. */
const ONLY = flag('only');
const UA = 'HourVenueDirectory/0.1 (+https://hour.zerosense.studio; marcorubiol@gmail.com)';

export const DOWNLOADS = [
  {
    file: 'basilic/basilic.csv',
    url: 'https://static.data.gouv.fr/resources/base-des-lieux-et-equipements-culturels-basilic/20260218-084338/base-des-lieux-et-des-equipements-culturels.csv',
  },
  // Metadata, only for the date of each dataset (the credits page shows it).
  { file: 'basilic/meta.json', url: 'https://www.data.gouv.fr/api/1/datasets/base-des-lieux-et-equipements-culturels-basilic/' },
  { file: 'gencat/meta.json', url: 'https://analisi.transparenciacatalunya.cat/api/views/48s6-82h2.json' },
  { file: 'cyl/red_teatros.meta.json', url: 'https://analisis.datosabiertos.jcyl.es/api/explore/v2.1/catalog/datasets/red_teatros' },
  {
    file: 'cyl/espacios-circuitos-escenicos.meta.json',
    url: 'https://analisis.datosabiertos.jcyl.es/api/explore/v2.1/catalog/datasets/espacios-circuitos-escenicos',
  },
  { file: 'gencat/equipaments.csv', url: 'https://analisi.transparenciacatalunya.cat/resource/48s6-82h2.csv?$limit=50000' },
  {
    file: 'cyl/red_teatros.json',
    url: 'https://analisis.datosabiertos.jcyl.es/api/explore/v2.1/catalog/datasets/red_teatros/exports/json',
  },
  {
    file: 'cyl/espacios-circuitos-escenicos.json',
    url: 'https://analisis.datosabiertos.jcyl.es/api/explore/v2.1/catalog/datasets/espacios-circuitos-escenicos/exports/json',
  },
  { file: 'geonames/ES.zip', url: 'https://download.geonames.org/export/dump/ES.zip' },
  { file: 'geonames/FR.zip', url: 'https://download.geonames.org/export/dump/FR.zip' },
  { file: 'geonames/cities500.zip', url: 'https://download.geonames.org/export/dump/cities500.zip' },
];

/**
 * Wikidata: venues in Spain (P17 = Q29) with coordinates, whose DIRECT class
 * is a stage or a polyvalent/cultural house, not dissolved (P576) nor closed
 * (P3999). Bullrings, Roman theatres, nightclubs and residencies are out by
 * construction (they are other classes), and an item that is ALSO one of
 * those is dropped in build.mjs.
 */
export const WIKIDATA_CLASSES = {
  Q24354: 'theatre', // theatre building
  Q2720855: 'theatre', // corral de comedias
  Q153562: 'opera', // opera house
  Q1954948: 'opera', // musical theater building
  Q1060829: 'concert_hall',
  Q3469910: 'auditorium', // performing arts center
  Q230752: 'auditorium',
  Q112688641: 'auditorium', // performance hall
  Q1763828: 'multipurpose', // multi-purpose hall
  Q1329623: 'cultural_centre',
  Q5061188: 'cultural_centre', // house of culture
  Q1435490: 'cultural_centre', // people's house
  Q2190251: 'cultural_centre', // arts center
  Q110203714: 'cultural_centre', // municipal arts centre
  Q16889960: 'arena', // circus building
};
export const WIKIDATA_EXCLUDE = [
  'Q1193438', 'Q130314383', 'Q130314369', 'Q130314575', // bullrings
  'Q19757', 'Q7362268', 'Q54831', 'Q839954', // Roman theatre/amphitheatre, amphitheatre, archaeological site
  'Q622425', 'Q51167626', 'Q117531692', 'Q117599782', 'Q253275', 'Q1974804',
];

function wikidataQuery() {
  const cls = Object.keys(WIKIDATA_CLASSES).map((q) => `wd:${q}`).join(' ');
  const ex = WIKIDATA_EXCLUDE.map((q) => `wd:${q}`).join(' ');
  return `SELECT ?item ?t ?coord ?es ?ca ?gl ?eu ?en ?muni ?postal ?addr ?cap ?web ?useLabel WHERE {
  VALUES ?t { ${cls} }
  ?item wdt:P31 ?t ; wdt:P17 wd:Q29 ; wdt:P625 ?coord .
  FILTER NOT EXISTS { ?item wdt:P576 [] }
  FILTER NOT EXISTS { ?item wdt:P3999 [] }
  FILTER NOT EXISTS { VALUES ?x { ${ex} } ?item wdt:P31 ?x }
  OPTIONAL { ?item rdfs:label ?es FILTER(lang(?es) = "es") }
  OPTIONAL { ?item rdfs:label ?ca FILTER(lang(?ca) = "ca") }
  OPTIONAL { ?item rdfs:label ?gl FILTER(lang(?gl) = "gl") }
  OPTIONAL { ?item rdfs:label ?eu FILTER(lang(?eu) = "eu") }
  OPTIONAL { ?item rdfs:label ?en FILTER(lang(?en) = "en") }
  OPTIONAL { ?item wdt:P131+ ?muni . ?muni wdt:P31/wdt:P279* wd:Q2074737 }
  OPTIONAL { ?item wdt:P281 ?postal }
  OPTIONAL { ?item wdt:P6375 ?addr }
  OPTIONAL { ?item wdt:P1083 ?cap }
  OPTIONAL { ?item wdt:P856 ?web }
  OPTIONAL { ?item wdt:P5817 ?use }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,es". ?use rdfs:label ?useLabel . }
}`;
}

/** The municipalities' names in Spanish, Catalan and Galician, by QID. */
function municipalityQuery(qids) {
  return `SELECT ?muni ?es ?ca ?gl WHERE {
  VALUES ?muni { ${qids.map((q) => `wd:${q}`).join(' ')} }
  OPTIONAL { ?muni rdfs:label ?es FILTER(lang(?es) = "es") }
  OPTIONAL { ?muni rdfs:label ?ca FILTER(lang(?ca) = "ca") }
  OPTIONAL { ?muni rdfs:label ?gl FILTER(lang(?gl) = "gl") }
}`;
}

const sparql = (query) => ({
  method: 'POST',
  headers: { accept: 'application/sparql-results+json', 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ query }).toString(),
});

async function download(url, file, init = {}) {
  const dest = path.join(RAW, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let res;
  for (let attempt = 1; ; attempt++) {
    res = await fetch(url, { ...init, headers: { 'user-agent': UA, ...(init.headers ?? {}) } });
    // Wikidata answers 429 when queried too often: wait what it asks, then retry.
    if (res.status !== 429 || attempt === 4) break;
    const wait = Number(res.headers.get('retry-after')) || 30 * attempt;
    console.log(`429 from ${new URL(url).host}, waiting ${wait}s`);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  console.log(`${String(buf.length).padStart(10)}  ${file}  ← ${url.slice(0, 110)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const d of DOWNLOADS) if (!ONLY || d.file.startsWith(`${ONLY}/`)) await download(d.url, d.file);
  const q = wikidataQuery();
  if (!ONLY || ONLY === 'wikidata') {
    await download('https://query.wikidata.org/sparql', 'wikidata/es.json', sparql(q));
    const es = JSON.parse(fs.readFileSync(path.join(RAW, 'wikidata/es.json'), 'utf8'));
    const munis = [...new Set(es.results.bindings.filter((b) => b.muni).map((b) => b.muni.value.split('/').pop()))];
    await download('https://query.wikidata.org/sparql', 'wikidata/municipalities.json', sparql(municipalityQuery(munis)));
  }
  fs.writeFileSync(path.join(RAW, 'fetched_at.txt'), new Date().toISOString() + '\n');
  const geo = path.join(RAW, 'geonames');
  if (!ONLY || ONLY === 'geonames') for (const z of ['ES.zip', 'FR.zip', 'cities500.zip']) {
    execFileSync('unzip', ['-o', '-q', path.join(geo, z), z.replace('.zip', '.txt'), '-d', geo]);
  }
}
