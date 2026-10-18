/**
 * Desk feed (ADR-063/065/068/069/070 · converged design 2026-07-18; the
 * dashboard of ADR-117) — the pure builder behind /h/desk's «Te espera».
 * THREE concerns grouped in day buckets, in a FIXED within-day type order:
 *
 *     tasks → conversations → money
 *
 * The agenda is the Planner's (ADR-117 § 2): the Desk no longer draws the
 * week's rehearsals and gigs; «Lo siguiente» carries the next one.
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
 * AI-proposed tasks (origin='ai') ride as ghost rows inside the task block —
 * real rows (the consent inbox, ADR-069), never invented. «Vencido» on money
 * is the aging of Cuentas (`invoiceAging`, ADR-117 § 4), not `due_on`.
 */

import { localDayISO } from './datetime';
import { taskSurfaceState, taskContextLabel, taskProjectId, type TaskItem } from './task';
import { LOCALE_TAG, t, type Locale } from './i18n';
import { invoiceAging, observedPayerTermsDays, type MoneyInvoiceItem } from './money';

/** `going`: a «voy · no voy» Hour asks about you (ADR-103); only «Te espera» has it. */
export type DeskConcern = 'task' | 'conversation' | 'money' | 'going';

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
  /** ADR-102: who the conversation is with; it titles the item when present. */
  organization?: { name: string } | null;
  project: { id: string; slug: string; name: string } | null;
}

/** The invoice as Cuentas reads it: aging needs its payments and payer. */
export type DeskInvoiceInput = MoneyInvoiceItem;

/** One rendered row, normalised across the concerns. */
export interface DeskItem {
  id: string;
  concern: DeskConcern;
  /** Derived-call verb i18n key (conversation / money / going). null for a task. */
  verbKey: string | null;
  subject: string;
  projectName: string;
  lineName: string | null;
  /** The item's project id — the page resolves the space name from it, to
   *  prepend `space ·` on the cross-space (Everything) view only. */
  projectId: string | null;
  overdue: boolean;
  /** Conversation → person page (page builds the href with its ws slug). */
  personSlug: string | null;
  /** A ready href (money → its bolo in Cuentas, a «voy» → its day) or null. */
  href: string | null;
  /** Task rows. */
  taskId: string | null;
  taskDone: boolean;
  surfacesDay: string | null;
  /** A task's own due day; null when it has none (a «desde» is not a deadline). */
  dueDay: string | null;
  dueLabel: 'overdue' | 'due' | null;
  /** AI consent inbox (ADR-069): origin='ai' → a proposal ghost row. */
  isProposal: boolean;
  reason: string | null;
  /** Money amount still owed (remind rows only). */
  amount: number | null;
  currency: string | null;
  /** The calendar day it sits on (YYYY-MM-DD), null for the anytime tail. */
  day: string | null;
  /** A «voy · no voy» row: what the answer is written on. */
  going: { of: 'performance' | 'date'; id: string } | null;
  /** A reply row: when they wrote (its «when» is how long ago). */
  repliedAt: string | null;
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
  runs: DeskRun[];
}

export interface DeskFeedInput {
  conversations: DeskConvInput[];
  tasks: TaskItem[];
  /** Only pass when the viewer can see fees; omit/empty to suppress money. */
  invoices?: DeskInvoiceInput[];
  /** A gig today keeps the quiet-day revive away (ADR-073). */
  showToday?: boolean;
  /**
   * Rooms whose latest word is theirs and asks for an answer: the «te toca»
   * rows of the Conversations overview with reason `reply` (ADR-126 § 1). They
   * wait today until answered; their next-action call is not drawn twice.
   */
  replies?: DeskReplyInput[];
}

