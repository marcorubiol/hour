/**
 * GET  /api/invoices — invoice list for the Money lens (ADR-046). RLS
 *      gates rows on `read:money` (project invoices) or workspace
 *      owner/admin (workspace-level invoices).
 * POST /api/invoices — create a draft invoice FROM a bolo's fee (ADR-050 +
 *      ADR-087) via the `create_invoice_from_bolo` RPC (the direct INSERT is
 *      claim-bound — sixth case of the pattern). One line, amounts
 *      snapshot the fee + optional VAT/IRPF percentages.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import type { MoneyInvoiceItem } from '$lib/money';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

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

type InvoiceDbItem = Omit<MoneyInvoiceItem, 'payer' | 'paid_amount'> & {
  payer: {
    id: string;
    slug: string;
    full_name: string;
    organization: { name: string } | null;
  } | null;
};

export const GET: RequestHandler = async ({ request, url, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
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
  // lines embed (ADR-056 + ADR-087): invoice headers carry no line linkage —
  // the join path is invoice_line.bolo_id → bolo.line_id. The Money module
  // filters client-side on its line's bolo ids.
  search.set(
    'select',
    [
      'id,number,status,issued_on,due_on,subtotal,total,currency',
      'workspace_id,project_id,payer_person_id,expected_on,payment_condition,vat_pct,vat_amount,irpf_pct,irpf_amount,notes',
      'project:project_id(id,slug,name,workspace_id)',
      'payer:workspace_person!invoice_workspace_payer_person_fkey(id:person_id,slug,full_name,organization:workspace_organization!workspace_person_organization_fkey(name))',
      'lines:invoice_line(bolo_id)',
      'payments:payment!payment_invoice_id_fkey(id,workspace_id,invoice_id,amount,received_on,method,reference,notes,created_at)',
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
    const { data } = await pgGet<InvoiceDbItem>(env, 'invoice', jwt, { search });
    const items: MoneyInvoiceItem[] = data.map((item) => ({
      ...item,
      paid_amount: item.payments.reduce((sum, payment) => sum + Number(payment.amount), 0),
      payer: item.payer
        ? {
            id: item.payer.id,
            slug: item.payer.slug,
            full_name: item.payer.full_name,
            organization_name: item.payer.organization?.name ?? null,
          }
        : null,
    }));
    return json({ items });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/invoices', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};

const CreateSchema = v.object({
  bolo_id: v.pipe(v.string(), v.uuid()),
  vat_pct: v.optional(v.nullable(v.pipe(v.number(), v.minValue(0), v.maxValue(100)))),
  irpf_pct: v.optional(v.nullable(v.pipe(v.number(), v.minValue(0), v.maxValue(100)))),
  number: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(60)))),
  due_on: v.optional(v.nullable(v.pipe(v.string(), v.isoDate()))),
  expected_on: v.optional(v.nullable(v.pipe(v.string(), v.isoDate()))),
  payment_condition: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(2000)))),
  payer_person_id: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
  notes: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(2000)))),
  // Money v3 (ADR-086): factura|proforma; null lets the RPC derive it from the
  // workspace invoicing_mode. Optional receiver fiscal identity.
  doc_type: v.optional(v.nullable(v.picklist(['factura', 'proforma']))),
  payer_fiscal_identity_id: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
});

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
    const { data } = await pgPostRpc<Record<string, unknown>>(env, 'create_invoice_from_bolo', jwt, {
      p_bolo_id: input.bolo_id,
      p_vat_pct: input.vat_pct ?? null,
      p_irpf_pct: input.irpf_pct ?? null,
      p_number: input.number ?? null,
      p_due_on: input.due_on ?? null,
      p_notes: input.notes ?? null,
      p_expected_on: input.expected_on ?? null,
      p_payment_condition: input.payment_condition ?? null,
      p_payer_person_id: input.payer_person_id ?? null,
      p_doc_type: input.doc_type ?? null,
      p_payer_fiscal_identity_id: input.payer_fiscal_identity_id ?? null,
    });
    if (data.length === 0 || !data[0]) return json({ error: 'create_failed' }, 502);
    return json({ invoice: data[0] }, 201);
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'POST /api/invoices', requestId: locals.requestId },
      {
        codes: {
          '22023': { status: 400, error: 'invalid_input' },
          '42501': { status: 403, error: 'forbidden' },
        },
      },
    );
  }
};
