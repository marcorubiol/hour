/**
 * GET  /api/money/bolos — the deals feed for the Money lens (ADR-087). Reads
 *      through a SECURITY DEFINER RPC that returns rows only when the caller
 *      holds `read:money`. Authenticated users have no direct SELECT grant on
 *      the bolo fee, so custom PostgREST queries cannot bypass the money boundary.
 * POST /api/money/bolos — record a deal by hand (ADR-087: a bolo is born from a
 *      confirmed conversation OR created here). Via `create_bolo` (claim-bound,
 *      edit:money on the deal's project).
 *
 * One row per bolo (deal), with collected (payments-against-fee) and display
 * aids (function_count, next_performed_at). Union filters + optional performed
 * window, same contract as the other list endpoints.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

const QuerySchema = v.object({
  project_ids: v.optional(v.string()),
  workspace_ids: v.optional(v.string()),
  line_ids: v.optional(v.string()),
  from: v.optional(v.pipe(v.string(), v.isoDate())),
  to: v.optional(v.pipe(v.string(), v.isoDate())),
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

type MoneyBolo = {
  id: string;
  project_id: string;
  line_id: string | null;
  conversation_id: string | null;
  venue_name: string | null;
  city: string | null;
  country: string | null;
  fee_amount: number | null;
  fee_currency: string | null;
  status: string;
  project: {
    id: string;
    slug: string;
    name: string;
    accent: string | null;
    workspace_id: string;
  } | null;
  collected: number;
  function_count: number;
  next_performed_at: string | null;
};

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
  const { project_ids, workspace_ids, line_ids, from, to, limit } = parsed.output;
  const projectIds = parseUuidList(project_ids);
  const workspaceIds = parseUuidList(workspace_ids);
  const lineIds = parseUuidList(line_ids);

  try {
    const { data } = await pgPostRpc<MoneyBolo>(env, 'list_money_bolos', jwt, {
      p_project_ids: projectIds.length > 0 ? projectIds : null,
      p_workspace_ids: workspaceIds.length > 0 ? workspaceIds : null,
      p_line_ids: lineIds.length > 0 ? lineIds : null,
      p_from: from ?? null,
      p_to: to ?? null,
      p_limit: limit,
    });
    return json({ items: data });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/money/bolos', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};

const CreateSchema = v.object({
  project_id: v.pipe(v.string(), v.uuid()),
  venue_name: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(200)))),
  city: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(120)))),
  country: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.regex(/^[A-Za-z]{2}$/, 'ISO 3166 alpha-2')))),
  fee_amount: v.optional(v.nullable(v.pipe(v.number(), v.minValue(0), v.maxValue(9_999_999_999.99)))),
  fee_currency: v.optional(v.pipe(v.string(), v.regex(/^[A-Za-z]{3}$/, 'ISO 4217')), 'EUR'),
  line_id: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
  conversation_id: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
});

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
  const parsed = v.safeParse(CreateSchema, raw);
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

  try {
    const { data } = await pgPostRpc<Record<string, unknown>>(env, 'create_bolo', jwt, {
      p_project_id: input.project_id,
      p_venue_name: input.venue_name ?? null,
      p_city: input.city ?? null,
      p_country: input.country ? input.country.toUpperCase() : null,
      p_fee_amount: input.fee_amount ?? null,
      p_fee_currency: (input.fee_currency ?? 'EUR').toUpperCase(),
      p_line_id: input.line_id ?? null,
      p_conversation_id: input.conversation_id ?? null,
    });
    if (data.length === 0 || !data[0]) return json({ error: 'create_failed' }, 502);
    return json({ bolo: data[0] }, 201);
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'POST /api/money/bolos', requestId: locals.requestId },
      {
        codes: {
          '22023': { status: 400, error: 'invalid_input' },
          '42501': { status: 403, error: 'forbidden', hint: 'edit:money required.' },
        },
      },
    );
  }
};
