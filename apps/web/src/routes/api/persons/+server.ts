/**
 * POST /api/persons — { workspace_id, full_name, email?, phone?, title? }
 * via `create_workspace_person` (ADR-107): somebody of the team who is not a
 * conversation. Every person picker offers it as «Añadir "nombre"», so only
 * the name is required; the rest is filled later on the person's file.
 *
 * The RPC deduplicates by email inside the workspace (same email, same
 * dossier, returned as it is) and gates on `can_write_workspace_person`.
 *
 * Auth: Bearer JWT required.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import type { CreatedPerson } from '$lib/persons';

const BodySchema = v.object({
  workspace_id: v.pipe(v.string(), v.uuid()),
  full_name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
  email: v.nullish(v.pipe(v.string(), v.trim(), v.email(), v.maxLength(320))),
  phone: v.nullish(v.pipe(v.string(), v.trim(), v.maxLength(60))),
  title: v.nullish(v.pipe(v.string(), v.trim(), v.maxLength(200))),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const POST: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const parsed = v.safeParse(BodySchema, await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'invalid_body' }, 400);
  const b = parsed.output;

  try {
    const { data } = await pgPostRpc<CreatedPerson>(env, 'create_workspace_person', jwt, {
      p_workspace_id: b.workspace_id,
      p_full_name: b.full_name,
      p_email: b.email ?? null,
      p_phone: b.phone ?? null,
      p_title: b.title ?? null,
    });
    if (data.length === 0) return json({ error: 'create_failed' }, 502);
    return json({ person: data[0] }, 201);
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'POST /api/persons', requestId: locals.requestId },
      {
        codes: {
          '22023': { status: 400, error: 'invalid_input' },
          '42501': { status: 403, error: 'forbidden' },
        },
      },
    );
  }
};
