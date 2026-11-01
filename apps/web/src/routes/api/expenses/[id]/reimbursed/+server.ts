/**
 * POST /api/expenses/:id/reimbursed: { reimbursed, on? } via
 * `set_expense_reimbursed` (79, ADR-170): an advance given back to who paid
 * it, with its day (today if none), or unmarked (the day goes with it). The
 * RPC gates on `edit:money` over the expense's project and answers 42501
 * alike for «missing» and «not yours».
 *
 * Auth: Bearer JWT required.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { ExpenseReimbursedSchema, type ExpenseItem } from '$lib/expense';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { json, UUID_RE } from '$lib/server/http';

export const POST: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);
  if (!UUID_RE.test(params.id)) return json({ error: 'invalid_id' }, 400);

  const parsed = v.safeParse(ExpenseReimbursedSchema, await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'invalid_body' }, 400);

  try {
    const { data } = await pgPostRpc<ExpenseItem>(env, 'set_expense_reimbursed', jwt, {
      p_expense_id: params.id,
      p_reimbursed: parsed.output.reimbursed,
      p_on: parsed.output.on ?? null,
    });
    if (!data[0]) return json({ error: 'not_found' }, 404);
    return json({ expense: data[0] });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'POST /api/expenses/[id]/reimbursed', requestId: locals.requestId },
      {
        codes: {
          '22023': { status: 400, error: 'invalid_input' },
          '42501': { status: 404, error: 'not_found' },
        },
      },
    );
  }
};
