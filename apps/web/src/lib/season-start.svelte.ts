/**
 * La temporada de la pantalla (tarea 78), estado del marco como el oficio
 * (`$lib/i18n/trade.svelte`): el layout la pone con los espacios que se ven,
 * y las lentes la leen. La aritmética es `$lib/season-year`.
 *
 * - `screenSeasonStart()`: el mes que rotula la temporada en pantalla, el de
 *   los espacios a la vista si coinciden, septiembre si no.
 * - `seasonStarts()`: el mes de cada espacio que se lee, para que una fila
 *   cuente con el suyo.
 */
import { DEFAULT_SEASON_START_MONTH, normalizeStartMonth, seasonStartOf, type SeasonStarts } from './season-year';

let screen = $state(DEFAULT_SEASON_START_MONTH);
let starts = $state.raw<SeasonStarts>(new Map());

export function screenSeasonStart(): number {
  return screen;
}

export function seasonStarts(): SeasonStarts {
  return starts;
}

export function setSeasonStarts(
  onScreen: ReadonlyArray<{ season_start_month?: number | null }>,
  all: ReadonlyArray<{ id: string; season_start_month?: number | null }>,
): void {
  screen = seasonStartOf(onScreen);
  starts = new Map(all.map((w) => [w.id, normalizeStartMonth(w.season_start_month)]));
}
