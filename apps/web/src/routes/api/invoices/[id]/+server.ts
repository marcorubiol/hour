/**
 * PATCH  /api/invoices/:id — lifecycle + metadata edits (ADR-050):
 *        status (draft → issued → paid, cancelled from anywhere), number,
 *        due_on, notes. Amounts are NOT editable — an invoice's numbers
 *        are a snapshot; wrong amounts mean delete the draft (or cancel)
 *        and re-create. Direct PostgREST UPDATE: the invoice_update
 *        policy gates on edit:money (not claim-bound), so no RPC needed.
 * DELETE /api/invoices/:id — discard a DRAFT via the `delete_invoice`
 *        RPC (client-direct soft-deletes are impossible, ADR-048).
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPatch, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

const IdSchema = v.pipe(v.string(), v.uuid());

const PatchSchema = v.object({
  status: v.optional(v.picklist(['draft', 'issued', 'cancelled'])),
  number: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(60)))),
  due_on: v.optional(v.nullable(v.pipe(v.string(), v.isoDate()))),
  expected_on: v.optional(v.nullable(v.pipe(v.string(), v.isoDate()))),
  payment_condition: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(2000)))),
  payer_person_id: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
  notes: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(2000)))),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const PATCH: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const idParsed = v.safeParse(IdSchema, params.id);
  if (!idParsed.success) return json({ error: 'invalid_id' }, 400);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(PatchSchema, raw);
  if (!parsed.success) {
    return json(
      {
        error: 'invalid_body',
        issues: parsed.issues.map((i) => ({
          path: i.path?.map((p) => p.key).join('.'),
          message: i.message,
        })),
      },
      400,
    );
  }
  const patch = parsed.output;
  if (Object.keys(patch).length === 0) return json({ error: 'empty_patch' }, 400);

  const search = new URLSearchParams();
  search.set('id', `eq.${idParsed.output}`);
  search.set('deleted_at', 'is.null');
  search.set(
    'select',
    'id,workspace_id,project_id,payer_person_id,number,status,issued_on,due_on,expected_on,payment_condition,subtotal,vat_pct,vat_amount,irpf_pct,irpf_amount,total,currency,notes',
  );

  try {
    const { data } = await pgPatch<Record<string, unknown>>(env, 'invoice', jwt, patch, {
      search,
    });
    if (data.length === 0) return json({ error: 'not_found' }, 404);
    return json({ invoice: data[0] });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'PATCH /api/invoices/[id]', requestId: locals.requestId },
      {
        codes: { '22023': { status: 400, error: 'invalid_input' } },
        passUpstream: [401, 403],
      },
    );
  }
};

export const DELETE: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const idParsed = v.safeParse(IdSchema, params.id);
  if (!idParsed.success) return json({ error: 'invalid_id' }, 400);

  try {
    await pgPostRpc(env, 'delete_invoice', jwt, { p_invoice_id: idParsed.output });
    return new Response(null, { status: 204 });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'DELETE /api/invoices/[id]', requestId: locals.requestId },
      {
        codes: {
          '22023': { status: 409, error: 'not_draft' },
          '42501': { status: 403, error: 'forbidden_or_not_found' },
        },
      },
    );
  }
};
