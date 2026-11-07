/**
 * Importar un chat de WhatsApp (tarea 128, ADR-189 sobre ADR-188): quién es
 * quién, la huella de cada mensaje y la propuesta de dónde va cada tanda.
 *
 * Todo lo de aquí corre en el dispositivo sobre el export ya leído
 * (`$lib/whatsapp-export`): a Hour sólo viaja lo que se confirma.
 *
 * Las reglas son las del ADR-188, en orden:
 *   1. tanda: los mensajes a menos de 3 horas van juntos (se coloca la tanda);
 *   2. chat atado: un grupo atado a un bolo va a su tablón hasta el día
 *      siguiente a la última función; atado a una conversación, ahí;
 *   3. un solo candidato (la persona es contacto ese día de una sola
 *      conversación viva que quien importa edita): ahí;
 *   4. ninguno: sin sitio (al importar, no entra salvo que se marque);
 *   5. dos o más: la de actividad más reciente, como suposición.
 * La marca de bolo, sólo si esa conversación tiene un único bolo en curso.
 */

import type { ExportAttachment, ExportMessage } from './whatsapp-export';

/** Lo que trae `POST /api/whatsapp/import-context`. */
export interface ImportPerson {
  person_id: string;
  name: string;
  phone: string | null;
  /** Alguien del propio espacio: un chat 1 a 1 con él no se importa. */
  team: boolean;
}

export interface ImportConversation {
  id: string;
  title: string;
  project_name: string | null;
  last_contacted_at: string | null;
}

export interface ImportContact {
  conversation_id: string;
  person_id: string;
  since: string | null;
  until: string | null;
}

export interface ImportBolo {
  id: string;
  conversation_id: string | null;
  project_name: string | null;
  venue_name: string | null;
  city: string | null;
  /** El día del trato (cuando nació el bolo). */
  start_day: string;
  first_day: string | null;
  last_day: string | null;
}

export interface ImportChatMember {
  label: string;
  person_id: string | null;
  is_self: boolean;
}

export interface ImportOwnChat {
  id: string;
  title: string | null;
  kind: 'direct' | 'group';
  bound_bolo_id: string | null;
  bound_conversation_id: string | null;
  members: ImportChatMember[];
}

export interface ImportContext {
  me: { person_id: string | null; name: string | null };
  persons: ImportPerson[];
  conversations: ImportConversation[];
  contacts: ImportContact[];
  bolos: ImportBolo[];
  /** Huellas que ya están en el espacio. */
  known: string[];
  /** Los chats propios que comparten mensajes con este: el mismo chat importado antes. */
  chats: ImportOwnChat[];
}

/** Hasta dónde dos mensajes seguidos son de la misma tanda (ADR-188 § 6). */
export const BURST_GAP_MS = 3 * 60 * 60 * 1000;
/** Cuántos mensajes por llamada a la base. */
export const IMPORT_BATCH = 500;

// ── Normalizar ────────────────────────────────────────────────────────────

/** Un nombre para comparar: sin acentos, sin signos, en minúsculas. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Si lo que el export pone de autor es un número («+34 600 12 34 56»). */
export function looksLikePhone(label: string): boolean {
  return /^\+?[\d\s().-]{7,}$/.test(label.trim()) && (label.match(/\d/g)?.length ?? 0) >= 7;
}

/** Los dígitos que identifican un número: sin prefijo internacional, los 9 últimos. */
export function phoneKey(s: string | null | undefined): string | null {
  const digits = (s ?? '').replace(/\D/g, '');
  if (digits.length < 7) return null;
  return digits.slice(-9);
}

// ── Quién es quién ────────────────────────────────────────────────────────

export type MatchHow = 'phone' | 'name' | 'remembered';

export interface AuthorMatch {
  person_id: string | null;
  how: MatchHow | null;
}

/**
 * Casa un autor del export con una persona del espacio: por número si es un
 * número, si no por nombre (igual, o todas las palabras del export dentro del
 * nombre de Hour, con una sola persona que encaje).
 */
