/**
 * Pure runtime-agnostic timezone, ICS text, and 4-locale calendar vocabulary
 * helpers (ADR-241).
 *
 * Intentionally imports ZERO Svelte (`.svelte.ts`), ZERO Vite (`import.meta.glob`),
 * and ZERO `$lib/*` aliases so it bundles cleanly in BOTH SvelteKit AND
 * Wrangler's esbuild pass for `worker-entry.js` (`src/worker-cron.ts`).
 */

export type CalendarLocale = 'ca' | 'es' | 'en' | 'fr';
export const CALENDAR_LOCALES: readonly CalendarLocale[] = ['ca', 'es', 'en', 'fr'];

const WORDS: Record<CalendarLocale, Record<string, string>> = {
  es: {
    option_suffix: 'opción',
    pending_suffix: 'por contestar',
    in_hour: 'En hour: {url}',
    perf_label: 'Función',
    arrives: 'llega {time}',
    kind_load_in: 'carga',
    kind_soundcheck: 'prueba de sonido',
    kind_doors: 'puertas',
    kind_start: 'función',
    kind_loadout: 'desmontaje',
    kind_wrap: 'fin',
    kind_curfew: 'toque de queda',
    date_rehearsal: 'ensayo',
    date_residency: 'residencia',
    date_press: 'prensa',
    date_travel_day: 'día de viaje',
    date_day_off: 'día libre',
    date_other: 'otro',
    mode_train: 'tren',
    mode_plane: 'avión',
    mode_flight: 'avión',
    mode_car: 'coche',
    mode_van: 'furgoneta',
    mode_bus: 'bus',
    mode_ferry: 'ferri',
    mode_other: 'otro',
  },
  en: {
    option_suffix: 'hold',
    pending_suffix: 'to reply',
    in_hour: 'In hour: {url}',
    perf_label: 'Performance',
    arrives: 'arrives {time}',
    kind_load_in: 'load-in',
    kind_soundcheck: 'soundcheck',
    kind_doors: 'doors',
    kind_start: 'show',
    kind_loadout: 'load-out',
    kind_wrap: 'wrap',
    kind_curfew: 'curfew',
    date_rehearsal: 'rehearsal',
    date_residency: 'residency',
    date_press: 'press',
    date_travel_day: 'travel day',
    date_day_off: 'day off',
    date_other: 'other',
    mode_train: 'train',
    mode_plane: 'flight',
    mode_flight: 'flight',
    mode_car: 'car',
    mode_van: 'van',
    mode_bus: 'bus',
    mode_ferry: 'ferry',
    mode_other: 'other',
  },
  ca: {
    option_suffix: 'opció',
    pending_suffix: 'per contestar',
    in_hour: 'A hour: {url}',
    perf_label: 'Funció',
    arrives: 'arriba {time}',
    kind_load_in: 'càrrega',
    kind_soundcheck: 'prova de so',
    kind_doors: 'portes',
    kind_start: 'funció',
    kind_loadout: 'desmuntatge',
    kind_wrap: 'fi',
    kind_curfew: 'toc de queda',
    date_rehearsal: 'assaig',
    date_residency: 'residència',
    date_press: 'premsa',
    date_travel_day: 'dia de viatge',
    date_day_off: 'dia lliure',
    date_other: 'altre',
    mode_train: 'tren',
    mode_plane: 'avió',
    mode_flight: 'avió',
    mode_car: 'cotxe',
    mode_van: 'furgoneta',
    mode_bus: 'bus',
    mode_ferry: 'ferri',
    mode_other: 'altre',
  },
  fr: {
    option_suffix: 'option',
    pending_suffix: 'à confirmer',
    in_hour: 'Dans hour : {url}',
    perf_label: 'Représentation',
    arrives: 'arrivée {time}',
    kind_load_in: 'montage',
    kind_soundcheck: 'balances',
    kind_doors: 'portes',
    kind_start: 'représentation',
    kind_loadout: 'démontage',
    kind_wrap: 'fin',
    kind_curfew: 'couvre-feu',
    date_rehearsal: 'répétition',
    date_residency: 'résidence',
    date_press: 'presse',
    date_travel_day: 'jour de voyage',
    date_day_off: 'relâche',
    date_other: 'autre',
    mode_train: 'train',
    mode_plane: 'avion',
    mode_flight: 'avion',
    mode_car: 'voiture',
    mode_van: 'utilitaire',
    mode_bus: 'car',
    mode_ferry: 'ferry',
    mode_other: 'autre',
  },
};

export function calWord(
  locale: CalendarLocale,
  key: string,
  params?: Record<string, string>,
): string {
  let out = WORDS[locale]?.[key] ?? WORDS.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) out = out.replaceAll(`{${k}}`, v);
  }
  return out;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function partsInZone(date: Date, timeZone: string): Record<string, string> | null {
  try {
    let fmt = fmtCache.get(timeZone);
    if (!fmt) {
      fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      });
      fmtCache.set(timeZone, fmt);
    }
    const out: Record<string, string> = {};
    for (const p of fmt.formatToParts(date)) out[p.type] = p.value;
    if (out.hour === '24') out.hour = '00';
    return out;
  } catch {
    return null;
  }
}

/** Format an ISO instant in `timeZone` as `YYYYMMDDTHHMMSS` (for RFC 5545 `TZID=`). */
export function formatIcsLocal(iso: string, timeZone: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = partsInZone(d, timeZone);
  if (!p) return null;
  return `${p.year}${p.month}${p.day}T${p.hour}${p.minute}${p.second}`;
}

/** Calendar day `YYYY-MM-DD` of an ISO instant in `timeZone`. */
export function dayInZone(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const p = partsInZone(d, timeZone);
  return p ? `${p.year}-${p.month}-${p.day}` : d.toISOString().slice(0, 10);
}

/** Hour's Planner clock (`20h`, `9h30`) in `timeZone`. */
export function calClockText(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = partsInZone(d, timeZone);
  if (!p) return '';
  const h = String(Number(p.hour));
  return p.minute === '00' ? `${h}h` : `${h}h${p.minute}`;
}

/** Convert a wall-clock `YYYY-MM-DDTHH:mm` in `timeZone` to a UTC ISO instant. */
export function wallToUtcIso(wall: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(wall);
  if (!m) return null;
  const [, Y, M, D, h, min, sec = '00'] = m;
  const targetUtcMs = Date.UTC(Number(Y), Number(M) - 1, Number(D), Number(h), Number(min), Number(sec));
  let guess = targetUtcMs;
  for (let i = 0; i < 3; i++) {
    const p = partsInZone(new Date(guess), timeZone);
    if (!p) return null;
    const shownMs = Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute),
      Number(p.second),
    );
    const diff = targetUtcMs - shownMs;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess).toISOString();
}

export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const ch of line) {
    const chBytes = encoder.encode(ch).length;
    if (currentBytes + chBytes > 75) {
      out.push(current);
      current = ' ';
      currentBytes = 1;
    }
    current += ch;
    currentBytes += chBytes;
  }
  if (current) out.push(current);
  return out.join('\r\n');
}

export function formatIcsUtc(iso: string): string {
  return new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

export function formatIcsDate(day: string): string {
  return day.slice(0, 10).replace(/-/g, '');
}
