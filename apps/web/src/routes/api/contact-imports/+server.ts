/**
 * /api/contact-imports (138): importar contactos desde una hoja.
 *
 * GET ?workspace_id=…: las importaciones del espacio que quien llama ve (las
 *   suyas; todas si es owner o admin), las más recientes primero. Sin la
 *   migración, `{ items: [], absent: true }`.
 * POST { workspace_id, import_id, filename, rows }: las filas ya revisadas en
 *   el dispositivo, con el id de importación que da el cliente. Trocea en
 *   tandas de 200 por `import_contacts`, numeradas: una tanda ya escrita no se
 *   vuelve a escribir, así que reenviar (o el reintento de aquí tras un corte)
 *   no duplica. Las cifras salen de la fila de la importación. Si una tanda
 *   falla, las anteriores se quedan (`partial`) y se deshacen igual.
 *
 * Auth: Bearer JWT. 404 si el espacio no es tuyo para importar; 503
 * `not_ready` si la base aún no tiene la migración.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgGet, pgPostRpc, PostgrestError, type SupabaseEnv } from '$lib/supabase';
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
  const { workspace_id, import_id, filename, rows } = parsed.output;
  const parts = batches(rows);

  /** Una tanda; un corte de red o un 5xx se reintenta una vez: la base no la escribe dos veces. */
  const send = async (i: number, batch: (typeof parts)[number]) => {
    const args = {
      p_workspace_id: workspace_id,
      p_import_id: import_id,
      p_batch: i,
      p_filename: filename ?? null,
      p_row_count: rows.length,
      p_rows: batch,
      p_last: i === parts.length - 1,
    };
    try {
      return await pgPostRpc<BatchResult>(env, 'import_contacts', jwt, args);
    } catch (err) {
      if (err instanceof PostgrestError && err.status < 500) throw err;
      return await pgPostRpc<BatchResult>(env, 'import_contacts', jwt, args);
    }
  };

  let total: ContactImportResult = { ...EMPTY_RESULT, import_id };
  let written = false;
  for (const [i, batch] of parts.entries()) {
    try {
      const { data } = await send(i, batch);
      const r = data[0];
      if (!r) return json({ error: 'not_found' }, 404);
      total = addBatchResult(total, r);
      written = true;
    } catch (err) {
      // Lo de las tandas anteriores ya está escrito: se dice, no se pierde.
      if (written) return json(await withStoredTotals(total, true), 201);
      if (schemaMissing(err)) return notReadyResponse();
      return pgErrorResponse(
        err,
        { route: 'POST /api/contact-imports', requestId: locals.requestId },
        { codes: { '42501': { status: 404, error: 'not_found' }, '22023': { status: 400, error: 'invalid_import' } } },
      );
    }
  }
  return json(await withStoredTotals(total, false), 201);

  /**
   * Las cifras, de la fila de la importación: una tanda repetida (reintento)
   * devuelve ceros, y lo escrito la primera vez está ahí.
   */
  async function withStoredTotals(t: ContactImportResult, partial: boolean): Promise<ContactImportResult> {
    try {
      const { data } = await pgGet<Totals>(env, 'contact_import', jwt, {
        search: new URLSearchParams({ select: TOTALS, id: `eq.${import_id}`, limit: '1' }),
      });
      const row = data[0];
      return row ? { ...t, ...row, partial } : { ...t, partial };
    } catch {
      return { ...t, partial };
    }
  }
};

type BatchResult = Omit<ContactImportResult, 'partial'> & { repeated?: boolean };
const TOTALS = 'persons_created,persons_filled,organizations_created,organizations_filled,notes_created';
type Totals = Pick<ContactImportResult, 'persons_created' | 'persons_filled' | 'organizations_created' | 'organizations_filled' | 'notes_created'>;
