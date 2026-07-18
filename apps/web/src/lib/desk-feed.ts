/**
 * Desk feed (ADR-063/065/068/069/070 · converged design 2026-07-18) — the
 * pure builder behind /h/desk. ONE ranked feed, FOUR concerns, grouped in day
 * buckets, in a FIXED within-day type order that mirrors the lens nav:
 *
 *     tasks → agenda → conversations → money
 *
 * The theorem (spec § /h/desk): only TASKS are stored; every other row is a
 * CALL computed from entity state — an overdue invoice → a "remind" call, a
 * conversation past its next action → a "reply" call — that DISAPPEARS when
 * the state changes. Nothing to tick, nothing to clean. So this module never
 * fabricates: it derives calls from conversations / performances / dates /
 * invoices, live.
 *
 * No fetching, no clock, NO copy: `now` is injected (tests pin the day math),
 * every label is a KEY (the page translates), and money is computed only when
 * the caller says fees are visible (masked === absent, suppressed silently).
 * Calendar-day arithmetic throughout (the date-only contract).
 *
 * Today's / tomorrow's gig is the bucket BANNER (anchor), outside the type
 * order. AI-proposed tasks (origin='ai') ride as ghost rows inside the task
 * block — real rows (the consent inbox, ADR-069), never invented.
 */

import { taskSurfaceState, taskContextLabel, taskProjectId, type TaskItem } from './task';
import type { Locale } from './i18n';

export type DeskConcern = 'task' | 'agenda' | 'conversation' | 'money';

export type BucketLabelKey =
  | 'overdue'
  | 'today'
  | 'tomorrow'
  | 'weekday'
  | 'next_week'
  | 'later'
  | 'anytime';

export interface DeskConvInput {
  id: string;
  status: string;
  next_action_at: string | null;
  next_action_note: string | null;
  person: { full_name: string | null; organization_name: string | null; slug: string | null } | null;
  project: { id: string; slug: string; name: string } | null;
}

export interface DeskPerfInput {
  id: string;
  performed_at: string;
  status: string;
  venue_name: string | null;
  city: string | null;
  load_in_at: string | null;
  start_at: string | null;
  venue: { name: string | null } | null;
  project: { id: string; slug: string | null; name: string } | null;
}

/** A pure calendar event (rehearsal / travel / press…) — NOT a performance
 *  (those come from DeskPerfInput; a `date` with a performance_id is that
 *  gig's own slot and is dropped here to avoid a double row). */
export interface DeskDateInput {
  id: string;
  kind: string;
  status: string;
  title: string | null;
  starts_at: string;
  all_day: boolean;
  city: string | null;
  performance_id: string | null;
  project: { id: string; slug: string | null; name: string } | null;
}

export interface DeskInvoiceInput {
  id: string;
  number: string | null;
  status: string;
  due_on: string | null;
  total: number;
  currency: string;
  payer: { full_name: string | null; organization_name: string | null } | null;
  project: { id: string; slug: string | null; name: string } | null;
}

/** One rendered row, normalised across the concerns. */
export interface DeskItem {
  id: string;
  concern: DeskConcern;
  /** Derived-call verb i18n key (conversation / money). null for task / agenda. */
  verbKey: string | null;
  /** Agenda rows: the ISO time to lead with (null when all-day). */
  atISO: string | null;
  allDay: boolean;
  subject: string;
  projectName: string;
  lineName: string | null;
  /** The item's project id — the page resolves the space name from it, to
   *  prepend `space ·` on the cross-space (Everything) view only. */
  projectId: string | null;
  overdue: boolean;
  /** Conversation → person page (page builds the href with its ws slug). */
  personSlug: string | null;
  /** A ready lens href (money → /h/money) or null. */
  href: string | null;
  /** Task rows. */
  taskId: string | null;
  taskDone: boolean;
  surfacesDay: string | null;
  dueLabel: 'overdue' | 'due' | null;
  /** AI consent inbox (ADR-069): origin='ai' → a proposal ghost row. */
  isProposal: boolean;
  reason: string | null;
  /** Money amount (remind / confirm rows only). */
  amount: number | null;
  currency: string | null;
}

