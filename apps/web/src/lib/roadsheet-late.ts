/**
 * «LLEGO TARDE» (121 B, ADR-183): the technician warns production from their
 * own road sheet link, and production sees it on Hoy and in the bolo group.
 * The technician never moves a time: «Mover <moment> a HH:MM» is
 * production's, through the collab doc (ADR-090 P2).
 *
 * Pure: the shapes the endpoints speak and the small rules the screens and
 * the Worker share (which moment, what time, which moment was moved). The
 * base decides the rest (`report_roadsheet_late`, `get_public_roadsheet`).
 */

import { timeInTz } from './datetime';
import { t, type Locale } from './i18n';
import { MOMENT_KEYS, momentWordKey, type MomentKey } from './month-events';

/** The minutes the technician picks; 45 reads «45+». null is «No sé». */
export const LATE_MINUTES = [10, 20, 30, 45] as const;
export type LateMinutes = (typeof LATE_MINUTES)[number];

/** The base's cap (`roadsheet_late_notice_note`). */
export const LATE_NOTE_MAX = 280;

/** Notices per link per hour (`report_roadsheet_late`, 53400 past it). */
export const LATE_PER_LINK_PER_HOUR = 3;

export function isLateMinutes(value: unknown): value is LateMinutes {
  return (LATE_MINUTES as readonly unknown[]).includes(value);
}

/** The moment of the running order a notice is about. */
export interface LateMilestone {
  kind: string | null;
  label: string | null;
  at: string;
}

/** The last notice of the holder today, as the public sheet gets it. */
export interface PublicLateNotice {
  created_at: string;
  minutes: number | null;
  milestone: LateMilestone | null;
  seen_at: string | null;
  /** Who in production saw it (their profile name), or null. */
  seen_by: string | null;
}

/** Only on a personal link (`get_public_roadsheet` · `late`). */
export interface PublicLate {
  /** Today is the performance's day, in the venue's zone: the button shows. */
  open: boolean;
  /** Who receives it: whoever can edit the performance, by name. */
  recipients: string[];
  last: PublicLateNotice | null;
}

/** Whose sheet it is (`get_public_roadsheet` · `holder`). */
export interface RoadsheetHolder {
  name: string | null;
  role: string | null;
}

/** A time a notice moved (`get_public_roadsheet` · `late_moves`). */
export interface LateMove {
  kind: string | null;
  label: string | null;
  from: string;
  to: string;
  moved_at: string;
}

/** A moment of the sheet's running order, with the move that set its time. */
export type MovedMoment<T> = T & { moved_from?: string | null; moved_at?: string | null };

/** An open notice on Hoy (`roadsheet_late_notices()`). */
export interface LateNotice {
  id: string;
  created_at: string;
  person_name: string;
  person_role: string | null;
  phone: string | null;
  minutes: number | null;
  note: string | null;
  milestone: LateMilestone | null;
  moved_to: string | null;
  /** The day's zone: the venue's, else the space's. */
  timezone: string;
  performance: {
    id: string;
    slug: string | null;
    performed_at: string;
    venue_name: string | null;
    city: string | null;
    workspace_slug: string;
  };
  /** May move the time (`edit:performance`). */
  can_edit: boolean;
}

const sameInstant = (a: string, b: string) => Date.parse(a) === Date.parse(b);

/**
 * The moment a notice is about: the first one still ahead (the base's rule
 * in `report_roadsheet_late`). Ties keep the written order.
 */
export function nextMilestone<T extends { at: string }>(moments: readonly T[], now: Date): T | null {
  const ms = now.getTime();
  let best: T | null = null;
  for (const m of moments) {
    const at = Date.parse(m.at);
    if (!Number.isFinite(at) || at <= ms) continue;
    if (!best || at < Date.parse(best.at)) best = m;
  }
  return best;
}

/** When the technician would be there: the moment's time plus the minutes. «No sé»: null. */
export function lateEta(milestoneAt: string | null | undefined, minutes: number | null | undefined): string | null {
  if (!milestoneAt || minutes == null) return null;
  const at = Date.parse(milestoneAt);
  return Number.isFinite(at) ? new Date(at + minutes * 60_000).toISOString() : null;
}

/** What «Mover» proposes: only for whoever edits, with a moment and minutes, not yet moved. */
export function canProposeMove(n: Pick<LateNotice, 'can_edit' | 'milestone' | 'minutes' | 'moved_to'>): boolean {
  return n.can_edit && n.milestone !== null && n.minutes !== null && n.moved_to === null;
}

/**
 * Mark the moments whose time a notice moved: same kind, same label, and
 * the time the move set (a time edited again afterwards is not «cambiado»
 * any more). The latest move of a moment wins.
 */
