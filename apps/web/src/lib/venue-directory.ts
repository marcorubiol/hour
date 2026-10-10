/**
 * DIRECTORIO GLOBAL DE SALAS (fase 1): the pure rules of the import and of
 * the search, shared by `scripts/venue-directory/build.mjs` (run under Node,
 * so this file stays import-free and uses only erasable TypeScript) and the
 * app.
 *
 * Two rules matter more than the rest:
 * - NO PERSONAL DATA (Marco, 2026-10-10): an email is kept only when it is
 *   recognisably a role of the venue (`info@`, `taquilla@`...), a phone only
 *   when it is a landline. Anything doubtful is dropped, never guessed.
 * - A MERGE ALWAYS HAS A REASON: two records are the same venue only by QID,
 *   or by distance plus name; the reason travels with the row (`sources`).
 *
 * Names are normalised with `normPlace` ($lib/places), the same function the
 * search key is built with; it is passed in so this file imports nothing.
 */

export const VENUE_KINDS = [
  'theatre',
  'opera',
  'concert_hall',
  'auditorium',
  'arena',
  'creation_centre',
  'multipurpose',
  'cultural_centre',
  'other_stage',
] as const;
export type VenueKind = (typeof VENUE_KINDS)[number];

/** Salas polivalentes, casas de cultura, ateneos (Marco's word «polivalentes»). */
export const POLYVALENT_KINDS: readonly VenueKind[] = ['multipurpose', 'cultural_centre'];

/**
 * Words that name a ROLE, never a person. An email is generic only when every
 * part of its local part (split on . _ - and digits) is one of them.
 */
const ROLE_WORDS = new Set([
  'info', 'informacio', 'informacion', 'information', 'infos', 'contact', 'contacte',
  'contacto', 'hola', 'hello', 'bonjour', 'general', 'cultura', 'culture', 'culturals',
  'teatre', 'teatro', 'theatre', 'auditori', 'auditorio', 'sala', 'salle', 'ateneu',
  'ateneo', 'casal', 'casino', 'centre', 'centro', 'civic', 'civico', 'ajuntament',
  'ayuntamiento', 'mairie', 'administracio', 'administracion', 'administration', 'admin',
  'secretaria', 'secretariat', 'secretariado', 'oficina', 'office', 'taquilla',
  'taquilles', 'taquillas', 'billetterie', 'reserves', 'reservas', 'reservations',
  'reservation', 'comunicacio', 'comunicacion', 'communication', 'premsa', 'prensa',
  'presse', 'programacio', 'programacion', 'programmation', 'produccio', 'produccion',
  'production', 'tecnica', 'technique', 'accueil', 'recepcio', 'recepcion', 'entrades',
  'entradas', 'festes', 'fiestas', 'municipal', 'mpal', 'agenda', 'activitats',
  'actividades', 'web', 'correu', 'correo', 'mail', 'email', 'direccio', 'direccion',
  'direction', 'gerencia', 'gestio', 'gestion', 'servei', 'servicio', 'service',
  'patronat', 'patronato', 'fundacio', 'fundacion', 'associacio', 'asociacion',
  'association', 'cultural', 'teatres', 'auditoris', 'espectacles', 'espectaculos',
  'spectacles', 'musique', 'musica', 'dansa', 'danza', 'danse', 'joventut', 'juventud',
]);

/** A generic email of the venue, or null (also null when in doubt). */
export function genericEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const first = raw.split(/[;,\s]+/).find((s) => s.includes('@'));
  if (!first) return null;
  const email = first.trim().toLowerCase();
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) return null;
  const parts = email.split('@')[0].split(/[._\-+]|\d+/).filter(Boolean);
  if (parts.length === 0) return null;
  return parts.every((p) => ROLE_WORDS.has(p)) ? email : null;
}

/**
 * A landline of the venue, digits only, or null. Mobiles are dropped: in
 * Spain and France a mobile is usually a person. ES landlines are nine
 * digits starting 8 or 9; FR, ten digits starting 01-05 or 09.
 */
