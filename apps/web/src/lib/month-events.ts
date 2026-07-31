/**
 * Shared planner event view-models + pure day/label helpers — formerly
 * MonthGrid.svelte's `<script module>`, extracted so the planner page,
 * the agenda and the feeds import types and bucketing rules without
 * touching the component. Grid math stays in $lib/planner.
 */
import { dayKeyInTz } from '$lib/planner';
import { performanceStatusFamily, type StatusFamily } from '$lib/performance';
import { dateStatusFamily } from '$lib/date';

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
  // The run sheet, all five. `/api/performances` has always SELECTed them
  // (+server.ts § select); only two were declared here, so the other three
  // arrived over the wire and were dropped on the floor by the type. They
  // are the day's shape, and the Planner v3 draws it.
  load_in_at?: string | null;
  soundcheck_at?: string | null;
  start_at: string | null;
  loadout_at?: string | null;
  wrap_at?: string | null;
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
  /** The performance this date hangs from (ADR-078 §1, third cascade
      level). Always fetched by the feed; read by the edit dialog. */
  performance_id?: string | null;
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

/* ══ THE SLIP · ONE VOCABULARY FOR EVERYTHING THAT HAPPENS ══════════════
   ADR-095 §0. The design draws ONE object in four placings — the month cell,
   the board cell, the flow row and the day card carry the same fields in the
   same order (pack · hour · state · name · city · gloss), and the only thing
   that differs is WHERE THE HOUR LIVES. That is a law with teeth: it is the
   reason the board's chip must BE the month's chip and not a lookalike.

   A lookalike is exactly what we have. `PerformanceEvent` and `DateEvent` are
   two shapes with two sets of accessors, `PerfChip` and `DateChip` are two
   components, and the board invented a third grammar in `.strip__pip`. Three
   implementations of one object is how the month came to print a country code
   the board could not, and how a held gig and a tentative rehearsal ended up
   with two ways of saying the same doubt.

   So both primitives normalise HERE, into one `Slip`, and every drawing
   renders that. `kind` and `cert` are the two words the design normalises to;
   everything else is already shared.
   ═══════════════════════════════════════════════════════════════════════ */

/** What sort of thing this is. `show` is a performance; the rest are `date`
    kinds, kept verbatim so the vocabulary never needs a translation table. */
export type SlipKind =
  | 'show'
  | 'rehearsal'
  | 'residency'
  | 'travel_day'
  | 'press'
  | 'day_off'
  | 'other';

export type SlipTime = {
  /** The venue's wall clock — the hour that is printed. */
  primary: string;
  /** The reader's clock, only when the two disagree. A GLOSS: it takes its
      own line and can never push an hour out of its box. */
  secondary: string | null;
};

/**
 * One thing that happens, in the vocabulary every drawing reads.
 *
 * `name` is never truncated by any view (the design's own law, four
 * violations old): a row is allowed to grow, and «Teatre Nacional de
 * Cataluny…» is a name you cannot look up.
 */
export type Slip = {
  id: string;
  kind: SlipKind;
  cert: StatusFamily;
  /** Venue, or the best name this thing has. Never the same string as `city`. */
  name: string;
  city: string | null;
  /** ISO-2. The month drops it (the cell gives 57px and city+code needs
      58–70); the board and the day print it. The DRAWING decides, not this. */
  country: string | null;
  time: SlipTime | null;
  project: ProjectLite | null;
  /** Where the thing lives, or null when it has no page of its own. */
  href: string | null;
  /** Full sentence for the `title` attribute — the one place a truncated or
      dropped field is still recoverable. */
  title: string;
};

type SlipContext = {
  workspaceSlug: string;
  workspaceSlugById: Map<string, string>;
  workspaceTzById: Map<string, string | undefined>;
  viewerTz: string;
  /** Injected so this file stays free of i18n — the caller owns the words. */
  kindLabel: (kind: SlipKind) => string;
  dualTime: (
    at: string,
    tz: string | null,
    viewerTz: string,
  ) => { primary: string; secondary: string | null };
};

/** A city is only a second line when it is not already the name. A slip never
    prints the same place twice. */
