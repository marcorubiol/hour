#!/usr/bin/env node
/**
 * Directorio global de salas, step 2 of 3: from the raw sources (fetch.mjs)
 * to one deduplicated list and the SQL that loads it.
 *
 *   node scripts/venue-directory/build.mjs [rawDir] [outDir]
 *     rawDir default .cache/venue-directory/raw
 *     outDir default .cache/venue-directory/out  → load.sql, rows.json, report.json
 *
 * Reads the downloads as DATA only (CSV/JSON/TSV parsing, nothing executed).
 *
 * What enters (Marco, 2026-10-10): theatres and every stage, AND salas
 * polivalentes, casas de cultura and ateneos; all of Spain and France.
 * What never enters: personal data. Names of people (CyL «responsables»),
 * nominative emails and mobiles are dropped by the rules of
 * `$lib/venue-directory` (genericEmail, landlinePhone); when in doubt, none.
 *
 * Dedup: records are folded into rows in source priority (Basilic, Gencat,
 * Castilla y León, Wikidata), each only by a reason `sameVenue` accepts
 * (QID; distance + name). Every folded record stays in the row's `sources`
 * with its reason and distance; a field filled from a folded record is
 * named in `field_sources`.
 *
 * Zone: the IANA zone of the nearest GeoNames populated place to the
 * venue's coordinates (ES, FR, and cities500 for overseas France), within
 * 25 km. No coordinates or nothing near: NULL, never guessed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { normPlace } from '../../apps/web/src/lib/places.ts';
import {
  genericEmail,
  kindFromName,
  landlinePhone,
  sameVenue,
  tidyName,
  websiteUrl,
  POLYVALENT_KINDS,
} from '../../apps/web/src/lib/venue-directory.ts';

const RAW = path.resolve(process.argv[2] ?? '.cache/venue-directory/raw');
const OUT = path.resolve(process.argv[3] ?? '.cache/venue-directory/out');
const read = (f) => fs.readFileSync(path.join(RAW, f), 'utf8');
const FETCHED_AT = fs.existsSync(path.join(RAW, 'fetched_at.txt')) ? read('fetched_at.txt').trim() : new Date().toISOString();

// ── tiny parsers ─────────────────────────────────────────────────────────
function parseCsv(text, delim) {
  const rows = [];
  let row = [], field = '', q = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}
const num = (s) => {
  const n = Number(String(s ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const posInt = (s) => {
  const n = num(s);
  return n && n > 0 && n < 200000 ? Math.round(n) : null;
};
const clean = (s) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t && t !== 'NA' ? t : null;
};

// ── gazetteer: nearest populated place → zone, country, region ──────────
const ES_REGIONS = {
  '51': 'Andalucía', '52': 'Aragón', '34': 'Asturias', '07': 'Illes Balears', '53': 'Canarias',
  '39': 'Cantabria', '54': 'Castilla-La Mancha', '55': 'Castilla y León', '56': 'Catalunya',
  '60': 'Comunitat Valenciana', '57': 'Extremadura', '58': 'Galicia', '29': 'Comunidad de Madrid',
  '31': 'Región de Murcia', '32': 'Navarra', '59': 'Euskadi', '27': 'La Rioja', CE: 'Ceuta', ML: 'Melilla',
};
const CELL = 0.25;
const grid = new Map();
function addGeo(f) {
  if (f[6] !== 'P' || !f[17]) return;
  const lat = Number(f[4]), lon = Number(f[5]);
  const key = `${Math.floor(lat / CELL)}:${Math.floor(lon / CELL)}`;
  let cell = grid.get(key);
  if (!cell) grid.set(key, (cell = []));
  cell.push({ lat, lon, cc: f[8], admin1: f[10], tz: f[17] });
}
for (const file of ['geonames/ES.txt', 'geonames/FR.txt', 'geonames/cities500.txt']) {
  for (const line of read(file).split('\n')) {
    if (!line) continue;
    const f = line.split('\t');
    if (file.endsWith('cities500.txt') && (f[8] === 'ES' || f[8] === 'FR')) continue;
    addGeo(f);
  }
}
function nearestPlace(lat, lon, countries) {
  if (lat == null || lon == null) return null;
  const ci = Math.floor(lat / CELL), cj = Math.floor(lon / CELL);
  let best = null, bestD = Infinity;
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
    for (const p of grid.get(`${ci + di}:${cj + dj}`) ?? []) {
      if (!countries.has(p.cc)) continue;
      const dy = (p.lat - lat) * 111.2, dx = (p.lon - lon) * 111.2 * Math.cos((lat * Math.PI) / 180);
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = p; }
    }
  }
  return best && Math.sqrt(bestD) <= 25 ? best : null;
}
const validTz = (tz) => {
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; }
};

// ── one record shape ─────────────────────────────────────────────────────
const FR_OVERSEAS = new Set(['GP', 'MQ', 'GF', 'RE', 'YT', 'NC', 'PF', 'PM', 'BL', 'MF', 'WF']);
const FR_ALL = new Set(['FR', ...FR_OVERSEAS]);
const ES_ONLY = new Set(['ES']);
const KIND_RANK = ['theatre', 'opera', 'concert_hall', 'auditorium', 'arena', 'creation_centre', 'multipurpose', 'other_stage', 'cultural_centre'];
const rec = (r) => {
  const name = tidyName(r.name);
  const city = r.city ? tidyName(r.city) : null;
  const near = nearestPlace(r.lat, r.lon, r.country === 'FR' ? FR_ALL : ES_ONLY);
  return {
    ...r,
    name,
    city,
    norm: normPlace(name),
    cityNorm: city ? normPlace(city) : '',
    timezone: near && validTz(near.tz) ? near.tz : null,
    near,
  };
};
const skipped = {};
const skip = (src, why) => { skipped[`${src}: ${why}`] = (skipped[`${src}: ${why}`] ?? 0) + 1; };

// ── Basilic (FR) ─────────────────────────────────────────────────────────
const BASILIC_OUT_LABELS = new Set([
  'Compagnie conventionnée', 'Compagnie subventionnée (DRAC - Aide à la production)', 'Orchestre national en région',
]);
function basilic() {
  const out = [];
  for (const x of parseCsv(read('basilic/basilic.csv'), ';')) {
    const type = x['Type équipement ou lieu'];
    const label = x['Label et appellation'];
    let kind = null;
    if (type === 'Théâtre') kind = 'theatre';
    else if (type === 'Opéra') kind = 'opera';
    else if (type === 'Scène') kind = label === 'Scène de musiques actuelles' ? 'concert_hall' : label === 'Zénith' ? 'arena' : 'theatre';
    else if (type === 'Centre de création artistique' || type === 'Centre de création musicale') kind = 'creation_centre';
    else if (type === 'Centre culturel') kind = 'cultural_centre';
    if (!kind) continue;
    if (BASILIC_OUT_LABELS.has(label) || x['Précision équipement'] === 'Compagnie') { skip('basilic', 'compagnie/orchestre sans lieu'); continue; }
    if (x['Demographie_AP'] && x['Demographie_AP'] !== 'Actif') { skip('basilic', 'no activo'); continue; }
    const id = clean(x['Identifiant_deps_a_partir_de_2022']) ?? clean(x['Identifiant_deps_old']);
    if (!id || !clean(x['Nom'])) { skip('basilic', 'sin id o nombre'); continue; }
    const lat = num(x['Latitude']), lon = num(x['Longitude']);
    const r = rec({
      source: 'basilic', source_id: id, qid: null, name: x['Nom'], kind,
      designation: clean(label) ?? clean(type), address: clean(x['Adresse']), postal_code: clean(x['Code Postal']),
      city: clean(x['libelle_geographique']), region: clean(x['Région']), country: 'FR',
      lat: lat ?? null, lon: lat == null ? null : lon, capacity: posInt(x['Jauge_du_theatre']),
      website: null, email: null, phone: null,
    });
    if (r.near && FR_OVERSEAS.has(r.near.cc)) r.country = r.near.cc;
    out.push(r);
  }
  return out;
}

// ── Gencat (Catalunya) ───────────────────────────────────────────────────
// Gencat writes «Sénia, la»; the municipality is «la Sénia».
const gencatCity = (c) => {
  const m = c && /^(.*), (el|la|els|les|l')$/i.exec(c);
  return m ? (m[2].endsWith("'") ? `${m[2]}${m[1]}` : `${m[2]} ${m[1]}`) : c;
};
function gencat() {
  const out = [];
  for (const x of parseCsv(read('gencat/equipaments.csv'), ',')) {
    const t = x.tipus, st = x.subtipus;
    const cap = posInt(x.aforament_sala_principal) ?? posInt(x.aforament_total);
    let kind = null;
    if (t === 'Espais escènics i musicals') {
      kind = { Teatre: 'theatre', 'Sala polivalent': 'multipurpose', Auditori: 'auditorium', 'Sales de concerts': 'concert_hall', 'Centre de creació': 'creation_centre' }[st] ?? 'other_stage';
    } else if (t === 'Centres culturals: ateneus, centres cívics i cases de cultura') {
      if (st === 'Centre cívic' && !cap) { skip('gencat', 'centre cívic sense aforament'); continue; }
      kind = 'cultural_centre';
    } else if (t === 'Altres espais aptes per a ús cultural' && st === 'Locals i espais polivalents') kind = 'multipurpose';
    else if (t === 'Fàbriques de Creació') kind = 'creation_centre';
    if (!kind) continue;
    const id = clean(x.id_peccat);
    if (!id || !clean(x.nom)) { skip('gencat', 'sense id o nom'); continue; }
    out.push(rec({
      source: 'gencat', source_id: id, qid: null, name: x.nom, kind,
      designation: clean(st) ?? clean(t), address: clean(x.adre_a), postal_code: clean(x.codi_postal),
      city: gencatCity(clean(x.municipi)), region: 'Catalunya', country: 'ES',
      lat: num(x.latitud), lon: num(x.longitud), capacity: cap,
      website: websiteUrl(clean(x.adre_a_web)), email: genericEmail(x.adre_a_electr_nica),
      phone: landlinePhone(x.tel_fon, 'ES'),
    }));
  }
  return out;
}

// ── Castilla y León (CC BY 4.0) ──────────────────────────────────────────
// No contact fields: the source's phones and emails belong to named
// «responsables» or to the town hall, not to the venue.
function cyl() {
  const out = [];
  for (const x of JSON.parse(read('cyl/red_teatros.json'))) {
    if (!clean(x.sala)) continue;
    const norm = normPlace(x.sala);
    out.push(rec({
      source: 'jcyl', source_id: `red:${norm}|${normPlace(x.municipio ?? '')}`, qid: null, name: x.sala,
      kind: kindFromName(norm), designation: 'Red de Teatros de Castilla y León', address: clean(x.direccion),
      postal_code: clean(x.cp), city: clean(x.municipio), region: 'Castilla y León', country: 'ES',
      lat: x.coordenadas?.lat ?? null, lon: x.coordenadas?.lon ?? null, capacity: null, website: websiteUrl(x.direccion_web),
      email: null, phone: null,
    }));
  }
  for (const x of JSON.parse(read('cyl/espacios-circuitos-escenicos.json'))) {
    if (!clean(x.espacio_escenico)) continue;
    const norm = normPlace(x.espacio_escenico);
    const coord = Object.values(x).find((v) => typeof v === 'string' && /^-?\d+\.\d+\s*,\s*-?\d+\.\d+$/.test(v));
    const [lat, lon] = coord ? coord.split(',').map(Number) : [null, null];
    out.push(rec({
      source: 'jcyl', source_id: `circ:${norm}|${normPlace(x.localidad ?? '')}`, qid: null, name: x.espacio_escenico,
      kind: kindFromName(norm), designation: 'Red de Circuitos Escénicos de Castilla y León',
      address: clean(x.direccion_espacio_escenico), postal_code: clean(x.c_p), city: clean(x.localidad),
      region: 'Castilla y León', country: 'ES', lat, lon, capacity: null, website: null, email: null, phone: null,
    }));
  }
  return out;
}

// ── Wikidata (CC0) ───────────────────────────────────────────────────────
const { WIKIDATA_CLASSES } = await import('./fetch.mjs');
function wikidata() {
  const munis = new Map();
  for (const b of JSON.parse(read('wikidata/municipalities.json')).results.bindings) {
    munis.set(b.muni.value.split('/').pop(), { es: b.es?.value, ca: b.ca?.value, gl: b.gl?.value });
  }
  const items = new Map();
  for (const b of JSON.parse(read('wikidata/es.json')).results.bindings) {
    const qid = b.item.value.split('/').pop();
    let it = items.get(qid);
    if (!it) items.set(qid, (it = { qid, kinds: new Set(), caps: [], v: {} }));
    it.kinds.add(WIKIDATA_CLASSES[b.t.value.split('/').pop()]);
    for (const k of ['coord', 'es', 'ca', 'gl', 'eu', 'en', 'muni', 'postal', 'addr', 'web', 'useLabel']) {
      if (b[k] && it.v[k] == null) it.v[k] = b[k].value;
    }
    if (b.cap) it.caps.push(Number(b.cap.value));
  }
  const out = [];
  for (const it of items.values()) {
    const v = it.v;
    if (v.useLabel && /demol|ruin|abandon|disus|closed|derrib|desapar|destro/i.test(v.useLabel)) { skip('wikidata', `estado de uso: ${v.useLabel}`); continue; }
    const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(v.coord ?? '');
    if (!m) { skip('wikidata', 'sin coordenadas'); continue; }
    const lon = Number(m[1]), lat = Number(m[2]);
    const near = nearestPlace(lat, lon, ES_ONLY);
    if (!near) { skip('wikidata', 'fuera de España (P17 España, sede en el extranjero)'); continue; }
    const admin1 = near?.cc === 'ES' ? near.admin1 : null;
    const pref = ['56', '60', '07'].includes(admin1) ? ['ca', 'es'] : admin1 === '58' ? ['gl', 'es'] : ['es', 'ca', 'gl', 'eu'];
    const name = [...pref, 'es', 'ca', 'gl', 'eu', 'en'].map((l) => v[l]).find(Boolean);
    if (!name) { skip('wikidata', 'sin etiqueta'); continue; }
    const kind = KIND_RANK.find((k) => it.kinds.has(k)) ?? 'other_stage';
    // The municipality in the language its venue's name is in (Banyoles, not Bañolas).
    const muni = (v.muni && munis.get(v.muni.split('/').pop())) ?? {};
    const city = [...pref, 'es', 'ca', 'gl'].map((l) => muni[l]).find(Boolean) ?? null;
    const caps = it.caps.filter((c) => c > 0 && c < 200000);
    out.push(rec({
      source: 'wikidata', source_id: it.qid, qid: it.qid, name, kind, designation: null,
      address: clean(v.addr), postal_code: clean(v.postal), city, region: admin1 ? ES_REGIONS[admin1] ?? null : null,
      country: 'ES', lat, lon, capacity: caps.length ? Math.max(...caps) : null, website: websiteUrl(v.web),
      email: null, phone: null,
    }));
  }
  return out;
}

// ── fold ─────────────────────────────────────────────────────────────────
const FILL = ['address', 'postal_code', 'city', 'region', 'capacity', 'website', 'email', 'phone', 'designation'];
const rows = [];
const rowGrid = new Map();
const qidOwner = new Map();
const merges = {};
const gkey = (lat, lon) => `${Math.floor(lat / 0.01)}:${Math.floor(lon / 0.01)}`;
function nearbyRows(r) {
  if (r.lat == null) return [];
  const ci = Math.floor(r.lat / 0.01), cj = Math.floor(r.lon / 0.01);
  const out = [];
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) out.push(...(rowGrid.get(`${ci + di}:${cj + dj}`) ?? []));
  return out;
}
const asMatch = (r) => ({ norm: r.norm, city: r.cityNorm, lat: r.lat, lon: r.lon, qid: r.qid });
function fold(r) {
  let best = null;
  if (r.qid && qidOwner.has(r.qid)) best = { row: qidOwner.get(r.qid), m: { by: 'qid', distanceM: null } };
  if (!best) {
    for (const row of nearbyRows(r)) {
      if (row.country !== r.country) continue;
      const m = sameVenue(asMatch(row), asMatch(r));
      if (m && (!best || (m.distanceM ?? 0) < (best.m.distanceM ?? 0))) best = { row, m };
    }
  }
  if (!best) {
    const row = { ...r, field_sources: {}, sources: [{ source: r.source, source_id: r.source_id }] };
    rows.push(row);
    if (row.lat != null) {
      const k = gkey(row.lat, row.lon);
      if (!rowGrid.has(k)) rowGrid.set(k, []);
      rowGrid.get(k).push(row);
    }
    if (row.qid) qidOwner.set(row.qid, row);
    return;
  }
  const { row, m } = best;
  merges[`${row.source}←${r.source} (${m.by})`] = (merges[`${row.source}←${r.source} (${m.by})`] ?? 0) + 1;
  row.sources.push({ source: r.source, source_id: r.source_id, matched_by: m.by, distance_m: m.distanceM });
  for (const f of FILL) {
    if (row[f] == null && r[f] != null) {
      row[f] = r[f];
      if (r.source !== row.source) row.field_sources[f] = r.source;
    }
  }
  if (!row.qid && r.qid && !qidOwner.has(r.qid)) {
    row.qid = r.qid;
    qidOwner.set(r.qid, row);
  }
}

const bySource = { basilic: basilic(), gencat: gencat(), jcyl: cyl(), wikidata: wikidata() };
const order = (a, b) =>
  KIND_RANK.indexOf(a.kind) - KIND_RANK.indexOf(b.kind) ||
  (b.capacity ? 1 : 0) - (a.capacity ? 1 : 0) ||
  a.source_id.localeCompare(b.source_id);
for (const src of ['basilic', 'gencat', 'jcyl', 'wikidata']) for (const r of [...bySource[src]].sort(order)) fold(r);

// ── output ───────────────────────────────────────────────────────────────
const out = rows.map((r) => ({
  source: r.source, source_id: r.source_id, wikidata_qid: r.qid, name: r.name, kind: r.kind,
  designation: r.designation, address: r.address, postal_code: r.postal_code, city: r.city, region: r.region,
  country: r.country, latitude: r.lat, longitude: r.lon, timezone: r.timezone, capacity: r.capacity,
  website: r.website, email: r.email, phone: r.phone, search_key: normPlace(`${r.name} ${r.city ?? ''}`),
  field_sources: r.field_sources, sources: r.sources,
}));

// The date of the data, from each dataset's own metadata (fetch.mjs).
const jsonOf = (f) => JSON.parse(read(f));
const day = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : null);
const DATA_DATES = {
  basilic: day(jsonOf('basilic/meta.json').resources.find((r) => r.format === 'csv')?.last_modified),
  gencat: day(jsonOf('gencat/meta.json').rowsUpdatedAt * 1000),
  jcyl: ['cyl/red_teatros.meta.json', 'cyl/espacios-circuitos-escenicos.meta.json']
    .map((f) => day(jsonOf(f).metas.default.data_processed))
    .sort()
    .pop(),
  wikidata: FETCHED_AT.slice(0, 10),
};
const SOURCES = [
  {
    key: 'basilic', name: 'Base des lieux et équipements culturels (Basilic)', publisher: 'Ministère de la Culture (DEPS)',
    license: 'Licence Ouverte 2.0', license_url: 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/',
    source_url: 'https://www.data.gouv.fr/datasets/base-des-lieux-et-equipements-culturels-basilic',
    attribution: 'Ministère de la Culture, Base des lieux et équipements culturels (Basilic), data.gouv.fr. Données modifiées par Hour : sélection des lieux de spectacle, fusion des doublons.',
  },
  {
    key: 'gencat', name: 'Equipaments culturals de Catalunya', publisher: 'Generalitat de Catalunya, Departament de Cultura',
    license: "Llicència oberta d'ús d'informació de Catalunya", license_url: 'https://web.gencat.cat/ca/generalitat/dades-indicadors/dades-obertes/llicencies',
    source_url: 'https://analisi.transparenciacatalunya.cat/d/48s6-82h2',
    attribution: 'Generalitat de Catalunya, Departament de Cultura: Equipaments culturals de Catalunya (Dades obertes de Catalunya).',
  },
  {
    key: 'jcyl', name: 'Red de Teatros y Red de Circuitos Escénicos de Castilla y León', publisher: 'Junta de Castilla y León',
    license: 'CC BY 4.0', license_url: 'https://creativecommons.org/licenses/by/4.0/deed.es',
    source_url: 'https://analisis.datosabiertos.jcyl.es/explore/dataset/red_teatros/',
    attribution: 'Junta de Castilla y León, Datos Abiertos: Red de Teatros y Red de Circuitos Escénicos. Cambios: selección de campos, sin datos de contacto.',
  },
  {
    key: 'wikidata', name: 'Wikidata', publisher: 'Wikimedia Foundation y colaboradores de Wikidata',
    license: 'CC0 1.0', license_url: 'https://creativecommons.org/publicdomain/zero/1.0/',
    source_url: 'https://www.wikidata.org', attribution: 'Wikidata (CC0).',
  },
];
for (const s of SOURCES) s.data_date = DATA_DATES[s.key];

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'rows.json'), JSON.stringify(out));
const json = JSON.stringify(out);
if (json.includes('$vd$')) throw new Error('dollar-quote collision');
const cols = `source text, source_id text, wikidata_qid text, name text, kind text, designation text, address text,
  postal_code text, city text, region text, country text, latitude double precision, longitude double precision,
  timezone text, capacity integer, website text, email text, phone text, search_key text, field_sources jsonb, sources jsonb`;
const lit = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const sql = `-- Directorio global de salas: load generated by scripts/venue-directory/build.mjs
-- from data fetched ${FETCHED_AT}. ${out.length} entries. Run as postgres / service role.
-- Idempotent: upsert on (source, source_id); entries of these sources not in
-- this load become status 'missing' (last_seen_at keeps their last sighting).
BEGIN;
INSERT INTO public.venue_directory_source (key, name, publisher, license, license_url, source_url, attribution, data_date, imported_at)
VALUES
${SOURCES.map((s) => `  (${[s.key, s.name, s.publisher, s.license, s.license_url, s.source_url, s.attribution, s.data_date].map(lit).join(', ')}, now())`).join(',\n')}
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, publisher = EXCLUDED.publisher, license = EXCLUDED.license,
  license_url = EXCLUDED.license_url, source_url = EXCLUDED.source_url, attribution = EXCLUDED.attribution,
  data_date = EXCLUDED.data_date, imported_at = EXCLUDED.imported_at;

CREATE TEMP TABLE _vd ON COMMIT DROP AS
SELECT * FROM jsonb_to_recordset($vd$${json}$vd$::jsonb) AS x(${cols});

UPDATE _vd SET timezone = NULL
WHERE timezone IS NOT NULL AND timezone NOT IN (SELECT name FROM pg_catalog.pg_timezone_names);

-- A QID moves to the row that owns it in this load.
UPDATE public.venue_directory d SET wikidata_qid = NULL
FROM _vd x
WHERE d.wikidata_qid = x.wikidata_qid AND (d.source, d.source_id) IS DISTINCT FROM (x.source, x.source_id);

INSERT INTO public.venue_directory (source, source_id, wikidata_qid, name, kind, designation, address, postal_code,
  city, region, country, latitude, longitude, timezone, capacity, website, email, phone, search_key,
  field_sources, sources, status, last_seen_at)
SELECT source, source_id, wikidata_qid, name, kind, designation, address, postal_code, city, region, country,
  latitude, longitude, timezone, capacity, website, email, phone, search_key, field_sources, sources, 'active', now()
FROM _vd
ON CONFLICT (source, source_id) DO UPDATE SET
  wikidata_qid = EXCLUDED.wikidata_qid, name = EXCLUDED.name, kind = EXCLUDED.kind, designation = EXCLUDED.designation,
  address = EXCLUDED.address, postal_code = EXCLUDED.postal_code, city = EXCLUDED.city, region = EXCLUDED.region,
  country = EXCLUDED.country, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude, timezone = EXCLUDED.timezone,
  capacity = EXCLUDED.capacity, website = EXCLUDED.website, email = EXCLUDED.email, phone = EXCLUDED.phone,
  search_key = EXCLUDED.search_key, field_sources = EXCLUDED.field_sources, sources = EXCLUDED.sources,
  status = 'active', last_seen_at = now();

UPDATE public.venue_directory SET status = 'missing'
WHERE source IN (${SOURCES.map((s) => lit(s.key)).join(', ')}) AND status = 'active' AND last_seen_at < now();
COMMIT;
`;
fs.writeFileSync(path.join(OUT, 'load.sql'), sql);

// ── report ───────────────────────────────────────────────────────────────
const tally = (f) => out.reduce((m, r) => ((m[f(r)] = (m[f(r)] ?? 0) + 1), m), {});
const fill = Object.fromEntries(
  ['address', 'postal_code', 'city', 'latitude', 'timezone', 'capacity', 'website', 'email', 'phone', 'wikidata_qid', 'designation'].map((f) => [
    f,
    `${out.filter((r) => r[f] != null).length}/${out.length} (${Math.round((100 * out.filter((r) => r[f] != null).length) / out.length)} %)`,
  ]),
);
const report = {
  fetched_at: FETCHED_AT,
  records_in: Object.fromEntries(Object.entries(bySource).map(([k, v]) => [k, v.length])),
  rows: out.length,
  by_source_country: tally((r) => `${r.source} ${r.country}`),
  by_country: tally((r) => r.country),
  by_kind: tally((r) => r.kind),
  polyvalent: out.filter((r) => POLYVALENT_KINDS.includes(r.kind)).length,
  polyvalent_by_country: tally((r) => (POLYVALENT_KINDS.includes(r.kind) ? r.country : '-')),
  by_region_es: tally((r) => (r.country === 'ES' ? r.region ?? '(sin región)' : '-')),
  merges,
  skipped,
  fill,
  timezones: tally((r) => r.timezone ?? '(null)'),
};
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
