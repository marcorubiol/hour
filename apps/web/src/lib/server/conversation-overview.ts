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
import type { ConversationBolo } from '$lib/conversation-relation';
import { defaultProviderKind, type MailoutEnv } from '$lib/server/mailout';

interface OverviewScope {
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
const LAST_TURN_EMBED = 'last_turn:conversation_event(direction,occurred_at,kind,subject:metadata->>subject)';

/** El último que vino de fuera: si han contestado alguna vez (la relación, ADR-138). */
const LAST_IN_EMBED = 'last_in:conversation_event(occurred_at)';

/** Los dos embebidos que leen el turno y la relación, juntos. */
export const TURN_EMBEDS = `${LAST_TURN_EMBED},${LAST_IN_EMBED}`;

/** Los filtros de `TURN_EMBEDS`: el último con dirección, y el último de fuera. */
export function setLastTurnEmbed(search: URLSearchParams): void {
  search.set('last_turn.direction', 'not.is.null');
  search.set('last_turn.kind', `in.(${TURN_KINDS.join(',')})`);
  // An automatic reply is not an answer (ADR-126 § 3): the sync marks it.
  search.set('last_turn.metadata->>auto', 'is.null');
  search.set('last_turn.order', 'occurred_at.desc');
  search.set('last_turn.limit', '1');
  search.set('last_in.direction', 'eq.inbound');
  search.set('last_in.kind', `in.(${TURN_KINDS.join(',')})`);
  search.set('last_in.metadata->>auto', 'is.null');
  search.set('last_in.order', 'occurred_at.desc');
  search.set('last_in.limit', '1');
}

/** Los hechos de la relación (ADR-138): `regular` es el campo calculado, que lee los bolos hechos sin dinero. */
const RELATION_SELECT =
  'not_now_at,not_now_until,first_contacted_at,contacted_undated,legacy_status:custom_fields->>legacy_status,regular:conversation_regular';

const OVERVIEW_SELECT = [
  'id,workspace_id,project_id,line_id,last_contacted_at,next_action_at,next_action_note,reply_settled_at',
  RELATION_SELECT,
  'organization:workspace_organization!conversation_workspace_organization_fkey(name)',
  'line:line_id(name)',
  'contacts:conversation_contact(person:workspace_person!conversation_contact_workspace_person_fkey(full_name))',
  TURN_EMBEDS,
].join(',');

interface OverviewDbRow {
  id: string;
  workspace_id: string;
  project_id: string;
  line_id: string | null;
  not_now_at: string | null;
  not_now_until: string | null;
  first_contacted_at: string | null;
  contacted_undated: boolean;
  legacy_status: string | null;
  regular: boolean | null;
  last_contacted_at: string | null;
  next_action_at: string | null;
  next_action_note: string | null;
  reply_settled_at: string | null;
  organization: { name: string } | null;
  line: { name: string } | null;
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

  const bolos = await loadConversationBolos(env, jwt, rows.map((r) => r.id));

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
      line_name: r.line?.name ?? null,
      not_now_at: r.not_now_at,
      not_now_until: r.not_now_until,
      first_contacted_at: r.first_contacted_at,
      contacted_undated: r.contacted_undated,
      legacy_status: r.legacy_status,
      regular: r.regular,
      last_contacted_at: r.last_contacted_at,
      next_action_at: r.next_action_at,
      next_action_note: r.next_action_note,
      reply_settled_at: r.reply_settled_at,
      title,
      person: person && person !== title ? person : null,
      last: r.last_turn?.[0] ?? null,
      last_in: r.last_in?.[0] ?? null,
      performance_days: days.get(r.id) ?? [],
      bolos: bolos.get(r.id) ?? [],
    };
  });
}

/** Lo que `conversations_bolos` acepta por llamada. */
const BOLOS_BATCH = 2000;

/**
 * Los bolos de unas conversaciones (ADR-138 § 3), sin caché ni pagador: la RPC
 * solo devuelve los de las que quien llama lee y con `read:performance` en el
 * proyecto. Agrupados por conversación, en orden de fecha.
 */
async function loadConversationBolos(
  env: SupabaseEnv,
  jwt: string,
  ids: readonly string[],
): Promise<Map<string, ConversationBolo[]>> {
  const out = new Map<string, ConversationBolo[]>();
  for (let i = 0; i < ids.length; i += BOLOS_BATCH) {
    const { data } = await pgPostRpc<ConversationBolo>(env, 'conversations_bolos', jwt, {
      p_conversation_ids: ids.slice(i, i + BOLOS_BATCH),
    });
    for (const b of data) out.set(b.conversation_id, [...(out.get(b.conversation_id) ?? []), b]);
  }
  return out;
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
    select: 'id,workspace_id,subject,from_address,status,queued_at,mail_domain_id',
    status: 'in.(queued,sending,paused,done)',
    order: 'queued_at.desc.nullslast',
    limit: '4',
  });
  setScope(search, scope.projectIds, scope.workspaceIds);
  type Row = Omit<LastMailout, 'figures' | 'simulated'> & { mail_domain_id: string | null };
  const { data } = await pgGet<Row>(env, 'mailout', jwt, { search });
  let m: Row | undefined;
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
  const { mail_domain_id, ...rest } = m;
  const domain = mail_domain_id
    ? (await pgGet<{ provider: string }>(env, 'mail_domain', jwt, { search: { select: 'provider', id: `eq.${mail_domain_id}` } })).data[0]
    : undefined;
  return {
    ...rest,
    figures: mailoutFigures(await withSentAt(env, jwt, m.id, recipients.data), m.queued_at, lastInMap(rows)),
    // The rule of the mailout screen (`route.ts`): its domain's provider, or the default one.
    simulated: (domain?.provider ?? defaultProviderKind(env as Partial<MailoutEnv>)) === 'simulator',
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
