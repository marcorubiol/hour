/**
 * GET /api/money/quarter?year=&q=&project_ids=&workspace_ids= — what the
 * gestoría export needs for one quarter (ADR-168): the facturas issued in it
 * (proformas never: not fiscal) and the payments received in it. Read with
 * the caller's JWT, so RLS is the gate: invoices and payments come back only
 * with read:money. The CSV itself is written in the browser
 * (`$lib/quarter-export`), in the person's language.
 *
 * The client and its NIF are the ones frozen on the factura when it was
 * issued (`payer_snapshot`); a factura without one falls back to the
 * organization's live fiscal data, then to its name.
 *
 * Scope is the same union as the other money feeds. A payment anchored to a
 * fee carries no project of its own, so with projects in the scope the
 * payments are read for the quarter and kept when their project (own, the
 * bolo's or the invoice's) or their space is in it.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgGet, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { jsonNoStore } from '$lib/server/http';
import { quarterRange, type QuarterData, type QuarterTaxLine } from '$lib/quarter-export';

const QuerySchema = v.object({
  year: v.pipe(v.string(), v.regex(/^\d{4}$/), v.transform(Number)),
  q: v.pipe(v.string(), v.picklist(['1', '2', '3', '4']), v.transform((x) => Number(x) as 1 | 2 | 3 | 4)),
  project_ids: v.optional(v.string()),
  workspace_ids: v.optional(v.string()),
});

const ROW_CAP = 2000;

function parseUuidList(raw: string | undefined): string[] {
  if (!raw) return [];
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return [...new Set(raw.split(',').map((s) => s.trim()).filter((s) => UUID.test(s)))];
}

type Snapshot = { legal_name?: string | null; tax_id?: string | null } | null;
type PayerEmbed = { name: string; fiscal: { legal_name: string | null; tax_id: string | null } | null } | null;

type InvoiceRow = {
  id: string;
  number: string | null;
  status: string;
  issued_on: string;
  subtotal: number;
  total: number;
  currency: string;
  payer_snapshot: Snapshot;
  payer: PayerEmbed;
  tax_lines: QuarterTaxLine[];
  payments: { amount: number; received_on: string; deleted_at: string | null }[];
};

type PaymentRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  amount: number;
  received_on: string;
  counterparty: string | null;
  bolo: { project_id: string; venue_name: string | null; fee_currency: string | null } | null;
  invoice: {
    number: string | null;
    doc_type: string;
    project_id: string | null;
    currency: string;
    payer_snapshot: Snapshot;
    payer: PayerEmbed;
  } | null;
};

const PAYER_EMBED =
  'payer:workspace_organization!invoice_workspace_payer_organization_fkey(name,fiscal:fiscal_identity!workspace_organization_fiscal_identity_id_fkey(legal_name,tax_id))';

function party(snapshot: Snapshot, payer: PayerEmbed): { client: string | null; tax_id: string | null } {
  const name = (x: string | null | undefined) => (x && x.trim() ? x.trim() : null);
  return {
    client: name(snapshot?.legal_name) ?? name(payer?.fiscal?.legal_name) ?? name(payer?.name),
    tax_id: name(snapshot?.tax_id) ?? name(payer?.fiscal?.tax_id),
  };
}

export const GET: RequestHandler = async ({ request, url, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);

  const parsed = v.safeParse(QuerySchema, Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) return jsonNoStore({ error: 'invalid_query' }, 400);
  const { year, q } = parsed.output;
  const projectIds = parseUuidList(parsed.output.project_ids);
  const workspaceIds = parseUuidList(parsed.output.workspace_ids);
  const { from, to } = quarterRange({ year, q });

  const invoiceSearch = new URLSearchParams({
    select: [
      'id,number,status,issued_on,subtotal,total,currency,payer_snapshot',
      PAYER_EMBED,
      'tax_lines:invoice_tax_line(kind,rate_pct,base_amount,amount)',
      'payments:payment!payment_invoice_id_fkey(amount,received_on,deleted_at)',
    ].join(','),
    doc_type: 'eq.factura',
    status: 'in.(issued,paid,cancelled)',
    deleted_at: 'is.null',
    order: 'issued_on.asc,number.asc',
    limit: String(ROW_CAP),
  });
  invoiceSearch.append('issued_on', `gte.${from}`);
  invoiceSearch.append('issued_on', `lte.${to}`);
  if (projectIds.length > 0 && workspaceIds.length > 0) {
    invoiceSearch.set('or', `(project_id.in.(${projectIds.join(',')}),workspace_id.in.(${workspaceIds.join(',')}))`);
  } else if (projectIds.length > 0) {
    invoiceSearch.set('project_id', `in.(${projectIds.join(',')})`);
  } else if (workspaceIds.length > 0) {
    invoiceSearch.set('workspace_id', `in.(${workspaceIds.join(',')})`);
  }

  const paymentSearch = new URLSearchParams({
    select: [
      'id,workspace_id,project_id,amount,received_on,counterparty',
      'bolo:bolo_id(project_id,venue_name,fee_currency)',
      `invoice:invoice!payment_invoice_id_fkey(number,doc_type,project_id,currency,payer_snapshot,${PAYER_EMBED})`,
    ].join(','),
    deleted_at: 'is.null',
    order: 'received_on.asc',
    limit: String(ROW_CAP),
  });
  paymentSearch.append('received_on', `gte.${from}`);
  paymentSearch.append('received_on', `lte.${to}`);
  if (projectIds.length === 0 && workspaceIds.length > 0) {
    paymentSearch.set('workspace_id', `in.(${workspaceIds.join(',')})`);
  }

  try {
    const [invoices, payments] = await Promise.all([
      pgGet<InvoiceRow>(env, 'invoice', jwt, { search: invoiceSearch }),
      pgGet<PaymentRow>(env, 'payment', jwt, { search: paymentSearch }),
    ]);

    const inScope = (p: PaymentRow): boolean => {
      if (projectIds.length === 0 && workspaceIds.length === 0) return true;
      if (workspaceIds.includes(p.workspace_id)) return true;
      const project = p.project_id ?? p.bolo?.project_id ?? p.invoice?.project_id ?? null;
      return project !== null && projectIds.includes(project);
    };

    const body: QuarterData & { capped: boolean } = {
      invoices: invoices.data.map((inv) => ({
        id: inv.id,
        number: inv.number,
        status: inv.status,
        issued_on: inv.issued_on,
        subtotal: Number(inv.subtotal),
        total: Number(inv.total),
        currency: inv.currency,
        ...party(inv.payer_snapshot, inv.payer),
        tax_lines: inv.tax_lines.map((l) => ({
          kind: l.kind,
          rate_pct: Number(l.rate_pct),
          base_amount: Number(l.base_amount),
          amount: Number(l.amount),
        })),
        payments: inv.payments
          .filter((p) => !p.deleted_at)
          .map((p) => ({ amount: Number(p.amount), received_on: p.received_on })),
      })),
      payments: payments.data.filter(inScope).map((p) => {
        const who = p.invoice ? party(p.invoice.payer_snapshot, p.invoice.payer) : { client: null, tax_id: null };
        return {
          id: p.id,
          received_on: p.received_on,
          amount: Number(p.amount),
          currency: p.invoice?.currency ?? p.bolo?.fee_currency ?? 'EUR',
          // A proforma's number is not a fiscal one: the gestoría would look for it.
          invoice_number: p.invoice?.doc_type === 'factura' ? p.invoice.number : null,
          client: who.client ?? p.counterparty ?? p.bolo?.venue_name ?? null,
          tax_id: who.tax_id,
        };
      }),
      capped: invoices.data.length >= ROW_CAP || payments.data.length >= ROW_CAP,
    };
    return jsonNoStore(body);
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/money/quarter', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};