export interface DeskReplyInput {
  id: string;
  title: string;
  projectId: string | null;
  projectName: string;
  /** Their message: when they wrote. */
  at: string;
  href: string | null;
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

/** i18n verb key (desk.verb_*) for a conversation's derived call. */
export function conversationVerbKey(status: string, overdue: boolean): string {
  return VERB_KEYS[status]?.[overdue ? 'overdue' : 'upcoming'] ?? 'look';
}

// Fixed within-day order of the day list, mirroring the lens nav.
const CONCERN_RANK: Record<DeskConcern, number> = {
  task: 0,
  going: 1,
  conversation: 2,
  money: 3,
};

const DAY = 86_400_000;

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
  const tag = LOCALE_TAG[locale];
  const dateLabel = `${new Intl.DateTimeFormat(tag, { weekday: 'short' }).format(d)} · ${d.getDate()} ${new Intl.DateTimeFormat(tag, { month: 'short' }).format(d).replace(/\.$/, '')}`;
  if (diff < 0) return { sortKey: -1, labelKey: 'overdue', weekday: '', dateLabel: '' };
  if (diff === 0) return { sortKey: 0, labelKey: 'today', weekday: '', dateLabel };
  if (diff === 1) return { sortKey: 1, labelKey: 'tomorrow', weekday: '', dateLabel };
  if (diff < 7)
    return {
      sortKey: diff,
      labelKey: 'weekday',
      weekday: new Intl.DateTimeFormat(tag, { weekday: 'long' }).format(d),
      dateLabel,
    };
  if (diff < 14) return { sortKey: 7, labelKey: 'next_week', weekday: '', dateLabel };
  return { sortKey: 98, labelKey: 'later', weekday: '', dateLabel };
}

/**
 * The Desk's horizon: detail stays near (today, tomorrow, the rest of the
 * week, a block per day); everything past it folds into ONE `later` bucket
 * the page draws as a single line (`laterSummary`) that opens the Agenda.
 * `dayBucket` itself keeps «next week» for the hall rail.
 */
function horizonBucket(b: ReturnType<typeof dayBucket>): ReturnType<typeof dayBucket> {
  return b.sortKey >= 7 && b.sortKey < 99 ? { ...b, sortKey: 98, labelKey: 'later', weekday: '' } : b;
}

/** The later bucket as one line: how many things, from which day to which. */
export function laterSummary(feed: DeskBucket[]): { count: number; from: string; until: string } | null {
  const later = feed.find((b) => b.labelKey === 'later');
  const days = (later?.runs ?? [])
    .flatMap((r) => r.items.map((i) => i.day))
    .filter((d): d is string => !!d)
    .sort();
  if (!later || !days.length) return null;
  return { count: later.runs.reduce((n, r) => n + r.items.length, 0), from: days[0], until: days[days.length - 1] };
}

function convSubject(e: DeskConvInput, locale: Locale): string {
  return (
    e.organization?.name || e.person?.full_name || e.person?.organization_name || e.next_action_note || t('desk.untitled', locale)
  );
}
function payerName(i: DeskInvoiceInput, locale: Locale): string {
  return i.payer?.name || i.number || t('desk.fallback_invoice', locale);
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
    projectName: '—',
    lineName: null,
    projectId: null,
    overdue: false,
    personSlug: null,
    href: null,
    taskId: null,
    taskDone: false,
    surfacesDay: null,
    dueDay: null,
    dueLabel: null,
    isProposal: false,
    reason: null,
    amount: null,
    currency: null,
    day: null,
    going: null,
    repliedAt: null,
    ...over,
  };
}

/**
 * The overdue invoices, as Cuentas decides it: issued, something still owed,
 * and past the date it was expected (`invoiceAging`, observed payer terms
 * included). The terms are learnt from the invoices passed in.
 */
