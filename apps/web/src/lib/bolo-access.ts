/**
 * El acceso al bolo (comms carril 2, fase 2; plan
 * build/plans/2026-10-22-comms-threads-facets.md § 3.1 y § 3.2): quién tiene
 * paquete en el bolo, qué invitaciones esperan, y quién va a una función y
 * no lee el tablón. Lo que dice `bolo_access` (20261022100000, con las
 * claves de 20261022150100), sin dinero.
 *
 * «Quién va» propone, no da (ADR-103): de aquí sale la línea «va y no lo ve
 * · Invitar», nunca un acceso.
 */

import { instantToWallClock, wallClockToInstant } from '$lib/datetime';

export type BoloPreset = 'minim' | 'equip';

export interface BoloMember {
  membership_id: string;
  user_id: string;
  /** La persona de esa cuenta (20261022150100); ausente en una base sin ella. */
  person_id?: string | null;
  name: string | null;
  preset: string | null;
  ends_at: string | null;
  expires_with_bolo: boolean;
  live: boolean;
  can_manage: boolean;
}

export interface BoloInvitation {
  id: string;
  email: string;
  preset: BoloPreset;
  person_id: string | null;
  invited_by: string | null;
  expires_at: string;
}

export interface BoloAccess {
  bolo_id: string;
  /** El final del acceso de una invitación: el día después de la última función. */
  ends_at: string | null;
  can_invite: { minim: boolean; equip: boolean };
  /** Puede mover la fecha (20261022150100); ausente = no se ofrece. */
  can_extend?: boolean;
  members: BoloMember[];
  invitations: BoloInvitation[];
  /** Personas cuya cuenta lee el tablón (solo para quien invita; 20261022150100). */
  readers?: string[];
}

export interface GoingPerson {
  person_id: string;
  name: string;
}

export function canInvite(access: BoloAccess | null | undefined): boolean {
  return Boolean(access && (access.can_invite.minim || access.can_invite.equip));
}

/** El paquete que el diálogo propone: Equip si se puede dar, si no Mínim. */
export function defaultPreset(access: BoloAccess): BoloPreset {
  return access.can_invite.equip ? 'equip' : 'minim';
}

/**
 * Quién va (hechos: reparto y «voy») y no lee el tablón, ni tiene una
 * invitación pendiente. Sin `readers` (quien llama no invita, o la base no lo
 * da) no se sabe: lista vacía, nunca una suposición.
 */
export function goingWithoutAccess(
  going: readonly GoingPerson[],
  access: BoloAccess | null | undefined,
): GoingPerson[] {
  if (!access || !canInvite(access) || !Array.isArray(access.readers)) return [];
  const reads = new Set(access.readers);
  for (const m of access.members) if (m.person_id && m.live) reads.add(m.person_id);
  const invited = new Set(access.invitations.flatMap((i) => (i.person_id ? [i.person_id] : [])));
  const seen = new Set<string>();
  const out: GoingPerson[] = [];
  for (const p of going) {
    if (seen.has(p.person_id) || reads.has(p.person_id) || invited.has(p.person_id)) continue;
    seen.add(p.person_id);
    out.push(p);
  }
  return out;
}

/** Quién va, de los hechos de una función: el reparto, más «voy», menos «no voy». */
export function goingPersonIds(
  roster: readonly string[],
  commitments: readonly { person_id: string; state: 'going' | 'not_going' }[] | null | undefined,
): string[] {
  const out = new Set(roster);
  for (const c of commitments ?? []) {
    if (c.state === 'going') out.add(c.person_id);
    else out.delete(c.person_id);
  }
  return [...out];
}

/** El último día de acceso, como fecha del calendario (el `ends_at` es el
    principio del día siguiente, en la zona del espacio). */
export function lastAccessDayISO(endsAt: string, tz: string): string {
  return instantToWallClock(new Date(new Date(endsAt).getTime() - 60_000).toISOString(), tz).slice(0, 10);
}

/** Una fecha del calendario como último día de acceso: el principio del día
    siguiente en esa zona, en ISO. `null` si la fecha no se lee. */
export function endOfDayInTz(dayISO: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayISO);
  if (!m) return null;
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (day.toISOString().slice(0, 10) !== dayISO) return null;
  const next = new Date(day.getTime() + 86_400_000);
  return wallClockToInstant(`${next.toISOString().slice(0, 10)}T00:00`, tz);
}