export interface ShowAnchor {
  venue: string;
  city: string | null;
  loadInAt: string | null;
  startAt: string | null;
  projectName: string;
  accentSlug: string;
  performanceSlug: string;
}

export interface DeskRun {
  concern: DeskConcern;
  items: DeskItem[];
}

export interface DeskBucket {
  sortKey: number;
  labelKey: BucketLabelKey;
  weekday: string;
  dateLabel: string;
  overdue: boolean;
  anchor: ShowAnchor | null;
  runs: DeskRun[];
}

export interface DeskFeedInput {
  conversations: DeskConvInput[];
  tasks: TaskItem[];
  performances: DeskPerfInput[];
  dates: DeskDateInput[];
  /** Only pass when the viewer can see fees; omit/empty to suppress money. */
  invoices?: DeskInvoiceInput[];
}

const VERB_KEYS: Record<string, { upcoming: string; overdue: string }> = {
  contacted: { upcoming: 'followup', overdue: 'chase' },
  in_conversation: { upcoming: 'reply', overdue: 'reply' },
  hold: { upcoming: 'confirm', overdue: 'confirm' },
  confirmed: { upcoming: 'prep', overdue: 'prep' },
  declined: { upcoming: 'note', overdue: 'note' },
  dormant: { upcoming: 'revive', overdue: 'revive' },
  recurring: { upcoming: 'check', overdue: 'check' },
};

// Fixed within-day order, mirroring the lens nav (Desk · Calendar · Contacts ·
// Money). The show-day banner sits above this, outside the order.
const CONCERN_RANK: Record<DeskConcern, number> = {
  task: 0,
  agenda: 1,
  conversation: 2,
  money: 3,
};

const DAY = 86_400_000;
const PAID_OR_DEAD = new Set(['paid', 'void', 'cancelled', 'draft']);

