/**
 * PATCH /api/money/bolos/:id — set or clear a bolo's fee (ADR-087). The fee is
 * negotiated per deal and lives on the bolo; it stays in the Money lens by
 * design. The `update_bolo_fee` RPC requires `edit:money`; callers never
 * receive direct SELECT access to the fee.
 *
 * Body: { fee_amount: number|null, fee_currency?: 'EUR'-style code }.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
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

  try {
    const { data } = await pgPostRpc<{
      id: string;
      fee_amount: number | null;
      fee_currency: string | null;
    }>(env, 'update_bolo_fee', jwt, {
      p_bolo_id: idParsed.output,
      p_fee_amount: fee_amount,
      p_fee_currency: (fee_currency ?? 'EUR').toUpperCase(),
    });
    if (data.length === 0) return json({ error: 'not_found' }, 404);
    return json({ bolo: data[0] });
  } catch (err) {
    // update_bolo_fee RAISEs 42501 without edit:money.
    return pgErrorResponse(
      err,
      { route: 'PATCH /api/money/bolos/[id]', requestId: locals.requestId },
      {
        codes: {
          '42501': { status: 403, error: 'forbidden', hint: 'edit:money required.' },
          'P0001': { status: 403, error: 'forbidden', hint: 'edit:money required.' },
          '22023': { status: 400, error: 'invalid_input' },
        },
        passUpstream: [401, 403],
      },
    );
  }
};
