/**
 * PATCH  /api/invoices/:id — lifecycle + metadata edits (ADR-050):
 *        status (draft/cancelled), due_on, expected_on, payment_condition,
 *        payer_person_id, notes. Amounts are NOT editable — an invoice's
 *        numbers are a snapshot; wrong amounts mean delete the draft (or
 *        cancel) and re-create.
 *
 *        Two RPCs, no direct UPDATE (hardening audit 2026-07-24): the money
 *        tables no longer grant writes to `authenticated`, because a direct
 *        PATCH could set status:'issued' with a hand-written `number`, forging
 *        a fiscal correlative that never went through the atomic series and
 *        leaving the issuer/payer snapshots empty.
 *          · status:'issued' → `issue_invoice` (assigns the correlative through
 *            next_invoice_number and freezes the fiscal snapshots)
 *          · everything else → `update_invoice` (whitelisted metadata patch)
 * DELETE /api/invoices/:id — discard a DRAFT via the `delete_invoice`
 *        RPC (client-direct soft-deletes are impossible, ADR-048).
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

const IdSchema = v.pipe(v.string(), v.uuid());

const PatchSchema = v.object({
  status: v.optional(v.picklist(['draft', 'issued', 'cancelled'])),
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
  const { status, ...metadata } = parsed.output;
  if (status === undefined && Object.keys(metadata).length === 0) {
    return json({ error: 'empty_patch' }, 400);
  }

  try {
    // Metadata first, so a combined patch doesn't issue an invoice and then
    // fail half-applied on a bad field.
    let invoice: Record<string, unknown> | undefined;
    if (Object.keys(metadata).length > 0) {
      const { data } = await pgPostRpc<Record<string, unknown>>(env, 'update_invoice', jwt, {
        p_invoice_id: idParsed.output,
        p_patch: metadata,
      });
      invoice = data[0];
    }

    if (status === 'issued') {
      const { data } = await pgPostRpc<Record<string, unknown>>(env, 'issue_invoice', jwt, {
        p_invoice_id: idParsed.output,
      });
      invoice = data[0];
    } else if (status !== undefined) {
      const { data } = await pgPostRpc<Record<string, unknown>>(env, 'update_invoice', jwt, {
        p_invoice_id: idParsed.output,
        p_patch: { status },
      });
      invoice = data[0];
    }

    if (!invoice) return json({ error: 'not_found' }, 404);
    return json({ invoice });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'PATCH /api/invoices/[id]', requestId: locals.requestId },
      {
        codes: {
          '22023': { status: 400, error: 'invalid_input' },
          '42501': { status: 403, error: 'forbidden_or_not_found' },
        },
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
