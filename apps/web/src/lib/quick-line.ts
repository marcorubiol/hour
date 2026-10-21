/**
 * LA LÍNEA QUE ENTIENDE TEXTO (ADR-139 § 3, «después»). El alta rápida tiene
 * un título grande; lo que se escribe en él se lee aquí y reparte lo que
 * reconoce en las fichas: «ensayo jue 10-14 Mercat» es un ensayo, el próximo
 * jueves, de 10 a 14, en el Mercat. Lo que no se reconoce queda como título.
 *
 * Determinista y sin red: una función pura sobre el texto, el día de hoy (en
 * el reloj de quien mira, `viewerTimeZone`) y los lugares que el diálogo ya
 * tiene cargados. Nada de IA. Las palabras van en cuatro idiomas (ca, es, en,
 * fr), plegadas (sin acentos, minúsculas), como en ⌘K (`palette-create`).
 *
 * LAS REGLAS, en el orden en que se aplican:
 * 1. Entre comillas («…», "…", “…”) es título, literal: «"Viernes 13"» no es
 *    un viernes.
 * 2. Un lugar conocido del espacio (salas y ciudades de las funciones y los
 *    bolos que el diálogo ya cargó) se reconoce entero, antes que nada: «Sala
 *    Mañana» no es mañana si es una sala conocida.
 * 3. El tipo: la primera palabra que no es una fecha («ensayo», «assaig»,
 *    «day off», «bolo»…). Una sola; una palabra de tipo más adelante es
 *    título («Ensayo general» → ensayo, título «general»).
 * 4. Un día o un tramo de días: hoy, mañana, pasado mañana; un día de la
 *    semana (el próximo, hoy incluido); «el 14» (el próximo 14); «14 nov»,
 *    «14 de noviembre de 2027», «nov 14»; «14/11», «2026-11-14»; tramos «3-5
 *    dic», «del 3 al 5», «28 nov - 2 dic», «lun-vie», «16 nov hasta el 19».
 *    Solo el primero; un segundo día queda en el título, a la vista.
 * 5. Una hora o una franja: «20h», «20:30», «20h30», «8pm», «a las 20»,
 *    «10-14», «de 10 a 14h». «10-14» sin mes es una franja si el tipo lleva
 *    hora; si no (día off, residencia, función), son días.
 * 6. Dónde: tras una preposición («en el Mercat», «a Girona», «at», «à»), o
 *    las palabras con mayúscula que siguen a la fecha o la hora («ensayo jue
 *    10-14 Mercat»). En un viaje, «BCN → Madrid», «de Girona a Madrid»; una
 *    flecha sin tipo dice que es un viaje. «ida» y «vuelta» dan la dirección.
 *
 * LO QUE NO SE ADIVINA (y por qué, en el informe del carril): una ciudad
 * desconocida sin preposición en una función va a la sala (la línea de una
 * función es su sala); la fecha numérica es día/mes, nunca mes/día; un día ya
 * pasado del año es del año que viene salvo si pasó hace menos de 30 días
 * (anotar lo de la semana pasada sigue siendo este año).
 *
 * Y LO QUE SE FIJA A MANO MANDA (`applyLine`): una ficha corregida no la vuelve
 * a escribir el texto, y si lo corregido era una palabra (el tipo, el lugar),
 * esa palabra vuelve al título.
 */

import { addDaysIso, dayKeyInTz } from './planner';
import { normPlace } from './places';
import type { TravelDirection } from './date';
import { skeletonFor, switchType, type Draft, type QuickType, type When } from './quick-add';

/* ── Lo que sale ────────────────────────────────────────────────────── */

export type MarkKind = 'type' | 'when' | 'time' | 'where' | 'unused';

/** Un trozo reconocido del texto, en posiciones de carácter [from, to). */
export type LineMark = { from: number; to: number; kind: MarkKind };

export type LineParse = {
  /** El tipo que nombra el texto, o null (se queda el del diálogo). */
  type: QuickType | null;
  day: string | null;
  /** El último día de un tramo (> day). */
  until: string | null;
  /** «HH:MM». */
  start: string | null;
  end: string | null;
  /** La sala o el lugar (no en una función: su línea ya es la sala). */
  venue: string | null;
  /** La ciudad; en un viaje, el destino. */
  city: string | null;
  /** En un viaje, el origen. */
  origin: string | null;
  direction: TravelDirection | null;
  /** Lo que no se reconoció: el título (la sala, en una función). */
  title: string;
  marks: LineMark[];
  /** Una hora leída en un tipo que no lleva hora: se dice, no se guarda. */
  unused: string[];
};

/** Un lugar que el espacio ya conoce: una sala con su ciudad, o una ciudad. */
export type KnownPlace = { venue: string | null; city: string | null };

export type LineOptions = {
  now: Date;
  /** El reloj de quien escribe: «hoy» y «mañana» son los suyos. */
  tz: string;
  /** El tipo del diálogo, si el texto no nombra ninguno. */
  type: QuickType;
  places?: readonly KnownPlace[];
  /** Fijado a mano: esas palabras no se leen, se quedan en el título. */
  keep?: { type?: boolean; place?: boolean };
};

/* ── Las palabras (plegadas) ────────────────────────────────────────── */

export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Tipo: listas de palabras; una entrada con espacio son varias seguidas. */
const TYPE_WORDS: Array<[QuickType, string[]]> = [
  ['day_off', ['day off', 'day-off', 'dayoff', 'dia off', 'dia libre', 'dia lliure', 'jour off', 'jour de repos', 'descanso', 'descans', 'relache']],
  ['unavailable', ['no disponible', 'no disponibles', 'not available', 'pas disponible', 'unavailable', 'indisponible', 'indisponibles']],
  ['performance', ['funcion', 'funciones', 'funcio', 'funcions', 'actuacion', 'actuacio', 'bolo', 'bolos', 'concierto', 'concert', 'show', 'gig', 'performance', 'representacion', 'representacio', 'representation']],
  ['rehearsal', ['ensayo', 'ensayos', 'assaig', 'assajos', 'rehearsal', 'rehearsals', 'repetition', 'repetitions']],
  ['travel_day', ['viaje', 'viatge', 'travel', 'trip', 'voyage', 'deplacement', 'desplazamiento', 'desplacament']],
  ['residency', ['residencia', 'residency', 'residence']],
  ['press', ['prensa', 'premsa', 'press', 'presse']],
];

