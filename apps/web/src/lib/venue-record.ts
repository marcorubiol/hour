/**
 * La ficha de sala (ADR-162 § 1): la sala física, no la organización que la
 * programa. Lo que la ficha dice de sus funciones, de quién programa allí y
 * de sus contactos.
 *
 * Sin red: `today` (día local, `YYYY-MM-DD`) se inyecta.
 */

import type { VenueContact } from './venue';

/** Una función en la sala, con lo justo para su fila. */
export interface VenuePerformance {
  id: string;
  slug: string | null;
  performed_at: string;
  status: string;
  project: { id: string; slug: string; name: string } | null;
  conversation: {
    id: string;
    slug: string | null;
    organization: { slug: string; name: string } | null;
  } | null;
}

/** Lo que lee la ficha: `GET /api/venues/:key?workspace_id=`. */
export interface VenueFile {
  venue: {
    id: string;
    workspace_id: string;
    slug: string | null;
    name: string;
    city: string | null;
    country: string | null;
    address: string | null;
    capacity: number | null;
    timezone: string | null;
    contacts: VenueContact[] | null;
    notes: string | null;
  };
  performances: VenuePerformance[];
}

const DEAD = new Set(['cancelled']);

/**
 * Sus funciones en dos tramos: las que vienen, la más cercana primero (hoy
 * cuenta como por venir), y las pasadas, la última primero. Una cancelada no
 * se cuenta, como en la ficha de organización.
 */
export function venuePerformances(
  rows: readonly VenuePerformance[],
  today: string,
): { coming: VenuePerformance[]; past: VenuePerformance[] } {
  const live = rows.filter((p) => !DEAD.has(p.status));
  const day = (p: VenuePerformance) => p.performed_at.slice(0, 10);
  const coming = live.filter((p) => day(p) >= today).sort((a, b) => day(a).localeCompare(day(b)));
  const past = live.filter((p) => day(p) < today).sort((a, b) => day(b).localeCompare(day(a)));
  return { coming, past };
}

/**
 * Quién programa allí: las organizaciones de las conversaciones de sus
 * funciones, una vez cada una, la de la función más reciente primero.
 */
export function venueOrganizations(rows: readonly VenuePerformance[]): { slug: string; name: string }[] {
  const seen = new Map<string, { slug: string; name: string }>();
  const byDay = [...rows].sort((a, b) => b.performed_at.localeCompare(a.performed_at));
  for (const p of byDay) {
    const o = p.conversation?.organization;
    if (o && !seen.has(o.slug)) seen.set(o.slug, { slug: o.slug, name: o.name });
  }
  return [...seen.values()];
}

/** Un contacto de la sala con sus enlaces: el teléfono llama, el correo escribe. */
export interface VenueContactRow {
  name: string;
  role: string | null;
  phone: string | null;
  telHref: string | null;
  email: string | null;
  mailHref: string | null;
}

/** Los espacios del número no van al `tel:`; el `+` del prefijo, sí. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

export function venueContactRows(contacts: readonly VenueContact[] | null | undefined): VenueContactRow[] {
  return (contacts ?? [])
    .filter((c) => c.name?.trim())
    .map((c) => ({
      name: c.name,
      role: c.role ?? null,
      phone: c.phone || null,
      telHref: c.phone ? telHref(c.phone) : null,
      email: c.email || null,
      mailHref: c.email ? `mailto:${c.email}` : null,
    }));
}
