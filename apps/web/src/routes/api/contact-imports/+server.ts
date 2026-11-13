/**
 * /api/contact-imports (138): importar contactos desde una hoja.
 *
 * GET ?workspace_id=…: las importaciones del espacio que quien llama ve (las
 *   suyas; todas si es owner o admin), las más recientes primero. Sin la
 *   migración, `{ items: [], absent: true }`.
 * POST { workspace_id, filename, rows }: las filas ya revisadas en el
 *   dispositivo. Trocea en tandas de 500 por `import_contacts`: la primera crea
 *   la importación y las siguientes la nombran; la última la da por hecha. Si
 *   una tanda falla, las anteriores se quedan (`partial`) y se deshacen igual.
 *
 * Auth: Bearer JWT. 404 si el espacio no es tuyo para importar; 503
 * `not_ready` si la base aún no tiene la migración.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { json, UUID_RE } from '$lib/server/http';
import { notReadyResponse, schemaMissing } from '$lib/server/contact-import';
import {
  addBatchResult,
  batches,
  CONTACT_IMPORT_SELECT,
  ContactImportRequestSchema,
  EMPTY_RESULT,
  type ContactImportItem,
  type ContactImportResult,
} from '$lib/contact-import';

export const GET: RequestHandler = async ({ url, request, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);
  const workspaceId = url.searchParams.get('workspace_id') ?? '';
  if (!UUID_RE.test(workspaceId)) return json({ error: 'invalid_workspace' }, 400);

  try {
    const { data } = await pgGet<ContactImportItem>(env, 'contact_import', jwt, {
      search: new URLSearchParams({
        select: CONTACT_IMPORT_SELECT,
        workspace_id: `eq.${workspaceId}`,
        order: 'created_at.desc',
        limit: '50',
      }),
    });
    return json({ items: data });
  } catch (err) {
    if (schemaMissing(err)) return json({ items: [], absent: true });
    return pgErrorResponse(err, { route: 'GET /api/contact-imports', requestId: locals.requestId });
  }
};

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
  const parsed = v.safeParse(ContactImportRequestSchema, raw);
  if (!parsed.success) {
    return json(
      { error: 'invalid_body', issues: parsed.issues.slice(0, 5).map((i) => ({ path: i.path?.map((p) => p.key).join('.'), message: i.message })) },
      400,
    );
  }
  const { workspace_id, filename, rows } = parsed.output;
  const parts = batches(rows);

  let total: ContactImportResult = { ...EMPTY_RESULT };
  for (const [i, batch] of parts.entries()) {
    try {
      const { data } = await pgPostRpc<Omit<ContactImportResult, 'partial'>>(env, 'import_contacts', jwt, {
        p_workspace_id: workspace_id,
        p_import_id: total.import_id,
        p_filename: filename ?? null,
        p_row_count: rows.length,
        p_rows: batch,
        p_last: i === parts.length - 1,
      });
      const r = data[0];
      if (!r) return json({ error: 'not_found' }, 404);
      total = addBatchResult(total, r);
    } catch (err) {
      // Lo de las tandas anteriores ya está escrito: se dice, no se pierde.
      if (total.import_id) return json({ ...total, partial: true }, 201);
      if (schemaMissing(err)) return notReadyResponse();
      return pgErrorResponse(
        err,
        { route: 'POST /api/contact-imports', requestId: locals.requestId },
        { codes: { '42501': { status: 404, error: 'not_found' }, '22023': { status: 400, error: 'invalid_import' } } },
      );
    }
  }
  return json(total, 201);
};
