/**
 * Shared planner event view-models + pure day/label helpers — formerly
 * MonthGrid.svelte's `<script module>`, extracted so the planner page,
 * the agenda and the feeds import types and bucketing rules without
 * touching the component. Grid math stays in $lib/planner.
 */
import { dayKeyInTz } from '$lib/planner';
import { hourMark } from '$lib/datetime';
import { appLocaleTag } from '$lib/i18n';
import { decideBy, performanceStatusFamily, type StatusFamily } from '$lib/performance';
import { dateStatusFamily } from '$lib/date';
import type { ScheduleMoment } from '$lib/schedule-slot';
import type { Commitment } from '$lib/people';
import type { TravelStageRow } from '$lib/travel-stage';

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
  /** ADR-090 P3 — the whole running order, free moments included, in its
      order. Read through `dayMoments`, never directly. */
  schedule?: ScheduleMoment[] | null;
  /** ADR-084 §1 — filas que lo comparten son UNA tanda de varios días y el
      mes las dibuja como una banda. Simétrico a `DateEvent.series_id`. */
  series_id?: string | null;
  venue_name: string | null;
  city: string | null;
  country: string | null;
  line_id: string | null;
  project: ProjectLite | null;
  /** The row's space (`/api/performances` selects it). Read through
      `perfWorkspaceId`: the project may be null for whoever reads the
      performance through a bolo membership (a guest, ADR-100 § 1). */
  workspace_id?: string | null;
  venue: {
    /** Present on the planner feeds (`/api/performances` selects it). */
    id?: string;
    name: string;
    city: string | null;
    country?: string | null;
    timezone: string | null;
  } | null;
  /** ADR-084 §3 — the operator's readiness ticks, read by the card foot. */
  readiness?: Record<string, boolean> | null;
  /**
   * ADR-080 §2 — days of notice before the gig, NULL meaning "the standard".
   * It travels under `?notice=1`, which until ADR-095 only the decisions feed
   * asked for: the chip could say a hold's RANK but never its DEADLINE, and
   * the deadline is the one thing on a held card that is not a maybe.
   */
  hold_notice_days?: number | null;
  /** Present only on ?rosters=1 fetches (conflict engine feed). */
  person_ids?: string[];
  /** ADR-103 — each person's «voy / no voy» on it. */
  commitments?: Commitment[] | null;
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
  /** ADR-089 — a trip's two ends, written by hand. Absent on old rows,
      where `city` is the destination and the origin is deduced. */
  origin_city?: string | null;
  destination_city?: string | null;
  label?: string | null;
  /** ADR-090 P3 — a rehearsal's running order (see `dayMoments`). */
  schedule?: ScheduleMoment[] | null;
  /** ADR-103 — each person's «voy / no voy» on it. Without any, nobody in
      particular goes: a company date (ADR-147). */
  commitments?: Commitment[] | null;
  /** ADR-146 — a trip's stages, in their order, on the feeds that ask
      `?stages=1` (the pulse's). Absent elsewhere: a trip is then one row. */
  stages?: TravelStageRow[] | null;
};

/**
 * A private post-it (ADR-093), as `/api/notes` returns it. The anchor says
 * what it is about (at most one id set); `on_day` says where it lives in the
 * diary. Always mine — RLS scopes the feed to the author.
 */
export type NoteEvent = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  line_id: string | null;
  performance_id: string | null;
  date_id: string | null;
  person_id: string | null;
  on_day: string;
  body: string;
  created_at: string;
};

/** A stored blackout, page-shaped for rendering (label already built). */
export type BlackoutBandVM = {
  id: string;
  /** starts_on / ends_on — inclusive ISO days. */
  from: string;
  to: string;
  company: boolean;
  tentative: boolean;
  /** The whole sentence, for surfaces with room for exactly one string. */
  label: string;
  /**
   * The bare name — the person, or the company. A band draws WORD · SUBJECT ·
   * SPAN as three fields in three voices (mono kind word, the name in text,
   * the dates in the margin voice), and three voices cannot be recovered from
   * one composed sentence.
   */
  subject?: string;
  note?: string | null;
};

