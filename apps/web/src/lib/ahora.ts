/**
 * What remains of Ahora (ADR-146) after Hoy absorbed it (ADR-202/203): the
 * pure rules Hoy's day piece, the road sheet and the map links still lean on.
 * Who to call at the venue, the map and phone links, the fixed logistics
 * lines, the countdown and the freshness line. Clock free (`now` is a
 * parameter), no words.
 */

import type { Json } from './db-types';

/** Minutes to an instant, rounded UP: it never says «0 min» before it happens. */
export function minutesTo(at: string, now: Date): number {
  return Math.ceil((Date.parse(at) - now.getTime()) / 60_000);
}

/** A countdown in hours and minutes, for the words the screen owns. */
export function countdownParts(minutes: number): { h: number; m: number } {
  const n = Math.max(0, minutes);
  return { h: Math.floor(n / 60), m: n % 60 };
}

// ── The venue's contact to call ──────────────────────────────────────────

export interface VenueCall {
  name: string;
  role: string | null;
  phone: string | null;
  /** Why this one: a technical role, production, or the main contact. */
  by: 'technical' | 'production' | 'main';
}

const fold = (s: string) =>
  s
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

/** Roles that say «technical» in the four languages and the trade's English. */
const TECHNICAL_WORDS = ['tecnic', 'techn', 'tech ', 'regie', 'regid', 'stage', 'luz', 'luces', 'llum', 'light', 'sonido', 'sound', 'maquin'];
const PRODUCTION_WORDS = ['produc'];

function contactsOf(raw: Json | null | undefined): Array<{ name: string; role: string | null; phone: string | null }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ name: string; role: string | null; phone: string | null }> = [];
  for (const c of raw) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) continue;
    const o = c as Record<string, Json>;
    if (typeof o.name !== 'string' || !o.name.trim()) continue;
    out.push({
      name: o.name.trim(),
      role: typeof o.role === 'string' && o.role.trim() ? o.role.trim() : null,
      phone: typeof o.phone === 'string' && o.phone.trim() ? o.phone.trim() : null,
    });
  }
  return out;
}

/**
 * WHO TO CALL AT THE VENUE (ADR-146): `venue.contacts` has a free `role`, so
 * «technical» is deduced from its words: the first technical contact, else
 * the first in production, else the main one (the first). Among those with a
 * phone first, because the button calls; with no phone on file anywhere, the
 * same rule still names the person (and the screen draws no call).
 */
export function venueCall(raw: Json | null | undefined): VenueCall | null {
  const all = contactsOf(raw);
  if (all.length === 0) return null;
  const has = (words: string[]) => (c: { role: string | null }) =>
    !!c.role && words.some((w) => `${fold(c.role!)} `.includes(w));
  const pick = (list: typeof all): VenueCall | null => {
    const tech = list.find(has(TECHNICAL_WORDS));
    if (tech) return { ...tech, by: 'technical' };
    const prod = list.find(has(PRODUCTION_WORDS));
    if (prod) return { ...prod, by: 'production' };
    return list[0] ? { ...list[0], by: 'main' } : null;
  };
  return pick(all.filter((c) => c.phone)) ?? pick(all);
}

/** A `tel:` link: the digits and a leading plus, nothing a dialer chokes on. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

/** The map apps «Mapa» can open (ADR-206). Their names are brands: no translation. */
export const MAPS_APPS = ['apple', 'google', 'waze'] as const;
export type MapsApp = (typeof MAPS_APPS)[number];
export const MAPS_APP_NAME: Readonly<Record<MapsApp, string>> = {
  apple: 'Apple Maps',
  google: 'Google Maps',
  waze: 'Waze',
};

export function isMapsApp(value: unknown): value is MapsApp {
  return typeof value === 'string' && (MAPS_APPS as readonly string[]).includes(value);
}

