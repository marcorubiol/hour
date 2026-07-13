/**
 * GET /api/expenses — expense rows for the Money surfaces (ADR-056).
 * Filter by line_ids and/or performance_ids (union). RLS hides whole rows
 * without read:money (there is no redacted view for expense — invisible,
 * not masked).
 *
 * POST /api/expenses — record an expense against a line or a performance
 * (exactly one). Goes through the `create_expense` RPC: the direct INSERT
 * is claim-bound — eighth case of the pattern. Gated on
 * has_permission(parent project, 'edit:money').
 *
 * Auth: Bearer JWT required.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { EXPENSE_CATEGORIES, ExpenseCreateSchema, type ExpenseItem } from '$lib/expense';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

const QuerySchema = v.object({
  line_ids: v.optional(v.string()),
  performance_ids: v.optional(v.string()),
  category: v.optional(
    v.union([v.literal('any'), v.picklist(EXPENSE_CATEGORIES)]),
    'any',
  ),
  limit: v.optional(
    v.pipe(
      v.string(),
      v.transform((n) => Number(n)),
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
  return [...new Set(raw.split(',').map((s) => s.trim()).filter((s) => UUID.test(s)))];
}

const EXPENSE_SELECT =
  'id,workspace_id,performance_id,line_id,category,description,amount,currency,incurred_on,reimbursed,notes,created_at';

export const GET: RequestHandler = async ({ request, url, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const rawParams = Object.fromEntries(url.searchParams.entries());
  const parsed = v.safeParse(QuerySchema, rawParams);
  if (!parsed.success) {
    return json(
      {
        error: 'invalid_query',
        issues: parsed.issues.map((i) => ({
          path: i.path?.map((p) => p.key).join('.'),
          message: i.message,
        })),
      },
      400,
    );
  }
  const { line_ids, performance_ids, category, limit } = parsed.output;
  const lineIds = parseUuidList(line_ids);
  const performanceIds = parseUuidList(performance_ids);
  if (lineIds.length === 0 && performanceIds.length === 0) {
    return json(
      { error: 'invalid_query', hint: 'Pass line_ids and/or performance_ids.' },
      400,
    );
  }

  const search = new URLSearchParams();
  search.set('select', EXPENSE_SELECT);
  if (lineIds.length > 0 && performanceIds.length > 0) {
    search.set(
      'or',
      `(line_id.in.(${lineIds.join(',')}),performance_id.in.(${performanceIds.join(',')}))`,
    );
  } else if (lineIds.length > 0) {
    search.set('line_id', `in.(${lineIds.join(',')})`);
  } else {
    search.set('performance_id', `in.(${performanceIds.join(',')})`);
  }
  if (category !== 'any') search.set('category', `eq.${category}`);
  search.set('deleted_at', 'is.null');
  search.set('order', 'incurred_on.desc,created_at.desc');
  search.set('limit', String(limit));

  try {
    const { data } = await pgGet<ExpenseItem>(env, 'expense', jwt, { search });
    return json({ items: data });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/expenses', requestId: locals.requestId },
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
  const parsed = v.safeParse(ExpenseCreateSchema, raw);
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
  const input = parsed.output;

  if (Boolean(input.line_id) === Boolean(input.performance_id)) {
    return json(
      { error: 'invalid_body', hint: 'Send exactly one of line_id or performance_id.' },
      400,
    );
  }

  try {
    const { data } = await pgPostRpc<ExpenseItem>(env, 'create_expense', jwt, {
      p_performance_id: input.performance_id ?? null,
      p_line_id: input.line_id ?? null,
      p_category: input.category,
      p_description: input.description,
      p_amount: input.amount,
      p_currency: input.currency,
      p_incurred_on: input.incurred_on ?? null,
      p_notes: input.notes ?? null,
    });
    if (data.length === 0 || !data[0]) return json({ error: 'create_failed' }, 502);
    return json({ expense: data[0] }, 201);
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'POST /api/expenses', requestId: locals.requestId },
      {
        codes: {
          '22023': { status: 400, error: 'invalid_input' },
          '42501': { status: 403, error: 'forbidden' },
        },
      },
    );
  }
};
