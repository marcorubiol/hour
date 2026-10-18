/**
 * Las lecturas del dashboard de Conversations (ADR-117): las conversaciones
 * vivas del alcance con su último evento embebido, los días de sus funciones y
 * el último envío. Las comparten `GET /api/conversations/overview` y los
 * filtros `?turno=`/`?temp=`/`?temporada=` de `GET /api/conversations`, para
 * que un bloque y su filtro lean lo mismo.
 *
 * Sin RPC (primera versión, ADR-117 § 7): dos embebidos de `conversation_event`
 * por conversación, con `limit=1` cada uno, sobre el índice
 * `(conversation_id, occurred_at desc)`. Cuánto cuesta, en ADR-118.
 */

import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import {
  TURN_KINDS,
  mailoutFigures,
  mailoutReplied,
  type MailoutPick,
  type LastMailout,
  type MailoutRecipientLite,
  type OverviewInput,
  type TurnEvent,
} from '$lib/conversation-overview';
import type { ConversationStatus } from '$lib/conversation';

export interface OverviewScope {
  projectIds: string[];
  workspaceIds: string[];
  /** `GET /api/conversations` puede acotar además por estado. */
  status?: ConversationStatus;
}

/** Lo que devuelve PostgREST hasta `max_rows` (config.toml); se pide por páginas. */
const PAGE = 1000;

/** El alcance de la barra lateral: unión de proyectos y espacios; sin ninguno, todo. */
export function setScope(search: URLSearchParams, projectIds: string[], workspaceIds: string[]): void {
  if (projectIds.length > 0 && workspaceIds.length > 0) {
    search.set('or', `(project_id.in.(${projectIds.join(',')}),workspace_id.in.(${workspaceIds.join(',')}))`);
  } else if (projectIds.length > 0) {
    search.set('project_id', `in.(${projectIds.join(',')})`);
  } else if (workspaceIds.length > 0) {
    search.set('workspace_id', `in.(${workspaceIds.join(',')})`);
  }
}

/** El último correo, mensaje o llamada con dirección: el que decide el turno. */
export const LAST_TURN_EMBED = 'last_turn:conversation_event(direction,occurred_at,kind,subject:metadata->>subject)';

export function setLastTurnEmbed(search: URLSearchParams): void {
  search.set('last_turn.direction', 'not.is.null');
  search.set('last_turn.kind', `in.(${TURN_KINDS.join(',')})`);
  // An automatic reply is not an answer (ADR-126 § 3): the sync marks it.
  search.set('last_turn.metadata->>auto', 'is.null');
  search.set('last_turn.order', 'occurred_at.desc');
  search.set('last_turn.limit', '1');
}

const OVERVIEW_SELECT = [
  'id,workspace_id,project_id,line_id,status,last_contacted_at,next_action_at,next_action_note,reply_settled_at',
  'organization:workspace_organization!conversation_workspace_organization_fkey(name)',
  'contacts:conversation_contact(person:workspace_person!conversation_contact_workspace_person_fkey(full_name))',
  LAST_TURN_EMBED,
  'last_in:conversation_event(occurred_at)',
].join(',');

interface OverviewDbRow {
  id: string;
  workspace_id: string;
  project_id: string;
  line_id: string | null;
  status: ConversationStatus;
  last_contacted_at: string | null;
  next_action_at: string | null;
  next_action_note: string | null;
  reply_settled_at: string | null;
  organization: { name: string } | null;
  contacts: { person: { full_name: string } | null }[] | null;
  last_turn: TurnEvent[] | null;
  last_in: { occurred_at: string }[] | null;
}

async function pages<T>(read: (offset: number) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const batch = await read(offset);
    out.push(...batch);
    if (batch.length < PAGE) return out;
  }
}

