/**
 * Hall status sentence (ADR-068/069; spec § /h — the hall) — the pure
 * truth layer behind the one-line status on /h. `computeHallStatus`
 * decides WHAT is true; `hallSentence` says it in the viewer's language.
 * No fetching, no clocks — `now` always comes in as a parameter so tests
 * can pin it.
 *
 * Day arithmetic is calendar-day based: the date PART of each value
 * against the viewer's local calendar day. next_action_at / due_at /
 * performed_at are date-only contracts (see realIsoDate in $lib/task.ts
 * and the UTC-anchored rule in $lib/datetime.ts — a plain date must never
 * shift a day through the viewer's zone). This agrees with DeskBoard's
 * bucketing for Phase 0 viewers, so the sentence and the Desk one click
 * away always tell the same story.
 */

import { dualTime } from './datetime';
import { t, type Locale } from './i18n';

/** Structural subset of the /api/engagements row the hall needs. */
export interface HallEngagement {
  status: string;
  next_action_at: string | null;
}

/** Structural subset of the /api/tasks row the hall needs. */
export interface HallTask {
  status: string;
  due_at: string | null;
}

/** Structural subset of the /api/performances row the hall needs. */
export interface HallPerformance {
  status: string;
  performed_at: string;
  load_in_at: string | null;
  start_at: string | null;
  venue_name: string | null;
  city: string | null;
  venue: { name: string | null; timezone: string | null } | null;
  project: { workspace_id: string } | null;
}

export type HallStatus =
  | { kind: 'show'; place: string; at: string | null; venueTz: string | null }
  | { kind: 'attention'; overdue: number; oldestDays: number }
  | { kind: 'calm'; open: number; next: { day: string; inDays: number } | null };
// Fourth state, slot only (ADR-069): { kind: 'proposal'; ... } — the AI
// proposal teaser ("Tinc una proposta per París — quan vulguis."), the
// consent-first door to an origin='ai' task. Lands with the AI layer;
// computeHallStatus never returns it yet.

const DAY = 86_400_000;

/** The viewer's calendar day for `now`, as YYYY-MM-DD. */
function localDayISO(now: Date): string {
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

/** Whole calendar days from `todayISO` to the date part of `iso`. */
function daysFromToday(iso: string, todayISO: string): number {
  const at = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  const today = Date.parse(`${todayISO}T00:00:00Z`);
  return Math.round((at - today) / DAY);
}

export function computeHallStatus(
  input: {
    engagements: HallEngagement[];
    performances: HallPerformance[];
    tasks: HallTask[];
    /** workspace_id → home IANA timezone: the show-time zone when the gig
        has no venue timezone (same fallback the entry dialog uses; the
        browser's zone is never a silent stand-in). */
    homeTzById?: Record<string, string>;
  },
  now: Date,
): HallStatus {
  const todayISO = localDayISO(now);

  // 1 — show day outranks everything: a gig today IS the status.
  const todayShows = input.performances.filter(
    (p) => p.status !== 'cancelled' && p.performed_at.slice(0, 10) === todayISO,
  );
  if (todayShows.length > 0) {
    const timeOf = (p: HallPerformance) => p.load_in_at ?? p.start_at;
    const first = [...todayShows].sort((a, b) => {
      const ta = timeOf(a);
      const tb = timeOf(b);
      if (ta && tb) return Date.parse(ta) - Date.parse(tb);
      return ta ? -1 : tb ? 1 : 0;
    })[0];
    const place = first.venue?.name ?? first.venue_name ?? first.city ?? '—';
    const venueTz =
      first.venue?.timezone ??
      input.homeTzById?.[first.project?.workspace_id ?? ''] ??
      null;
    return { kind: 'show', place, at: timeOf(first), venueTz };
  }

  // The working set: DeskBoard's exact semantics for engagements (status
  // not declined/dormant, a next action set) + open tasks (the verb
  // layer, ADR-068). Undated open tasks count as open but can never be
  // overdue or "the next one".
  const dated: { day: string; inDays: number }[] = [];
  let undatedOpen = 0;

  for (const e of input.engagements) {
    if (e.status === 'declined' || e.status === 'dormant' || !e.next_action_at) continue;
    dated.push({
      day: e.next_action_at.slice(0, 10),
      inDays: daysFromToday(e.next_action_at, todayISO),
    });
  }
  for (const task of input.tasks) {
    if (task.status !== 'open') continue;
    if (task.due_at) {
      dated.push({ day: task.due_at.slice(0, 10), inDays: daysFromToday(task.due_at, todayISO) });
    } else {
      undatedOpen += 1;
    }
  }

  // 2 — attention: anything whose action day is already behind us.
  const overdue = dated.filter((d) => d.inDays < 0);
  if (overdue.length > 0) {
    const oldestDays = Math.max(...overdue.map((d) => -d.inDays));
    return { kind: 'attention', overdue: overdue.length, oldestDays };
  }

  // 3 — calm.
  const upcoming = dated.filter((d) => d.inDays >= 0).sort((a, b) => a.inDays - b.inDays);
  return {
    kind: 'calm',
    open: upcoming.length + undatedOpen,
    next: upcoming[0] ?? null,
  };
}

export interface HallSentenceOpts {
  /** The viewer's IANA zone (for the courtesy time); defaults to the runtime's. */
  viewerTz?: string;
}

export function hallSentence(
  status: HallStatus,
  locale: Locale,
  opts: HallSentenceOpts = {},
): string {
  if (status.kind === 'show') {
    if (!status.at) return t('hall.status_show', locale, { place: status.place });
    // Timezone rule (spec § Timezone rule): venue wall time is the primary
    // truth; the viewer's time rides along in parentheses only when the
    // zones actually disagree on the clock face.
    const viewerTz = opts.viewerTz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const dual = dualTime(status.at, status.venueTz, viewerTz);
    const time = dual.secondary
      ? `${dual.primary} ${t('hall.time_yours', locale, { time: dual.secondary })}`
      : dual.primary;
    return t('hall.status_show_time', locale, { place: status.place, time });
  }

  if (status.kind === 'attention') {
    const days =
      status.oldestDays === 1
        ? t('hall.days_one', locale)
        : t('hall.days_many', locale, { x: status.oldestDays });
    return status.overdue === 1
      ? t('hall.status_attention_one', locale, { days })
      : t('hall.status_attention_many', locale, { n: status.overdue, days });
  }

  if (status.open === 0) return t('hall.status_calm_zero', locale);
  const when = status.next ? whenLabel(status.next, locale) : null;
  if (status.open === 1) {
    return when
      ? t('hall.status_calm_one_next', locale, { when })
      : t('hall.status_calm_one', locale);
  }
  return when
    ? t('hall.status_calm_many_next', locale, { n: status.open, when })
    : t('hall.status_calm_many', locale, { n: status.open });
}

/**
 * "avui" / "demà" / a weekday inside the week / a real date beyond it —
 * a bare weekday name more than a week out would read as this week,
 * which the truth rule forbids. UTC-anchored like all date-only labels.
 */
function whenLabel(next: { day: string; inDays: number }, locale: Locale): string {
  if (next.inDays === 0) return t('hall.when_today', locale);
  if (next.inDays === 1) return t('hall.when_tomorrow', locale);
  const date = new Date(`${next.day}T00:00:00Z`);
  if (next.inDays < 7) {
    const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(
      date,
    );
    return t('hall.when_weekday', locale, { weekday });
  }
  const label = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(date);
  return t('hall.when_date', locale, { date: label });
}