/** JS getDay(): 0 domingo … 6 sábado. */
const WEEKDAY_WORDS: string[][] = [
  ['domingo', 'dom', 'diumenge', 'dg', 'sunday', 'sun', 'dimanche', 'dim'],
  ['lunes', 'lun', 'dilluns', 'dl', 'monday', 'mon', 'lundi'],
  ['martes', 'mar', 'dimarts', 'dt', 'tuesday', 'tue', 'tues', 'mardi'],
  ['miercoles', 'mie', 'mier', 'dimecres', 'dc', 'wednesday', 'wed', 'mercredi', 'mer'],
  ['jueves', 'jue', 'dijous', 'dj', 'thursday', 'thu', 'thur', 'thurs', 'jeudi', 'jeu'],
  ['viernes', 'vie', 'divendres', 'dv', 'friday', 'fri', 'vendredi', 'ven'],
  ['sabado', 'sab', 'dissabte', 'ds', 'saturday', 'sat', 'samedi', 'sam'],
];
/** Abreviaturas que también son palabras («mon spectacle», «ven a casa», «mar
    adentro»): cuentan solo si después no viene una palabra en minúscula. */
const WEEKDAY_SHY = new Set(['mon', 'mar', 'mer', 'ven', 'sam', 'dim', 'dom', 'sun', 'sat', 'wed']);

const MONTH_WORDS: string[][] = [
  ['enero', 'ene', 'gener', 'gen', 'january', 'jan', 'janvier', 'janv'],
  ['febrero', 'feb', 'febrer', 'february', 'fevrier', 'fevr', 'fev'],
  ['marzo', 'mar', 'marc', 'march', 'mars'],
  ['abril', 'abr', 'april', 'apr', 'avril', 'avr'],
  ['mayo', 'may', 'maig', 'mai'],
  ['junio', 'jun', 'juny', 'june', 'juin'],
  ['julio', 'jul', 'juliol', 'july', 'juillet', 'juil'],
  ['agosto', 'ago', 'agost', 'ag', 'august', 'aug', 'aout'],
  ['septiembre', 'setiembre', 'sep', 'sept', 'set', 'setembre', 'september', 'septembre'],
  ['octubre', 'oct', 'october', 'octobre'],
  ['noviembre', 'nov', 'novembre', 'november'],
  ['diciembre', 'dic', 'desembre', 'des', 'december', 'dec', 'decembre'],
];

const TODAY = ['hoy', 'avui', 'today', "aujourd'hui", 'aujourdhui', 'auj'];
const TOMORROW = ['manana', 'dema', 'tomorrow', 'demain'];
const AFTER_TOMORROW = ['pasado manana', 'passat dema', 'dema passat', 'day after tomorrow', 'apres-demain', 'apres demain', 'pasadomanana'];

/** Lo que puede ir delante de un día: «el 14», «le jeudi», «on the 14th». */
const DAY_PRE = new Set(['el', 'le', 'the', 'on', 'dia', 'jour', 'day', 'del', 'du', 'from', 'este', 'esta', 'aquest', 'aquesta', 'this', 'ce', 'cette', 'coming']);
/** «próximo jueves»: estrictamente después de hoy. */
const NEXT = new Set(['proximo', 'proxima', 'proper', 'propera', 'next', 'prochain', 'prochaine']);
/** Lo que une dos días de un tramo. */
const RANGE_SEP = ['-', 'al', 'a', 'au', 'to', 'till', 'until', 'through', 'thru', 'hasta', 'fins', 'fins a', 'fins al', "jusqu'au", "jusqu'a", 'jusqu au'];
/** Lo que une dos horas de una franja. */
const TIME_SEP = ['-', 'a', 'to', 'until', 'till', 'hasta', 'fins', 'fins a', 'fins les', 'y', 'i', 'and', 'et'];
/** Lo que pone una hora delante: «a las 20», «at 8», «à 20h». */
const TIME_PRE = ['a las', 'a les', 'a la', 'at', 'a', 'sobre las', 'cap a les', 'vers', 'around', 'hacia las', 'de', 'de las', 'de les', 'des de les', 'desde las', 'from', 'entre', 'between', 'des', 'du'];
/** Antes de un día o una hora: se lo lleva la marca, no el título. */
const GLUE = new Set(['de', 'del', 'd', 'el', 'la', 'le', 'the', 'on', 'a', 'al', 'au', 'at', 'from', 'desde', 'des', 'depuis', 'entre', 'between', 'por', 'per', 'pour', 'for', ',', '-', '·', '|', '/']);
/** «Dónde» tras una preposición. */
const PLACE_PRE = new Set(['en', 'a', 'al', 'at', 'in', 'au', 'aux', 'chez', 'dans', 'sala']);
const TRIP_FROM = new Set(['de', 'desde', 'des', 'from', 'depuis', 'd']);
const TRIP_TO = new Set(['a', 'al', 'hacia', 'cap', 'to', 'vers', 'au', 'aux', 'en', 'in', 'para', 'pour']);
/** Dentro de un nombre propio: «Mercat de les Flors», «Teatre i Dansa». */
const NAME_JOIN = new Set(['de', 'del', 'dels', 'la', 'les', 'el', 'los', 'las', 'l', 'd', 'i', 'y', 'et', 'of', 'the', 'du', 'des', 'and', 'sur', 'en', 'da', 'di', '&']);
/** El artículo tras la preposición no es del nombre: «en el Mercat» → Mercat. */
const ARTICLE = new Set(['el', 'la', 'les', 'los', 'las', 'l', 'le', 'the', 'du', 'del']);
const ARROWS = /(→|->|=>|⟶|➝|➔|>)/;
const DIRECTION_WORDS: Array<[TravelDirection, string[]]> = [
  ['outbound', ['ida', 'anada', 'outbound', 'aller']],
  ['return', ['vuelta', 'tornada', 'retorno', 'return', 'retour']],
];
const NOON = ['mediodia', 'migdia', 'noon', 'midi'];

