/**
 * GET  /api/payments — active payment rows by invoice or workspace/date window.
 * POST /api/payments — record an observed payment through the locking RPC.
 * Invoice paid/issued status is derived atomically by the database trigger.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { PaymentCreateSchema, type PaymentItem } from '$lib/money';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

const QuerySchema = v.object({
  invoice_id: v.optional(v.pipe(v.string(), v.uuid())),
  workspace_ids: v.optional(v.string()),
  from: v.optional(v.pipe(v.string(), v.isoDate())),
  to: v.optional(v.pipe(v.string(), v.isoDate())),
  limit: v.optional(
    v.pipe(
      v.string(),
      v.transform((value) => Number(value)),
      v.number(),
      v.integer(),
      v.minValue(1),
      v.maxValue(500),
    ),
    '200',
  ),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function parseUuidList(raw: string | undefined): string[] {
  if (!raw) return [];
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return [...new Set(raw.split(',').map((value) => value.trim()).filter((value) => UUID.test(value)))];
}

export const GET: RequestHandler = async ({ request, url, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const parsed = v.safeParse(QuerySchema, Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) return json({ error: 'invalid_query' }, 400);
  const { invoice_id, workspace_ids, from, to, limit } = parsed.output;
  const workspaceIds = parseUuidList(workspace_ids);
  if (!invoice_id && workspaceIds.length === 0) {
    return json({ error: 'invalid_query', hint: 'Pass invoice_id or workspace_ids.' }, 400);
  }

  const search = new URLSearchParams({
    select: 'id,workspace_id,invoice_id,amount,received_on,method,reference,notes,created_at',
    deleted_at: 'is.null',
    order: 'received_on.desc,created_at.desc',
    limit: String(limit),
  });
  if (invoice_id) search.set('invoice_id', `eq.${invoice_id}`);
  if (workspaceIds.length > 0) search.set('workspace_id', `in.(${workspaceIds.join(',')})`);
  if (from) search.set('received_on', `gte.${from}`);
  if (to) search.append('received_on', `lte.${to}`);

  try {
    const { data } = await pgGet<PaymentItem>(env, 'payment', jwt, { search });
    return json({ items: data });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/payments', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
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
  const parsed = v.safeParse(PaymentCreateSchema, raw);
  if (!parsed.success) {
    return json(
      {
        error: 'invalid_body',
        issues: parsed.issues.map((issue) => ({
          path: issue.path?.map((part) => part.key).join('.'),
          message: issue.message,
        })),
      },
      400,
    );
  }
  const input = parsed.output;

  try {
    const { data } = await pgPostRpc<PaymentItem>(env, 'create_payment', jwt, {
      p_invoice_id: input.invoice_id ?? null,
      p_amount: input.amount,
      p_received_on: input.received_on,
      p_method: input.method,
      p_reference: input.reference ?? null,
      p_notes: input.notes ?? null,
      p_performance_id: input.performance_id ?? null,
      p_line_id: input.line_id ?? null,
      p_project_id: input.project_id ?? null,
      p_counterparty: input.counterparty ?? null,
      p_category: input.category ?? null,
    });
    if (!data[0]) return json({ error: 'create_failed' }, 502);
    return json({ payment: data[0] }, 201);
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'POST /api/payments', requestId: locals.requestId },
      {
        codes: {
          '22023': { status: 400, error: 'invalid_input' },
          '42501': { status: 403, error: 'forbidden' },
        },
      },
    );
  }
};
