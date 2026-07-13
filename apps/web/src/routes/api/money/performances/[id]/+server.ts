/**
 * PATCH /api/money/performances/:id — set or clear a performance's fee
 * (ADR-046). Fee lives in the Money lens by design: ADR-043 deliberately
 * excluded fee columns from the performance write path. The DB trigger
 * `guard_show_fee_columns` enforces `edit:money` on top of the RLS
 * UPDATE policy (`edit:show`) — a 42501 from the trigger maps to 403.
 *
 * Body: { fee_amount: number|null, fee_currency?: 'EUR'-style code }.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPatch, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

const BodySchema = v.object({
  fee_amount: v.nullable(
    v.pipe(v.number(), v.minValue(0), v.maxValue(9_999_999_999.99)),
  ),
  fee_currency: v.optional(v.pipe(v.string(), v.regex(/^[A-Za-z]{3}$/, 'ISO 4217'))),
});

const IdSchema = v.pipe(v.string(), v.uuid());

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
  const parsed = v.safeParse(BodySchema, raw);
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
  const { fee_amount, fee_currency } = parsed.output;

  const search = new URLSearchParams();
  search.set('id', `eq.${idParsed.output}`);
  search.set('deleted_at', 'is.null');
  search.set('select', 'id,fee_amount,fee_currency');

  try {
    const { data } = await pgPatch<{
      id: string;
      fee_amount: number | null;
      fee_currency: string | null;
    }>(env, 'performance', jwt, {
      fee_amount,
      fee_currency: (fee_currency ?? 'EUR').toUpperCase(),
    }, { search });
    if (data.length === 0) return json({ error: 'not_found' }, 404);
    return json({ performance: data[0] });
  } catch (err) {
    // The fee-guard trigger RAISEs 42501 (or P0001) without edit:money.
    return pgErrorResponse(
      err,
      { route: 'PATCH /api/money/performances/[id]', requestId: locals.requestId },
      {
        codes: {
          '42501': { status: 403, error: 'forbidden', hint: 'edit:money required.' },
          'P0001': { status: 403, error: 'forbidden', hint: 'edit:money required.' },
        },
        passUpstream: [401, 403],
      },
    );
  }
};