/**
 * A derived away band (ADR-078 §6) — display-only inference, and quieter than
 * an absence on purpose: an absence is a fact somebody wrote down, this is
 * deduced from two travel legs.
 *
 * It says WHOSE tour: at one column wide the coloured monogram is the only
 * thing that survives, so the project travels with the band rather than being
 * flattened into a label the drawing cannot take apart again.
 */
export type AwayBandVM = {
  from: string;
  to: string;
  label: string;
  project_id: string;
  /** Accent as a CSS value, for the monogram. */
  accent: string | null;
  initials: string | null;
  projectName: string | null;
  /** Where the tour is. Without it, «on tour» cannot tell London from anywhere. */
  place: string | null;
  /**
   * THAT WE DEDUCED IT, AND OUT OF WHAT (§ 38). Nobody wrote a tour down: the
   * app paired two travel days. The italic insinuated it; Marco asked for it
   * to be SAID: «no podemos añadir cosas nosotros sin decirlo».
   *
   * Two pieces and not one sentence, because a narrow band has to let one go
   * before the other: `legs` («out 3 Oct · back 9 Oct») names the two trips,
   * which the sheet also draws as the cards either side of the band; `word`
   * («inferred») is the claim itself, and it outlives the legs.
   */
  deduced: { word: string; legs: string };
};

/** The tour's provenance as one phrase, for the surfaces that print a line
    or a tooltip instead of a band: «inferred · out 3 Oct · back 9 Oct». */
export function deducedPhrase(d: { word: string; legs: string }): string {
  return `${d.word} · ${d.legs}`;
}

/** One conflict, page-shaped for the day mark + clash card. */
export type ClashVM = {
  severity: 'people' | 'possible' | 'blackout' | 'blackout-tentative';
  /**
   * WHICH two collide. The red rule is painted on exactly the pair, and the
   * bridge between two adjacent slips only draws when both are on the sheet —
   * neither is possible from a label. These were resolved to strings at the VM
   * boundary and thrown away, so the month could say THAT something clashed
   * and never which.
   */
  event_ids: string[];
  title: string;
  body: string;
  rows: Array<{ label: string; status: string; accent: string | null }>;
};

