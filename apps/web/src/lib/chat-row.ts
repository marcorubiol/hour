/**
 * La fila de chat de Conversaciones (ADR-176): lo que se lee de un vistazo,
 * como en una app de mensajería. Puro: sin red y con `now` inyectable.
 */

import { hourMark, localeDayMonthNear, localeWeekdayShort, timeInTz } from './datetime';
import { LOCALE_TAG, t, type Locale } from './i18n';

function dayInZone(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(iso),
  );
}

const DAY_MS = 86_400_000;

/**
 * Cuándo, en la columna de la hora: hoy, la hora; ayer, «ayer»; esta semana,
 * el día de la semana; antes, el día y el mes (con el año si no es de los
 * doce meses de alrededor).
 */
export function chatWhen(iso: string, locale: Locale, tz: string, now: Date = new Date()): string {
  const day = dayInZone(iso, tz);
  const today = dayInZone(now.toISOString(), tz);
  if (day === today) return hourMark(timeInTz(iso, tz));
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / DAY_MS);
  if (days === 1) return t('chat.yesterday', locale);
  const tag = LOCALE_TAG[locale];
  if (days > 1 && days < 7) return localeWeekdayShort(day, tag);
  return localeDayMonthNear(day, today, tag);
}
