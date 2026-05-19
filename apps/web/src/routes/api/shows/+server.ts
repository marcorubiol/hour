/**
 * GET /api/shows
 *
 * Lists shows of a project (and optionally a specific line). Caller passes
 * `?project_id=<uuid>` to get all shows; add `?line_id=<uuid>` to narrow to
 * one line. RoomStructure uses the project-level call and groups client-side
 * to avoid N+1 fetches across lines.
 *
 * Embeds `venue` so sidebar can render `<city · date>` without a second
 * round-trip. Embedding is nullable — shows can have venue_id NULL with a
 * denormalized venue_name; the client decides which to display.
 *
 * RLS scopes by workspace membership (ADR-029). No `current_workspace_id`
 * claim needed.
 *
 * Auth: Bearer JWT required. RLS denies anon.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractBearer } from '$lib/auth';
import { pgGet, PostgrestError, type SupabaseEnv } from '$lib/supabase';

const ALLOWED_STATUSES = [
  'any',
  'proposed',
  'hold',
  'hold_1',
  'hold_2',
  'hold_3',
  'confirmed',
  'done',
  'invoiced',
  'paid',
  'cancelled',
] as const;

const QuerySchema = v.object({
  project_id: v.pipe(v.string(), v.uuid()),
  line_id: v.optional(v.pipe(v.string(), v.uuid())),
  status: v.optional(v.picklist(ALLOWED_STATUSES), 'any'),
  limit: v.optional(
    v.pipe(
      v.string(),
      v.transform((n) => Number(n)),
      v.number(),
      v.integer(),
      v.minValue(1),
      v.maxValue(200),
    ),
    '100',
  ),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

type VenueLite = {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
};

type ShowItem = {
  id: string;
  slug: string | null;
  performed_at: string; // ISO date
  status: string;
  venue_id: string | null;
  venue_name: string | null;
  city: string | null;
  country: string | null;
  project_id: string;
  line_id: string | null;
  engagement_id: string | null;
  fee_amount: number | null;
  fee_currency: string | null;
  load_in_at: string | null;
  show_start_at: string | null;
  venue: VenueLite | null;
};

export const GET: RequestHandler = async ({ request, url, platform }) => {
  if (!platform?.env) {
    return json({ error: 'platform_unavailable' }, 500);
  }
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractBearer(request);
  if (!jwt) {
    return json(
      {
        error: 'missing_authorization',
        hint: 'Send Authorization: Bearer <supabase_jwt>.',
      },
      401,
    );
  }

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
  const { project_id, line_id, status, limit } = parsed.output;

  const search = new URLSearchParams();
  search.set(
    'select',
    [
      'id,slug,performed_at,status,venue_id,venue_name,city,country',
      'project_id,line_id,engagement_id',
      'fee_amount,fee_currency,load_in_at,show_start_at',
      'venue:venue_id(id,name,city,country)',
    ].join(','),
  );
  search.set('project_id', `eq.${project_id}`);
  if (line_id) search.set('line_id', `eq.${line_id}`);
  search.set('deleted_at', 'is.null');
  if (status !== 'any') search.set('status', `eq.${status}`);
  search.set('order', 'performed_at.asc.nullslast');
  search.set('limit', String(limit));

  try {
    const { data } = await pgGet<ShowItem>(env, 'show', jwt, { search });
    return json({ items: data });
  } catch (err) {
    if (err instanceof PostgrestError) {
      const upstream = err.status === 401 || err.status === 403 ? err.status : 502;
      return json(
        { error: 'postgrest_error', status: err.status, detail: err.body },
        upstream,
      );
    }
    return json({ error: 'unexpected', detail: String(err) }, 500);
  }
};
