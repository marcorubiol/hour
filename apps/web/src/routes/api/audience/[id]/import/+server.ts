/**
 * POST /api/audience/[id]/import { filename, rows, basis_kind, source_note,
 * statement_accepted, statement_language } → ImportResult (plan § 3.6).
 *
 * La base y la fuente son obligatorias, y la declaración aceptada también:
 * sin ella, 400 aquí y la base ni se llama. `import_audience` salta y cuenta
 * lo que no entra; la primera importación del espacio queda en revisión.
 */

import type { RequestHandler } from './$types';
import { pgPostRpc } from '$lib/supabase';
import { jsonNoStore } from '$lib/server/http';
import { mailoutRoute, readBody } from '$lib/server/mailout/route';
import { ImportSchema, type ImportResult } from '$lib/audience';

export const POST: RequestHandler = (event) =>
  mailoutRoute(event, 'POST /api/audience/[id]/import', async ({ env, jwt, id }) => {
    const body = await readBody(event.request, ImportSchema);
    if (body instanceof Response) return body;
    const r = await pgPostRpc<ImportResult>(env, 'import_audience', jwt, {
      p_audience_id: id,
      p_filename: body.filename ?? null,
      p_rows: body.rows,
      p_basis_kind: body.basis_kind,
      p_source_note: body.source_note,
      p_statement_language: body.statement_language,
    });
    return jsonNoStore(r.data[0] ?? null);
  });
