/**
 * PATCH /api/expenses/:id — edit an expense's fields. Direct PostgREST
 * PATCH: expense_update RLS gates on edit:money and is NOT claim-bound,
 * and the row stays SELECT-visible after a field edit (ADR-048 only
 * bites soft-deletes). Whitelisted by ExpensePatchSchema.
 *
 * DELETE /api/expenses/:id — soft-delete via the `delete_expense` RPC
 * (ADR-048 rule: expense has no DELETE policy and a deleted_at PATCH
 * would 42501 by construction).
 *
 * Auth: Bearer JWT required.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractBearer } from '$lib/auth';
import { ExpensePatchSchema, type ExpenseItem } from '$lib/expense';
import { pgPatch, pgPostRpc, PostgrestError, type SupabaseEnv } from '$lib/supabase';

const IdSchema = v.pipe(v.string(), v.uuid());

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const PATCH: RequestHandler = async ({ request, params, platform }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractBearer(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const idParsed = v.safeParse(IdSchema, params.id);
  if (!idParsed.success) return json({ error: 'invalid_id' }, 400);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }

  const parsed = v.safeParse(ExpensePatchSchema, raw);
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
  if (Object.keys(patch).length === 0) {
    return json({ error: 'empty_patch' }, 400);
  }

  const search = new URLSearchParams();
  search.set('id', `eq.${idParsed.output}`);
  search.set('deleted_at', 'is.null');

  try {
    const { data } = await pgPatch<ExpenseItem>(env, 'expense', jwt, patch, { search });
    if (data.length === 0) return json({ error: 'not_found' }, 404);
    return json({ expense: data[0] });
  } catch (err) {
    if (err instanceof PostgrestError) {
      // 23514 = amount/currency CHECK violation.
      if (err.code === '23514') {
        return json({ error: 'constraint_violation', detail: err.body }, 400);
      }
      const upstream = err.status === 401 || err.status === 403 ? err.status : 502;
      return json(
        { error: 'postgrest_error', status: err.status, detail: err.body },
        upstream,
      );
    }
    return json({ error: 'unexpected', detail: String(err) }, 500);
  }
};

export const DELETE: RequestHandler = async ({ request, params, platform }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractBearer(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const idParsed = v.safeParse(IdSchema, params.id);
  if (!idParsed.success) return json({ error: 'invalid_id' }, 400);

  try {
    await pgPostRpc(env, 'delete_expense', jwt, { p_expense_id: idParsed.output });
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof PostgrestError) {
      // 42501 collapses not-found and no-permission → 404 (no oracle).
      if (err.code === '42501') return json({ error: 'not_found' }, 404);
      const upstream = err.status === 401 ? 401 : 502;
      return json({ error: 'postgrest_error', status: err.status, detail: err.body }, upstream);
    }
    return json({ error: 'unexpected', detail: String(err) }, 500);
  }
};
