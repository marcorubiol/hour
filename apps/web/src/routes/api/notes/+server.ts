/**
 * /api/notes — the private post-it (ADR-093), as the margin reads and
 * writes it.
 *
 * GET  ?from=YYYY-MM-DD&to=YYYY-MM-DD — MY notes across the day range,
 *      every workspace I am a member of at once. RLS is the filter
 *      (`note_select`: author + member), so there is nothing to scope here:
 *      the diary spans workspaces and so does its margin.
 * POST { body, on_day, …one optional anchor, workspace_id? } — through the
 *      `create_note` RPC (the direct INSERT policy is claim-bound, and the
 *      workspace is DERIVED from the anchor — only an anchorless or
 *      person-anchored note names one).
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

const NOTE_SELECT =
  'id,workspace_id,author_id,project_id,line_id,performance_id,date_id,person_id,on_day,body,created_at,updated_at';

const BodySchema = v.object({
  body: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(4000)),
  on_day: v.pipe(v.string(), v.isoDate()),
  workspace_id: v.optional(v.pipe(v.string(), v.uuid())),
  project_id: v.optional(v.pipe(v.string(), v.uuid())),
  line_id: v.optional(v.pipe(v.string(), v.uuid())),
  performance_id: v.optional(v.pipe(v.string(), v.uuid())),
  date_id: v.optional(v.pipe(v.string(), v.uuid())),
  person_id: v.optional(v.pipe(v.string(), v.uuid())),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export const GET: RequestHandler = async ({ url, request, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  if (!ISO_DAY.test(from) || !ISO_DAY.test(to) || to < from) {
    return json({ error: 'invalid_range' }, 400);
  }

  try {
    const search = new URLSearchParams({
      select: NOTE_SELECT,
      on_day: `gte.${from}`,
      deleted_at: 'is.null',
      order: 'on_day.asc,created_at.asc',
    });
    search.append('on_day', `lte.${to}`);
    const { data } = await pgGet(env, 'note', jwt, { search });
    return json({ items: data });
  } catch (err) {
    return pgErrorResponse(err, { route: 'GET /api/notes', requestId: locals.requestId });
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
  const parsed = v.safeParse(BodySchema, raw);
  if (!parsed.success) {
    return json(
      {
        error: 'invalid_body',
        issues: parsed.issues.map((i) => ({
          path: i.path?.map((pp) => pp.key).join('.'),
          message: i.message,
        })),
      },
      400,
    );
  }
  const input = parsed.output;

  try {
    const { data } = await pgPostRpc(env, 'create_note', jwt, {
      p_body: input.body,
      p_on_day: input.on_day,
      p_workspace_id: input.workspace_id ?? null,
      p_project_id: input.project_id ?? null,
      p_line_id: input.line_id ?? null,
      p_performance_id: input.performance_id ?? null,
      p_date_id: input.date_id ?? null,
      p_person_id: input.person_id ?? null,
    });
    if (data.length === 0) return json({ error: 'create_failed' }, 502);
    return json({ note: data[0] }, 201);
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'POST /api/notes', requestId: locals.requestId },
      {
        codes: {
          '22023': { status: 400, error: 'invalid_input' },
          '42501': { status: 403, error: 'forbidden' },
        },
      },
    );
  }
};