export function matchAuthor(label: string, persons: ImportPerson[]): AuthorMatch {
  if (looksLikePhone(label)) {
    const key = phoneKey(label);
    const hits = persons.filter((p) => key && phoneKey(p.phone) === key);
    return hits.length === 1 ? { person_id: hits[0].person_id, how: 'phone' } : { person_id: null, how: null };
  }
  const want = normalizeName(label);
  if (!want) return { person_id: null, how: null };
  const exact = persons.filter((p) => normalizeName(p.name) === want);
  if (exact.length === 1) return { person_id: exact[0].person_id, how: 'name' };
  if (exact.length > 1) return { person_id: null, how: null };
  const words = want.split(' ');
  const partial = persons.filter((p) => {
    const have = new Set(normalizeName(p.name).split(' '));
    return words.length > 1 && words.every((w) => have.has(w));
  });
  return partial.length === 1 ? { person_id: partial[0].person_id, how: 'name' } : { person_id: null, how: null };
}

/** Cuál de los autores es quien importa: el que se llama como su perfil. */
export function guessSelf(authors: string[], myName: string | null | undefined): string | null {
  const mine = normalizeName(myName ?? '');
  if (!mine) return null;
  const first = mine.split(' ')[0];
  const exact = authors.filter((a) => normalizeName(a) === mine);
  if (exact.length === 1) return exact[0];
  const byFirst = authors.filter((a) => normalizeName(a) === first || normalizeName(a).split(' ')[0] === first);
  return byFirst.length === 1 ? byFirst[0] : null;
}

// ── La huella ─────────────────────────────────────────────────────────────

/** Lo que pesa de un mensaje para reconocerlo en otro export: el texto y el tipo de lo adjunto. */
export function contentKey(body: string, attachments: ExportAttachment[]): string {
  const text = body.normalize('NFC').replace(/\s+/g, ' ').trim();
  return `${text}|${attachments.map((a) => a.type).join(',')}`;
}