/** Las conversaciones vivas del alcance, con su turno y los días de sus funciones. */
export async function loadOverviewRows(env: SupabaseEnv, jwt: string, scope: OverviewScope): Promise<OverviewInput[]> {
  const [rows, perfs] = await Promise.all([
    pages((offset) => {
      const search = new URLSearchParams({ select: OVERVIEW_SELECT, deleted_at: 'is.null', order: 'id', limit: String(PAGE), offset: String(offset) });
      setScope(search, scope.projectIds, scope.workspaceIds);
      if (scope.status) search.set('status', `eq.${scope.status}`);
      setLastTurnEmbed(search);
      search.set('last_in.direction', 'eq.inbound');
      search.set('last_in.kind', `in.(${TURN_KINDS.join(',')})`);
      search.set('last_in.metadata->>auto', 'is.null');
      search.set('last_in.order', 'occurred_at.desc');
      search.set('last_in.limit', '1');
      search.set('contacts.is_primary', 'eq.true');
      return pgGet<OverviewDbRow>(env, 'conversation', jwt, { search }).then((r) => r.data);
    }),
    // La función lleva su conversación (la de su bolo no: `performance.bolo_id`
    // está fuera del grant por columnas, ADR-106).
    pages((offset) => {
      const search = new URLSearchParams({
        select: 'conversation_id,performed_at',
        conversation_id: 'not.is.null',
        deleted_at: 'is.null',
        status: 'neq.cancelled',
        order: 'id',
        limit: String(PAGE),
        offset: String(offset),
      });
      setScope(search, scope.projectIds, scope.workspaceIds);
      return pgGet<{ conversation_id: string; performed_at: string }>(env, 'performance', jwt, { search }).then((r) => r.data);
    }),
  ]);

  const days = new Map<string, string[]>();
  for (const p of perfs) {
    const list = days.get(p.conversation_id) ?? [];
    list.push(p.performed_at.slice(0, 10));
    days.set(p.conversation_id, list);
  }

  return rows.map((r) => {
    const title = r.organization?.name ?? r.contacts?.[0]?.person?.full_name ?? '';
    const person = r.contacts?.[0]?.person?.full_name ?? null;
    return {
      id: r.id,
      workspace_id: r.workspace_id,
      project_id: r.project_id,
      line_id: r.line_id,
      status: r.status,
      last_contacted_at: r.last_contacted_at,
      next_action_at: r.next_action_at,
      next_action_note: r.next_action_note,
      reply_settled_at: r.reply_settled_at,
      title,
      person: person && person !== title ? person : null,
      last: r.last_turn?.[0] ?? null,
      last_in: r.last_in?.[0] ?? null,
      performance_days: days.get(r.id) ?? [],
    };
  });
}

/** El envío más reciente que salió (o está saliendo) en el alcance, con sus cifras. */
export async function loadLastMailout(
  env: SupabaseEnv,
  jwt: string,
  scope: OverviewScope,
  rows: readonly OverviewInput[],
): Promise<LastMailout | null> {
  // The 4 latest, and the first with a recipient you can read: a mailout
  // whose recipients are all conversations you no longer see (deleted, or
  // someone else's private ones) would say «done, 0 recipients» and name a
  // venue in its subject (`permisos.md` § 3).
  const search = new URLSearchParams({
    select: 'id,workspace_id,subject,from_address,status,queued_at',
    status: 'in.(queued,sending,paused,done)',
    order: 'queued_at.desc.nullslast',
    limit: '4',
  });
  setScope(search, scope.projectIds, scope.workspaceIds);
  const { data } = await pgGet<Omit<LastMailout, 'figures'>>(env, 'mailout', jwt, { search });
  let m: Omit<LastMailout, 'figures'> | undefined;
  let recipients: { data: (MailoutRecipientLite & { recipient_id: string })[] } = { data: [] };
  for (const candidate of data) {
    recipients = await pgPostRpc<MailoutRecipientLite & { recipient_id: string }>(env, 'mailout_preview', jwt, {
      p_id: candidate.id,
    });
    if (recipients.data.length > 0) {
      m = candidate;
      break;
    }
  }
  if (!m) return null;
  return {
    ...m,
    figures: mailoutFigures(await withSentAt(env, jwt, m.id, recipients.data), m.queued_at, lastInMap(rows)),
  };
}

type PreviewRecipient = MailoutRecipientLite & { recipient_id: string };

async function withSentAt(env: SupabaseEnv, jwt: string, mailoutId: string, recipients: PreviewRecipient[]) {
  const sentAt = await pgGet<{ id: string; sent_at: string | null }>(env, 'mailout_recipient', jwt, {
    search: { select: 'id,sent_at', mailout_id: `eq.${mailoutId}` },
  });
  const sentById = new Map(sentAt.data.map((r) => [r.id, r.sent_at]));
  return recipients.map((r) => ({ ...r, sent_at: sentById.get(r.recipient_id) ?? null }));
}

function lastInMap(rows: readonly OverviewInput[]): Map<string, string> {
  return new Map(rows.filter((r) => r.last_in).map((r) => [r.id, r.last_in!.occurred_at]));
}

/**
 * The conversations behind a figure of a mailout (ADR-126 § 9): those that
 * replied, or those that bounced. Same rule as the figure, so «22 replies»
 * lists 22. Only recipients the caller can read (`mailout_preview`).
 */
export async function mailoutPickIds(
  env: SupabaseEnv,
  jwt: string,
  mailoutId: string,
  pick: MailoutPick,
  rows: readonly OverviewInput[],
): Promise<Set<string>> {
  const [preview, mailout] = await Promise.all([
    pgPostRpc<PreviewRecipient>(env, 'mailout_preview', jwt, { p_id: mailoutId }),
    pgGet<{ queued_at: string | null }>(env, 'mailout', jwt, { search: { select: 'queued_at', id: `eq.${mailoutId}` } }),
  ]);
  const queuedAt = mailout.data[0]?.queued_at ?? null;
  const recipients = await withSentAt(env, jwt, mailoutId, preview.data);
  const lastIn = lastInMap(rows);
  return new Set(
    recipients
      .filter((r) => (pick === 'rebotes' ? r.status === 'bounced' : mailoutReplied(r, queuedAt, lastIn)))
      .map((r) => r.conversation_id),
  );
}
