/**
 * Las filas de la vista Envíos (ADR-176): una página de envíos del alcance,
 * de los dos tipos, con sus destinatarios y sus cifras. Cada envío pide su
 * vista previa (`mailout_preview`, la misma lectura que «Último envío») y las
 * respuestas salen del último correo de fuera de sus conversaciones, todo con
 * la RLS de quien llama. Un envío cuya vista previa falla sale sin cifras.
 */

import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { mailoutFigures } from '$lib/conversation-overview';
import { mailoutLeft, type MailoutKind, type MailoutListResponse, type MailoutRow } from '$lib/mailout-list';
import {
  loadLastIn,
  setScope,
  withSentAt,
  type OverviewScope,
  type PreviewRecipient,
} from '$lib/server/conversation-overview';

type Row = Omit<MailoutRow, 'professionals' | 'subscribers' | 'figures'>;

export async function loadMailoutRows(
  env: SupabaseEnv,
  jwt: string,
  scope: OverviewScope,
  opts: { kind: MailoutKind | null; limit: number },
): Promise<MailoutListResponse> {
  const search = new URLSearchParams({
    select: 'id,workspace_id,project_id,kind,subject,status,queued_at,created_at,audience_id',
    status: 'neq.cancelled',
    // Lo que va a salir (borradores, sin fecha de cola) arriba; después lo último que salió.
    order: 'queued_at.desc.nullsfirst,created_at.desc',
    limit: String(opts.limit),
  });
  if (opts.kind) search.set('kind', `eq.${opts.kind}`);
  setScope(search, scope.projectIds, scope.workspaceIds);
  const { data, total } = await pgGet<Row>(env, 'mailout', jwt, { search, exactCount: true });

  const previews = await Promise.all(
    data.map((m) =>
      pgPostRpc<PreviewRecipient>(env, 'mailout_preview', jwt, { p_id: m.id })
        .then((r) => r.data)
        .catch(() => null),
    ),
  );
  const left = await Promise.all(
    data.map((m, i) => {
      const p = previews[i];
      return p && mailoutLeft(m.status) ? withSentAt(env, jwt, m.id, p).catch(() => null) : Promise.resolve(null);
    }),
  );
  const asked = [
    ...new Set(left.flatMap((rs) => (rs ?? []).map((r) => r.conversation_id)).filter((id): id is string => Boolean(id))),
  ];
  const lastIn = asked.length > 0 ? await loadLastIn(env, jwt, scope, asked) : new Map<string, string>();

  return {
    total: total ?? data.length,
    items: data.map((m, i) => {
      const p = previews[i] ?? [];
      const sent = left[i];
      return {
        ...m,
        professionals: p.filter((r) => r.conversation_id).length,
        subscribers: p.length - p.filter((r) => r.conversation_id).length,
        figures: sent ? mailoutFigures(sent, m.queued_at, lastIn) : null,
      };
    }),
  };
}