export function overdueInvoices(
  invoices: readonly DeskInvoiceInput[],
  now: Date,
): { invoice: DeskInvoiceInput; owed: number; expectedOn: string }[] {
  const terms = observedPayerTermsDays([...invoices], invoices.flatMap((i) => i.payments ?? []));
  const out: { invoice: DeskInvoiceInput; owed: number; expectedOn: string }[] = [];
  for (const inv of invoices) {
    if (inv.status !== 'issued') continue;
    const aging = invoiceAging({ ...inv, payments: inv.payments ?? [] }, terms, now);
    const owed = Number(inv.total) - aging.paidAmount;
    if (aging.state !== 'past-expected' || owed <= 0 || !aging.expectedOn) continue;
    out.push({ invoice: inv, owed, expectedOn: aging.expectedOn });
  }
  return out;
}

/** Where an invoice opens: its bolo in Cuentas, or the lens. */
export function invoiceHref(inv: Pick<DeskInvoiceInput, 'lines'>): string {
  const bolo = inv.lines?.find((l) => l.bolo_id)?.bolo_id;
  return bolo ? `/h/books#bolo-${bolo}` : '/h/books';
}

/** Build the full day-bucketed, fixed-order, concern-grouped Desk feed. */
export function buildDeskFeed(input: DeskFeedInput, now: Date, locale: Locale = 'en'): DeskBucket[] {
  const todayISO = localDayISO(now);
  const entries: Entry[] = [];

  const push = (dayISO: string | null, concern: DeskConcern, sub: number, item: DeskItem) => {
    const b = horizonBucket(dayBucket(dayISO, now, locale));
    item.day = dayISO ? dayISO.slice(0, 10) : null;
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
    // Only a due date can pass: a task with just «desde» that has surfaced is
    // today's, never late (its «desde» is not a deadline).
    const dueDay = t.due_at?.slice(0, 10) ?? null;
    const day = dueDay ?? (surface.surfacesAt ? todayISO : null);
    const overdue = surface.state === 'overdue';
    push(
      day,
      'task',
      day ? Date.parse(`${day}T00:00:00Z`) : Number.MAX_SAFE_INTEGER,
      blankItem({
        id: `task-${t.id}`,
        concern: 'task',
        subject: t.title,
        projectName: t.project?.name ?? t.line?.name ?? taskContextLabel(t, locale) ?? '',
        lineName: t.line?.name ?? null,
        projectId: taskProjectId(t),
        overdue,
        taskId: t.id,
        surfacesDay: surface.surfacesAt,
        dueDay,
        dueLabel: t.due_at ? (overdue ? 'overdue' : surface.state === 'urgent' ? 'due' : null) : null,
        isProposal: t.origin === 'ai',
        reason: t.origin === 'ai' ? (t.note ?? null) : null,
      }),
    );
  }

  // ── Replies waiting for us (ADR-126 «te toca», reason reply): today, the
  //    most recent first, opening the conversation. They are the call for
  //    their conversation: its next action is not drawn again.
  const replied = new Set<string>();
  for (const r of input.replies ?? []) {
    replied.add(r.id);
    push(
      todayISO,
      'conversation',
      -Date.parse(r.at),
      blankItem({
        id: `reply-${r.id}`,
        concern: 'conversation',
        subject: r.title,
        projectName: r.projectName || '—',
        projectId: r.projectId,
        verbKey: 'reply',
        href: r.href,
        repliedAt: r.at,
      }),
    );
  }

  // ── Conversations (derived calls): next action set, not declined/dormant.
  let hasOverdue = false;
  for (const e of input.conversations) {
    if (e.status === 'declined' || e.status === 'dormant' || !e.next_action_at || replied.has(e.id)) continue;
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
        subject: convSubject(e, locale),
        projectName: e.project?.name ?? '—',
        projectId: e.project?.id ?? null,
        verbKey: conversationVerbKey(e.status, overdue),
        overdue,
        personSlug: e.person?.slug ?? null,
      }),
    );
  }

  // ── Revive (quiet days only): no overdue and no show today → up to two
  //    dormant conversations offered as proposal-toned revive calls (ADR-073).
  if (!hasOverdue && !input.showToday) {
    const dormant = input.conversations.filter((e) => e.status === 'dormant').slice(0, 2);
    for (const e of dormant) {
      push(
        todayISO,
        'conversation',
        Number.MAX_SAFE_INTEGER,
        blankItem({
          id: `revive-${e.id}`,
          concern: 'conversation',
          subject: e.organization?.name || e.person?.full_name || e.person?.organization_name || t('desk.fallback_contact', locale),
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
  //    the date Cuentas expects them → "remind" calls, OVERDUE, owed shown.
  for (const { invoice: inv, owed, expectedOn } of overdueInvoices(input.invoices ?? [], now)) {
    push(
      expectedOn,
      'money',
      Date.parse(`${expectedOn}T00:00:00Z`),
      blankItem({
        id: `inv-${inv.id}`,
        concern: 'money',
        subject: payerName(inv, locale),
        projectName: inv.project?.name ?? '—',
        projectId: inv.project?.id ?? null,
        verbKey: 'remind',
        overdue: true,
        href: invoiceHref(inv),
        amount: owed,
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
      return { sortKey, labelKey, weekday, dateLabel, overdue: sortKey === -1, runs };
    });
  return buckets;
}

// ── «Te espera»: the short list, by weight ─────────────────────────────

/** How many rows «Te espera» draws; the rest waits behind «Ver todo». */
export const WAITING_ROWS = 7;
/** How far ahead a «voy · no voy» is worth asking. */
export const GOING_DAYS = 14;

/** Within one tier: money owed, then a call, then «voy», then a task, then a proposal. */
function weightOf(i: DeskItem): number {
  if (i.concern === 'money') return 0;
  if (i.concern === 'conversation') return i.isProposal ? 4 : 1;
  if (i.concern === 'going') return 2;
  return i.isProposal ? 4 : 3;
}

export interface Waiting {
  rows: DeskItem[];
  /** Everything that qualified, before the cut. */
  total: number;
  overdue: number;
}

/**
 * «Te espera» (ADR-117): what to act on, by weight. Tiers by day — overdue,
 * today, the rest of this week — and the «voy · no voy» of the next two weeks
 * after them; inside a tier, by `weightOf`, then by day. The anytime tail and
 * what lies past this week stay in the day list. Calm keeps overdue and today.
 */
export function rankWaiting(
  feed: readonly DeskBucket[],
  asks: readonly DeskItem[],
  now: Date,
  opts: { calm?: boolean; limit?: number } = {},
): Waiting {
  const tiered: { tier: number; item: DeskItem }[] = [];
  for (const b of feed) {
    const tier = b.sortKey === -1 ? 0 : b.sortKey === 0 ? 1 : b.sortKey < 98 ? 2 : null;
    if (tier === null) continue;
    for (const r of b.runs) for (const item of r.items) tiered.push({ tier, item });
  }
  for (const item of asks) {
    const k = dayBucket(item.day, now, 'en').sortKey;
    tiered.push({ tier: k === 0 ? 1 : k < 7 ? 2 : 3, item });
  }
  const kept = opts.calm ? tiered.filter((x) => x.tier <= 1) : tiered;
  kept.sort(
    (a, b) =>
      a.tier - b.tier ||
      weightOf(a.item) - weightOf(b.item) ||
      (a.item.day ?? '').localeCompare(b.item.day ?? ''),
  );
  return {
    rows: kept.slice(0, opts.limit ?? WAITING_ROWS).map((x) => x.item),
    total: kept.length,
    overdue: kept.filter((x) => x.tier === 0).length,
  };
}

/** A «voy · no voy» row for «Te espera» (the page names it with its slip). */
export function goingItem(row: {
  of: 'performance' | 'date';
  id: string;
  day: string;
  subject: string;
  projectId: string | null;
  projectName: string;
  href: string | null;
}): DeskItem {
  return blankItem({
    id: `going-${row.id}`,
    concern: 'going',
    subject: row.subject,
    projectName: row.projectName,
    projectId: row.projectId,
    verbKey: 'going',
    day: row.day,
    href: row.href,
    going: { of: row.of, id: row.id },
  });
}
