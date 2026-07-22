/**
 * GET /api/expenses — expense rows for the Money surfaces (ADR-056).
 * Filter by workspace/project/line/performance ids (union). RLS hides whole rows
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
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

const QuerySchema = v.object({
  project_ids: v.optional(v.string()),
  workspace_ids: v.optional(v.string()),
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
  const { project_ids, workspace_ids, line_ids, performance_ids, category, limit } = parsed.output;
  const projectIds = parseUuidList(project_ids);
  const workspaceIds = parseUuidList(workspace_ids);
  const lineIds = parseUuidList(line_ids);
  const performanceIds = parseUuidList(performance_ids);

  try {
    const { data } = await pgPostRpc<ExpenseItem>(env, 'list_expenses_for_scope', jwt, {
      p_project_ids: projectIds.length > 0 ? projectIds : null,
      p_workspace_ids: workspaceIds.length > 0 ? workspaceIds : null,
      p_line_ids: lineIds.length > 0 ? lineIds : null,
      p_performance_ids: performanceIds.length > 0 ? performanceIds : null,
      p_category: category === 'any' ? null : category,
      p_limit: limit,
    });
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
      p_counterparty: input.counterparty ?? null,
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
