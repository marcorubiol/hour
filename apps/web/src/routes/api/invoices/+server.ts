/**
 * GET /api/invoices — read-only invoice list for the Money lens
 * (ADR-046). RLS gates rows on `read:money` (project invoices) or
 * workspace owner/admin (workspace-level invoices). Creation/editing is
 * Phase 0.5 — this is the "the lens exists and the data path works"
 * slice.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractBearer } from '$lib/auth';
import { pgGet, PostgrestError, type SupabaseEnv } from '$lib/supabase';

const QuerySchema = v.object({
  project_ids: v.optional(v.string()),
  workspace_ids: v.optional(v.string()),
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

function parseUuidList(raw: string | undefined): string[] {
  if (!raw) return [];
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return [...new Set(raw.split(',').map((s) => s.trim()).filter((s) => UUID.test(s)))];
}

type InvoiceItem = {
  id: string;
  number: string | null;
  status: string;
  issued_on: string;
  due_on: string | null;
  subtotal: number;
  total: number;
  currency: string;
  project: { id: string; slug: string; name: string } | null;
  payer: { id: string; slug: string; full_name: string; organization_name: string | null } | null;
};

export const GET: RequestHandler = async ({ request, url, platform }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractBearer(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const rawParams = Object.fromEntries(url.searchParams.entries());
  const parsed = v.safeParse(QuerySchema, rawParams);
  if (!parsed.success) {
    return json({ error: 'invalid_query' }, 400);
  }
  const { project_ids, workspace_ids, limit } = parsed.output;
  const projectIds = parseUuidList(project_ids);
  const workspaceIds = parseUuidList(workspace_ids);

  const search = new URLSearchParams();
  search.set(
    'select',
    [
      'id,number,status,issued_on,due_on,subtotal,total,currency',
      'project:project_id(id,slug,name)',
      'payer:payer_person_id(id,slug,full_name,organization_name)',
    ].join(','),
  );

  if (projectIds.length > 0 && workspaceIds.length > 0) {
    search.set(
      'or',
      `(project_id.in.(${projectIds.join(',')}),workspace_id.in.(${workspaceIds.join(',')}))`,
    );
  } else if (projectIds.length > 0) {
    search.set('project_id', `in.(${projectIds.join(',')})`);
  } else if (workspaceIds.length > 0) {
    search.set('workspace_id', `in.(${workspaceIds.join(',')})`);
  }

  search.set('deleted_at', 'is.null');
  search.set('order', 'issued_on.desc');
  search.set('limit', String(limit));

  try {
    const { data } = await pgGet<InvoiceItem>(env, 'invoice', jwt, { search });
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
