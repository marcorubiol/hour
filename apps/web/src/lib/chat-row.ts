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

/**
 * Con quién es la fila (ADR-177 § 2 y § 3): la forma de su monograma y las
 * palabras de al lado del nombre. Una organización que es una sola persona y
 * se llama como ella se enseña como persona: redonda y «por libre», sin
 * «organización». Si no, cuadrada, con su tipo; sin tipo (o «otra»), sólo la
 * ciudad, nunca «otro». La ciudad ya llega elegida (la de la organización y,
 * si no tiene, la de la persona). La forma nunca va sola: siempre con la
 * palabra.
 */
export interface ChatWho {
  shape: 'person' | 'organization';
  /** «sala», «Girona»: van tras el nombre, separadas por «·». */
  words: string[];
}

export function chatWho(
  c: { kind?: string | null; solo?: boolean | null; city?: string | null },
  locale: Locale,
): ChatWho {
  const city = c.city?.trim() || null;
  if (c.solo) return { shape: 'person', words: [t('chat.solo', locale), ...(city ? [city] : [])] };
  const kind = c.kind && c.kind !== 'other' ? t(`organization.kind_${c.kind}`, locale).toLocaleLowerCase(LOCALE_TAG[locale]) : null;
  return { shape: 'organization', words: [kind, city].filter((w): w is string => Boolean(w)) };
}

/** Dos nombres que son el mismo: sin mayúsculas, espacios de más ni acentos que falten. */
function sameName(a: string, b: string): boolean {
  const norm = (s: string) => s.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  return norm(a) === norm(b);
}

/**
 * Una organización que es una sola persona (ADR-177 § 3), leída de la
 * conversación: su único contacto se llama como ella. La lista de chats lo
 * recibe ya hecho de la base (`solo`); la tabla filtrada lo lee aquí.
 */
export function soloOf(org: string | null | undefined, contacts: readonly (string | null | undefined)[]): boolean {
  return Boolean(org) && contacts.length === 1 && Boolean(contacts[0]) && sameName(org!, contacts[0]!);
}
