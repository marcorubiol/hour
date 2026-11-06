/**
 * La ficha de una conversación como hilo (punto 110, ADR-099 añadido): lo
 * hablado con fuera y el hilo del equipo en una sola línea, de lo antiguo a lo
 * nuevo, lo último abajo. Presentación, no un modelo: cada cosa sigue siendo
 * lo que es (`conversation_event`, ADR-098; mensaje del hilo, ADR-106).
 *
 * La regla del hilo (Marco, 2026-11-02): todo en orden; cada correo entero en
 * su sitio, con su texto nuevo (la sincronización ya lo guarda sin lo citado,
 * `trimQuoted`), el asunto sólo cuando cambia, y lo largo enseña el principio
 * y se despliega en el mismo sitio.
 *
 * El lado dice quién (ADR-184): lo que llegó de fuera a la izquierda, todo lo
 * nuestro a la derecha. Sin separadores de día: la fecha va en cada entrada,
 * y sólo la hora si la anterior es del mismo día y del mismo lado. El centro
 * es del tiempo: la raya de nuevos y el silencio de una semana o más.
 */

import { dayKeyInTz } from './planner';
import { localDayISO, localeDayMonthNear } from './datetime';
import { LOCALE_TAG, t, type Locale } from './i18n';
import { isUnread, type ThreadMessage } from './threads';
import type { MessageApp } from './conversation';
import type { ThreadIconName } from './components/ThreadIcon.svelte';

/** Lo que el hilo lee de un evento del registro. */
export interface ThreadEvent {
  id: string;
  occurred_at: string;
  recorded_at: string;
  kind: string;
  source: string;
  direction: 'inbound' | 'outbound' | null;
  body: string | null;
  subject?: string | null;
  mailout_id?: string | null;
  mailout_note?: string | null;
}

/** De quién es una entrada: de fuera, a la izquierda; nuestra, a la derecha. */
export type ThreadSide = 'theirs' | 'ours';

/**
 * Lo que toda entrada con contenido lleva: su lado y el día que se escribe
 * encima (`null`: la anterior es del mismo día y del mismo lado, sólo la hora).
 */
interface Placed {
  side: ThreadSide;
  day: string | null;
}

export type ThreadEntry<E extends ThreadEvent> =
  /** La raya de «N nuevos», donde se dejó de leer al abrir. */
  | { kind: 'new'; key: string; count: number }
  /** Un silencio de una semana o más entre dos entradas: «2 semanas». */
  | { kind: 'gap'; key: string; days: number }
  /** Un correo sincronizado o enviado desde Hour: entero, con su asunto y el original. */
  | ({ kind: 'mail'; key: string; event: E; showSubject: boolean; long: boolean } & Placed)
  /** Lo que salió con un envío (ADR-115): una línea que lleva a Envíos. */
  | ({ kind: 'mailout'; key: string; event: E } & Placed)
  /** Lo apuntado a mano (correo, llamada, mensaje, reunión, apunte) y los avisos de un envío. */
  | ({ kind: 'logged'; key: string; event: E } & Placed)
  /** Un mensaje del hilo del equipo, intercalado: ámbar, «solo el equipo». */
  | ({ kind: 'team'; key: string; message: ThreadMessage } & Placed);

/** Desde cuántos días sin nada el hilo lo dice en el centro. */
export const THREAD_GAP_DAYS = 7;

/** Lo que llegó de fuera va a su lado; lo demás (nuestro, apuntado sin dirección, el equipo) al nuestro. */
export function sideOf(e: Pick<ThreadEvent, 'direction'>): ThreadSide {
  return e.direction === 'inbound' ? 'theirs' : 'ours';
}

/** Días enteros entre dos días (`YYYY-MM-DD`). */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

/** Un correo de verdad, con remitente y texto: lo trajo el buzón o salió por él. */
export function isMail(e: Pick<ThreadEvent, 'kind' | 'source' | 'mailout_id' | 'mailout_note'>): boolean {
  return e.kind === 'email' && e.source === 'email' && !e.mailout_id && !e.mailout_note;
}

