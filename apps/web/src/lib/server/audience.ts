/**
 * Piezas comunes de las rutas /api/audience/* (ADR-173, fase 3). Todo va con
 * el JWT de quien llama: la RLS (`private.audience_access`) decide qué lee y
 * las RPC qué escribe. Esto solo dice a la pantalla qué ofrecer.
 */

import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { jwtSubject } from '$lib/server/http';
import type { AudienceAccess } from '$lib/audience';

type MembershipRow = {
  workspace_id: string;
  workspace_role: string | null;
  facets: { verb: 'view' | 'edit'; facet: { key: string; workspace_id: string | null } | null }[] | null;
};

/**
 * Lo que quien llama puede hacer con el público de cada espacio, de su propia
 * membresía (la RLS deja leer las propias): owner y admin todo; la faceta
 * Público (estándar, a nivel de espacio) ver o ver y editar. Es la misma regla
 * que `private.audience_access`, leída para pintar; la base la vuelve a mirar.
 */
export async function audienceAccess(
  env: SupabaseEnv,
  jwt: string,
  workspaceIds: readonly string[],
): Promise<Record<string, AudienceAccess>> {
  const sub = jwtSubject(jwt);
  const out: Record<string, AudienceAccess> = {};
  if (!sub || workspaceIds.length === 0) return out;
  const { data } = await pgGet<MembershipRow>(env, 'membership', jwt, {
    search: {
      select: 'workspace_id,workspace_role,facets:membership_facet(verb,facet:facet_id(key,workspace_id))',
      level: 'eq.workspace',
      accepted_at: 'not.is.null',
      user_id: `eq.${sub}`,
      workspace_id: `in.(${[...new Set(workspaceIds)].join(',')})`,
    },
  });
  for (const m of data) {
    const admin = m.workspace_role === 'owner' || m.workspace_role === 'admin';
    const facet = (m.facets ?? []).find((f) => f.facet?.key === 'audience' && f.facet.workspace_id === null);
    out[m.workspace_id] = { read: admin || Boolean(facet), edit: admin || facet?.verb === 'edit', admin };
  }
  return out;
}

/** Si el envío de un espacio sale del simulador: su dominio del público, o el modo del Worker. */
export async function audienceSimulated(
  env: SupabaseEnv,
  jwt: string,
  workspaceId: string,
  fallback: 'simulator' | 'ses',
): Promise<boolean> {
  const [domains, ws] = await Promise.all([
    pgGet<{ provider: string }>(env, 'mail_domain', jwt, {
      search: { select: 'provider', workspace_id: `eq.${workspaceId}`, purpose: 'eq.audience', limit: '1' },
    }),
    pgGet<{ mailout_simulator_only: boolean }>(env, 'workspace', jwt, {
      search: { select: 'mailout_simulator_only', id: `eq.${workspaceId}` },
    }),
  ]);
  if (ws.data[0]?.mailout_simulator_only) return true;
  return (domains.data[0]?.provider ?? fallback) === 'simulator';
}

/** Admin del espacio (la prueba con IP y borrar datos). */
export async function isWorkspaceAdmin(env: SupabaseEnv, jwt: string, workspaceId: string): Promise<boolean> {
  const r = await pgPostRpc<boolean>(env, 'is_workspace_admin', jwt, { ws_id: workspaceId });
  return r.data[0] === true;
}
