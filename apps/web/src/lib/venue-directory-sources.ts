/**
 * DIRECTORIO GLOBAL DE SALAS, fase 2: the parsers of the new public sources,
 * pure and testable, read by `scripts/venue-directory/build.mjs` under Node
 * (so this file stays import-free and uses only erasable TypeScript; the
 * normaliser is passed in, as in `$lib/venue-directory`).
 *
 * - EIEL (Encuesta de Infraestructura y Equipamientos Locales), Secretaría de
 *   Estado de Política Territorial: the «centros culturales» of every
 *   municipality under 50.000 inhabitants, with their type and their uses,
 *   WITHOUT coordinates and without contacts. Pipe-separated, no header.
 * - The same survey published by the Comunidad de Madrid (IDEM WFS), WITH
 *   coordinates.
 * - Spanish provinces to region and IANA zone (the EIEL has no coordinates),
 *   and French regions from GeoNames admin1 codes.
 *
 * The phase 1 rules hold: the same kinds of venue; a civic or social centre
 * only with a declared capacity (the EIEL declares none, so none enters); no
 * contact of a town hall; no personal data (the EIEL has none).
 */

/** Kept in step with `VenueKind` in `$lib/venue-directory` (a string here to stay import-free). */
type Kind =
  | 'theatre'
  | 'opera'
  | 'concert_hall'
  | 'auditorium'
  | 'arena'
  | 'creation_centre'
  | 'multipurpose'
  | 'cultural_centre'
  | 'other_stage';

/** One record as build.mjs folds it (before its own normalisation and zone lookup). */
export type SourceRecord = {
  source: string;
  source_id: string;
  qid: string | null;
  name: string;
  kind: Kind;
  designation: string | null;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  region: string | null;
  country: string;
  lat: number | null;
  lon: number | null;
  capacity: number | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  /** Only for sources without coordinates: the zone of the province. */
  timezone?: string | null;
};

// ── Spain: province → region, zone ──────────────────────────────────────
const PROVINCE_REGION: Record<string, string> = {};
const REGIONS: [string, string[]][] = [
  ['Andalucía', ['04', '11', '14', '18', '21', '23', '29', '41']],
  ['Aragón', ['22', '44', '50']],
  ['Asturias', ['33']],
  ['Illes Balears', ['07']],
  ['Canarias', ['35', '38']],
  ['Cantabria', ['39']],
  ['Castilla-La Mancha', ['02', '13', '16', '19', '45']],
  ['Castilla y León', ['05', '09', '24', '34', '37', '40', '42', '47', '49']],
  ['Catalunya', ['08', '17', '25', '43']],
  ['Comunitat Valenciana', ['03', '12', '46']],
  ['Extremadura', ['06', '10']],
  ['Galicia', ['15', '27', '32', '36']],
  ['Comunidad de Madrid', ['28']],
  ['Región de Murcia', ['30']],
  ['Navarra', ['31']],
  ['Euskadi', ['01', '20', '48']],
  ['La Rioja', ['26']],
  ['Ceuta', ['51']],
  ['Melilla', ['52']],
];
for (const [region, provinces] of REGIONS) for (const p of provinces) PROVINCE_REGION[p] = region;

/** The autonomous community of a Spanish province (INE code, two digits), with the names build.mjs uses. */
export function spanishRegion(province: string): string | null {
  return PROVINCE_REGION[province] ?? null;
}

/**
 * The IANA zone of a Spanish province. Exact, not guessed: the Canaries are
 * Atlantic/Canary, Ceuta and Melilla Africa/Ceuta, the rest Europe/Madrid.
 */
export function spanishProvinceZone(province: string): string | null {
  if (!PROVINCE_REGION[province]) return null;
  if (province === '35' || province === '38') return 'Atlantic/Canary';
  if (province === '51' || province === '52') return 'Africa/Ceuta';
  return 'Europe/Madrid';
}

/**
 * A municipality as the registers write it, as people say it: the first of
 * two official names («Elx/Elche» → «Elx»), and the article in front
 * («Campello, el» → «el Campello», «Orxa, l'» → «l'Orxa», «Rinconada (La)» →
 * «La Rinconada»). The article keeps the source's case.
 */
