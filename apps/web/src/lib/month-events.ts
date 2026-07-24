/**
 * Shared planner event view-models + pure day/label helpers — formerly
 * MonthGrid.svelte's `<script module>`, extracted so the planner page,
 * the agenda and the feeds import types and bucketing rules without
 * touching the component. Grid math stays in $lib/planner.
 */
import { dayKeyInTz } from '$lib/planner';

export type ProjectLite = {
  id: string;
  slug: string;
  name: string;
  accent?: string | null;
  /** Stored identity monogram (ADR-081); absent until the migration is
      applied — IdentityMark falls back to initials derived from name. */
  initials?: string | null;
  workspace_id: string;
};

export type PerformanceEvent = {
  id: string;
  slug: string | null;
  performed_at: string;
  status: string;
  load_in_at?: string | null;
  start_at: string | null;
  venue_name: string | null;
  city: string | null;
  country: string | null;
  line_id: string | null;
  project: ProjectLite | null;
  venue: {
    name: string;
    city: string | null;
    country?: string | null;
    timezone: string | null;
  } | null;
  /** ADR-084 §3 — the operator's readiness ticks, read by the card foot. */
  readiness?: Record<string, boolean> | null;
  /** Present only on ?rosters=1 fetches (conflict engine feed). */
  person_ids?: string[];
};

export type DateEvent = {
  id: string;
  kind: string;
  status: string;
  title: string | null;
  starts_at: string;
  ends_at?: string | null;
  all_day: boolean;
  /** ADR-084 §1 — rows sharing this render as one multi-day band. */
  series_id?: string | null;
  venue_name: string | null;
  city: string | null;
  country?: string | null;
  project: ProjectLite | null;
  venue: { timezone: string | null } | null;
  /** ADR-078 columns — absent until the migrations are applied
      (graceful absence: chips render directionless, no away bands). */
  line_id?: string | null;
  travel_direction?: string | null;
  label?: string | null;
};

/** A stored blackout, page-shaped for rendering (label already built). */
export type BlackoutBandVM = {
  id: string;
  /** starts_on / ends_on — inclusive ISO days. */
  from: string;
  to: string;
  company: boolean;
  tentative: boolean;
  label: string;
  note?: string | null;
};

/** A derived away band (ADR-078 §6) — display-only inference. */
export type AwayBandVM = {
  from: string;
  to: string;
  label: string;
};

/** One conflict, page-shaped for the day mark + clash card. */
export type ClashVM = {
  severity: 'people' | 'possible' | 'blackout' | 'blackout-tentative';
  glyph: '!' | '?';
  title: string;
  body: string;
  rows: Array<{ label: string; status: string; accent: string | null }>;
};

/** Day bucket of a performance — performed_at is day-level truth. */
export function perfDayKey(p: PerformanceEvent): string {
  return p.performed_at.slice(0, 10);
}

/**
 * Day bucket of a date row. All-day rows are calendar dates, not
 * instants — keep the stored day. Timed rows follow the timezone rule
 * (spec § Timezone rule): the day of THEIR venue when one is linked,
 * the viewer's day otherwise.
 */
export function dateDayKey(d: DateEvent, timeZone: string): string {
  if (d.all_day) return d.starts_at.slice(0, 10);
  return dayKeyInTz(d.starts_at, d.venue?.timezone || timeZone);
}

/** "July 2026" — shared by the page's h1 and the grid's aria-label. */
export function formatMonthLabel(year: number, month: number, locale = 'en-GB'): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Month name alone ("May", "maig") — the masthead's serif em. */
export function monthName(year: number, month: number, locale = 'en-GB'): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(locale, {
    month: 'long',
    timeZone: 'UTC',
  });
}

/** ADR-078: the working time — load-in when known, else show start. */
export function perfInstant(p: PerformanceEvent): string | null {
  return p.load_in_at ?? p.start_at;
}