/** El asunto sin «Re:», «Fwd:» y compañía, para saber si cambia. */
export function subjectStem(subject: string | null | undefined): string {
  let s = (subject ?? '').trim();
  for (;;) {
    const next = s.replace(/^(re|rv|fw|fwd|tr|aw|wg|ref|resp)\s*(\[\d+\])?\s*:\s*/i, '');
    if (next === s) break;
    s = next;
  }
  return s.replace(/\s+/g, ' ').toLowerCase();
}

/** Las líneas que enseña un correo plegado; lo que pase de aquí se despliega en su sitio. */
export const MAIL_FOLD_LINES = 6;
/** Y los caracteres: un párrafo largo sin saltos también se pliega. */
export const MAIL_FOLD_CHARS = 480;

/** Un texto que no cabe en el principio: se pliega y se despliega en el mismo sitio. */
export function isLongText(body: string | null | undefined): boolean {
  const s = (body ?? '').trim();
  return s.length > MAIL_FOLD_CHARS || s.split('\n').length > MAIL_FOLD_LINES;
}

/**
 * Lo nuevo para quien mira, con las reglas de la lista (`conversation_feed`):
 * un entrante del registro anotado después de su última lectura (sin lectura,
 * después de nacer la conversación), y un mensaje ajeno del equipo posterior a
 * la lectura del hilo.
 */
export function isNewEvent(e: Pick<ThreadEvent, 'direction' | 'recorded_at'>, readAt: string): boolean {
  return e.direction === 'inbound' && Date.parse(e.recorded_at) > Date.parse(readAt);
}

/**
 * El hilo entero, en orden. A la misma hora, lo de fuera primero (el equipo
 * suele comentar lo que llegó). `eventsReadAt` y `teamReadAt` son las
 * lecturas al abrir: la raya no se mueve mientras se lee.
 */
export function conversationThreadEntries<E extends ThreadEvent>(input: {
  events: readonly E[];
  messages: readonly ThreadMessage[];
  me: string;
  eventsReadAt: string | null;
  teamReadAt: string | null;
  tz: string;
}): ThreadEntry<E>[] {
  type Content = Exclude<ThreadEntry<E>, { kind: 'new' } | { kind: 'gap' }>;
  type Step = { at: string; order: number; id: string; entry: Content; fresh: boolean };
  const steps: Step[] = [];
  for (const e of input.events) {
    const fresh = input.eventsReadAt !== null && isNewEvent(e, input.eventsReadAt);
    const kind = isMail(e) ? 'mail' : e.kind === 'email' && e.mailout_id && !e.mailout_note ? 'mailout' : 'logged';
    const placed = { side: sideOf(e), day: null };
    const entry: Content =
      kind === 'mail'
        ? { kind, key: e.id, event: e, showSubject: false, long: isLongText(e.body), ...placed }
        : { kind, key: e.id, event: e, ...placed };
    steps.push({ at: e.occurred_at, order: 0, id: e.id, entry, fresh });
  }
  for (const m of input.messages) {
    steps.push({
      at: m.created_at,
      order: 1,
      id: m.id,
      entry: { kind: 'team', key: m.id, message: m, side: 'ours', day: null },
      fresh: isUnread(m, input.me, input.teamReadAt),
    });
  }
  steps.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.order - b.order || a.id.localeCompare(b.id));

  const fresh = steps.filter((s) => s.fresh).length;
  const firstFresh = steps.findIndex((s) => s.fresh);
  const out: ThreadEntry<E>[] = [];
  let prev: { day: string; side: ThreadSide } | null = null;
  let stem: string | null = null;
  steps.forEach((s, i) => {
    const d = dayKeyInTz(s.at, input.tz);
    if (prev) {
      const days = daysBetween(prev.day, d);
      if (days >= THREAD_GAP_DAYS) out.push({ kind: 'gap', key: `gap-${s.id}`, days });
    }
    if (i === firstFresh) out.push({ kind: 'new', key: 'new', count: fresh });
    s.entry.day = prev && prev.day === d && prev.side === s.entry.side ? null : d;
    prev = { day: d, side: s.entry.side };
    if (s.entry.kind === 'mail') {
      const next = subjectStem(s.entry.event.subject);
      s.entry.showSubject = next !== '' && next !== stem;
      if (next !== '') stem = next;
    }
    out.push(s.entry);
  });
  return out;
}

