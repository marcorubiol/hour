/**
 * Lo que pinta una fila de la lista de Conversaciones (plan `build/plans/
 * 2026-10-22-conversations-list.md` § 3): el turno con su palabra, el bolo
 * más cercano y la última línea. Las reglas son las del panel y Desk
 * (`turnOf`, `followUpDue`, ADR-118 § 7); aquí solo se dicen.
 *
 * Sin red: `now` y el idioma se inyectan.
 */

import { daysSince, followUpDue, mailoutOutcome, turnOf, type RowMailout, type TurnRow } from './conversation-overview';
import { relativeContactDate } from './conversation';
import type { ConversationBolo } from './conversation-relation';
import { dayMonth, localDayISO } from './datetime';
import { t, type Locale } from './i18n';
import { performanceStatusLabel } from './performance';

/** Desde estos días, lo que te toca va en el tono de aviso (el «tarde» del bloque Te toca). */
export const LATE_DAYS = 7;

export interface RowTurn {
  /** TE TOCA, SEGUIMIENTO o LES TOCA (la columna mono la pone en mayúsculas). */
  word: string;
  /** Desde cuándo, o el día del seguimiento. */
  since: string;
  tone: 'ours' | 'late' | 'theirs';
}

/** El turno de una fila: una respuesta pendiente, un seguimiento vencido o su turno. */
export function rowTurn(
  row: TurnRow & { next_action_at: string | null },
  now: Date,
  locale: Locale,
): RowTurn | null {
  const turn = turnOf(row, now);
  if (turn?.side === 'ours') {
    return {
      word: t('overview.turn_ours_cap', locale),
      since: relativeContactDate(turn.since, locale, now.getTime()),
      tone: turn.days >= LATE_DAYS ? 'late' : 'ours',
    };
  }
  if (followUpDue(row, now)) {
    const day = row.next_action_at!.slice(0, 10);
    return {
      word: t('overview.follow_up_cap', locale),
      since: dayMonth(day, locale),
      tone: daysSince(day, now) >= LATE_DAYS ? 'late' : 'ours',
    };
  }
  if (turn) {
    return { word: t('overview.turn_theirs_cap', locale), since: relativeContactDate(turn.since, locale, now.getTime()), tone: 'theirs' };
  }
  return null;
}

const DEAD = new Set(['cancelled']);

/**
 * El bolo que la fila nombra: el vivo más cercano desde hoy; si todos son de
 * antes, el último; los que no tienen fecha, al final. «+N» son los otros
 * vivos. Sin dinero (ADR-138 § 3).
 */
export function nearestBolo(
  bolos: readonly ConversationBolo[],
  now: Date,
): { bolo: ConversationBolo; more: number } | null {
  const live = bolos.filter((b) => !DEAD.has(b.status));
  if (live.length === 0) return null;
  const today = localDayISO(now);
  const day = (b: ConversationBolo) => b.first_performed_at?.slice(0, 10) ?? null;
  const ahead = live.filter((b) => day(b) !== null && day(b)! >= today).sort((a, b) => day(a)!.localeCompare(day(b)!));
  const past = live.filter((b) => day(b) !== null && day(b)! < today).sort((a, b) => day(b)!.localeCompare(day(a)!));
  const undated = live.filter((b) => day(b) === null);
  const bolo = ahead[0] ?? past[0] ?? undated[0];
  return { bolo, more: live.length - 1 };
}

/** «1.ª opción · 14 mar +1»: la palabra del Planner (ADR-128) y su primer día. */
export function boloLabel(n: { bolo: ConversationBolo; more: number }, locale: Locale): string {
  const when = n.bolo.first_performed_at ? dayMonth(n.bolo.first_performed_at, locale) : t('conversations.bolo_undated', locale);
  return `${performanceStatusLabel(n.bolo.status, locale)} · ${when}${n.more > 0 ? ` +${n.more}` : ''}`;
}

/** «Envío 22 sept · sin respuesta». */
export function mailoutLabel(m: RowMailout, lastIn: string | null, locale: Locale): string {
  const outcome = mailoutOutcome(m, lastIn);
  const when = m.at ? dayMonth(m.at, locale) : '';
  return t(`conversations.row_mailout_${outcome}`, locale, { when }).trim();
}

/**
 * La última línea: quién («Tú» si fuimos nosotros, nada si fueron ellos) y el
 * asunto o la clase de evento; sin historial, el último envío que recibió.
 */
export function rowLast(
  row: {
    last: { direction: 'inbound' | 'outbound'; kind?: string | null; subject?: string | null } | null;
    last_in: { occurred_at: string } | null;
    last_mailout?: RowMailout | null;
  },
  locale: Locale,
): { lead: string | null; last: string | null } {
  if (row.last) {
    const what = row.last.subject || (row.last.kind ? t(`conversations.kind_${row.last.kind}`, locale) : null);
    return { lead: row.last.direction === 'outbound' ? t('threads.you', locale) : null, last: what };
  }
  if (row.last_mailout) return { lead: null, last: mailoutLabel(row.last_mailout, row.last_in?.occurred_at ?? null, locale) };
  return { lead: null, last: null };
}
