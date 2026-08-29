/**
 * ¿Esto que se está escribiendo en el ⌘K es un día?
 *
 * Puro y con `today` inyectado, como el resto de `$lib`: la paleta no debe
 * saber de husos ni de calendarios, y un parser que lee el reloj no se puede
 * probar. Devuelve un ISO `YYYY-MM-DD` o `null` — nunca adivina a medias.
 *
 * LOS NOMBRES DE MES NO SE ESCRIBEN AQUÍ. Salen de `Intl` para el locale que
 * toque, así que las tres lenguas de la app —y cualquiera futura— entran
 * gratis y no hay una tabla que se desincronice de `i18n`.
 *
 * Lo que NO acepta, a propósito: días de la semana sueltos («jueves»). Hay dos
 * jueves a un salto de aquí y elegir uno por el usuario es adivinar; un día es
 * un destino exacto o no es nada.
 */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
/** `10/7`, `10-7-2031`, `10.7.31` — día primero, que es la norma en ES/CA/EN-GB. */
const NUMERIC = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/;
/** `10 jul`, `10 de julio`, `3 oct 2031`. */
const DAY_MONTH = /^(\d{1,2})\s+(?:de\s+|d'|of\s+)?([\p{L}.]+)\.?(?:\s+(\d{2}|\d{4}))?$/u;

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  // Rebota el 31 de febrero en vez de deslizarlo al 3 de marzo: un día que no
  // existe no es un destino.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Sin tildes ni puntos, para que «març», «marc.» y «marc» sean lo mismo. */
function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\./g, '')
    .toLowerCase();
}

function monthFromName(name: string, locales: string[]): number | null {
  const want = fold(name);
  if (want.length < 3) return null;
  for (const loc of locales) {
    for (const width of ['long', 'short'] as const) {
      const fmt = new Intl.DateTimeFormat(loc, { month: width, timeZone: 'UTC' });
      for (let m = 1; m <= 12; m += 1) {
        const label = fold(fmt.format(new Date(Date.UTC(2020, m - 1, 1))));
        if (label === want || label.startsWith(want) || want.startsWith(label)) return m;
      }
    }
  }
  return null;
}

/** Un año de dos cifras es de este siglo: `31` es 2031, no 1931. */
function fullYear(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return raw.length === 2 ? 2000 + n : n;
}

export interface DayQueryOptions {
  /** Hoy, en ISO, en el huso del lector. Inyectado: nada aquí lee el reloj. */
  today: string;
  /** El locale activo primero; el resto como red, porque la gente escribe
      «sept» en una app en catalán. */
  locales?: string[];
}

export function parseDayQuery(raw: string, opts: DayQueryOptions): string | null {
  const q = raw.trim().toLowerCase();
  if (!q) return null;
  const { today } = opts;
  const locales = opts.locales?.length ? opts.locales : ['es', 'ca', 'en'];

  if (/^(hoy|avui|today)$/.test(q)) return today;
  if (/^(manana|mañana|dema|demà|tomorrow)$/.test(q)) return addDays(today, 1);
  if (/^(ayer|ahir|yesterday)$/.test(q)) return addDays(today, -1);

  const isoM = ISO.exec(q);
  if (isoM) return iso(Number(isoM[1]), Number(isoM[2]), Number(isoM[3]));

  const thisYear = Number(today.slice(0, 4));

  const numM = NUMERIC.exec(q);
  if (numM) {
    const d = Number(numM[1]);
    const m = Number(numM[2]);
    // SIN AÑO, EL DESTINO ES EL PRÓXIMO, no el del pasado: quien escribe una
    // fecha corta está planificando. Si ya pasó este año, es el que viene.
    if (!numM[3]) {
      const here = iso(thisYear, m, d);
      if (!here) return null;
      return here >= today ? here : iso(thisYear + 1, m, d);
    }
    return iso(fullYear(numM[3], thisYear), m, d);
  }

  const dmM = DAY_MONTH.exec(q);
  if (dmM) {
    const d = Number(dmM[1]);
    const m = monthFromName(dmM[2], locales);
    if (!m) return null;
    if (!dmM[3]) {
      const here = iso(thisYear, m, d);
      if (!here) return null;
      return here >= today ? here : iso(thisYear + 1, m, d);
    }
    return iso(fullYear(dmM[3], thisYear), m, d);
  }

  return null;
}
