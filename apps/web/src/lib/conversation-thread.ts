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
 */

import { dayKeyInTz } from './planner';
import { localDayISO, localeDayMonthNear } from './datetime';
import { LOCALE_TAG, t, type Locale } from './i18n';
import { isUnread, type ThreadMessage } from './threads';

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

export type ThreadEntry<E extends ThreadEvent> =
  /** Cambia el día: «8 oct», «ayer», «hoy». */
  | { kind: 'day'; key: string; day: string }
  /** La raya de «N nuevos», donde se dejó de leer al abrir. */
  | { kind: 'new'; key: string; count: number }
  /** Un correo sincronizado o enviado desde Hour: carta en su lado. */
  | { kind: 'mail'; key: string; event: E; showSubject: boolean; long: boolean }
  /** Lo que salió con un envío (ADR-115): tarjeta que lleva a Envíos. */
  | { kind: 'mailout'; key: string; event: E }
  /** Lo apuntado a mano (llamada, reunión, nota) y los avisos de un envío: una línea centrada. */
  | { kind: 'logged'; key: string; event: E }
  /** Un mensaje del hilo del equipo, intercalado y marcado «Solo el equipo». */
  | { kind: 'team'; key: string; message: ThreadMessage };

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
  type Step = { at: string; order: number; id: string; entry: ThreadEntry<E>; fresh: boolean };
  const steps: Step[] = [];
  for (const e of input.events) {
    const fresh = input.eventsReadAt !== null && isNewEvent(e, input.eventsReadAt);
    const kind = isMail(e) ? 'mail' : e.kind === 'email' && e.mailout_id && !e.mailout_note ? 'mailout' : 'logged';
    const entry: ThreadEntry<E> =
      kind === 'mail'
        ? { kind, key: e.id, event: e, showSubject: false, long: isLongText(e.body) }
        : { kind, key: e.id, event: e };
    steps.push({ at: e.occurred_at, order: 0, id: e.id, entry, fresh });
  }
  for (const m of input.messages) {
    steps.push({
      at: m.created_at,
      order: 1,
      id: m.id,
      entry: { kind: 'team', key: m.id, message: m },
      fresh: isUnread(m, input.me, input.teamReadAt),
    });
  }
  steps.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.order - b.order || a.id.localeCompare(b.id));

  const fresh = steps.filter((s) => s.fresh).length;
  const firstFresh = steps.findIndex((s) => s.fresh);
  const out: ThreadEntry<E>[] = [];
  let day = '';
  let stem: string | null = null;
  steps.forEach((s, i) => {
    if (i === firstFresh) out.push({ kind: 'new', key: 'new', count: fresh });
    const d = dayKeyInTz(s.at, input.tz);
    if (d !== day) {
      day = d;
      out.push({ kind: 'day', key: `day-${d}`, day: d });
    }
    if (s.entry.kind === 'mail') {
      const next = subjectStem(s.entry.event.subject);
      s.entry.showSubject = next !== '' && next !== stem;
      if (next !== '') stem = next;
    }
    out.push(s.entry);
  });
  return out;
}

/** El nombre de una cabecera de correo («Laia Puig <laia@…>» → «Laia Puig»); sin nombre, la dirección. */
export function senderName(from: string | null | undefined): string {
  const s = (from ?? '').trim();
  const m = /^"?([^"<]*?)"?\s*<([^>]+)>$/.exec(s);
  if (m) return m[1].trim() || m[2].trim();
  return s;
}

/** El día de un separador: «hoy», «ayer» o la fecha («8 oct», con año si queda lejos). */
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