export function annotateMoves<T extends { kind: string | null; label: string | null; at: string }>(
  moments: readonly T[],
  moves: readonly LateMove[],
): MovedMoment<T>[] {
  if (moves.length === 0) return [...moments];
  const latest = [...moves].sort((a, b) => Date.parse(b.moved_at) - Date.parse(a.moved_at));
  return moments.map((m) => {
    const hit = latest.find(
      (mv) => (mv.kind ?? null) === (m.kind ?? null) && (mv.label ?? null) === (m.label ?? null) && sameInstant(mv.to, m.at),
    );
    return hit ? { ...m, moved_from: hit.from, moved_at: hit.moved_at } : m;
  });
}

/** A moment's word: its label, else the word of its kind («carga»), else nothing. */
export function lateMomentWord(m: Pick<LateMilestone, 'kind' | 'label'>, locale: Locale): string {
  const label = m.label?.trim();
  if (label) return label;
  if (m.kind && MOMENT_KEYS.has(m.kind)) return t(momentWordKey(m.kind as MomentKey), locale);
  return m.kind ?? '';
}

/** «unos 20 min», «45 min o más», «sin saber cuánto». */
export function lateMinutesWord(minutes: number | null | undefined, locale: Locale): string {
  if (minutes == null) return t('late.minutes_unknown', locale);
  if (minutes >= 45) return t('late.minutes_45', locale);
  return t('late.minutes_about', locale, { n: minutes });
}

/** A time on the day's clock, «16:20». */
export const lateClock = (iso: string, tz: string) => timeInTz(iso, tz);

/** The notice behind a system line of a bolo group (`message.late_notice_id`). */
export interface LateLineData {
  person_name: string;
  minutes: number | null;
  note: string | null;
  milestone_kind: string | null;
  milestone_label: string | null;
  milestone_at: string | null;
  moved_from: string | null;
  moved_to: string | null;
}

/**
 * The words of a system line in the reader's language: «Pau Roca llega
 * tarde, unos 20 min · carga 16:00 · desde su hoja» or «Núria movió carga de
 * 16:00 a 16:20». Without its notice (the reader does not read the
 * performance), the base's Spanish `body`.
 */
export function lateLineText(
  system: 'late_notice' | 'late_moved',
  late: LateLineData | null | undefined,
  author: string,
  body: string,
  locale: Locale,
  tz: string,
): string {
  if (!late) return body;
  const moment = lateMomentWord({ kind: late.milestone_kind, label: late.milestone_label }, locale);
  if (system === 'late_moved') {
    if (!late.moved_from || !late.moved_to) return body;
    return t('late.line_moved', locale, {
      name: author || t('threads.someone', locale),
      moment,
      from: lateClock(late.moved_from, tz),
      to: lateClock(late.moved_to, tz),
    });
  }
  const head =
    late.minutes == null
      ? t('late.line_notice', locale, { name: late.person_name })
      : `${t('late.line_notice', locale, { name: late.person_name })}, ${lateMinutesWord(late.minutes, locale)}`;
  return [head, late.milestone_at ? `${moment} ${lateClock(late.milestone_at, tz)}` : null, t('late.line_from_sheet', locale)]
    .filter(Boolean)
    .join(' · ');
}

type TeamRow = { role: string | null; person: { id: string; full_name: string } | null };

/** Someone of the performance's team who can get a personal link. */
export interface TeamMember {
  person_id: string;
  name: string;
  /** Their role in the company's words («luces»). */
  role: string | null;
  kind: 'crew' | 'cast';
}

/**
 * Who can get a personal link: the performance's crew, then its cast (the
 * substitutes of this performance, then the project's cast minus whoever a
 * substitute replaces), each person once, crew first: the same rule as
 * `private.roadsheet_person_role` in the base, which gives the link its role.
 */
export function roadsheetTeam(
  crew: readonly TeamRow[],
  castMembers: readonly TeamRow[],
  overrides: readonly (TeamRow & { replaces_person: { id: string } | null })[],
): TeamMember[] {
  const out = new Map<string, TeamMember>();
  const add = (row: TeamRow, kind: TeamMember['kind']) => {
    if (!row.person || out.has(row.person.id)) return;
    out.set(row.person.id, { person_id: row.person.id, name: row.person.full_name, role: row.role?.trim() || null, kind });
  };
  for (const row of crew) add(row, 'crew');
  const replaced = new Set(overrides.map((o) => o.replaces_person?.id).filter((x): x is string => Boolean(x)));
  for (const row of overrides) add(row, 'cast');
  for (const row of castMembers) if (row.person && !replaced.has(row.person.id)) add(row, 'cast');
  return [...out.values()];
}
