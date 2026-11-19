/**
 * THE PASS IN READ MODE (ADR-223): the small pure pieces both the record's
 * pass (`PerformanceRecord`) and the public road sheet (`PassSheet`) draw
 * from, so the eyebrow, the figure and the folds' one-line summaries are
 * written once. No clock here: `today` and `tz` are parameters.
 */

import { daysBetween } from './away';
import { timeInTz } from './datetime';
import type { Json } from './db-types';
import { t, type Locale } from './i18n';

/** «hoy», «mañana», «en 3 días», «hace 2 días»: how far the day is from `today` (ISO dates). */
export function passWhenWord(today: string, day: string, locale: Locale): string {
  const d = daysBetween(today, day.slice(0, 10));
  if (d === 0) return t('pass.when_today', locale);
  if (d === 1) return t('pass.when_tomorrow', locale);
  if (d === -1) return t('pass.when_yesterday', locale);
  return t(d > 0 ? 'pass.when_in' : 'pass.when_ago', locale, { n: Math.abs(d) });
}

/** «Función · en 3 días»: the eyebrow over the figure. */
export function passEyebrow(kindLabel: string, today: string, day: string, locale: Locale): string {
  return `${kindLabel} · ${passWhenWord(today, day, locale)}`;
}

/** The big figure: the show's hour on the venue's clock, or null («sin hora»). */
export function passFigure(startAt: string | null | undefined, tz: string): string | null {
  return startAt && Number.isFinite(Date.parse(startAt)) ? timeInTz(startAt, tz) : null;
}

/** The show's start on a sheet's schedule: its field, else the running order's `start` moment. */
export function showStartAt(
  schedule: { start_at: string | null; moments?: readonly { kind?: string | null; at: string }[] } | null | undefined,
): string | null {
  if (!schedule) return null;
  if (schedule.start_at) return schedule.start_at;
  return schedule.moments?.find((m) => m.kind === 'start')?.at ?? null;
}

/** «5 personas, con su teléfono» / «1 persona, nombre y oficio». */
export function peopleSummary(n: number, withContact: boolean, locale: Locale): string {
  const count = t(n === 1 ? 'pass.people_one' : 'pass.people_n', locale, { n });
  return `${count}, ${t(withContact ? 'pass.people_contact' : 'pass.people_plain', locale)}`;
}

const humanKey = (k: string) => {
  const s = k.replace(/_/g, ' ').trim();
  return s ? s[0]!.toLocaleUpperCase() + s.slice(1) : s;
};

const filled = (v: Json | undefined): boolean => {
  if (v === null || v === undefined || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
};

/**
 * One line of what a free-shaped jsonb holds (logistics, hospitality,
 * technical): its first filled keys, `max` of them, joined with « · ». A
 * bare list says how many; a scalar says itself, cut short. Empty: ''.
 */
export function jsonSummary(value: Json | null | undefined, max = 3): string {
  if (!filled(value ?? undefined)) return '';
  if (Array.isArray(value)) return String(value.length);
  if (typeof value === 'object' && value !== null) {
    const keys = Object.entries(value as Record<string, Json>)
      .filter(([, v]) => filled(v))
      .map(([k]) => humanKey(k));
    const shown = keys.slice(0, max).join(' · ');
    return keys.length > max ? `${shown} …` : shown;
  }
  const s = String(value);
  return s.length > 40 ? `${s.slice(0, 39)}…` : s;
}

/** Join the non-empty parts of a fold's summary. */
export const foldKeeps = (...parts: (string | null | undefined | false)[]): string =>
  parts.filter((p): p is string => Boolean(p)).join(' · ');
