/**
 * GET /api/invoices/:id/proforma — one proforma as a document to print
 * (ADR-162). Everything is read with the caller's JWT, so RLS is the gate:
 * an invoice row only comes back with `read:money` on its project (or as a
 * workspace admin), and a fiscal record only to who may read it. Nothing is
 * read as service role.
 *
 * A factura answers 409 `not_proforma`: printing an issued factura is a
 * fiscal act (Verifactu, ADR-087), not this page.
 *
 * The issuer is the one `issue_invoice` would freeze: the workspace override,
 * else the account default; an issued proforma prints its snapshot instead.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgGet, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { json } from '$lib/server/http';
import {
  FISCAL_PRINT_FIELDS,
  resolveParty,
  type ProformaDocument,
  type ProformaLine,
  type ProformaTaxLine,
} from '$lib/proforma';

const IdSchema = v.pipe(v.string(), v.uuid());

type InvoiceRow = {
  id: string;
  number: string | null;
  status: string;
  doc_type: string;
  issued_on: string;
  due_on: string | null;
  payment_condition: string | null;
  notes: string | null;
  currency: string;
  subtotal: number;
  total: number;
  workspace_id: string;
  payer_fiscal_identity_id: string | null;
  issuer_snapshot: unknown;
  payer_snapshot: unknown;
  project: { name: string } | null;
  payer: { name: string } | null;
  lines: ProformaLine[];
  tax_lines: ProformaTaxLine[];
};

type FiscalRow = Record<string, unknown> & { id: string };

export const GET: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const idParsed = v.safeParse(IdSchema, params.id);
  if (!idParsed.success) return json({ error: 'invalid_id' }, 400);

  try {
    const { data: invoices } = await pgGet<InvoiceRow>(env, 'invoice', jwt, {
      search: {
        id: `eq.${idParsed.output}`,
        deleted_at: 'is.null',
        select: [
          'id,number,status,doc_type,issued_on,due_on,payment_condition,notes,currency,subtotal,total',
          'workspace_id,payer_fiscal_identity_id,issuer_snapshot,payer_snapshot',
          'project:project_id(name)',
          'payer:workspace_organization!invoice_workspace_payer_organization_fkey(name)',
          'lines:invoice_line(description,quantity,unit_amount,line_total)',
          'tax_lines:invoice_tax_line(id,label,kind,rate_pct,base_amount,amount,exempt_reason,ordinal)',
        ].join(','),
        'lines.order': 'created_at.asc',
      },
    });
    const inv = invoices[0];
    if (!inv) return json({ error: 'not_found' }, 404);
    if (inv.doc_type !== 'proforma') return json({ error: 'not_proforma' }, 409);

    const { data: workspaces } = await pgGet<{
      name: string;
      slug: string;
      fiscal_identity_id: string | null;
      account_id: string;
    }>(env, 'workspace', jwt, {
      search: { id: `eq.${inv.workspace_id}`, select: 'name,slug,fiscal_identity_id,account_id' },
    });
    const ws = workspaces[0] ?? null;

    let issuerId = ws?.fiscal_identity_id ?? null;
    if (!inv.issuer_snapshot && !issuerId && ws) {
      const { data: accounts } = await pgGet<{ default_fiscal_identity_id: string | null }>(env, 'account', jwt, {
        search: { id: `eq.${ws.account_id}`, select: 'default_fiscal_identity_id' },
      });
      issuerId = accounts[0]?.default_fiscal_identity_id ?? null;
    }

    const wanted = [inv.issuer_snapshot ? null : issuerId, inv.payer_snapshot ? null : inv.payer_fiscal_identity_id].filter(
      (x): x is string => Boolean(x),
    );
    const rows = new Map<string, FiscalRow>();
    if (wanted.length > 0) {
      const { data } = await pgGet<FiscalRow>(env, 'fiscal_identity', jwt, {
        search: { id: `in.(${wanted.join(',')})`, select: ['id', ...FISCAL_PRINT_FIELDS].join(',') },
      });
      for (const row of data) rows.set(row.id, row);
    }

    const document: ProformaDocument = {
      id: inv.id,
      number: inv.number,
      status: inv.status,
      issued_on: inv.issued_on,
      due_on: inv.due_on,
      payment_condition: inv.payment_condition,
      notes: inv.notes,
      currency: inv.currency,
      subtotal: Number(inv.subtotal),
      total: Number(inv.total),
      project: inv.project,
      workspace_slug: ws?.slug ?? null,
      issuer: resolveParty({
        snapshot: inv.issuer_snapshot,
        pointer: issuerId,
        row: issuerId ? rows.get(issuerId) : null,
        name: ws?.name,
      }),
      payer: resolveParty({
        snapshot: inv.payer_snapshot,
        pointer: inv.payer_fiscal_identity_id,
        row: inv.payer_fiscal_identity_id ? rows.get(inv.payer_fiscal_identity_id) : null,
        name: inv.payer?.name,
      }),
      lines: inv.lines.map((l) => ({
        description: l.description,
        quantity: Number(l.quantity),
        unit_amount: Number(l.unit_amount),
        line_total: Number(l.line_total),
      })),
      tax_lines: inv.tax_lines.map((tx) => ({
        ...tx,
        rate_pct: Number(tx.rate_pct),
        base_amount: Number(tx.base_amount),
        amount: Number(tx.amount),
      })),
    };
    return json({ document });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/invoices/[id]/proforma', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};
