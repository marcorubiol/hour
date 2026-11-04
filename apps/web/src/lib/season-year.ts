/**
 * La temporada del año (ADR-117 § 3, tarea 78): doce meses por fecha de
 * función, desde el mes en que empieza la del espacio (`workspace.
 * season_start_month`, septiembre por defecto). La única regla de la app:
 * Cuentas, Conversaciones, el Desk y el nombre de una línea de difusión la
 * leen de aquí, y la SQL de `private.season_start` (`conversation_feed`,
 * `private.organization_is_regular`) la repite con la misma aritmética.
 *
 * No es la «Temporada» del Planner: esa es un horizonte de doce semanas desde
 * hoy (`$lib/season`, ADR-117 § 2).
 */

/** Septiembre: la temporada de las artes en vivo, de septiembre a agosto. */
export const DEFAULT_SEASON_START_MONTH = 9;

export interface Season {
  /** El año en que empieza: 2026 para la de septiembre de 2026 a agosto de 2027. */
  year: number;
  /** «26-27»; si empieza en enero, el año solo: «2026». */
  label: string;
  /** Primer día, inclusive (YYYY-MM-DD). */
  start: string;
  /** Último día, inclusive (YYYY-MM-DD). */
  end: string;
}

/** Un mes de inicio válido (1..12); cualquier otra cosa, septiembre. */
export function normalizeStartMonth(month: unknown): number {
  const n = typeof month === 'string' && month.trim() !== '' ? Number(month) : month;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 12 ? n : DEFAULT_SEASON_START_MONTH;
}

const pad = (n: number) => String(n).padStart(2, '0');
const yy = (n: number) => pad(((n % 100) + 100) % 100);

/** El año en que empieza la temporada de un día (`YYYY-MM-DD…`, también un instante: lee la fecha escrita). */
export function seasonYearOf(day: string, startMonth: number = DEFAULT_SEASON_START_MONTH): number {
  const m = normalizeStartMonth(startMonth);
  const year = Number(day.slice(0, 4));
  return Number(day.slice(5, 7)) >= m ? year : year - 1;
}

/** «26-27», o «2026» cuando la temporada es el año natural. `long`: «2026-27». */
export function seasonLabel(year: number, startMonth: number = DEFAULT_SEASON_START_MONTH, long = false): string {
  if (normalizeStartMonth(startMonth) === 1) return String(year);
  return `${long ? String(year) : yy(year)}-${yy(year + 1)}`;
}

/** La temporada que empieza en `year`, con sus dos extremos inclusive. */
export function seasonAt(year: number, startMonth: number = DEFAULT_SEASON_START_MONTH): Season {
  const m = normalizeStartMonth(startMonth);
  const start = `${year}-${pad(m)}-01`;
  // El día anterior al primero de la siguiente.
  const next = Date.UTC(year + 1, m - 1, 1) - 86_400_000;
  const end = new Date(next).toISOString().slice(0, 10);
  return { year, label: seasonLabel(year, m), start, end };
}

/** La temporada de un día. */
export function seasonOf(day: string, startMonth: number = DEFAULT_SEASON_START_MONTH): Season {
  return seasonAt(seasonYearOf(day, startMonth), startMonth);
}

/**
 * El día de hoy donde se mira: con `timeZone`, el de esa zona; sin ella, el
 * del reloj que corre el código (el dispositivo en la app; UTC en el Worker,
 * como `current_date` en la base).
 */
export function dayIn(now: Date, timeZone?: string): string {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
      const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
      return `${get('year')}-${get('month')}-${get('day')}`;
    } catch {
      // Una zona desconocida no rompe la temporada: el reloj local.
    }
  }
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** La temporada en curso. */
export function currentSeason(now: Date, startMonth: number = DEFAULT_SEASON_START_MONTH, timeZone?: string): Season {
  return seasonOf(dayIn(now, timeZone), startMonth);
}

/** ¿Cae el día en la temporada? Compara la fecha escrita, como la SQL. */
export function inSeasonDay(day: string, season: Pick<Season, 'start' | 'end'>): boolean {
  const d = day.slice(0, 10);
  return d >= season.start && d <= season.end;
}

/**
 * Un mes de inicio para un conjunto de espacios: el suyo cuando todos lo
 * comparten, septiembre cuando no coinciden o no dicen nada. Una pantalla
 * que mezcla dos espacios con temporadas distintas rotula la de por defecto
 * (como `tradeOf`); cada fila sigue contando con la de su espacio.
 */
export function seasonStartOf(workspaces: ReadonlyArray<{ season_start_month?: number | null }>): number {
  const seen = new Set(workspaces.map((w) => normalizeStartMonth(w.season_start_month)));
  return seen.size === 1 ? [...seen][0] : DEFAULT_SEASON_START_MONTH;
}

/** El mes de inicio de cada espacio por id; un espacio que no está, septiembre. */
export type SeasonStarts = ReadonlyMap<string, number>;

export function seasonStartFor(starts: SeasonStarts | undefined, workspaceId: string | null | undefined): number {
  return normalizeStartMonth(workspaceId ? starts?.get(workspaceId) : undefined);
}
