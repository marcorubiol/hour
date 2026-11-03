/**
 * Las filas de la vista Envíos (ADR-176): una página de envíos del alcance,
 * de los dos tipos, con sus destinatarios y sus cifras, todo con la RLS de
 * quien llama.
 *
 * UN NÚMERO FIJO DE LECTURAS POR PÁGINA, nunca una por envío: hour-web corre
 * en Workers Free (50 subpeticiones por petición). Los envíos (1); sus
 * destinatarios, todos a la vez y por tandas de URL (`mailout_recipient`,
 * cuya RLS ya deja fuera los de una conversación que no se lee); las bajas
 * (`mail_suppression` de esos espacios desde el envío más antiguo, 1; sólo la
 * lee un admin del espacio: a quien no lo es no le salen bajas, nunca un cero
 * que no sabemos); y el último correo de fuera de sus conversaciones para las
 * respuestas (`loadLastIn`, por tandas de 150). Una página es de 20 como
 * mucho (`offset` para la siguiente): unas diez lecturas.
 */

import { pgGet, type SupabaseEnv } from '$lib/supabase';
import { mailoutFigures, type MailoutRecipientLite } from '$lib/conversation-overview';
import { MAILOUT_PAGE, mailoutLeft, type MailoutKind, type MailoutListResponse, type MailoutRow } from '$lib/mailout-list';
import { loadLastIn, type OverviewScope } from '$lib/server/conversation-overview';

type Row = Omit<MailoutRow, 'professionals' | 'subscribers' | 'figures'>;

type RecipientRow = {
  mailout_id: string;
  conversation_id: string | null;
  audience_subscription_id: string | null;
  address: string | null;
  status: string;
  sent_at: string | null;
  conversation: { deleted_at: string | null } | null;
};

/** Ids per `in.(…)` read: about 5.5 kB of URL, under any proxy's limit. */
const IDS_PER_READ = 150;

function batches<T>(xs: readonly T[], n = IDS_PER_READ): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/**
 * El alcance de la vista: el de la barra lateral (unión de proyectos y
 * espacios) y, además, las invitaciones de los espacios en pantalla, que no
 * llevan proyecto y salen como sus listas del público (ADR-173 § 9).
 */
function setMailoutScope(search: URLSearchParams, scope: OverviewScope, audienceWorkspaceIds: string[]): void {
  const parts: string[] = [];
  if (scope.projectIds.length > 0) parts.push(`project_id.in.(${scope.projectIds.join(',')})`);
  if (scope.workspaceIds.length > 0) parts.push(`workspace_id.in.(${scope.workspaceIds.join(',')})`);
  if (parts.length === 0) return;
  if (audienceWorkspaceIds.length > 0) parts.push(`and(kind.eq.invitation,workspace_id.in.(${audienceWorkspaceIds.join(',')}))`);
  search.set('or', `(${parts.join(',')})`);
}

export async function loadMailoutRows(
  env: SupabaseEnv,
  jwt: string,
  scope: OverviewScope,
  opts: { kind: MailoutKind | null; offset: number; audienceWorkspaceIds: string[] },
): Promise<MailoutListResponse> {
  const search = new URLSearchParams({
    select: 'id,workspace_id,project_id,kind,subject,status,queued_at,created_at,audience_id',
    status: 'neq.cancelled',
    // Lo que va a salir (borradores, sin fecha de cola) arriba; después lo último que salió.
    order: 'queued_at.desc.nullsfirst,created_at.desc',
    limit: String(MAILOUT_PAGE),
    offset: String(opts.offset),
  });
  if (opts.kind) search.set('kind', `eq.${opts.kind}`);
  setMailoutScope(search, scope, opts.audienceWorkspaceIds);
  const { data, total } = await pgGet<Row>(env, 'mailout', jwt, { search, exactCount: true });
  if (data.length === 0) return { total: total ?? 0, items: [] };

  const recipients = (
    await Promise.all(
      batches(data.map((m) => m.id)).map((ids) =>
        pgGet<RecipientRow>(env, 'mailout_recipient', jwt, {
          search: {
            select: 'mailout_id,conversation_id,audience_subscription_id,address,status,sent_at,conversation:conversation_id(deleted_at)',
            mailout_id: `in.(${ids.join(',')})`,
            status: 'neq.skipped',
          },
        }).then((r) => r.data),
      ),
    )
  )
    .flat()
    // As `mailout_preview`: a deleted conversation is no longer a recipient anyone sees.
    .filter((r) => r.conversation_id === null || (r.conversation && r.conversation.deleted_at === null));

  const byMailout = new Map<string, RecipientRow[]>();
  for (const r of recipients) byMailout.set(r.mailout_id, [...(byMailout.get(r.mailout_id) ?? []), r]);

  const sentIds = new Set(data.filter((m) => mailoutLeft(m.status)).map((m) => m.id));
  const sent = recipients.filter((r) => sentIds.has(r.mailout_id));
  const addresses = [...new Set(sent.map((r) => r.address).filter((a): a is string => Boolean(a)))];
  const conversations = [...new Set(sent.map((r) => r.conversation_id).filter((c): c is string => Boolean(c)))];

  const oldestQueued = data
    .filter((m) => sentIds.has(m.id) && m.queued_at)
    .map((m) => m.queued_at!)
    .sort()[0] ?? new Date().toISOString();
  const [suppressed, lastIn] = await Promise.all([
    addresses.length > 0
      ? pgGet<{ workspace_id: string; address: string; created_at: string }>(env, 'mail_suppression', jwt, {
          search: {
            select: 'workspace_id,address,created_at',
            reason: 'eq.unsubscribe',
            workspace_id: `in.(${[...new Set(data.map((m) => m.workspace_id))].join(',')})`,
            created_at: `gte.${oldestQueued}`,
          },
        }).then((r) => new Map(r.data.map((x) => [`${x.workspace_id}|${x.address.toLowerCase()}`, x.created_at])))
      : Promise.resolve(new Map<string, string>()),
    conversations.length > 0 ? loadLastIn(env, jwt, scope, conversations) : Promise.resolve(new Map<string, string>()),
  ]);

  return {
    total: total ?? data.length,
    items: data.map((m) => {
      const rs = byMailout.get(m.id) ?? [];
      const professionals = rs.filter((r) => r.conversation_id).length;
      const lite: MailoutRecipientLite[] = rs.map((r) => {
        const unsubAt = r.address ? suppressed.get(`${m.workspace_id}|${r.address.toLowerCase()}`) : undefined;
        return {
          // A subscriber has no conversation: it never counts as a reply.
          conversation_id: r.conversation_id ?? '',
          status: r.status,
          sent_at: r.sent_at,
          suppressed_reason: unsubAt ? 'unsubscribe' : null,
          suppressed_at: unsubAt ?? null,
        };
      });
      return {
        ...m,
        professionals,
        subscribers: rs.length - professionals,
        figures: sentIds.has(m.id) ? mailoutFigures(lite, m.queued_at, lastIn) : null,
      };
    }),
  };
}
