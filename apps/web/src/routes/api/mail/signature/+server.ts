/**
 * La firma de correo en un espacio (ADR-099, añadido: la firma es de la
 * persona en cada compañía; el buzón común firma con la de la compañía).
 *
 * GET ?workspace_id=… → { parts, can_edit_company }: las piezas de
 *     `my_mail_signature` (las dos firmas guardadas, null = la propuesta) y si
 *     quien llama edita la de la compañía.
 * PUT { workspace_id, scope: 'personal', signature } → la tuya
 *     (`set_my_mail_signature`; null = volver a la propuesta).
 * PUT { workspace_id, scope: 'workspace', signature?, website?, phone? } → la
 *     de la compañía y sus datos de contacto; un admin (policy
 *     `workspace_update`). Para los demás, 404 sin confirmar nada.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPatch, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { jsonNoStore, UUID_RE } from '$lib/server/http';
import { SignaturePutSchema, type SignatureParts, type SignatureSettings } from '$lib/mail';

const clean = (s: string | null | undefined) => (s ?? '').trim() || null;

export const GET: RequestHandler = async ({ request, url, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);
  const workspaceId = url.searchParams.get('workspace_id') ?? '';
  if (!UUID_RE.test(workspaceId)) return jsonNoStore({ error: 'invalid_workspace' }, 400);
  try {
    const [parts, admin] = await Promise.all([
      pgPostRpc<SignatureParts>(env, 'my_mail_signature', jwt, { p_workspace_id: workspaceId }),
      pgPostRpc<boolean>(env, 'is_workspace_admin', jwt, { ws_id: workspaceId }),
    ]);
    const row = parts.data[0];
    if (!row) return jsonNoStore({ error: 'not_found' }, 404);
    return jsonNoStore({ parts: row, can_edit_company: admin.data[0] === true } satisfies SignatureSettings);
  } catch (err) {
    return pgErrorResponse(err, { route: 'GET /api/mail/signature', requestId: locals.requestId });
  }
};

export const PUT: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonNoStore({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(SignaturePutSchema, raw);
  if (!parsed.success) return jsonNoStore({ error: 'invalid_body' }, 400);
  const body = parsed.output;
  try {
    if (body.scope === 'personal') {
      await pgPostRpc(env, 'set_my_mail_signature', jwt, {
        p_workspace_id: body.workspace_id,
        p_signature: clean(body.signature),
      });
      return jsonNoStore({ signature: clean(body.signature) });
    }
    const patch: Record<string, string | null> = {};
    if (body.signature !== undefined) patch.mail_signature = clean(body.signature);
    if (body.website !== undefined) patch.website = clean(body.website);
    if (body.phone !== undefined) patch.phone = clean(body.phone);
    if (Object.keys(patch).length === 0) return jsonNoStore({ error: 'invalid_body' }, 400);
    const { data } = await pgPatch<{ id: string }>(env, 'workspace', jwt, patch, {
      search: { id: `eq.${body.workspace_id}`, select: 'id' },
    });
    if (!data[0]) return jsonNoStore({ error: 'not_found' }, 404);
    return jsonNoStore(patch);
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'PUT /api/mail/signature', requestId: locals.requestId },
      { codes: { '42501': { status: 404, error: 'not_found' } } },
    );
  }
};
