/**
 * El acceso al bolo (comms carril 2, fase 2): quién tiene paquete, qué
 * invitaciones esperan, invitar, revocar y mover la fecha.
 *
 *   GET    → `bolo_access` (sin dinero; 404 si quien llama no está en el bolo).
 *   POST   → `create_bolo_invitation` (Mínim o Equip; el techo del delegante
 *            lo decide la RPC). Devuelve el enlace para copiar: Hour no envía
 *            correos de invitación (las de espacio tampoco), el token viaja en
 *            el fragmento como en `/api/workspaces/[id]/access`.
 *   PATCH  → `set_membership_expiry` (null = sin fecha).
 *   DELETE → `revoke_membership` (una persona) o `revoke_workspace_invitation`.
 *
 * Auth: Bearer JWT (o la cookie de sesión). Toda la puerta es la RPC.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { jsonNoStore } from '$lib/server/http';
import type { BoloAccess } from '$lib/bolo-access';

const UUID = v.pipe(v.string(), v.uuid());
const InviteBody = v.object({
  email: v.pipe(v.string(), v.trim(), v.email(), v.maxLength(320)),
  preset: v.picklist(['minim', 'equip']),
  /** ADR-107: invitada desde «quién va»; aceptar enlaza la cuenta a esa persona. */
  person_id: v.optional(v.nullable(UUID)),
});
const PatchBody = v.object({
  membership_id: UUID,
  expires_at: v.nullable(v.pipe(v.string(), v.isoTimestamp())),
});
const DeleteBody = v.variant('kind', [
  v.object({ kind: v.literal('member'), id: UUID }),
  v.object({ kind: v.literal('invitation'), id: UUID }),
]);

interface InvitationResult {
  id: string;
  email: string;
  bolo_id: string;
  bolo_preset: 'minim' | 'equip';
  expires_at: string;
  token: string;
}

function context(request: Request, platform: App.Platform | undefined, id: string | undefined) {
  if (!platform?.env) return { ok: false, response: jsonNoStore({ error: 'platform_unavailable' }, 500) } as const;
  const jwt = extractAccessToken(request);
  if (!jwt) return { ok: false, response: jsonNoStore({ error: 'missing_authorization' }, 401) } as const;
  const parsedId = v.safeParse(UUID, id ?? '');
  if (!parsedId.success) return { ok: false, response: jsonNoStore({ error: 'invalid_id' }, 400) } as const;
  return { ok: true, env: platform.env as unknown as SupabaseEnv, jwt, boloId: parsedId.output } as const;
}

function rpcError(err: unknown, route: string, requestId: string | undefined, notFound = false): Response {
  return pgErrorResponse(
    err,
    { route, requestId },
    {
      codes: {
        '22023': { status: 400, error: 'invalid_input' },
        '42501': notFound ? { status: 404, error: 'not_found' } : { status: 403, error: 'forbidden' },
      },
      passUpstream: [401],
    },
  );
}

export const GET: RequestHandler = async ({ request, params, platform, locals }) => {
  const ctx = context(request, platform, params.id);
  if (!ctx.ok) return ctx.response;
  try {
    const { data } = await pgPostRpc<BoloAccess>(ctx.env, 'bolo_access', ctx.jwt, { p_bolo_id: ctx.boloId });
    const access = data[0];
    if (!access) return jsonNoStore({ error: 'not_found' }, 404);
    return jsonNoStore(access);
  } catch (err) {
    return rpcError(err, 'GET /api/bolos/[id]/access', locals.requestId, true);
  }
};

export const POST: RequestHandler = async ({ request, params, platform, locals, url }) => {
  const ctx = context(request, platform, params.id);
  if (!ctx.ok) return ctx.response;
  const parsed = v.safeParse(InviteBody, await request.json().catch(() => null));
  if (!parsed.success) return jsonNoStore({ error: 'invalid_body', issues: parsed.issues }, 400);
  try {
    const { data } = await pgPostRpc<InvitationResult>(ctx.env, 'create_bolo_invitation', ctx.jwt, {
      p_bolo_id: ctx.boloId,
      p_email: parsed.output.email,
      p_preset: parsed.output.preset,
      p_person_id: parsed.output.person_id ?? null,
    });
    const invitation = data[0];
    if (!invitation) return jsonNoStore({ error: 'rpc_empty_result' }, 502);
    return jsonNoStore(
      {
        invitation: {
          ...invitation,
          token: undefined,
          // El fragmento deja la capacidad fuera de HTTP, CDN y Sentry.
          invite_url: `${url.origin}/invite#${invitation.token}`,
        },
      },
      201,
    );
  } catch (err) {
    return rpcError(err, 'POST /api/bolos/[id]/access', locals.requestId);
  }
};

export const PATCH: RequestHandler = async ({ request, params, platform, locals }) => {
  const ctx = context(request, platform, params.id);
  if (!ctx.ok) return ctx.response;
  const parsed = v.safeParse(PatchBody, await request.json().catch(() => null));
  if (!parsed.success) return jsonNoStore({ error: 'invalid_body', issues: parsed.issues }, 400);
  try {
    await pgPostRpc(ctx.env, 'set_membership_expiry', ctx.jwt, {
      p_membership_id: parsed.output.membership_id,
      p_expires_at: parsed.output.expires_at,
    });
    return new Response(null, { status: 204 });
  } catch (err) {
    return rpcError(err, 'PATCH /api/bolos/[id]/access', locals.requestId);
  }
};

export const DELETE: RequestHandler = async ({ request, params, platform, locals }) => {
  const ctx = context(request, platform, params.id);
  if (!ctx.ok) return ctx.response;
  const parsed = v.safeParse(DeleteBody, await request.json().catch(() => null));
  if (!parsed.success) return jsonNoStore({ error: 'invalid_body', issues: parsed.issues }, 400);
  try {
    if (parsed.output.kind === 'member') {
      await pgPostRpc(ctx.env, 'revoke_membership', ctx.jwt, { p_membership_id: parsed.output.id });
    } else {
      await pgPostRpc(ctx.env, 'revoke_workspace_invitation', ctx.jwt, { p_invitation_id: parsed.output.id });
    }
    return new Response(null, { status: 204 });
  } catch (err) {
    return rpcError(err, 'DELETE /api/bolos/[id]/access', locals.requestId);
  }
};