/** Un silencio dicho como se dice: «1 semana», «3 semanas», «2 meses». */
export function threadGapLabel(days: number, locale: Locale): string {
  if (days >= 60) return t('thread.gap_months', locale, { n: Math.floor(days / 30) });
  const weeks = Math.floor(days / 7);
  return t(weeks === 1 ? 'thread.gap_week' : 'thread.gap_weeks', locale, { n: weeks });
}

/** El glifo de la app de un mensaje (ADR-186); sin app, el bocadillo. */
export function messageAppIcon(via: MessageApp | null | undefined): ThreadIconName {
  return via === 'whatsapp' || via === 'sms' || via === 'telegram' ? via : 'message';
}

/** El nombre de la app: las marcas no se traducen; «otra», en la lengua de quien mira. */
export function messageAppName(via: MessageApp | null | undefined, locale: Locale): string {
  if (via === 'whatsapp') return 'WhatsApp';
  if (via === 'sms') return 'SMS';
  if (via === 'telegram') return 'Telegram';
  return t('thread.app_other', locale);
}

/** La marca de una cita en la primera línea de una nota del equipo (ADR-185). */
const CITE_MARK = '> ';
/** Cuánto de lo citado cabe en la línea de la cita. */
export const CITE_MAX = 120;

/**
 * La cita de una entrada para una nota del equipo: qué fue, cuándo y el
 * principio de lo que se dijo, en una línea («> Reunión con Elena · 29 sept:
 * Café en la sala…»). Va en el propio texto de la nota, así que fuera del
 * hilo (el tablón, un aviso) se lee como texto normal.
 */
export function citeLine(label: string, when: string, body: string | null | undefined): string {
  const said = (body ?? '').replace(/\s+/g, ' ').trim();
  const head = `${label} · ${when}`;
  const text = said ? `${head}: ${said}` : head;
  return CITE_MARK + (text.length > CITE_MAX ? `${text.slice(0, CITE_MAX - 1).trimEnd()}…` : text);
}

/** Separa la cita (la primera línea con «> ») del resto de la nota. */
export function splitCite(body: string): { cite: string | null; text: string } {
  if (!body.startsWith(CITE_MARK)) return { cite: null, text: body };
  const nl = body.indexOf('\n');
  const first = nl === -1 ? body : body.slice(0, nl);
  const rest = nl === -1 ? '' : body.slice(nl + 1).trim();
  return { cite: first.slice(CITE_MARK.length).trim(), text: rest };
}

/** El nombre de una cabecera de correo («Laia Puig <laia@…>» → «Laia Puig»); sin nombre, la dirección. */
export function senderName(from: string | null | undefined): string {
  const s = (from ?? '').trim();
  const m = /^"?([^"<]*?)"?\s*<([^>]+)>$/.exec(s);
  if (m) return m[1].trim() || m[2].trim();
  return s;
}

/** El día de una entrada: «hoy», «ayer» o la fecha («8 oct», con año si queda lejos). */
export function threadDayLabel(day: string, locale: Locale, today: string = localDayISO()): string {
  if (day === today) return t('thread.today', locale);
  const y = new Date(`${today}T12:00:00`);
  y.setDate(y.getDate() - 1);
  if (day === localDayISO(y)) return t('thread.yesterday', locale);
  return localeDayMonthNear(day, today, LOCALE_TAG[locale]);
}

/**
 * Llevar `el` al borde de lo que se ve. En su página, `scrollIntoView`; en un
 * panel (`within`: el vistazo o el segundo panel de la lista) sólo se mueve
 * el contenedor que desplaza al panel, nunca la ventana, que escondería la
 * cabecera de la página. Respeta el `scroll-margin` del elemento.
 */
export function scrollToEdge(el: HTMLElement, block: 'start' | 'end', within: boolean): void {
  if (!within) {
    el.scrollIntoView({ block });
    return;
  }
  let box = el.parentElement;
  while (box) {
    const { overflowY } = getComputedStyle(box);
    if (/(auto|scroll)/.test(overflowY) && box.scrollHeight > box.clientHeight) break;
    box = box.parentElement;
  }
  if (!box) return;
  const style = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  box.scrollTop +=
    block === 'start'
      ? r.top - b.top - (parseFloat(style.scrollMarginBlockStart) || 0)
      : r.bottom - b.bottom + (parseFloat(style.scrollMarginBlockEnd) || 0);
}