function localDayISO(now: Date): string {
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

export function dayBucket(
  dayISO: string | null,
  now: Date,
  locale: Locale,
): { sortKey: number; labelKey: BucketLabelKey; weekday: string; dateLabel: string } {
  if (!dayISO) return { sortKey: 99, labelKey: 'anytime', weekday: '', dateLabel: '' };
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  // Accept either a date-only 'YYYY-MM-DD' or a full timestamp — the day is
  // always the first 10 chars (the date-only contract).
  const d = new Date(`${dayISO.slice(0, 10)}T00:00:00`);
  const diff = Math.floor((d.getTime() - start.getTime()) / DAY);
  const dateLabel = `${new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(d)} · ${d.getDate()} ${new Intl.DateTimeFormat(locale, { month: 'short' }).format(d).replace(/\.$/, '')}`;
  if (diff < 0) return { sortKey: -1, labelKey: 'overdue', weekday: '', dateLabel: '' };
  if (diff === 0) return { sortKey: 0, labelKey: 'today', weekday: '', dateLabel };
  if (diff === 1) return { sortKey: 1, labelKey: 'tomorrow', weekday: '', dateLabel };
  if (diff < 7)
    return {
      sortKey: diff,
      labelKey: 'weekday',
      weekday: new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(d),
      dateLabel,
    };
  if (diff < 14) return { sortKey: 7, labelKey: 'next_week', weekday: '', dateLabel };
  return { sortKey: 98, labelKey: 'later', weekday: '', dateLabel };
}

function convSubject(e: DeskConvInput): string {
  return e.person?.full_name || e.person?.organization_name || e.next_action_note || 'Untitled';
}
function payerName(i: DeskInvoiceInput): string {
  return i.payer?.full_name || i.payer?.organization_name || i.number || 'Invoice';
}

type Entry = {
  sortKey: number;
  labelKey: BucketLabelKey;
  weekday: string;
  dateLabel: string;
  rank: number;
  sub: number;
  item: DeskItem;
};

function blankItem(over: Partial<DeskItem> & Pick<DeskItem, 'id' | 'concern' | 'subject'>): DeskItem {
  return {
    verbKey: null,
    atISO: null,
    allDay: false,
    projectName: '—',
    lineName: null,
    projectId: null,
    overdue: false,
    personSlug: null,
    href: null,
    taskId: null,
    taskDone: false,
    surfacesDay: null,
    dueLabel: null,
    isProposal: false,
    reason: null,
    amount: null,
    currency: null,
    ...over,
  };
}

/** Build the full day-bucketed, fixed-order, concern-grouped Desk feed. */
export function buildDeskFeed(input: DeskFeedInput, now: Date, locale: Locale = 'en'): DeskBucket[] {
  const todayISO = localDayISO(now);
  const entries: Entry[] = [];
  const anchors = new Map<number, ShowAnchor>();

  const push = (dayISO: string | null, concern: DeskConcern, sub: number, item: DeskItem) => {
    const b = dayBucket(dayISO, now, locale);
    entries.push({
      sortKey: b.sortKey,
      labelKey: b.labelKey,
      weekday: b.weekday,
      dateLabel: b.dateLabel,
      rank: CONCERN_RANK[concern],
      sub,
      item,
    });
  };

  // ── Tasks (stored). Dormant never surfaces (ADR-070); done is out. AI
  //    (origin='ai') rides as a proposal ghost inside the task block.
  for (const t of input.tasks) {
    const surface = taskSurfaceState(t, now);
    if (surface.state === 'dormant' || surface.state === 'done') continue;
    const day = t.due_at?.slice(0, 10) ?? surface.surfacesAt ?? null;
    const overdue = surface.state === 'overdue';
    push(
      day,
      'task',
      day ? Date.parse(`${day}T00:00:00Z`) : Number.MAX_SAFE_INTEGER,
      blankItem({
        id: `task-${t.id}`,
        concern: 'task',
        subject: t.title,
        projectName: t.project?.name ?? t.line?.name ?? taskContextLabel(t) ?? '',
        lineName: t.line?.name ?? null,
        projectId: taskProjectId(t),
        overdue,
        taskId: t.id,
        surfacesDay: surface.surfacesAt,
        dueLabel: t.due_at ? (overdue ? 'overdue' : surface.state === 'urgent' ? 'due' : null) : null,
        isProposal: t.origin === 'ai',
        reason: t.origin === 'ai' ? (t.note ?? null) : null,
      }),
    );
  }

  // ── Agenda: performances + pure date events, leading with their hour.
  //    Today's / tomorrow's gig is the bucket BANNER (anchor), not a row.
  for (const p of input.performances) {
    if (p.status === 'cancelled' || p.performed_at.slice(0, 10) < todayISO) continue;
    const day = p.performed_at.slice(0, 10);
    const b = dayBucket(day, now, locale);
    const place = p.venue?.name ?? p.venue_name ?? p.city ?? '—';
    if ((b.sortKey === 0 || b.sortKey === 1) && !anchors.has(b.sortKey)) {
      anchors.set(b.sortKey, {
        venue: place,
        city: p.city,
        loadInAt: p.load_in_at,
        startAt: p.start_at,
        projectName: p.project?.name ?? '—',
        accentSlug: p.project?.slug ?? '',
        performanceSlug: p.id,
      });
      continue;
    }
    const at = p.start_at ?? p.load_in_at;
    push(
      day,
      'agenda',
      at ? Date.parse(at) : Date.parse(`${day}T23:59:00`),
      blankItem({
        id: `perf-${p.id}`,
        concern: 'agenda',
        subject: place,
        projectName: p.project?.name ?? '—',
        projectId: p.project?.id ?? null,
        atISO: at,
        href: '/h/calendar',
      }),
    );
  }
  for (const d of input.dates) {
    if (d.status === 'cancelled' || d.performance_id) continue; // gig slots come from performances
    const day = d.starts_at.slice(0, 10);
    if (day < todayISO) continue;
    push(
      day,
      'agenda',
      d.all_day ? Date.parse(`${day}T00:00:00`) : Date.parse(d.starts_at),
      blankItem({
        id: `date-${d.id}`,
        concern: 'agenda',
        subject: d.title ?? d.kind,
        projectName: d.project?.name ?? d.city ?? '—',
        projectId: d.project?.id ?? null,
        atISO: d.all_day ? null : d.starts_at,
        allDay: d.all_day,
        href: '/h/calendar',
      }),
    );
  }

  // ── Conversations (derived calls): next action set, not declined/dormant.
  let hasOverdue = false;
  let hasTodayShow = anchors.has(0);
  for (const e of input.conversations) {
    if (e.status === 'declined' || e.status === 'dormant' || !e.next_action_at) continue;
    const day = e.next_action_at.slice(0, 10);
    const b = dayBucket(day, now, locale);
    const overdue = b.sortKey === -1;
    if (overdue) hasOverdue = true;
    push(
      day,
      'conversation',
      Date.parse(`${day}T00:00:00Z`),
      blankItem({
        id: `conv-${e.id}`,
        concern: 'conversation',
        subject: convSubject(e),
        projectName: e.project?.name ?? '—',
        projectId: e.project?.id ?? null,
        verbKey: VERB_KEYS[e.status]?.[overdue ? 'overdue' : 'upcoming'] ?? 'look',
        overdue,
        personSlug: e.person?.slug ?? null,
      }),
    );
  }

  // ── Revive (quiet days only): no overdue and no show today → up to two
  //    dormant conversations offered as proposal-toned revive calls (ADR-073).
  if (!hasOverdue && !hasTodayShow) {
    const dormant = input.conversations.filter((e) => e.status === 'dormant').slice(0, 2);
    for (const e of dormant) {
      push(
        todayISO,
        'conversation',
        Number.MAX_SAFE_INTEGER,
        blankItem({
          id: `revive-${e.id}`,
          concern: 'conversation',
          subject: e.person?.full_name || e.person?.organization_name || 'Contact',
          projectName: e.project?.name ?? '—',
          projectId: e.project?.id ?? null,
          verbKey: 'revive',
          personSlug: e.person?.slug ?? null,
          isProposal: true,
        }),
      );
    }
  }

  // ── Money (derived, only when fees are visible): issued invoices past
  //    due_on → "remind" calls, in the OVERDUE bucket, amount shown.
  for (const inv of input.invoices ?? []) {
    if (PAID_OR_DEAD.has(inv.status) || !inv.due_on || inv.due_on.slice(0, 10) >= todayISO) continue;
    push(
      inv.due_on,
      'money',
      Date.parse(`${inv.due_on.slice(0, 10)}T00:00:00Z`),
      blankItem({
        id: `inv-${inv.id}`,
        concern: 'money',
        subject: payerName(inv),
        projectName: inv.project?.name ?? '—',
        projectId: inv.project?.id ?? null,
        verbKey: 'remind',
        overdue: true,
        href: '/h/money',
        amount: inv.total,
        currency: inv.currency,
      }),
    );
  }

  // ── Group into buckets, order by fixed concern rank then secondary sub,
  //    collapse consecutive same-concern items into runs.
  const byKey = new Map<number, { labelKey: BucketLabelKey; weekday: string; dateLabel: string; entries: Entry[] }>();
  for (const entry of entries) {
    const meta = byKey.get(entry.sortKey);
    if (meta) meta.entries.push(entry);
    else byKey.set(entry.sortKey, { labelKey: entry.labelKey, weekday: entry.weekday, dateLabel: entry.dateLabel, entries: [entry] });
  }

  const buckets: DeskBucket[] = [...byKey.keys()]
    .sort((a, b) => a - b)
    .map((sortKey) => {
      const { labelKey, weekday, dateLabel, entries: es } = byKey.get(sortKey)!;
      es.sort((a, b) => a.rank - b.rank || a.sub - b.sub);
      const runs: DeskRun[] = [];
      for (const { item } of es) {
        const last = runs[runs.length - 1];
        if (last && last.concern === item.concern) last.items.push(item);
        else runs.push({ concern: item.concern, items: [item] });
      }
      return { sortKey, labelKey, weekday, dateLabel, overdue: sortKey === -1, anchor: anchors.get(sortKey) ?? null, runs };
    });

  // A banner day with no rows still needs its bucket to host the anchor.
  for (const [sortKey, anchor] of anchors) {
    if (buckets.some((b) => b.sortKey === sortKey)) continue;
    const b = dayBucket(sortKey === 0 ? todayISO : null, now, locale);
    const label = sortKey === 0 ? b : dayBucket(localDayISO(new Date(now.getTime() + DAY)), now, locale);
    buckets.push({ sortKey, labelKey: label.labelKey, weekday: label.weekday, dateLabel: label.dateLabel, overdue: false, anchor, runs: [] });
  }
  buckets.sort((a, b) => a.sortKey - b.sortKey);
  return buckets;
}

export interface DeskSummary {
  /** DATED items that need you (every bucket except the anytime tail). */
  needYou: number;
  overdue: number;
  nextShowCity: string | null;
  holds: number;
  live: number;
  /** Sum of open (unpaid) invoice totals; null when fees are not visible. */
  pipeline: number | null;
  currency: string | null;
}

export function deskSummary(input: DeskFeedInput, now: Date): DeskSummary {
  const todayISO = localDayISO(now);
  let needYou = 0;
  let overdue = 0;

  for (const e of input.conversations) {
    if (e.status === 'declined' || e.status === 'dormant' || !e.next_action_at) continue;
    const day = e.next_action_at.slice(0, 10);
    if (day < todayISO) {
      overdue += 1;
      needYou += 1;
    } else needYou += 1; // every dated conversation call counts (anytime excluded — calls are always dated)
  }
  for (const t of input.tasks) {
    const s = taskSurfaceState(t, now);
    if (s.state === 'dormant' || s.state === 'done') continue;
    const day = t.due_at?.slice(0, 10) ?? s.surfacesAt ?? null;
    if (!day) continue; // anytime tail — excluded from the headline
    if (s.state === 'overdue') overdue += 1;
    needYou += 1;
  }
  for (const inv of input.invoices ?? []) {
    if (PAID_OR_DEAD.has(inv.status) || !inv.due_on || inv.due_on.slice(0, 10) >= todayISO) continue;
    overdue += 1;
    needYou += 1;
  }

  const next = input.performances
    .filter((p) => p.status !== 'cancelled' && p.performed_at.slice(0, 10) >= todayISO)
    .sort((a, b) => (a.performed_at < b.performed_at ? -1 : 1))[0];
  const live = input.conversations.filter(
    (e) => e.status !== 'declined' && e.status !== 'dormant' && e.next_action_at,
  ).length;
  const holds = input.conversations.filter((e) => e.status === 'hold').length;

  const open = (input.invoices ?? []).filter((i) => !PAID_OR_DEAD.has(i.status));
  const pipeline = input.invoices ? open.reduce((a, i) => a + i.total, 0) : null;
  const currency = open[0]?.currency ?? null;

  return {
    needYou,
    overdue,
    nextShowCity: next ? (next.city ?? next.venue?.name ?? next.venue_name ?? null) : null,
    holds,
    live,
    pipeline,
    currency,
  };
}
