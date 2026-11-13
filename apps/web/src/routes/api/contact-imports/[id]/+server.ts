/**
 * DELETE /api/contact-imports/:id (138): deshacer una importación de
 * contactos (`undo_contact_import`), durante 7 días, quien la hizo o el owner
 * o admin del espacio. Borra lo que nació en ella y sigue igual, devuelve a
 * vacío lo completado que nadie ha cambiado y deja lo que alguien ha tocado.
 *
 * Auth: Bearer JWT. 404 si no existe o no es tuya; 409 `already_undone`;
 * 410 `undo_expired`; 503 `not_ready` sin la migración.
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, PostgrestError, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { json, UUID_RE } from '$lib/server/http';
import { notReadyResponse, schemaMissing } from '$lib/server/contact-import';
import type { UndoResult } from '$lib/contact-import';

export const DELETE: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);
  if (!UUID_RE.test(params.id)) return json({ error: 'invalid_id' }, 400);

  try {
    const { data } = await pgPostRpc<UndoResult>(env, 'undo_contact_import', jwt, { p_import_id: params.id });
    return json({ undo: data[0] ?? null });
  } catch (err) {
    if (schemaMissing(err)) return notReadyResponse();
    if (err instanceof PostgrestError && err.code === '22023') {
      if (/already undone/.test(err.body)) return json({ error: 'already_undone' }, 409);
      if (/undo expired/.test(err.body)) return json({ error: 'undo_expired' }, 410);
    }
    return pgErrorResponse(
      err,
      { route: 'DELETE /api/contact-imports/[id]', requestId: locals.requestId },
      { codes: { '42501': { status: 404, error: 'not_found' } } },
    );
  }
};