async function sha256Hex(s: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * La huella de cada mensaje: el minuto (UTC), el texto y el orden entre
 * iguales. Sin el autor (cada teléfono lo llama como lo tiene en su agenda)
 * ni los segundos (Android no los trae), para que el mismo grupo exportado por
 * dos personas, o desde dos teléfonos, no entre dos veces. 32 hex.
 */
export async function fingerprints(items: { at: string; body: string; attachments: ExportAttachment[] }[]): Promise<string[]> {
  const seen = new Map<string, number>();
  const keys = items.map((m) => {
    const minute = m.at.slice(0, 16); // YYYY-MM-DDTHH:MM en UTC
    const k = `${minute}|${contentKey(m.body, m.attachments)}`;
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return `${k}|${n}`;
  });
  return Promise.all(keys.map(async (k) => (await sha256Hex(k)).slice(0, 32)));
}

/** La hora local del export como instante, en la zona del dispositivo. */
export function localToInstant(local: string): string {
  return new Date(local).toISOString();
}

// ── Tandas ────────────────────────────────────────────────────────────────

/** Índices de inicio de cada tanda: un hueco de 3 horas o más abre otra. */
export function bursts(times: string[], gapMs = BURST_GAP_MS): number[][] {
  const out: number[][] = [];
  let prev = -Infinity;
  times.forEach((iso, i) => {
    const t = Date.parse(iso);
    if (out.length === 0 || t - prev >= gapMs) out.push([i]);
    else out[out.length - 1].push(i);
    prev = t;
  });
  return out;
}

// ── Dónde va ──────────────────────────────────────────────────────────────

export type Site = { kind: 'conversation'; id: string } | { kind: 'bolo'; id: string } | { kind: 'none' };

export type PlacementReason = 'chat_binding' | 'single_candidate' | 'most_recent' | 'person_choice' | 'none';

export interface Proposal {
  site: Site;
  /** Suposición entre varias: entra, y «Por colocar» lo preguntará (ADR-188 § 5). */
  guess: boolean;
  reason: PlacementReason;
  /** Con suposición: los candidatos, del más reciente al más antiguo. */
  candidates: string[];
}

/** Un día `YYYY-MM-DD` dentro de [since, until], sin extremo si es null. */
function within(day: string, since: string | null, until: string | null): boolean {
  return (!since || day >= since) && (!until || day <= until);
}

/** Las conversaciones donde alguna de estas personas era contacto ese día, de la más reciente a la más antigua. */
export function candidatesFor(personIds: string[], day: string, ctx: Pick<ImportContext, 'contacts' | 'conversations'>): string[] {
  const ids = new Set(
    ctx.contacts.filter((c) => personIds.includes(c.person_id) && within(day, c.since, c.until)).map((c) => c.conversation_id),
  );
  const order = new Map(ctx.conversations.map((c) => [c.id, c]));
  return [...ids]
    .filter((id) => order.has(id))
    .sort((a, b) => {
      const ta = order.get(a)!.last_contacted_at ?? '';
      const tb = order.get(b)!.last_contacted_at ?? '';
      return ta === tb ? a.localeCompare(b) : tb.localeCompare(ta);
    });
}

/** El día siguiente a uno `YYYY-MM-DD`. */
export function nextDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Hasta qué día un grupo atado a un bolo cae en su tablón: el siguiente a la última función (ADR-142 § 2). */
export function boloBindingUntil(bolo: ImportBolo): string | null {
  return bolo.last_day ? nextDay(bolo.last_day) : null;
}

/** El bolo en curso de una conversación ese día, si es uno solo (ADR-188 § 7). */
export function soleBoloOn(conversationId: string, day: string, bolos: ImportBolo[]): string | null {
  const live = bolos.filter(
    (b) => b.conversation_id === conversationId && day >= b.start_day && (!b.last_day || day <= nextDay(b.last_day)),
  );
  return live.length === 1 ? live[0].id : null;
}

export type Binding = { kind: 'bolo'; id: string; until: string | null } | { kind: 'conversation'; id: string } | null;

/**
 * La propuesta para una tanda: `personIds` son las personas de fuera que
 * hablan en ella (o la otra persona del chat directo), `day` su primer día.
 */
export function propose(personIds: string[], day: string, binding: Binding, ctx: ImportContext): Proposal {
  if (binding?.kind === 'conversation') {
    return { site: { kind: 'conversation', id: binding.id }, guess: false, reason: 'chat_binding', candidates: [] };
  }
  if (binding?.kind === 'bolo') {
    if (!binding.until || day <= binding.until) {
      return { site: { kind: 'bolo', id: binding.id }, guess: false, reason: 'chat_binding', candidates: [] };
    }
    // Caducó con el bolo: lo nuevo del grupo vuelve a quedar sin sitio.
    return { site: { kind: 'none' }, guess: false, reason: 'none', candidates: [] };
  }
  const cands = candidatesFor(personIds, day, ctx);
  if (cands.length === 1) return { site: { kind: 'conversation', id: cands[0] }, guess: false, reason: 'single_candidate', candidates: [] };
  if (cands.length > 1) return { site: { kind: 'conversation', id: cands[0] }, guess: true, reason: 'most_recent', candidates: cands };
  return { site: { kind: 'none' }, guess: false, reason: 'none', candidates: [] };
}

/** La clave de un sitio, para agrupar en la pantalla. */
export function siteKey(site: Site): string {
  return site.kind === 'none' ? 'none' : `${site.kind}:${site.id}`;
}

/** Un mensaje leído y listo para importar. */
export interface PreparedMessage extends ExportMessage {
  at: string;
  fp: string;
  known: boolean;
}

/** Una tanda con su propuesta y lo que decidió quien importa. */
export interface PlannedBurst {
  index: number;
  messages: PreparedMessage[];
  /** Mensajes nuevos (no estaban ya en Hour). */
  fresh: number;
  proposal: Proposal;
  site: Site;
  guess: boolean;
  /** Si entra: por defecto, si tiene sitio. */
  include: boolean;
}

/**
 * Las tandas con su propuesta. `labelToPerson` da la persona de cada autor
 * (null: sin nombre); `selfLabel` es quien importa. Las tandas sin nada nuevo
 * se quedan fuera: ya están.
 */
export function planBursts(
  messages: PreparedMessage[],
  labelToPerson: Map<string, string | null>,
  selfLabel: string | null,
  binding: Binding,
  ctx: ImportContext,
): PlannedBurst[] {
  const groups = bursts(messages.map((m) => m.at));
  const others = [...labelToPerson.entries()].filter(([l, p]) => l !== selfLabel && p).map(([, p]) => p!) as string[];
  return groups
    .map((idx, index) => {
      const msgs = idx.map((i) => messages[i]);
      const speaking = [
        ...new Set(msgs.filter((m) => m.author !== selfLabel).map((m) => labelToPerson.get(m.author)).filter((p): p is string => !!p)),
      ];
      // En una tanda sólo nuestra, la otra parte es la del chat.
      const persons = speaking.length > 0 ? speaking : others;
      const proposal = propose(persons, msgs[0].local.slice(0, 10), binding, ctx);
      const fresh = msgs.filter((m) => !m.known).length;
      return {
        index,
        messages: msgs,
        fresh,
        proposal,
        site: proposal.site,
        guess: proposal.guess,
        include: proposal.site.kind !== 'none',
      };
    })
    .filter((b) => b.fresh > 0);
}

/** Una línea por sitio: cuántos mensajes nuevos y cuántas tandas, con suposición si alguna lo es. */
export interface SiteSummary {
  key: string;
  site: Site;
  messages: number;
  bursts: number;
  guess: boolean;
  include: boolean;
}

export function summarize(plan: PlannedBurst[]): SiteSummary[] {
  const by = new Map<string, SiteSummary>();
  for (const b of plan) {
    const key = siteKey(b.site) + (b.guess ? ':guess' : '');
    const s = by.get(key) ?? { key, site: b.site, messages: 0, bursts: 0, guess: b.guess, include: false };
    s.messages += b.fresh;
    s.bursts += 1;
    s.include = s.include || b.include;
    by.set(key, s);
  }
  const rank = (s: SiteSummary) => (s.site.kind === 'none' ? 2 : s.guess ? 1 : 0);
  return [...by.values()].sort((a, b) => rank(a) - rank(b) || b.messages - a.messages);
}

/** Lo que viaja de un mensaje a `POST /api/whatsapp/import`. */
export interface ImportMessagePayload {
  fp: string;
  at: string;
  label: string;
  body: string;
  attachments: ExportAttachment[];
  edited?: boolean;
  placements: {
    surface: 'conversation' | 'bolo_team';
    conversation_id?: string;
    bolo_id?: string;
    state: 'placed' | 'guess';
    reason: Exclude<PlacementReason, 'none'>;
    candidates?: string[];
  }[];
}

/** Los mensajes nuevos de las tandas que entran, con su colocación. */
export function payloadOf(plan: PlannedBurst[], bolos: ImportBolo[]): ImportMessagePayload[] {
  const out: ImportMessagePayload[] = [];
  for (const b of plan) {
    if (!b.include) continue;
    const moved = siteKey(b.site) !== siteKey(b.proposal.site);
    for (const m of b.messages) {
      if (m.known) continue;
      const placements: ImportMessagePayload['placements'] = [];
      if (b.site.kind === 'conversation') {
        const bolo = soleBoloOn(b.site.id, m.local.slice(0, 10), bolos);
        placements.push({
          surface: 'conversation',
          conversation_id: b.site.id,
          ...(bolo ? { bolo_id: bolo } : {}),
          state: b.guess && !moved ? 'guess' : 'placed',
          reason: moved ? 'person_choice' : b.proposal.reason === 'none' ? 'person_choice' : b.proposal.reason,
          ...(b.guess && !moved ? { candidates: b.proposal.candidates } : {}),
        });
      } else if (b.site.kind === 'bolo') {
        placements.push({
          surface: 'bolo_team',
          bolo_id: b.site.id,
          state: 'placed',
          reason: moved || b.proposal.reason === 'none' ? 'person_choice' : b.proposal.reason,
        });
      }
      out.push({
        fp: m.fp,
        at: m.at,
        label: m.author,
        body: m.body,
        attachments: m.attachments,
        ...(m.edited ? { edited: true } : {}),
        placements,
      });
    }
  }
  return out;
}

/** Trocea en tandas de envío. */
export function chunk<T>(items: T[], size = IMPORT_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