export function landlinePhone(raw: string | null | undefined, country: string): string | null {
  if (!raw) return null;
  const first = raw.split(/[;,/]|\s{2,}/)[0] ?? '';
  let d = first.replace(/[^\d+]/g, '');
  if (country === 'ES') {
    d = d.replace(/^(\+|00)34/, '');
    return /^[89]\d{8}$/.test(d) ? d : null;
  }
  if (country === 'FR') {
    d = d.replace(/^(\+|00)33/, '0');
    return /^0[1-59]\d{8}$/.test(d) ? d : null;
  }
  return null;
}

/** A website as an absolute http(s) URL, or null. */
export function websiteUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim().split(/\s+/)[0] ?? '';
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    return u.hostname.includes('.') ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Great-circle distance in metres. */
export function distanceM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const r = Math.PI / 180;
  const dLat = (bLat - aLat) * r;
  const dLon = (bLon - aLon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Articles and prepositions: they never tell two venues apart. */
const FILLER = new Set([
  'de', 'del', 'dels', 'la', 'las', 'les', 'el', 'els', 'los', 'lo', 'l', 'd', 'du', 'des',
  'le', 'a', 'al', 'i', 'y', 'et', 'en', 'sa', 'es', 'ses', 'the', 'of', 'and',
]);

/**
 * Words every venue has: they say WHAT it is, not WHICH. «Teatre Arnau» and
 * «Teatre Apolo» share «teatre» and nothing else.
 */
const GENERIC = new Set([
  'teatre', 'teatro', 'theatre', 'teatres', 'teatros', 'theatres', 'sala', 'salle', 'salo', 'salon', 'auditori',
  'auditorio', 'auditorium', 'centre', 'centro', 'center', 'casa', 'cultura', 'cultural', 'culturel', 'culturelle',
  'casal', 'ateneu', 'ateneo', 'espai', 'espacio', 'espace', 'municipal', 'municipale', 'polivalent', 'polivalente',
  'polyvalente', 'civic', 'civico', 'social', 'scene', 'cine', 'cinema', 'local', 'nacional', 'national', 'nationale',
  'gran', 'grand', 'nou', 'nuevo', 'nouveau', 'nouvelle', 'arts', 'art', 'escenic', 'escenico', 'espectacles',
  'musica', 'musique', 'concerts', 'conciertos', 'actes', 'actos', 'usos', 'multiple', 'multiusos', 'palau', 'palacio',
]);

/** The words of a normalised name that can tell two venues apart. */
export function nameWords(norm: string): string[] {
  return norm.split(' ').filter((w) => w && !FILLER.has(w));
}

/**
 * How alike two normalised names are, 0..1: shared words over the words of
 * the SHORTER name (so «Teatre Principal» and «Teatre Principal d'Olot» are
 * 1). Generic words («teatre», «sala», «casal»...) only count when one of the
 * names has nothing else («Casa de Cultura»). Two names with no words are 0.
 */
export function nameLikeness(a: string, b: string): number {
  const all = (n: string) => nameWords(n);
  const own = (n: string) => all(n).filter((w) => !GENERIC.has(w));
  const useOwn = own(a).length > 0 && own(b).length > 0;
  const wa = new Set(useOwn ? own(a) : all(a));
  const wb = new Set(useOwn ? own(b) : all(b));
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size);
}

export type MatchInput = {
  norm: string;
  city: string;
  lat: number | null;
  lon: number | null;
  qid: string | null;
};
export type MatchReason = { by: 'qid' | 'near_name' | 'same_spot' | 'city_name'; distanceM: number | null };

/**
 * Are two records the same venue? Only for these reasons, in this order:
 * - the same Wikidata QID;
 * - under 40 m and the names share half their words (two labels of one
 *   house: «Théâtre X» and «Scène nationale X»);
 * - under 150 m and the names share 80 %;
 * - the same municipality, under 1 km, and the same name word for word
 *   (a geocoding of the town hall instead of the door).
 * Anything else is two venues: a missed merge is a duplicate a person can
 * see; a wrong merge hides a venue.
 */
