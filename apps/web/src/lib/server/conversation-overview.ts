/**
 * Las lecturas del dashboard de Conversations (ADR-117): las conversaciones
 * vivas del alcance con su último evento embebido y los días de sus funciones,
 * que lee `GET /api/conversations/overview` (el panel), y el último envío, que
 * lee aparte `GET /api/conversations/last-mailout` (2026-10-24: el panel ya no
 * lo espera). Los
 * filtros de la lista (`?turno=`/`?temp=`/`?temporada=`…) los resuelve
 * `conversation_feed` con las mismas reglas en SQL (plan de la lista, fase 3);
 * el test RLS `conversation-feed-list.test.ts` compara las dos lecturas.
 *
 * Sin RPC (primera versión, ADR-117 § 7): dos embebidos de `conversation_event`
 * por conversación, con `limit=1` cada uno, sobre el índice
 * `(conversation_id, occurred_at desc)`. Cuánto cuesta, en ADR-118.
 */

import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import {
  TURN_KINDS,
  mailoutFigures,
  type LastMailout,
  type MailoutRecipientLite,
  type OverviewInput,
  type TurnEvent,
} from '$lib/conversation-overview';
import { TAGGING_EMBED, tagKeysOf, type TaggingEmbed } from '$lib/conversation-tags';
import type { ConversationBolo } from '$lib/conversation-relation';
import { defaultProviderKind, type MailoutEnv } from '$lib/server/mailout';

interface OverviewScope {
  projectIds: string[];
  workspaceIds: string[];
}

/** Lo que devuelve PostgREST hasta `max_rows` (config.toml); se pide por páginas. */
const PAGE = 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Una lista de ids de la query (`project_ids=a,b`): únicos, solo los uuid. */
export function parseIds(raw: string | null): string[] {
  return raw ? [...new Set(raw.split(',').map((x) => x.trim()).filter((x) => UUID.test(x)))] : [];
}

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
  setLastInEmbed(search);
}

/** Los filtros de `LAST_IN_EMBED` solo: el último que vino de fuera. */
function setLastInEmbed(search: URLSearchParams): void {
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
  TAGGING_EMBED,
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
  tagging: TaggingEmbed;
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
      tags: tagKeysOf(r.tagging),
    };
  });
}

/**
 * La consulta de una página de `loadTaggedIds`. Las columnas del orden van en el
 * `select`: sobre `rpc/conversation_search` PostgREST no ordena por una columna
 * que no devuelve (42703).
 */
export function taggedIdsSearch(base: URLSearchParams, offset: number): URLSearchParams {
  const search = new URLSearchParams(base);
  search.set('select', `id,next_action_at,updated_at,${TAGGING_EMBED}`);
  search.set('order', 'next_action_at.asc.nullslast,updated_at.desc,id');
  search.set('limit', String(PAGE));
  search.set('offset', String(offset));
  return search;
}

/**
 * Lo que la lista sin filtro de bloque necesita para acotar por etiqueta
 * (ADR-138, fase 2): los ids del alcance con sus etiquetas, en el orden de la
 * lista. Ligero: sin turno, bolos ni funciones. La página se lee después entera.
 */
export async function loadTaggedIds(
  env: SupabaseEnv,
  jwt: string,
  base: URLSearchParams,
  path: 'conversation' | 'rpc/conversation_search',
): Promise<{ id: string; tags: string[] }[]> {
  const rows = await pages((offset) =>
    pgGet<{ id: string; tagging: TaggingEmbed }>(env, path, jwt, { search: taggedIdsSearch(base, offset) }).then((r) => r.data),
  );
  return rows.map((r) => ({ id: r.id, tags: tagKeysOf(r.tagging) }));
}

/** Lo que `conversations_bolos` acepta por llamada. */
const BOLOS_BATCH = 2000;

/**
 * Los bolos de unas conversaciones (ADR-138 § 3), sin caché ni pagador: la RPC
 * solo devuelve los de las que quien llama lee y con `read:performance` en el
 * proyecto. Agrupados por conversación, en orden de fecha.
 */
export async function loadConversationBolos(
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

/**
 * El envío más reciente que salió (o está saliendo) en el alcance, con sus
 * cifras. Lectura propia (`GET /api/conversations/last-mailout`), fuera del
 * panel: cuesta lo que la RLS de `mailout` (un `has_permission` por fila de la
 * tabla, medido 1,1 s con 637 filas el 2026-10-24), y Hoy no la espera.
 */
export async function loadLastMailout(env: SupabaseEnv, jwt: string, scope: OverviewScope): Promise<LastMailout | null> {
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
  // The four previews at once; the first in order with someone in it wins.
  const previews = await Promise.all(
    data.map((candidate) =>
      pgPostRpc<PreviewRecipient>(env, 'mailout_preview', jwt, { p_id: candidate.id }).then((r) => r.data),
    ),
  );
  const at = previews.findIndex((p) => p.length > 0);
  if (at < 0) return null;
  const m = data[at];
  const recipients = previews[at];
  const { mail_domain_id, ...rest } = m;
  const [domain, withSent, lastIn] = await Promise.all([
    mail_domain_id
      ? pgGet<{ provider: string }>(env, 'mail_domain', jwt, {
          search: { select: 'provider', id: `eq.${mail_domain_id}` },
        }).then((r) => r.data[0])
      : undefined,
    withSentAt(env, jwt, m.id, recipients),
    loadLastIn(env, jwt, scope, [...new Set(recipients.map((r) => r.conversation_id))]),
  ]);
  return {
    ...rest,
    figures: mailoutFigures(withSent, m.queued_at, lastIn),
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

/** Ids per `id=in.(…)` read: about 5.5 kB of URL, under any proxy's limit. */
const IDS_PER_READ = 150;

/**
 * The last inbound word of some conversations, read as the panel reads it:
 * live, readable (RLS) and in the scope, or absent, which never counts as a
 * reply. Before the split the figures took it from the panel's rows; these
 * are the same rows, narrowed to the mailout's recipients.
 */
async function loadLastIn(
  env: SupabaseEnv,
  jwt: string,
  scope: OverviewScope,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += IDS_PER_READ) batches.push(ids.slice(i, i + IDS_PER_READ));
  const reads = await Promise.all(
    batches.map((batch) => {
      const search = new URLSearchParams({
        select: `id,${LAST_IN_EMBED}`,
        id: `in.(${batch.join(',')})`,
        deleted_at: 'is.null',
      });
      setScope(search, scope.projectIds, scope.workspaceIds);
      setLastInEmbed(search);
      return pgGet<Pick<OverviewDbRow, 'id' | 'last_in'>>(env, 'conversation', jwt, { search }).then((r) => r.data);
    }),
  );
  return lastInMap(reads.flat().map((r) => ({ id: r.id, last_in: r.last_in?.[0] ?? null })));
}

export function lastInMap(rows: readonly Pick<OverviewInput, 'id' | 'last_in'>[]): Map<string, string> {
  return new Map(rows.filter((r) => r.last_in).map((r) => [r.id, r.last_in!.occurred_at]));
}
