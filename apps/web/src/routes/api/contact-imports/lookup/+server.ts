/**
 * POST /api/contact-imports/lookup (138): qué hay ya en Hour de una hoja que
 * se está revisando. Body `{ workspace_id, emails, names, organizations }`;
 * devuelve las personas con alguno de esos correos o nombres y las
 * organizaciones con alguno de esos nombres, sólo entre lo que quien llama
 * lee (`contact_import_lookup`). Nada se escribe.
 *
 * Auth: Bearer JWT. 404 si el espacio no es tuyo para importar; 503
 * `not_ready` si la base aún no tiene la migración.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { json } from '$lib/server/http';
import { notReadyResponse, schemaMissing } from '$lib/server/contact-import';
import { ContactLookupRequestSchema, type ImportLookup } from '$lib/contact-import';

export const POST: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(ContactLookupRequestSchema, raw);
  if (!parsed.success) return json({ error: 'invalid_body' }, 400);
  const { workspace_id, emails, names, organizations } = parsed.output;

  try {
    const { data } = await pgPostRpc<ImportLookup>(env, 'contact_import_lookup', jwt, {
      p_workspace_id: workspace_id,
      p_emails: emails,
      p_names: names,
      p_organizations: organizations,
    });
    const r = data[0];
    return json({ persons: r?.persons ?? [], organizations: r?.organizations ?? [] } satisfies ImportLookup);
  } catch (err) {
    if (schemaMissing(err)) return notReadyResponse();
    return pgErrorResponse(
      err,
      { route: 'POST /api/contact-imports/lookup', requestId: locals.requestId },
      { codes: { '42501': { status: 404, error: 'not_found' }, '22023': { status: 400, error: 'invalid_body' } } },
    );
  }
};