/* ── Fichas de texto ────────────────────────────────────────────────── */

type Tok = {
  raw: string;
  /** Plegada, sin la puntuación de los bordes. Vacía en un literal. */
  f: string;
  from: number;
  to: number;
  /** Entre comillas: título, siempre. */
  lit: boolean;
  /** Empieza en mayúscula (o es un código: «BCN»). */
  cap: boolean;
  /** Qué lo reconoció; `unused`: una hora en un tipo sin hora. */
  used: MarkKind | null;
};

const EDGE_OPEN = /^[(¿¡"'«“]+/;
const EDGE_CLOSE = /[.,;:!?)"'»”]+$/;

function makeTok(text: string, from: number, to: number, lit = false): Tok {
  const raw = text.slice(from, to);
  const f = lit ? '' : fold(raw).replace(EDGE_OPEN, '').replace(EDGE_CLOSE, '');
  return { raw, f, from, to, lit, cap: /^[(¿¡"'«“]*\p{Lu}/u.test(raw), used: null };
}

const ISO_RE = /^\d{4}-\d{1,2}-\d{1,2}$/;
const DMY_DASH = /^\d{1,2}-\d{1,2}-\d{2,4}$/;

function isWeekdayWord(f: string): boolean {
  return WEEKDAY_WORDS.some((ws) => ws.includes(f));
}

/** Parte un trozo sin espacios: flechas, «d'octubre», y guiones junto a un
    número («3-5», «10h-14h», «nov-2») o entre días («lun-vie»). */
function splitChunk(text: string, from: number, to: number, out: Tok[]) {
  const chunk = text.slice(from, to);
  // Arrows first: «BCN→Madrid».
  const arrow = chunk.match(ARROWS);
  if (arrow && arrow.index !== undefined && chunk !== '-') {
    const a = from + arrow.index;
    const b = a + arrow[0].length;
    if (a > from) splitChunk(text, from, a, out);
    out.push(makeTok(text, a, b));
    if (b < to) splitChunk(text, b, to, out);
    return;
  }
  const elision = chunk.match(/^([dlDL])['’](?=\p{L})/u);
  if (elision) {
    out.push(makeTok(text, from, from + 2));
    splitChunk(text, from + 2, to, out);
    return;
  }
  const folded = fold(chunk).replace(EDGE_CLOSE, '');
  if (!ISO_RE.test(folded) && !DMY_DASH.test(folded) && /[-–—]/.test(chunk) && chunk.length > 1) {
    const parts = chunk.split(/([-–—])/);
    const words = parts.filter((p, i) => i % 2 === 0);
    const digitNext = /\d[-–—]|[-–—]\d/.test(chunk);
    const weekdays = words.length > 1 && words.every((w) => isWeekdayWord(fold(w).replace(EDGE_CLOSE, '')));
    if (digitNext || weekdays) {
      let at = from;
      for (const p of parts) {
        if (p) out.push(makeTok(text, at, at + p.length));
        at += p.length;
      }
      return;
    }
  }
  out.push(makeTok(text, from, to));
}

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  const quote = /"([^"]*)"|«([^»]*)»|“([^”]*)”/g;
  let at = 0;
  const plain = (from: number, to: number) => {
    for (const m of text.slice(from, to).matchAll(/\S+/g)) {
      const a = from + m.index!;
      splitChunk(text, a, a + m[0].length, out);
    }
  };
  for (const m of text.matchAll(quote)) {
    plain(at, m.index!);
    const inner = m.index! + 1;
    const end = m.index! + m[0].length - 1;
    if (end > inner) out.push(makeTok(text, inner, end, true));
    at = m.index! + m[0].length;
  }
  plain(at, text.length);
  for (const t of out) if (t.f === '–' || t.f === '—') t.f = '-';
  return out;
}

/* ── El analizador ──────────────────────────────────────────────────── */

type DaySpec =
  | { k: 'abs'; iso: string }
  | { k: 'dm'; d: number; m: number; y: number | null }
  | { k: 'd'; d: number; bare: boolean }
  | { k: 'wd'; wd: number; strict: boolean };

type Clock = { h: number; m: number; explicit: boolean; pm: boolean | null };

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function validDay(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function dayNum(f: string | undefined): { n: number; ordinal: boolean } | null {
  if (!f) return null;
  const m = f.match(/^(\d{1,2})(r|n|t|e|er|re|eme|st|nd|rd|th|o|a|º|ª)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 31 ? { n, ordinal: Boolean(m[2]) } : null;
}

function monthOf(f: string | undefined): number | null {
  if (!f) return null;
  const i = MONTH_WORDS.findIndex((ws) => ws.includes(f));
  return i < 0 ? null : i + 1;
}

function weekdayOf(f: string | undefined): number | null {
  if (!f) return null;
  const i = WEEKDAY_WORDS.findIndex((ws) => ws.includes(f));
  return i < 0 ? null : i;
}

function yearOf(f: string | undefined): number | null {
  if (!f || !/^20\d\d$/.test(f)) return null;
  return Number(f);
}

/** A clock word: «20h», «20:30», «20h30», «20.30h», «8pm», «mediodía»; a
    bare «20» only when the caller says the context makes it one. */
function clockOf(f: string | undefined, bareOk: boolean): Clock | null {
  if (!f) return null;
  if (NOON.includes(f)) return { h: 12, m: 0, explicit: true, pm: null };
  let m = f.match(/^(\d{1,2})(?::|h|\.)(\d{2})h?$/);
  if (m) return mk(Number(m[1]), Number(m[2]), true, null);
  m = f.match(/^(\d{1,2})h$/);
  if (m) return mk(Number(m[1]), 0, true, null);
  m = f.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?$/);
  if (m) return mk(Number(m[1]), Number(m[2] ?? 0), true, m[3] === 'p');
  m = f.match(/^(\d{1,2})$/);
  if (m && bareOk) return mk(Number(m[1]), 0, false, null);
  return null;
  function mk(h: number, min: number, explicit: boolean, pm: boolean | null): Clock | null {
    if (min > 59) return null;
    if (pm !== null) {
      if (h < 1 || h > 12) return null;
      h = (h % 12) + (pm ? 12 : 0);
    }
    if (h > 24) return null;
    return { h, m: min, explicit, pm };
  }
}

function clockText(c: Clock): string {
  if (c.h === 24) return '23:59';
  return `${pad(c.h)}:${pad(c.m)}`;
}

/** Match a list of (possibly multi-word) phrases at i; the longest wins. */
function phraseAt(toks: Tok[], i: number, phrases: readonly string[]): number {
  let best = 0;
  for (const p of phrases) {
    const words = p.split(' ');
    if (words.length <= best) continue;
    if (words.every((w, k) => toks[i + k] && !toks[i + k].used && !toks[i + k].lit && toks[i + k].f === w)) best = words.length;
  }
  return best;
}

export function parseLine(text: string, opts: LineOptions): LineParse {
  const toks = tokenize(text);
  const today = dayKeyInTz(opts.now.toISOString(), opts.tz);
  const free = (i: number) => Boolean(toks[i]) && !toks[i].used && !toks[i].lit;
  const f = (i: number) => (free(i) ? toks[i].f : undefined);
  const use = (i: number, n: number, kind: MarkKind) => {
    for (let k = i; k < i + n; k++) toks[k].used = kind;
  };

  const out: LineParse = {
    type: null,
    day: null,
    until: null,
    start: null,
    end: null,
    venue: null,
    city: null,
    origin: null,
    direction: null,
    title: '',
    marks: [],
    unused: [],
  };

  // 2 · Known places, whole and first. Kept aside: which slot they fill
  // depends on the type, read next.
  const known: Array<{ i: number; n: number; place: KnownPlace; isCity: boolean }> = [];
  if (!opts.keep?.place) {
    const names: Array<{ key: string[]; place: KnownPlace; isCity: boolean }> = [];
    for (const p of opts.places ?? []) {
      if (p.venue && normPlace(p.venue).length >= 3) names.push({ key: normPlace(p.venue).split(' '), place: p, isCity: false });
      if (p.city && normPlace(p.city).length >= 3) names.push({ key: normPlace(p.city).split(' '), place: { venue: null, city: p.city }, isCity: true });
    }
    names.sort((a, b) => b.key.length - a.key.length);
    for (let i = 0; i < toks.length; i++) {
      if (!free(i)) continue;
      for (const nm of names) {
        let k = 0;
        let ti = i;
        const keyJoined: string[] = [];
        while (keyJoined.length < nm.key.length && free(ti)) {
          const part = normPlace(toks[ti].raw);
          if (!part) break;
          keyJoined.push(...part.split(' '));
          ti++;
          k++;
        }
        if (keyJoined.join(' ') === nm.key.join(' ')) {
          // A lone date or type word that happens to be a name is not a place.
          if (k === 1 && (weekdayOf(toks[i].f) !== null || monthOf(toks[i].f) !== null || TODAY.includes(toks[i].f) || TOMORROW.includes(toks[i].f))) continue;
          use(i, k, 'where');
          known.push({ i, n: k, place: nm.place, isCity: nm.isCity });
          i += k - 1;
          break;
        }
      }
    }
  }

  // 3 · The type: the first word that is not a date.
  const dateish = (i: number) => {
    const w = f(i);
    if (!w) return false;
    return /\d/.test(w) || weekdayOf(w) !== null || monthOf(w) !== null || DAY_PRE.has(w) || NEXT.has(w) ||
      TODAY.includes(w) || TOMORROW.includes(w) || GLUE.has(w);
  };
  if (!opts.keep?.type) {
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].used) continue;
      if (toks[i].lit) break;
      let hit = false;
      for (const [type, words] of TYPE_WORDS) {
        const n = phraseAt(toks, i, words);
        if (n) {
          out.type = type;
          use(i, n, 'type');
          hit = true;
          break;
        }
      }
      if (hit || !dateish(i)) break;
    }
  }
  const effType = out.type ?? opts.type;
  const sk = skeletonFor(effType);
  const hasHours = sk.when.hours;

  // Direction of a trip.
  if (effType === 'travel_day' || out.type === null) {
    for (let i = 0; i < toks.length && !out.direction; i++) {
      for (const [dir, words] of DIRECTION_WORDS) {
        if (f(i) && words.includes(f(i)!)) {
          if (effType !== 'travel_day') continue;
          out.direction = dir;
          use(i, 1, 'type');
          break;
        }
      }
    }
  }

  // 4 · Days.
  const dayAt = (i: number): { n: number; spec: DaySpec } | null => {
    const lead = phraseAt(toks, i, AFTER_TOMORROW);
    if (lead) return { n: lead, spec: { k: 'abs', iso: addDaysIso(today, 2) } };
    let j = i;
    let strict = false;
    let pre = false;
    while (f(j) && (DAY_PRE.has(f(j)!) || NEXT.has(f(j)!))) {
      if (NEXT.has(f(j)!)) strict = true;
      pre = true;
      j++;
    }
    const w = f(j);
    if (!w) return null;
    // Relative words. «por la mañana» is the morning, not tomorrow.
    let n = phraseAt(toks, j, AFTER_TOMORROW);
    if (n) return { n: j - i + n, spec: { k: 'abs', iso: addDaysIso(today, 2) } };
    if (TODAY.includes(w)) return { n: j - i + 1, spec: { k: 'abs', iso: today } };
    if (TOMORROW.includes(w)) {
      const prev = toks[j - 1]?.f;
      if (w === 'manana' && (prev === 'la' || prev === 'por' || prev === 'de')) return null;
      return { n: j - i + 1, spec: { k: 'abs', iso: addDaysIso(today, 1) } };
    }
    // A weekday, maybe with its number («jue 14», «vendredi 14 nov»).
    const wd = weekdayOf(w);
    if (wd !== null) {
      if (WEEKDAY_SHY.has(w)) {
        const next = toks[j + 1];
        if (next && !next.used && !next.lit && /^\p{Ll}/u.test(next.raw) && !dateish(j + 1) && !TYPE_WORDS.some(([, ws]) => ws.includes(next.f))) return null;
      }
      const num = dayNum(f(j + 1));
      if (num) {
        const mo = monthOf(f(j + 2)) ?? (f(j + 2) === 'de' ? monthOf(f(j + 3)) : null);
        const sep = f(j + 2);
        const isRange = sep !== undefined && (sep === '-' || TIME_SEP.includes(sep));
        if (mo !== null) {
          const mAt = monthOf(f(j + 2)) !== null ? j + 2 : j + 3;
          const y = yearAfter(mAt + 1);
          return { n: mAt + 1 + y.n - i, spec: { k: 'dm', d: num.n, m: mo, y: y.y } };
        }
        const ampmNext = /^[ap]\.?m\.?$/.test(f(j + 2) ?? '');
        if (!isRange && !ampmNext && !clockOf(f(j + 1), false)) return { n: j + 2 - i, spec: { k: 'd', d: num.n, bare: false } };
      }
      return { n: j + 1 - i, spec: { k: 'wd', wd, strict } };
    }
    // ISO and numeric dates (day/month, never month/day).
    let m = w.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]), j - i + 1);
    m = w.match(/^(\d{1,2})[/](\d{1,2})(?:[/](\d{2}|\d{4}))?$/) ?? w.match(/^(\d{1,2})[.-](\d{1,2})[.-](\d{2}|\d{4})$/);
    if (m) {
      const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null;
      if (y !== null) return valid(y, Number(m[2]), Number(m[1]), j - i + 1);
      return { n: j - i + 1, spec: { k: 'dm', d: Number(m[1]), m: Number(m[2]), y: null } };
    }
    // «nov 14», «november 14th, 2027».
    const mo0 = monthOf(w);
    if (mo0 !== null) {
      const num = dayNum(f(j + 1));
      if (num) {
        const y = yearAfter(j + 2);
        return { n: j + 2 + y.n - i, spec: { k: 'dm', d: num.n, m: mo0, y: y.y } };
      }
      return null;
    }
    // «14 nov», «14 de noviembre de 2027», «1r d'octubre», «el 14», «14th».
    const num = dayNum(w);
    if (num) {
      let k = j + 1;
      if (f(k) === 'de' || f(k) === 'd') k++;
      const mo = monthOf(f(k));
      if (mo !== null) {
        const y = yearAfter(k + 1);
        return { n: k + 1 + y.n - i, spec: { k: 'dm', d: num.n, m: mo, y: y.y } };
      }
      return { n: j + 1 - i, spec: { k: 'd', d: num.n, bare: !pre && !num.ordinal } };
    }
    return null;

    function valid(y: number, mo: number, d: number, len: number) {
      return validDay(y, mo, d) ? { n: len, spec: { k: 'abs' as const, iso: isoOf(y, mo, d) } } : null;
    }
    function yearAfter(k: number): { n: number; y: number | null } {
      if (yearOf(f(k)) !== null) return { n: 1, y: yearOf(f(k)) };
      if ((f(k) === 'de' || f(k) === ',') && yearOf(f(k + 1)) !== null) return { n: 2, y: yearOf(f(k + 1)) };
      if (toks[k - 1]?.raw.endsWith(',') && yearOf(f(k)) !== null) return { n: 1, y: yearOf(f(k)) };
      return { n: 0, y: null };
    }
  };

  /** A spec to a day; `after` resolves a range's end against its start. */
  const resolve = (s: DaySpec, after?: string): string | null => {
    const [ty, tm, td] = today.split('-').map(Number);
    switch (s.k) {
      case 'abs':
        return s.iso;
      case 'wd': {
        const from = after ?? today;
        const dow = new Date(`${from}T00:00:00Z`).getUTCDay();
        let delta = (s.wd - dow + 7) % 7;
        if (delta === 0 && (s.strict || after)) delta = after ? 0 : 7;
        return addDaysIso(from, delta);
      }
      case 'dm': {
        if (s.y !== null) return validDay(s.y, s.m, s.d) ? isoOf(s.y, s.m, s.d) : null;
        if (after) {
          const ay = Number(after.slice(0, 4));
          for (const y of [ay, ay + 1]) if (validDay(y, s.m, s.d) && isoOf(y, s.m, s.d) >= after) return isoOf(y, s.m, s.d);
          return null;
        }
        // This year; a day already gone is next year's, unless it went less
        // than 30 days ago (writing down last week stays this year).
        // (Up to four years ahead: the 29th of February.)
        for (const y of [ty, ty + 1, ty + 2, ty + 3, ty + 4]) {
          if (!validDay(y, s.m, s.d)) continue;
          const iso = isoOf(y, s.m, s.d);
          if (iso >= addDaysIso(today, -30)) return iso;
        }
        return null;
      }
      case 'd': {
        const base = after ?? today;
        let [y, m] = after ? [Number(base.slice(0, 4)), Number(base.slice(5, 7))] : [ty, tm];
        for (let k = 0; k < 13; k++) {
          if (validDay(y, m, s.d)) {
            const iso = isoOf(y, m, s.d);
            if (iso >= (after ?? isoOf(ty, tm, td))) return iso;
          }
          m++;
          if (m > 12) {
            m = 1;
            y++;
          }
        }
        return null;
      }
    }
  };

  /** A range: «3-5 dic», «del 3 al 5», «28 nov - 2 dic», «lun-vie». */
  const rangeAt = (i: number): { n: number; from: string; to: string } | null => {
    const a = dayAt(i);
    if (!a) return null;
    const j = i + a.n;
    const sepN = phraseAt(toks, j, RANGE_SEP);
    if (!sepN) return null;
    const b = dayAt(j + sepN);
    if (!b) return null;
    // Two bare numbers («10-14», «3 a 5») are hours where the type has
    // them, unless «del 3 al 5» says days.
    const bothBare = a.spec.k === 'd' && a.spec.bare && b.spec.k === 'd' && b.spec.bare;
    const preDel = f(i) === 'del' || f(i) === 'du' || f(i) === 'from';
    if (a.spec.k === 'd' && b.spec.k === 'd' && (bothBare || a.spec.bare) && hasHours && !preDel) return null;
    let from: string | null;
    let to: string | null;
    if (a.spec.k === 'd' && b.spec.k === 'dm') {
      // «3-5 dic», «28-2 dic»: the start takes the end's month, or the one before.
      to = resolve(b.spec);
      if (!to) return null;
      const [ey, em] = [Number(to.slice(0, 4)), Number(to.slice(5, 7))];
      from = validDay(ey, em, a.spec.d) && a.spec.d <= b.spec.d ? isoOf(ey, em, a.spec.d) : null;
      if (!from) {
        const pm = em === 1 ? 12 : em - 1;
        const py = em === 1 ? ey - 1 : ey;
        from = validDay(py, pm, a.spec.d) ? isoOf(py, pm, a.spec.d) : null;
      }
    } else if (a.spec.k === 'wd' && b.spec.k === 'wd') {
      from = resolve(a.spec);
      to = from ? resolve(b.spec, from) : null;
    } else {
      from = resolve(a.spec);
      to = from ? resolve(b.spec, from) : null;
    }
    if (!from || !to || to <= from) return null;
    return { n: a.n + sepN + b.n, from, to };
  };

  /** One clock or a span of two. */
  const timeAt = (i: number): { n: number; start: Clock; end: Clock | null } | null => {
    let j = i;
    const preN = phraseAt(toks, j, TIME_PRE);
    const pre = preN > 0;
    j += preN;
    const ampm = (k: number): boolean | null => {
      const w = f(k);
      if (!w) return null;
      const m = w.match(/^([ap])\.?m\.?$/);
      return m ? m[1] === 'p' : null;
    };
    let a = clockOf(f(j), true);
    if (!a) return null;
    let k = j + 1;
    const apA = ampm(k);
    if (apA !== null && !a.explicit) {
      a = clockOf(`${f(j)}${apA ? 'pm' : 'am'}`, false);
      if (!a) return null;
      k++;
    }
    const sepN = phraseAt(toks, k, TIME_SEP);
    if (sepN) {
      let b = clockOf(f(k + sepN), true);
      if (b) {
        let n = k + sepN + 1;
        const apB = ampm(n);
        if (apB !== null && !b.explicit) {
          b = clockOf(`${f(k + sepN)}${apB ? 'pm' : 'am'}`, false);
          n++;
        }
        if (b) {
          // A span needs a word that makes it hours: an «h», a «de … a», or a
          // type that has hours («10-14» in a rehearsal).
          const sure = a.explicit || b.explicit || (pre && toks[k].f !== '-') || hasHours;
          // A month right after is a span of days, not hours.
          const dayRange = monthOf(f(n)) !== null || (f(n) === 'de' && monthOf(f(n + 1)) !== null);
          if (sure && !dayRange) {
            // «8-10pm»: the start follows the end into the afternoon.
            if (b.pm && a.pm === null && a.h < 12 && a.h + 12 < b.h) a = { ...a, h: a.h + 12 };
            const ends = b.h * 60 + b.m > a.h * 60 + a.m;
            return { n: n - i, start: a, end: ends ? b : null };
          }
        }
      }
    }
    if (!a.explicit) {
      // A bare number is an hour only after «a las», «at», «à».
      const w0 = toks[i].f;
      if (!pre || w0 === 'de' || w0 === 'from' || w0 === 'entre' || w0 === 'between' || w0 === 'des' || w0 === 'du') return null;
      if (w0 === 'a' && preN === 1) return null;
      if (dayNum(f(j)) && (monthOf(f(j + 1)) !== null || f(j + 1) === 'de')) return null;
    }
    return { n: k - i, start: a, end: null };
  };

  let gotDay = false;
  let gotTime = false;
  const takeTime = (i: number): boolean => {
    if (gotTime || !free(i)) return false;
    const t = timeAt(i);
    if (!t) return false;
    gotTime = true;
    const kind: MarkKind = hasHours ? 'time' : 'unused';
    use(i, t.n, kind);
    if (hasHours) {
      out.start = clockText(t.start);
      out.end = t.end ? clockText(t.end) : null;
    } else {
      out.unused.push(text.slice(toks[i].from, toks[i + t.n - 1].to));
    }
    return true;
  };
  for (let i = 0; i < toks.length; i++) {
    if (!free(i)) continue;
    if (!gotDay) {
      const r = rangeAt(i);
      if (r) {
        use(i, r.n, 'when');
        out.day = r.from;
        out.until = r.to;
        gotDay = true;
        i += r.n - 1;
        continue;
      }
    }
    if (takeTime(i)) {
      i = toks.findIndex((t, k) => k >= i && !t.used) - 1;
      if (i < -1) i = toks.length;
      continue;
    }
    if (!gotDay) {
      const d = dayAt(i);
      if (d && !(d.spec.k === 'd' && d.spec.bare)) {
        const iso = resolve(d.spec);
        if (iso) {
          use(i, d.n, 'when');
          out.day = iso;
          gotDay = true;
          i += d.n - 1;
        }
      }
    }
  }

  // Glue words just before a day or an hour go with it: «de 10 a 14» was
  // taken whole, but «Lectura, el jue» leaves a comma; «hasta el» too.
  for (let i = toks.length - 2; i >= 0; i--) {
    const next = toks[i + 1];
    if (!free(i) || !next.used || (next.used !== 'when' && next.used !== 'time' && next.used !== 'unused')) continue;
    if (GLUE.has(toks[i].f) || toks[i].f === '') toks[i].used = next.used;
  }

  // 6 · Where.
  const isTrip = effType === 'travel_day';
  const where = sk.where;
  /** A capitalised run from i (names may hold «de les», «i»). */
  const nameRun = (i: number): number => {
    if (!free(i) || !toks[i].cap) return 0;
    let n = 1;
    let k = i + 1;
    while (free(k)) {
      if (toks[k].cap) {
        n = k - i + 1;
        k++;
        continue;
      }
      if (NAME_JOIN.has(toks[k].f)) {
        k++;
        continue;
      }
      break;
    }
    return n;
  };
  const span = (i: number, n: number) => text.slice(toks[i].from, toks[i + n - 1].to).replace(EDGE_CLOSE, '');

  const place = { venue: null as string | null, city: null as string | null, origin: null as string | null };
  const placeWords: Array<{ i: number; n: number; role: 'place' | 'from' | 'to' }> = [];

  if (isTrip || (out.type === null && !opts.keep?.type)) {
    // An arrow: «BCN → Madrid», «Girona->Lyon».
    // In a trip, a dash between two names is an arrow too: «Barcelona - Girona».
    const ai = toks.findIndex(
      (t, x) =>
        !t.used &&
        !t.lit &&
        ((ARROWS.test(t.raw) && t.raw.replace(ARROWS, '') === '') ||
          (isTrip && t.f === '-' && free(x - 1) && free(x + 1) && toks[x - 1].cap && toks[x + 1].cap)),
    );
    if (ai >= 0 && !opts.keep?.place) {
      let s = ai;
      while (s - 1 >= 0 && free(s - 1)) s--;
      let e = ai + 1;
      while (free(e)) e++;
      // Only the words touching the arrow: a title before them stays.
      const left = s < ai ? lastRun(s, ai) : null;
      const right = ai + 1 < e ? firstRun(ai + 1, e) : null;
      if (left || right) {
        if (!isTrip) out.type = 'travel_day';
        use(ai, 1, 'where');
        if (left) placeWords.push({ ...left, role: 'from' });
        if (right) placeWords.push({ ...right, role: 'to' });
        for (const p of placeWords) use(p.i, p.n, 'where');
      }
    }
  }
  const tripNow = (out.type ?? opts.type) === 'travel_day';

  if (!opts.keep?.place && where !== 'none') {
    // After a preposition.
    for (let i = 0; i < toks.length; i++) {
      if (!free(i)) continue;
      const w = toks[i].f;
      const fromWord = tripNow && TRIP_FROM.has(w);
      const toWord = tripNow ? TRIP_TO.has(w) : PLACE_PRE.has(w) || w.startsWith('@');
      if (!fromWord && !toWord) continue;
      let k = w.startsWith('@') && w.length > 1 ? i : i + 1;
      if (w === 'cap' && f(k) === 'a') k++;
      if (w === 'des' && f(k) === 'de') k++;
      if (ARTICLE.has(f(k) ?? '') && !toks[k].cap && free(k + 1) && toks[k + 1].cap) k++;
      if (k === i) {
        // «@Mercat»: the name is in the same word.
        use(i, 1, 'where');
        placeWords.push({ i, n: 1, role: 'place' });
        continue;
      }
      const n = nameRun(k);
      if (!n) continue;
      if (w === 'sala') {
        // «sala Beckett»: the word is part of the name.
        use(i, n + k - i, 'where');
        placeWords.push({ i, n: n + k - i, role: 'place' });
      } else {
        use(i, k - i, 'where');
        use(k, n, 'where');
        placeWords.push({ i: k, n, role: tripNow ? (fromWord ? 'from' : 'to') : 'place' });
      }
      i = k + n - 1;
    }
    // A capitalised run right after the day or the hour: «… 10-14 Mercat».
    for (let i = 1; i < toks.length; i++) {
      if (!free(i) || !toks[i].cap) continue;
      const prev = toks[i - 1].used;
      if (prev !== 'when' && prev !== 'time' && prev !== 'unused') continue;
      const n = nameRun(i);
      if (!n) continue;
      use(i, n, 'where');
      placeWords.push({ i, n, role: tripNow ? (placeWords.some((p) => p.role === 'to') ? 'from' : 'to') : 'place' });
      i += n - 1;
    }
  }

  // Fill the slots, by type.
  const title = (): string => {
    const runs: string[] = [];
    let run: Tok[] = [];
    const flush = () => {
      if (run.length) runs.push(run.some((t) => t.lit) ? run.map((t) => t.raw).join(' ') : text.slice(run[0].from, run[run.length - 1].to));
      run = [];
    };
    for (const t of toks) {
      if (t.used) flush();
      else run.push(t);
    }
    flush();
    return runs
      .join(' ')
      .replace(/^[\s,;·|:\-–—/]+|[\s,;·|:\-–—/]+$/g, '')
      .replace(/\s{2,}/g, ' ');
  };

  if (tripNow) {
    for (const p of placeWords) {
      const s = span(p.i, p.n);
      if (p.role === 'from' && !place.origin) place.origin = s;
      else if (p.role !== 'from' && !place.city) place.city = s;
    }
    for (const k of known) {
      const name = k.place.city ?? k.place.venue ?? '';
      const before = toks.slice(0, k.i).some((t) => t.used === 'where' && ARROWS.test(t.raw));
      const fromPre = k.i > 0 && TRIP_FROM.has(toks[k.i - 1].f);
      if ((before || place.origin) && !place.city) place.city = name;
      else if ((fromPre || toks.slice(k.i + k.n).some((t) => t.used === 'where' && ARROWS.test(t.raw))) && !place.origin) place.origin = name;
      else if (!place.city) place.city = name;
      else if (!place.origin) place.origin = name;
    }
  } else if (where === 'venue') {
    // A performance: its line is its venue. A known city goes to the city;
    // a known venue stays in the line and brings its city.
    for (const k of known) {
      if (k.isCity) place.city ??= k.place.city;
      else {
        place.city ??= k.place.city;
        for (let x = k.i; x < k.i + k.n; x++) toks[x].used = null;
      }
    }
    for (const p of placeWords) {
      // A named place with a venue already in the line is its city; alone,
      // it is the venue (the line).
      const others = toks.some((t, x) => !t.used && (x < p.i || x >= p.i + p.n));
      if (others && !place.city) place.city = span(p.i, p.n);
      else for (let x = p.i; x < p.i + p.n; x++) toks[x].used = null;
    }
    // A preposition left alone in the line goes with what it introduced.
    for (let x = 0; x < toks.length; x++) {
      if (toks[x].used === 'where' && !toks.slice(x + 1).some((t) => t.used === 'where') && toks[x + 1] && !toks[x + 1].used) {
        if (PLACE_PRE.has(toks[x].f) || ARTICLE.has(toks[x].f)) toks[x].used = null;
      }
    }
  } else if (where === 'place') {
    for (const k of known) {
      if (k.isCity) place.city ??= k.place.city;
      else {
        place.venue ??= k.place.venue;
        place.city ??= k.place.city;
      }
    }
    for (const p of placeWords) {
      const s = span(p.i, p.n).replace(/^@/, '');
      if (!place.venue) place.venue = s;
      else if (!place.city) place.city = s;
    }
  } else {
    // No «where» in this type: the words are the title.
    for (const k of known) for (let x = k.i; x < k.i + k.n; x++) toks[x].used = null;
  }
  out.venue = place.venue;
  out.city = place.city;
  out.origin = place.origin;
  out.title = title();

  // Marks: adjacent tokens of one kind are one mark.
  for (const t of toks) {
    if (!t.used) continue;
    const last = out.marks[out.marks.length - 1];
    const between = last ? text.slice(last.to, t.from) : '';
    if (last && last.kind === t.used && /^\s*$/.test(between)) last.to = t.to;
    else out.marks.push({ from: t.from, to: t.to, kind: t.used });
  }
  return out;

  function lastRun(s: number, e: number): { i: number; n: number } | null {
    // The capitalised (or code) run that ends right before e.
    let i = e - 1;
    while (i >= s && free(i) && (toks[i].cap || NAME_JOIN.has(toks[i].f))) i--;
    let st = i + 1;
    while (st < e && NAME_JOIN.has(toks[st].f)) st++;
    if (st >= e) {
      // No capitals: the one word before the arrow («bcn → madrid»).
      return free(e - 1) && !dateish(e - 1) ? { i: e - 1, n: 1 } : null;
    }
    return { i: st, n: e - st };
  }
  function firstRun(s: number, e: number): { i: number; n: number } | null {
    const n = nameRun(s);
    if (n) return { i: s, n: Math.min(n, e - s) };
    return free(s) && !dateish(s) ? { i: s, n: 1 } : null;
  }
}