/** Day bucket of a performance — performed_at is day-level truth. */
export function perfDayKey(p: Pick<PerformanceEvent, 'performed_at'>): string {
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

/** A day on the timed clock is not a second day of the thing: a rehearsal
    from 22h to 2h is one evening. Past this length a timed date spans days. */
const SPAN_MIN_MS = 24 * 3_600_000;
/** A date row that spans days is never drawn past this many (a typo guard). */
const SPAN_MAX_DAYS = 92;

/**
 * Every day a date row occupies, first to last (Marco, 2026-10-18).
 *
 * A row whose `ends_at` falls on another day occupies all of its days, the
 * way a gig of several days already does. Before, everything bucketed by
 * `dateDayKey` alone and a residency from the 16th to the 19th was drawn on
 * the 16th, with the 17th to the 19th offered as a gap to sell.
 *
 * All-day rows store their last day as `ends_at`'s date (EditDateDialog
 * writes `${day}T00:00:00Z`). A timed row only spans when it ends on another
 * day AND lasts 24 hours or more: a late night is not a second day.
 */
export function dateSpanDays(d: DateEvent, timeZone: string): string[] {
  const first = dateDayKey(d, timeZone);
  if (!d.ends_at) return [first];
  const last = d.all_day ? d.ends_at.slice(0, 10) : dayKeyInTz(d.ends_at, d.venue?.timezone || timeZone);
  if (last <= first) return [first];
  if (!d.all_day && Date.parse(d.ends_at) - Date.parse(d.starts_at) < SPAN_MIN_MS) return [first];
  const out: string[] = [];
  for (let day = first; day <= last && out.length < SPAN_MAX_DAYS; day = nextDay(day)) out.push(day);
  return out;
}

function nextDay(iso: string): string {
  const t = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** The id a drawn day of a spanning date stands for — what the server knows. */
export function spanSourceId(id: string): string {
  const i = id.indexOf('#');
  return i === -1 ? id : id.slice(0, i);
}

/**
 * The Planner's rows with every spanning date laid out one row per day, so
 * every drawing (month, agenda, day, board, season) and the census place it
 * on all of its days without learning a second rule.
 *
 * The first day is the row itself (its hour stays; the end hour, which
 * belongs to another day, goes). Each further day is a copy for that day,
 * all-day, with the id `${id}#${day}` so no two drawn rows share a key.
 * They share a series (the row's own, else `span:${id}`), which is how the
 * month already draws a run of days as one band (ADR-084 §1). Anything that
 * talks to the server about a drawn row goes through `spanSourceId`.
 *
 * A trip is left alone: its days are its stages (ADR-089), and copying an
 * outbound leg would pair the tour against itself.
 */
export function expandDateSpans<D extends DateEvent>(rows: readonly D[], timeZone: string): D[] {
  const out: D[] = [];
  for (const d of rows) {
    const days = d.kind === 'travel_day' ? [] : dateSpanDays(d, timeZone);
    if (days.length < 2) {
      out.push(d);
      continue;
    }
    const series_id = d.series_id ?? `span:${d.id}`;
    out.push({ ...d, ends_at: null, series_id });
    for (const day of days.slice(1)) {
      out.push({ ...d, id: `${d.id}#${day}`, starts_at: `${day}T00:00:00.000Z`, ends_at: null, all_day: true, series_id });
    }
  }
  return out;
}

/**
 * ADR-084 §1 — the days each series touches, across dates AND performances
 * (since `20260829100000` a gig can run several days too). A block is N rows
 * sharing a series_id; which day starts it is derived here on every read,
 * never stored. The month draws it as a band, the Desk as one row.
 *
 * The date's day is the caller's: the month buckets by venue timezone, the
 * Desk by the stored day.
 */
export function seriesDayMap<D extends { series_id?: string | null }>(
  dates: readonly D[],
  dayOfDate: (d: D) => string,
  performances: readonly Pick<PerformanceEvent, 'series_id' | 'performed_at'>[],
): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  const add = (sid: string | null | undefined, day: string) => {
    if (!sid) return;
    (m.get(sid) ?? m.set(sid, new Set<string>()).get(sid)!).add(day);
  };
  for (const d of dates) add(d.series_id, dayOfDate(d));
  for (const p of performances) add(p.series_id, perfDayKey(p));
  return m;
}

/** ¿Esta serie es una tanda de verdad? Dos días o más. */
export function isMultiDayRun(days: Map<string, Set<string>>, sid: string | null | undefined): boolean {
  return Boolean(sid && (days.get(sid)?.size ?? 0) >= 2);
}

/** "July 2026" — shared by the page's h1 and the grid's aria-label. */
export function formatMonthLabel(year: number, month: number, locale: string = appLocaleTag()): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Month name alone ("May", "maig") — the masthead's serif em. */
export function monthName(year: number, month: number, locale: string = appLocaleTag()): string {
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

type SlipTime = {
  /** The venue's wall clock — the hour that is printed. `20h30`, never
      `20:30`: the Planner's clock (see `hourMark`). */
  primary: string;
  /**
   * The end of the range, when there is one, and it is a SEPARATE FIELD on
   * purpose — not `«16h–20h»` in one string.
   *
   * If a cell runs short something has to go, and the rule is that it is the
   * end hour: a start hour alone is a whole assertion, half a range is not.
   * That decision belongs to the CELL (a container query), and a cell cannot
   * drop the second half of a string.
   */
  end: string | null;
  /** The reader's clock, only when the two disagree. A GLOSS: it takes its
      own line and can never push an hour out of its box. */
  secondary: string | null;
  /**
   * The hour is the LOAD-IN, not the show (ADR-078: the working time is the
   * load-in when there is one). «SHOW 15h» read as the curtain; the slip says
   * «load-in 15h» instead (revisión del Planner, 2026-10-18).
   */
  loadIn?: boolean;
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
  /**
   * A mono, uppercase word that governs the NAME — `to` on a travel day,
   * where the place alone is ambiguous («London» is a departure or an arrival
   * depending on a column nobody can see).
   */
  lead: string | null;
  /**
   * WHERE THE LEG STARTED, when it can be known — printed as a second line
   * («from Barcelona»), which is how the design draws a travel day.
   *
   * The origin is not a column on `date` (that is ADR-089's subject), so it
   * is DEDUCED, and the deduction is the one the calendar itself makes: where
   * you were is the last place the sheet put you. The nearest event before
   * this day that names a city is where this leg began. It is the same class
   * of inference the tour band already makes from two legs, and it is null —
   * not a guess — when nothing precedes it.
   */
  origin: string | null;
  city: string | null;
  /** ISO-2. The month drops it (the cell gives 57px and city+code needs
      58–70); the board and the day print it. The DRAWING decides, not this. */
  country: string | null;
  time: SlipTime | null;
  project: ProjectLite | null;
  /**
   * Present only while `cert === 'hold'`. The RANK is what is actually being
   * decided between (folding hold_1..3 into one shape is right for the
   * geometry and loses the very thing the operator chooses), and `expires` is
   * THE one thing on a held card that is not a maybe.
   *
   * A workspace that does not run a queue gets `rank: null` — there, hold_1
   * and hold_2 are the same thing (two holds coexisting on a slot), so
   * printing "1st" would invent a hierarchy the company does not have.
   */
  hold: { rank: number | null; expires: string | null } | null;
  /** Where the thing lives, or null when it has no page of its own. */
  href: string | null;
  /** Full sentence for the `title` attribute — the one place a truncated or
      dropped field is still recoverable. */
  title: string;
};

export type SlipContext = {
  workspaceSlug: string;
  workspaceSlugById: Map<string, string>;
  workspaceTzById: Map<string, string | undefined>;
  viewerTz: string;
  /** Injected so this file stays free of i18n — the caller owns the words. */
  kindLabel: (kind: SlipKind) => string;
  /** The status word in the title sentence. Raw enum spelling when absent. */
  statusLabel?: (status: string) => string;
  /** «20h30 yours»: the viewer's clock in the title sentence. */
  viewerTimeLabel?: (time: string) => string;
  /** The name a performance with no venue, city or project falls back to. */
  fallbackName?: string;
  /** ADR-002 — the workspace's hold convention, resolved PER SLIP. */
  workspaceModeById?: Map<string, string>;
  /** Where a travel leg began — see `Slip.origin`. The DRAWING supplies it,
      because only a drawing knows what else is on the sheet. */
  originOf?: (d: DateEvent) => string | null;
  dualTime: (
    at: string,
    tz: string | null,
    viewerTz: string,
  ) => { primary: string; secondary: string | null };
};

function statusWordOf(status: string, ctx: SlipContext): string {
  return ctx.statusLabel ? ctx.statusLabel(status) : status.replace(/_/g, ' ');
}

/** A city is only a second line when it is not already the name. A slip never
    prints the same place twice. */
function cityUnder(name: string, city: string | null | undefined): string | null {
  const c = city ?? null;
  return c && c !== name ? c : null;
}

/** `HH:MM` off the wire → the Planner's clock, keeping null null. */
function clock(t: string | null): string | null {
  return t ? hourMark(t) : null;
}

/**
 * The space a performance lives in: its project's, else its own row's. A
 * guest of a bolo reads the performance and not its project (RLS), so the
 * embed is null and only the row says where it is.
 */
export function perfWorkspaceId(p: Pick<PerformanceEvent, 'project' | 'workspace_id'>): string | null {
  return p.project?.workspace_id ?? p.workspace_id ?? null;
}

export function performanceSlip(p: PerformanceEvent, ctx: SlipContext): Slip {
  const name =
    p.venue?.name ?? p.venue_name ?? p.city ?? p.project?.name ?? ctx.fallbackName ?? 'Performance';
  const at = perfInstant(p);
  // A venue-less gig falls back to its home space's zone — the one its times
  // were entered in — never silently the browser's.
  const tz = p.venue?.timezone ?? ctx.workspaceTzById.get(perfWorkspaceId(p) ?? '') ?? null;
  const dual = at ? ctx.dualTime(at, tz, ctx.viewerTz) : null;
  // A gig is ONE instant on the sheet — the working time. Its running order
  // (load-in, soundcheck, wrap) is the Day's business, through runSheetSteps.
  const time: SlipTime | null = dual
    ? {
        primary: hourMark(dual.primary),
        end: null,
        secondary: clock(dual.secondary),
        loadIn: Boolean(p.load_in_at) && at === p.load_in_at,
      }
    : null;
  const ws = ctx.workspaceSlugById.get(perfWorkspaceId(p) ?? '') ?? ctx.workspaceSlug;
  const cc = p.venue?.country ?? p.country ?? null;
  const base = `${name} — ${statusWordOf(p.status, ctx)}`;
  const cert = performanceStatusFamily(p.status);
  // The rank only means something where the convention is a priority queue.
  const mode = ctx.workspaceModeById?.get(perfWorkspaceId(p) ?? '') ?? 'simple';
  const rankMatch = mode === 'prioritized' ? p.status.match(/^hold_([123])$/) : null;
  return {
    id: p.id,
    kind: 'show',
    cert,
    hold:
      cert === 'hold'
        ? {
            rank: rankMatch ? Number(rankMatch[1]) : null,
            expires: at ? decideBy(at, p.hold_notice_days) : null,
          }
        : null,
    name,
    lead: null,
    origin: null,
    city: cityUnder(name, p.venue?.city ?? p.city),
    country: cc ? cc.toUpperCase() : null,
    time,
    project: p.project,
    href: p.slug && perfWorkspaceId(p) ? `/h/${ws}/performance/${p.slug}` : null,
    title: time
      ? time.secondary
        ? `${base} · ${time.primary} (${ctx.viewerTimeLabel ? ctx.viewerTimeLabel(time.secondary) : `${time.secondary} yours`})`
        : `${base} · ${time.primary}`
      : base,
  };
}

export function dateSlip(d: DateEvent, ctx: SlipContext): Slip {
  const kind = (d.kind as SlipKind) ?? 'other';
  // ADR-089: a trip names where it goes. The written destination first; an
  // old row's `city` already meant the same thing.
  const trip = kind === 'travel_day';
  const goesTo = trip ? (d.destination_city ?? d.city) : d.city;
  const name = d.title ?? d.venue_name ?? goesTo ?? ctx.kindLabel(kind);
  // A venue-less DATE stays on the reader's clock on purpose: it buckets on
  // the reader's day (dateDayKey), and a slip must not print a wall time from
  // a zone other than the one that placed it in its cell.
  const tz = d.venue?.timezone ?? null;
  const dual = d.all_day ? null : ctx.dualTime(d.starts_at, tz, ctx.viewerTz);
  // The END of a session is real information a date carries and a gig does
  // not — a rehearsal is `10h–14h`, and the second half is what tells you the
  // afternoon is free. It is its own field so the cell can drop it.
  const endDual = !d.all_day && d.ends_at ? ctx.dualTime(d.ends_at, tz, ctx.viewerTz) : null;
  const time: SlipTime | null = dual
    ? {
        primary: hourMark(dual.primary),
        end: clock(endDual && endDual.primary !== dual.primary ? endDual.primary : null),
        secondary: clock(dual.secondary),
      }
    : null;
  const cc = d.country ?? null;
  const base = `${ctx.kindLabel(kind)} — ${statusWordOf(d.status, ctx)}`;
  /**
   * `to`, and it is `to` for all three directions — see `Slip.lead`.
   *
   * A travel day stores ONE place and it is the DESTINATION, whichever way
   * you are going: `tourPlaceFor()` reads the outbound leg's city as where
   * the tour is, and the return leg's city is home. So the word that is true
   * of the stored field is `to` — and it is not redundant for being constant:
   * `Barcelona` on a travel day could be read as «this happens in Barcelona»,
   * which is exactly what a travel day is not.
   *
   * The second place («from …») is WRITTEN when the trip has its origin
   * (ADR-089), and deduced, not invented, when it has not — see `origin`.
   * A written destination earns the `to` even without a direction: it says
   * which end it is by itself.
   */
  const lead = trip && (d.travel_direction || d.destination_city) ? 'to' : null;
  const from = lead ? (d.origin_city ?? ctx.originOf?.(d) ?? null) : null;
  const origin = from && from !== name ? from : null;
  return {
    id: d.id,
    kind,
    cert: dateStatusFamily(d.status),
    // A date has no booking queue: `tentative` is the whole of what it says.
    hold: null,
    name,
    lead,
    origin,
    city: cityUnder(name, goesTo),
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

type RunSheetStep = { key: RunSheetStepKey; at: string };

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


/**
 * One moment of a day's running order, for the drawings that read it whole
 * (the day strip): one of the five steps (`key`) or a free moment somebody
 * named (`key: null`, `label: 'photo call'`). A legacy step renamed by hand
 * keeps its key and carries its label too.
 */
export type DayMoment = { key: MomentKey | null; label: string | null; at: string };

/**
 * The moments with a NAME in the vocabulary: the five, plus doors and curfew
 * (ADR-146). `schedule_slot.kind` is text, so the two need no migration; they
 * are not columns either, so `runSheetSteps` (the five) never sees them and
 * only a feed that carries `schedule` can say them.
 */
export type MomentKey = RunSheetStepKey | 'doors' | 'curfew';

export const MOMENT_KEYS: ReadonlySet<string> = new Set<MomentKey>([
  'load_in',
  'soundcheck',
  'doors',
  'start',
  'loadout',
  'wrap',
  'curfew',
]);

/** The dictionary key of a moment's word (`desk.anchor_*`, the one vocabulary). */
export function momentWordKey(key: MomentKey): string {
  return `desk.anchor_${key === 'load_in' ? 'loadin' : key === 'start' ? 'show' : key}`;
}

/**
 * The running order of a performance or a date, as it was written (ADR-090
 * P3), in its order. Falls back to the five fields for a feed that does not
 * carry `schedule` yet, so nothing that drew the five stops drawing them.
 *
 * `runSheetSteps` stays the five on purpose: the rail's pulse reads it, and a
 * free moment has no word in its vocabulary.
 */
export function dayMoments(e: PerformanceEvent | DateEvent): DayMoment[] {
  // An empty array is truthy: only a schedule WITH moments wins over the five
  // fields (the API derives those from the same rows, so both agree there).
  if (e.schedule?.length) {
    return e.schedule.map((m) => ({
      key: m.kind && MOMENT_KEYS.has(m.kind) ? (m.kind as MomentKey) : null,
      label: m.label,
      at: m.at,
    }));
  }
  if (!('performed_at' in e)) return [];
  return runSheetSteps(e).map((s) => ({ key: s.key, label: null, at: s.at }));
}
