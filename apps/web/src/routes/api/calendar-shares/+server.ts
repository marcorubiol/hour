/**
 * Calendar feed links (ADR-054). A share pins a WORKSPACE; the token
 * opens `/api/public/calendar/:token` with no account. Management is
 * RPC-only — `calendar_share` is deny-all even for authenticated, so the
 * token never travels through PostgREST table reads; all RPCs gate on
 * accepted workspace membership.
 *
 * GET  ?workspace_id= → active feed links for the workspace.
 * POST { workspace_id } → 201 with the new share.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractBearer } from '$lib/auth';
import { pgPostRpc, PostgrestError, type SupabaseEnv } from '$lib/supabase';

const BodySchema = v.object({
  workspace_id: v.pipe(v.string(), v.uuid()),
});

type ShareRow = {
  id: string;
  token: string;
  workspace_id: string;
  created_at: string;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function mapShare(s: ShareRow) {
  return {
    id: s.id,
    token: s.token,
    workspace_id: s.workspace_id,
    created_at: s.created_at,
  };
}

function mapError(err: unknown): Response {
  if (err instanceof PostgrestError) {
    // "workspace not found" and "not a member" both surface as 42501 —
    // indistinguishable by design.
    if (err.code === '42501') return json({ error: 'forbidden_or_not_found' }, 403);
    if (err.code === '22023') return json({ error: 'invalid_input', detail: err.body }, 400);
    const upstream = err.status === 401 ? 401 : 502;
    return json({ error: 'postgrest_error', status: err.status, detail: err.body }, upstream);
  }
  return json({ error: 'unexpected', detail: String(err) }, 500);
}

export const GET: RequestHandler = async ({ request, url, platform }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractBearer(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const wsId = url.searchParams.get('workspace_id') ?? '';
  const parsed = v.safeParse(v.pipe(v.string(), v.uuid()), wsId);
  if (!parsed.success) return json({ error: 'invalid_workspace_id' }, 400);

  try {
    const { data } = await pgPostRpc<ShareRow>(env, 'list_calendar_shares', jwt, {
      p_workspace_id: wsId,
    });
    return json({ items: data.filter(Boolean).map(mapShare) });
  } catch (err) {
    return mapError(err);
  }
};

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractBearer(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(BodySchema, raw);
  if (!parsed.success) return json({ error: 'invalid_body' }, 400);

  try {
    const { data } = await pgPostRpc<ShareRow>(env, 'create_calendar_share', jwt, {
      p_workspace_id: parsed.output.workspace_id,
    });
    if (data.length === 0 || !data[0]) return json({ error: 'create_failed' }, 502);
    return json({ share: mapShare(data[0]) }, 201);
  } catch (err) {
    return mapError(err);
  }
};