/**
 * A search for a place in the map app of the person's choice (ADR-206;
 * Apple when none, as ADR-146 had it). Each is the app's universal link: it
 * opens the app when it is installed and the web when it is not.
 */
export function mapsHref(parts: readonly (string | null | undefined)[], app: MapsApp = 'apple'): string | null {
  const q = parts.filter((p): p is string => typeof p === 'string' && p.trim() !== '').join(', ');
  if (!q) return null;
  const e = encodeURIComponent(q);
  if (app === 'google') return `https://www.google.com/maps/search/?api=1&query=${e}`;
  if (app === 'waze') return `https://waze.com/ul?q=${e}&navigate=yes`;
  return `https://maps.apple.com/?q=${e}`;
}

// ── Hotel, parking, load access: fixed keys in `logistics` ───────────────

/**
 * THE FIXED KEYS (ADR-146 § 4, no migration). `performance.logistics` stays a
 * free object of lines; these three keys have a meaning Ahora draws in place
 * when present. Canonical: `hotel`, `parking`, `load_access`. Recognised
 * without case or accents, with the words people already type in the four
 * languages (a line «Hotel: Ultònia», «Aparcamiento: ...»), and the old
 * `accommodation`.
 */
export const LOGISTICS_KEYS = {
  hotel: ['hotel', 'accommodation', 'alojamiento', 'allotjament', 'hebergement'],
  parking: ['parking', 'aparcamiento', 'aparcament', 'estacionamiento', 'stationnement'],
  load_access: ['load_access', 'load access', 'acceso de carga', 'acceso carga', 'acces de carrega', 'carga', 'carrega', 'acces de chargement', 'chargement'],
} as const;

export type LogisticsKey = keyof typeof LOGISTICS_KEYS;

function textOf(v: Json): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join(' · ') || null;
  return Object.values(v as Record<string, Json>).map(textOf).filter(Boolean).join(' · ') || null;
}

/** The three fixed lines a logistics object carries, as text. */
export function logisticsLines(raw: Json | null | undefined): Partial<Record<LogisticsKey, string>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Partial<Record<LogisticsKey, string>> = {};
  for (const [k, v] of Object.entries(raw as Record<string, Json>)) {
    const key = fold(k).replace(/_/g, ' ').trim();
    for (const [canon, words] of Object.entries(LOGISTICS_KEYS) as [LogisticsKey, readonly string[]][]) {
      if (out[canon]) continue;
      if (words.some((w) => fold(w).replace(/_/g, ' ') === key)) {
        const text = textOf(v);
        if (text) out[canon] = text;
      }
    }
  }
  return out;
}

// ── Freshness and the way back in ────────────────────────────────────────

/** Older than this, Ahora says how old its data is. */
export const FRESH_MS = 3_600_000;

/**
 * THE FRESHNESS LINE (ADR-146 § 3, amends ADR-144 § 6 for Ahora only): one
 * line saying when the data was last updated, only without network or when
 * it is older than an hour. A load-in moved by an hour that never reached
 * the phone is the expensive mistake of a tour; a line that is always there
 * is a line nobody reads.
 */
export function freshnessShown(updatedAt: number | null | undefined, now: number, online: boolean): boolean {
  if (!updatedAt) return false;
  return !online || now - updatedAt > FRESH_MS;
}

/** The road sheet Ahora asks for (ADR-146 § 6): the whole one for the
    space's crew, the technician's cut for a guest. Like every door of the
    frame, a role that has not arrived reads as able: the server clamps it
    (`roadsheetRoleFor`), so asking for more never shows more. */
export function ahoraRoadsheetRole(myRole: string | null | undefined): 'full' | 'tech_manager' {
  return myRole === 'guest' ? 'tech_manager' : 'full';
}

/** Where Ahora, a screen until ADR-202 § 5, remembered the day it was left
    open. Read by nobody now: `/` clears it, and the app opens on Hoy. */
export const AHORA_KEY = 'hour.ahora';
