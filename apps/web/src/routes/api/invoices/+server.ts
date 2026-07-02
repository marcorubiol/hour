/**
 * GET  /api/invoices — invoice list for the Money lens (ADR-046). RLS
 *      gates rows on `read:money` (project invoices) or workspace
 *      owner/admin (workspace-level invoices).
 * POST /api/invoices — create a draft invoice FROM a performance's fee
 *      (ADR-050) via the `create_invoice` RPC (the direct INSERT is
 *      claim-bound — sixth case of the pattern). One line, amounts
 *      snapshot the fee + optional VAT/IRPF percentages.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractBearer } from '$lib/auth';
import { pgGet, pgPostRpc, PostgrestError, type SupabaseEnv } from '$lib/supabase';

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

const CreateSchema = v.object({
  performance_id: v.pipe(v.string(), v.uuid()),
  vat_pct: v.optional(v.nullable(v.pipe(v.number(), v.minValue(0), v.maxValue(100)))),
  irpf_pct: v.optional(v.nullable(v.pipe(v.number(), v.minValue(0), v.maxValue(100)))),
  number: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(60)))),
  due_on: v.optional(v.nullable(v.pipe(v.string(), v.isoDate()))),
  notes: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(2000)))),
});

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
    const { data } = await pgPostRpc<Record<string, unknown>>(env, 'create_invoice', jwt, {
      p_performance_id: input.performance_id,
      p_vat_pct: input.vat_pct ?? null,
      p_irpf_pct: input.irpf_pct ?? null,
      p_number: input.number ?? null,
      p_due_on: input.due_on ?? null,
      p_notes: input.notes ?? null,
    });
    if (data.length === 0 || !data[0]) return json({ error: 'create_failed' }, 502);
    return json({ invoice: data[0] }, 201);
  } catch (err) {
    if (err instanceof PostgrestError) {
      // 22023 carries actionable hints ("performance has no fee").
      if (err.code === '22023') return json({ error: 'invalid_input', detail: err.body }, 400);
      if (err.code === '42501') return json({ error: 'forbidden' }, 403);
      const upstream = err.status === 401 ? 401 : 502;
      return json({ error: 'postgrest_error', status: err.status, detail: err.body }, upstream);
    }
    return json({ error: 'unexpected', detail: String(err) }, 500);
  }
};