export function sameVenue(a: MatchInput, b: MatchInput): MatchReason | null {
  if (a.qid && b.qid) return a.qid === b.qid ? { by: 'qid', distanceM: null } : null;
  if (a.lat == null || a.lon == null || b.lat == null || b.lon == null) return null;
  const d = distanceM(a.lat, a.lon, b.lat, b.lon);
  // The town's name in a venue's name («Teatre Barcelona», «La Off
  // Barcelona») says nothing about which venue it is.
  const town = new Set(`${a.city} ${b.city}`.split(' ').filter(Boolean));
  const strip = (n: string) => {
    const left = n.split(' ').filter((w) => !town.has(w)).join(' ');
    return nameWords(left).length > 0 ? left : n;
  };
  const like = nameLikeness(strip(a.norm), strip(b.norm));
  if (d < 40 && like >= 0.5) return { by: 'same_spot', distanceM: Math.round(d) };
  if (d < 250 && like >= 0.8) return { by: 'near_name', distanceM: Math.round(d) };
  if (d < 1000 && a.city && a.city === b.city && like === 1 && nameWords(a.norm).length === nameWords(b.norm).length) {
    return { by: 'city_name', distanceM: Math.round(d) };
  }
  return null;
}

/**
 * The kind of a venue from its own name, for sources with no type (Castilla y
 * León). Ordered: «Teatro Auditorio» is a theatre.
 */
export function kindFromName(norm: string): VenueKind {
  if (/\b(teatro|teatre|theatre|cine teatro|corral)\b/.test(norm)) return 'theatre';
  if (/\b(auditorio|auditori|auditorium)\b/.test(norm)) return 'auditorium';
  if (/\b(casa de (la )?cultura|centro cultural|centre cultural|ateneo|ateneu|casino|casal)\b/.test(norm)) {
    return 'cultural_centre';
  }
  if (/\b(polivalente|multiusos|multifuncional|salon de actos|centro civico|sala municipal|salon municipal)\b/.test(norm)) {
    return 'multipurpose';
  }
  if (/\b(palacio de congresos|palau)\b/.test(norm)) return 'auditorium';
  return 'other_stage';
}

/**
 * The search: every word of the text must be in the entry's key
 * (`search_key` = normalised name + city), in any order. Returns the words,
 * or [] under two letters. PostgREST pattern metacharacters cannot survive
 * `normPlace`, which keeps letters, digits and single spaces only.
 */
export function directoryQueryWords(norm: string): string[] {
  if (norm.replace(/ /g, '').length < 2) return [];
  return [...new Set(norm.split(' ').filter(Boolean))].slice(0, 6);
}

/** Words that stay lower case inside a title-cased name (es, ca, fr, gl). */
const SMALL_WORDS = new Set([
  'de', 'del', 'dels', 'la', 'las', 'les', 'el', 'els', 'los', 'lo', 'y', 'i', 'e', 'et',
  'en', 'a', 'al', 'du', 'des', 'le', 'da', 'do', 'das', 'dos', 'sur', 'per',
]);

/** One lower-cased word in title case; «d'olot» → «d'Olot», «l'ateneu» → «L'Ateneu» first. */
function titleWord(word: string, first: boolean): string {
  const m = /^([("«“]*)(?:([ldn])['’])?(.*)$/u.exec(word);
  if (!m) return word;
  const [, open, elision, body] = m;
  const cap = (w: string) => w.replace(/^(\p{L})/u, (c) => c.toUpperCase()).replace(/([-'’])(\p{L})/gu, (_x, sep: string, c: string) => sep + c.toUpperCase());
  if (elision) return `${open}${first ? elision.toUpperCase() : elision}'${cap(body)}`;
  if (!first && SMALL_WORDS.has(body)) return open + body;
  return open + cap(body);
}

/**
 * A name typed IN CAPITALS (all of Gencat, part of Castilla y León) in title
 * case: «CASAL DE CULTURA D'OLOT» → «Casal de Cultura d'Olot». A name that
 * already has lower case letters is left exactly as the source wrote it.
 * Spaces are collapsed either way.
 */
export function tidyName(raw: string): string {
  const s = raw.replace(/\s+/g, ' ').trim();
  if (/\p{Ll}/u.test(s)) return s;
  return s
    .toLowerCase()
    .split(' ')
    .map((w, i) => titleWord(w, i === 0))
    .join(' ');
}