/* ── Del texto al borrador ──────────────────────────────────────────── */

/** Lo que la persona fijó a mano en una ficha: el texto ya no lo escribe. */
export type LineHand = {
  type: boolean;
  day: boolean;
  time: boolean;
  venue: boolean;
  city: boolean;
  origin: boolean;
  direction: boolean;
};

export const NO_HAND: LineHand = {
  type: false,
  day: false,
  time: false,
  venue: false,
  city: false,
  origin: false,
  direction: false,
};

/** Lo que había antes de que el texto escribiera cada cosa: borrar la
    palabra lo devuelve (borrar «jue» devuelve el día de la celda). */
export type LineBase = {
  type?: QuickType;
  day?: Pick<When, 'day' | 'until' | 'until_on'>;
  time?: Pick<When, 'timed' | 'start' | 'end'>;
  venue?: string;
  city?: string;
  origin?: string;
  direction?: TravelDirection;
};

/**
 * El texto leído, puesto en el borrador. Solo toca lo que no se fijó a mano;
 * lo que el texto deja de decir vuelve a lo que había. El título es siempre
 * lo que quedó sin reconocer.
 */
export function applyLine(d: Draft, p: LineParse, hand: LineHand, base: LineBase): { draft: Draft; base: LineBase } {
  let draft: Draft = { ...d, when: { ...d.when } };
  const b: LineBase = { ...base };

  if (!hand.type) {
    if (p.type && p.type !== draft.type) {
      if (b.type === undefined) b.type = draft.type;
      draft = switchType(draft, p.type);
      draft = { ...draft, when: { ...draft.when } };
    } else if (!p.type && b.type !== undefined) {
      draft = switchType(draft, b.type);
      draft = { ...draft, when: { ...draft.when } };
      delete b.type;
    }
  }
  const sk = skeletonFor(draft.type);

  if (!hand.day) {
    if (p.day) {
      b.day ??= { day: draft.when.day, until: draft.when.until, until_on: draft.when.until_on };
      draft.when.day = p.day;
      if (p.until) {
        draft.when.until_on = true;
        draft.when.until = p.until;
      } else {
        draft.when.until = '';
        draft.when.until_on = sk.when.untilOpen;
      }
    } else if (b.day) {
      Object.assign(draft.when, b.day);
      delete b.day;
    }
  }

  if (!hand.time) {
    if (p.start && sk.when.hours) {
      b.time ??= { timed: draft.when.timed, start: draft.when.start, end: draft.when.end };
      draft.when.timed = true;
      draft.when.start = p.start;
      draft.when.end = p.end ?? '';
    } else if (b.time) {
      Object.assign(draft.when, b.time);
      delete b.time;
    }
  }

  for (const key of ['venue', 'city', 'origin'] as const) {
    if (hand[key]) continue;
    const want = p[key];
    if (want) {
      if (b[key] === undefined) b[key] = draft[key];
      draft[key] = want;
    } else if (b[key] !== undefined) {
      draft[key] = b[key]!;
      delete b[key];
    }
  }

  if (!hand.direction) {
    if (p.direction) {
      if (b.direction === undefined) b.direction = draft.direction;
      draft.direction = p.direction;
    } else if (b.direction !== undefined) {
      draft.direction = b.direction;
      delete b.direction;
    }
  }

  draft.title = p.title;
  return { draft, base: b };
}

/** Lo que entendió, en una frase para un lector de pantalla. */
export function lineSummary(parts: Array<string | null | undefined>): string {
  return parts.filter((s): s is string => Boolean(s && s.trim())).join(' · ');
}