function cityUnder(name: string, city: string | null | undefined): string | null {
  const c = city ?? null;
  return c && c !== name ? c : null;
}

export function performanceSlip(p: PerformanceEvent, ctx: SlipContext): Slip {
  const name = p.venue?.name ?? p.venue_name ?? p.city ?? p.project?.name ?? 'Performance';
  const at = perfInstant(p);
  // A venue-less gig falls back to its home space's zone — the one its times
  // were entered in — never silently the browser's.
  const tz = p.venue?.timezone ?? ctx.workspaceTzById.get(p.project?.workspace_id ?? '') ?? null;
  const time = at ? ctx.dualTime(at, tz, ctx.viewerTz) : null;
  const ws = ctx.workspaceSlugById.get(p.project?.workspace_id ?? '') ?? ctx.workspaceSlug;
  const cc = p.venue?.country ?? p.country ?? null;
  const base = `${name} — ${p.status.replace(/_/g, ' ')}`;
  return {
    id: p.id,
    kind: 'show',
    cert: performanceStatusFamily(p.status),
    name,
    city: cityUnder(name, p.venue?.city ?? p.city),
    country: cc ? cc.toUpperCase() : null,
    time,
    project: p.project,
    href: p.slug && p.project ? `/h/${ws}/performance/${p.slug}` : null,
    title: time
      ? time.secondary
        ? `${base} · ${time.primary} (${time.secondary} yours)`
        : `${base} · ${time.primary}`
      : base,
  };
}

export function dateSlip(d: DateEvent, ctx: SlipContext): Slip {
  const kind = (d.kind as SlipKind) ?? 'other';
  const name = d.title ?? d.venue_name ?? d.city ?? ctx.kindLabel(kind);
  // A venue-less DATE stays on the reader's clock on purpose: it buckets on
  // the reader's day (dateDayKey), and a slip must not print a wall time from
  // a zone other than the one that placed it in its cell.
  const tz = d.venue?.timezone ?? null;
  const time = d.all_day ? null : ctx.dualTime(d.starts_at, tz, ctx.viewerTz);
  const cc = d.country ?? null;
  const base = `${ctx.kindLabel(kind)} — ${d.status.replace(/_/g, ' ')}`;
  return {
    id: d.id,
    kind,
    cert: dateStatusFamily(d.status),
    name,
    city: cityUnder(name, d.city),
    country: cc ? cc.toUpperCase() : null,
    time,
    project: d.project,
    href: null,
    title: time ? `${name} · ${base} · ${time.primary}` : `${name} · ${base}`,
  };
}

/** One moment of the day, in order. `key` is a vocabulary, not a string to
 *  print — the caller translates it. */
export type RunSheetStepKey = 'load_in' | 'soundcheck' | 'start' | 'loadout' | 'wrap';

export type RunSheetStep = { key: RunSheetStepKey; at: string };

/** Fixed order, because the five columns carry a CHECK that enforces it. */
const RUN_SHEET_ORDER: ReadonlyArray<
  readonly [RunSheetStepKey, (p: PerformanceEvent) => string | null | undefined]
> = [
  ['load_in', (p) => p.load_in_at],
  ['soundcheck', (p) => p.soundcheck_at],
  ['start', (p) => p.start_at],
  ['loadout', (p) => p.loadout_at],
  ['wrap', (p) => p.wrap_at],
];

/**
 * The day's running order as a list, skipping what nobody filled in.
 *
 * THIS IS THE SEAM. Today the five moments are five columns on `performance`
 * — a list wearing a table's clothes, which is exactly what ADR-090 objected
 * to: nobody can add "photo call" without a migration. When `schedule_slot`
 * lands, the rows move and the labels go free, and the only thing that has to
 * change is the body of this function. Everything that draws the day should
 * go through it and never touch `*_at` directly.
 */
export function runSheetSteps(p: PerformanceEvent): RunSheetStep[] {
  const out: RunSheetStep[] = [];
  for (const [key, read] of RUN_SHEET_ORDER) {
    const at = read(p);
    if (at) out.push({ key, at });
  }
  return out;
}