export function municipalityName(raw: string | null | undefined): string | null {
  const s = (raw ?? '').split('/')[0]?.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const m = /^(.*?)(?:, | \()(el|la|els|les|l'|los|las|lo|o|a|os|as|es|sa|ses)\)?$/i.exec(s);
  if (!m) return s;
  return m[2].endsWith("'") ? `${m[2]}${m[1]}` : `${m[2]} ${m[1]}`;
}

// ── France: GeoNames admin1 → region ────────────────────────────────────
const FR_REGIONS: Record<string, string> = {
  '11': 'Île-de-France', '24': 'Centre-Val de Loire', '27': 'Bourgogne-Franche-Comté', '28': 'Normandie',
  '32': 'Hauts-de-France', '44': 'Grand Est', '52': 'Pays de la Loire', '53': 'Bretagne',
  '75': 'Nouvelle-Aquitaine', '76': 'Occitanie', '84': 'Auvergne-Rhône-Alpes',
  '93': "Provence-Alpes-Côte d'Azur", '94': 'Corse',
};
/** Overseas France, by the ISO code GeoNames files it under (Basilic's names). */
const FR_OVERSEAS_REGIONS: Record<string, string> = {
  RE: 'La Réunion', MQ: 'Martinique', GP: 'Guadeloupe', GF: 'Guyane', YT: 'Mayotte',
  NC: 'Nouvelle-Calédonie', PF: 'Polynésie française', PM: 'Saint-Pierre-et-Miquelon',
  BL: 'Saint-Barthélemy', MF: 'Saint-Martin', WF: 'Wallis-et-Futuna',
};

/** The French region of the nearest populated place, with the names Basilic uses; null when unknown. */
export function frenchRegion(cc: string, admin1: string | null | undefined): string | null {
  if (cc === 'FR') return (admin1 && FR_REGIONS[admin1]) || null;
  return FR_OVERSEAS_REGIONS[cc] ?? null;
}

// ── EIEL: the kind of a centre from its type and its uses ───────────────
/**
 * EIEL types (domain «tipo de centro cultural») that may hold a stage. The
 * rest (archive, library, museum, pensioners' club, bullring, bandstand) are
 * not venues.
 */
const EIEL_TYPE_LABEL: Record<string, string> = {
  TC: 'Teatro/cine',
  AU: 'Auditorio',
  CC: 'Casa de cultura',
  OT: 'Otros, con uso de teatro o auditorio',
};

export type EielVerdict = { kind: Kind; designation: string } | { skip: string } | null;

/**
 * Whether an EIEL centre enters the directory, and as what. `uses` are its
 * EIEL use codes (TE teatro, AO auditorio, CI cine...).
 * - TC (teatro/cine): a stage, unless its name says cinema and nothing else
 *   and it declares no theatre use («Cine de verano»).
 * - AU (auditorio): an auditorium (a theatre when its name says so).
 * - CC (casa de cultura): a cultural centre, like the casas de cultura of
 *   phase 1.
 * - OT (otros): only with a theatre or auditorium use, as a multipurpose hall.
 * - CS (centro social/cívico): never, even with a stage use: the EIEL gives
 *   no capacity, and a civic centre enters only with one (Marco, 10-10).
 * - Under construction (estado E): not yet a venue.
 */
export function eielVerdict(
  type: string,
  uses: ReadonlySet<string>,
  norm: string,
  state: string,
  kindFromName: (norm: string) => Kind,
): EielVerdict {
  const stageUse = uses.has('TE') || uses.has('AO');
  if (!['TC', 'AU', 'CC', 'OT', 'CS'].includes(type)) return null;
  if (type === 'CS') return stageUse ? { skip: 'centro social con escenario, sin aforo' } : null;
  if (type === 'OT' && !stageUse) return null;
  if (state === 'E') return { skip: 'en ejecución' };
  const designation = EIEL_TYPE_LABEL[type];
  const byName = kindFromName(norm);
  if (type === 'TC') {
    const cinemaOnly = /\bcines?\b/.test(norm) && !/\b(teatro|teatre|auditori|auditorio|escenico|escenic)\b/.test(norm);
    if (cinemaOnly && !uses.has('TE')) return { skip: 'cine sin uso escénico' };
    return { kind: byName === 'other_stage' || byName === 'cultural_centre' ? 'theatre' : byName, designation };
  }
  if (type === 'AU') return { kind: byName === 'theatre' ? 'theatre' : 'auditorium', designation };
  if (type === 'CC') return { kind: 'cultural_centre', designation };
  return { kind: 'multipurpose', designation };
}

/** The stable id of an EIEL centre: province+municipality, entity, nucleus, order («04001-0001-01-001»). */
export function eielId(prov: string, mun: string, ent: string, pob: string, order: string): string {
  return `${prov}${mun}-${ent}-${pob}-${order}`;
}

/** The rows of an EIEL table: pipe-separated, CRLF, no header. */
export function eielRows(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => l.split('|').map((f) => f.trim()));
}

type Skip = (why: string) => void;

/**
 * One province of the national EIEL → records. Columns, from the survey's
 * data model: CENT_CULTURAL = fase, clave, provincia, municipio, entidad,
 * núcleo, orden, nombre, tipo, titular, gestión, sup. cubierta, sup. aire
 * libre, sup. solar, acceso, estado; CENT_CULTURAL_USOS = fase, clave,
 * provincia, municipio, entidad, núcleo, orden, uso, superficie; MUNICIPIO =
 * fase, provincia, municipio, -, nombre.
 */
export function eielRecords(
  tables: { centres: string; uses: string; municipalities: string },
  norm: (s: string) => string,
  kindFromName: (norm: string) => Kind,
  skip: Skip = () => {},
): SourceRecord[] {
  const munis = new Map<string, string>();
  for (const r of eielRows(tables.municipalities)) munis.set(`${r[1]}${r[2]}`, r[4]);
  const uses = new Map<string, Set<string>>();
  for (const r of eielRows(tables.uses)) {
    const key = eielId(r[2], r[3], r[4], r[5], r[6]);
    if (!uses.has(key)) uses.set(key, new Set());
    uses.get(key)!.add(r[7]);
  }
  const out: SourceRecord[] = [];
  for (const r of eielRows(tables.centres)) {
    if (r.length < 16) continue;
    const [, , prov, mun, ent, pob, order, name, type, , , , , , , state] = r;
    const id = eielId(prov, mun, ent, pob, order);
    if (!name) continue;
    const v = eielVerdict(type, uses.get(id) ?? new Set(), norm(name), state, kindFromName);
    if (!v) continue;
    if ('skip' in v) {
      skip(v.skip);
      continue;
    }
    out.push({
      source: 'eiel', source_id: id, qid: null, name, kind: v.kind, designation: v.designation,
      address: null, postal_code: null, city: municipalityName(munis.get(`${prov}${mun}`)),
      region: spanishRegion(prov), country: 'ES', lat: null, lon: null, capacity: null,
      website: null, email: null, phone: null, timezone: spanishProvinceZone(prov),
    });
  }
  return out;
}

/** The Comunidad de Madrid's type names, as EIEL codes. */
const IDEM_TYPES: Record<string, string> = {
  'TEATRO/CINE': 'TC', AUDITORIO: 'AU', 'CASA DE CULTURA': 'CC', OTROS: 'OT', 'CENTRO CIVICO/SOCIAL': 'CS',
};

/**
 * The Comunidad de Madrid's EIEL (WFS GeoJSON) → records, by the same rules
 * as the national survey; its uses are yes/no columns (TEATRO, AUDITORIO,
 * CINE). Same id scheme as the national EIEL.
 */
export function idemMadridRecords(
  geojson: { features: { geometry: { coordinates: number[] } | null; properties: Record<string, string | null> }[] },
  norm: (s: string) => string,
  kindFromName: (norm: string) => Kind,
  skip: Skip = () => {},
): SourceRecord[] {
  const out: SourceRecord[] = [];
  for (const f of geojson.features) {
    const p = f.properties;
    const type = IDEM_TYPES[p.TIPO ?? ''] ?? '';
    const uses = new Set<string>();
    if (p.TEATRO === 'SI') uses.add('TE');
    if (p.AUDITORIO === 'SI') uses.add('AO');
    if (p.CINE === 'SI') uses.add('CI');
    const name = (p.NOMBRE ?? '').trim();
    if (!name || !p.PROV || !p.MUN) continue;
    const state = p.ESTADO === 'EN EJECUCION' ? 'E' : '';
    const v = eielVerdict(type, uses, norm(name), state, kindFromName);
    if (!v) continue;
    if ('skip' in v) {
      skip(v.skip);
      continue;
    }
    const [lon, lat] = f.geometry?.coordinates ?? [];
    const ok = Number.isFinite(lat) && Number.isFinite(lon);
    out.push({
      source: 'madrid_eiel', source_id: eielId(p.PROV, p.MUN, p.ENT ?? '', p.POBLAMIENT ?? '', p.ORDEN_CENT ?? ''),
      qid: null, name, kind: v.kind, designation: v.designation, address: null, postal_code: null,
      city: municipalityName(p.MUNICIPIO), region: 'Comunidad de Madrid', country: 'ES',
      lat: ok ? lat : null, lon: ok ? lon : null, capacity: null, website: null, email: null, phone: null,
    });
  }
  return out;
}
