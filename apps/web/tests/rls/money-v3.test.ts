/**
 * Money v3 (ADR-086) RLS + behaviour — fiscal identities, invoicing_mode,
 * anchored payments (collected-vs-fee) and the issue/numbering path. Additive
 * to the money v2 contract in payment.test.ts, which still holds unchanged.
 * Self-cleaning: every row it creates is removed in afterAll.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  envReady,
  limitedEnvReady,
  login,
  pgGet,
  pgPatch,
  pgPost,
  pgRpc,
  requireEnv,
  requireLimitedEnv,
} from './_helpers';

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

interface FiscalRow {
  id: string;
  kind: string;
  legal_name: string;
  workspace_id: string | null;
  account_id: string | null;
}
interface InvoiceRow {
  id: string;
  status: string;
  number: string | null;
  doc_type: string;
  issuer_snapshot: unknown;
  payer_snapshot: unknown;
}
interface MoneyBolo {
  id: string;
  collected: number;
  project?: { slug?: string } | null;
}

describe.skipIf(!envReady())('money v3 — fiscal identity, invoicing mode, anchored payments, issue', () => {
  let jwt: string;
  let wsId: string;
  let accountId: string;
  let boloId: string;

  const fiscalIds: string[] = [];
  const invoiceIds: string[] = [];
  const paymentIds: string[] = [];

  beforeAll(async () => {
    const env = requireEnv();
    jwt = await login(env.email, env.password);

    const ws = await pgGet<{ id: string; account_id: string }>(
      'workspace?slug=eq.playwright&select=id,account_id',
      jwt,
    );
    expect(ws.status).toBe(200);
    wsId = ws.rows[0]!.id;
    accountId = ws.rows[0]!.account_id;

    const perfs = await pgRpc<MoneyBolo[]>('list_money_bolos', jwt, {
      p_project_ids: null,
      p_workspace_ids: null,
      p_line_ids: null,
      p_from: null,
      p_to: null,
      p_limit: 500,
    });
    expect(perfs.status).toBe(200);
    const perf = (perfs.data ?? []).find((p) => p.project?.slug === 'zzz-e2e-collab');
    if (!perf) throw new Error('Missing ZZZ e2e collab fixture performance');
    boloId = perf.id;
  });

  afterAll(async () => {
    for (const id of paymentIds) await pgRpc('delete_payment', jwt, { p_payment_id: id });
    for (const id of invoiceIds) {
      await pgPatch('invoice', jwt, { status: 'draft' }, new URLSearchParams({ id: `eq.${id}` }));
      await pgRpc('delete_invoice', jwt, { p_invoice_id: id });
    }
    // Detach the workspace override before deleting the identity it points at.
    await pgRpc('update_workspace', jwt, { p_workspace_id: wsId, p_patch: { fiscal_identity_id: '', invoicing_mode: '' } });
    for (const id of fiscalIds) {
      await pgPatch('fiscal_identity', jwt, { deleted_at: new Date().toISOString() }, new URLSearchParams({ id: `eq.${id}` }));
    }
  });

  it('fiscal_identity: admin inserts a workspace receiver; anon blocked; soft-owner + kind enforced', async () => {
    // anon cannot read the table
    const anon = await pgGet<FiscalRow>('fiscal_identity?select=id', null);
    expect([200, 401, 403]).toContain(anon.status);
    if (anon.status === 200) expect(anon.rows.length).toBe(0);

    // admin inserts a workspace-owned receiver
    const ins = await pgPost<FiscalRow>('fiscal_identity', jwt, {
      workspace_id: wsId,
      kind: 'receiver',
      legal_name: `Teatre ${RUN}`,
      tax_id: 'P1700000A',
      city: 'Girona',
      country: 'Espanya',
    });
    expect(ins.status).toBe(201);
    expect(ins.rows[0]!.kind).toBe('receiver');
    fiscalIds.push(ins.rows[0]!.id);

    // and can read it back
    const read = await pgGet<FiscalRow>(
      `fiscal_identity?select=id,legal_name&id=eq.${ins.rows[0]!.id}`,
      jwt,
    );
    expect(read.status).toBe(200);
    expect(read.rows[0]!.legal_name).toBe(`Teatre ${RUN}`);

    // soft-owner: exactly one of account_id / workspace_id
    const both = await pgPost('fiscal_identity', jwt, {
      workspace_id: wsId,
      account_id: accountId,
      kind: 'issuer',
      legal_name: `Both ${RUN}`,
    });
    expect(both.status).toBeGreaterThanOrEqual(400);

    // kind must be issuer | receiver
    const badKind = await pgPost('fiscal_identity', jwt, {
      workspace_id: wsId,
      kind: 'nonsense',
      legal_name: `Bad ${RUN}`,
    });
    expect(badKind.status).toBeGreaterThanOrEqual(400);
  });

  it.skipIf(!limitedEnvReady())('fiscal_identity: a non-admin member cannot write', async () => {
    const lim = requireLimitedEnv();
    const limJwt = await login(lim.email, lim.password);
    const ins = await pgPost('fiscal_identity', limJwt, {
      workspace_id: wsId,
      kind: 'receiver',
      legal_name: `Sneaky ${RUN}`,
    });
    expect([401, 403]).toContain(ins.status);
  });

  it('invoicing_mode: valid values set, invalid rejected, empty clears', async () => {
    const set = await pgRpc('update_workspace', jwt, { p_workspace_id: wsId, p_patch: { invoicing_mode: 'legal' } });
    expect(set.status).toBe(200);
    let read = await pgGet<{ invoicing_mode: string | null }>(
      `workspace?select=invoicing_mode:settings->>invoicing_mode&id=eq.${wsId}`,
      jwt,
    );
    expect(read.rows[0]!.invoicing_mode).toBe('legal');

    const bad = await pgRpc('update_workspace', jwt, { p_workspace_id: wsId, p_patch: { invoicing_mode: 'bogus' } });
    expect(bad.status).toBeGreaterThanOrEqual(400);

    const clear = await pgRpc('update_workspace', jwt, { p_workspace_id: wsId, p_patch: { invoicing_mode: '' } });
    expect(clear.status).toBe(200);
    read = await pgGet<{ invoicing_mode: string | null }>(
      `workspace?select=invoicing_mode:settings->>invoicing_mode&id=eq.${wsId}`,
      jwt,
    );
    expect(read.rows[0]!.invoicing_mode ?? null).toBeNull();
  });

  it('payment anchored to a gig counts as collected against the fee; no-attachment rejected', async () => {
    // anon denied
    const anon = await pgRpc('create_payment', null, { p_amount: 100, p_bolo_id: boloId });
    expect([401, 403, 404]).toContain(anon.status);

    // collected before
    const before = await pgRpc<MoneyBolo[]>('list_money_bolos', jwt, {
      p_project_ids: null, p_workspace_ids: null, p_line_ids: null, p_from: null, p_to: null, p_limit: 500,
    });
    const collBefore = (before.data ?? []).find((p) => p.id === boloId)!.collected;

    // anchored payment, no invoice
    const pay = await pgRpc<{ id: string; bolo_id: string; invoice_id: string | null }>(
      'create_payment', jwt,
      { p_amount: 250, p_bolo_id: boloId, p_counterparty: `Teatre ${RUN}`, p_category: 'Caixet' },
    );
    expect(pay.status).toBe(200);
    expect(pay.data!.bolo_id).toBe(boloId);
    expect(pay.data!.invoice_id).toBeNull();
    paymentIds.push(pay.data!.id);

    // collected reflects it
    const after = await pgRpc<MoneyBolo[]>('list_money_bolos', jwt, {
      p_project_ids: null, p_workspace_ids: null, p_line_ids: null, p_from: null, p_to: null, p_limit: 500,
    });
    const collAfter = (after.data ?? []).find((p) => p.id === boloId)!.collected;
    expect(Number(collAfter)).toBeCloseTo(Number(collBefore) + 250, 2);

    // a payment with neither invoice nor anchor is rejected
    const orphan = await pgRpc('create_payment', jwt, { p_amount: 50 });
    expect(orphan.status).toBeGreaterThanOrEqual(400);
  });

  it.skipIf(!limitedEnvReady())('payment: a performer without edit:money cannot anchor a payment', async () => {
    const lim = requireLimitedEnv();
    const limJwt = await login(lim.email, lim.password);
    const pay = await pgRpc('create_payment', limJwt, { p_amount: 100, p_bolo_id: boloId });
    expect([401, 403]).toContain(pay.status);
  });

  it('issue_invoice: proforma numbers PRO; a factura needs an issuer identity; wired factura numbers FAC + freezes snapshots', async () => {
    // proforma: create a draft and issue it → PRO number, no identities needed
    const pro = await pgRpc<InvoiceRow>('create_invoice_from_bolo', jwt, {
      p_bolo_id: boloId, p_number: null, p_doc_type: 'proforma',
    });
    expect(pro.status).toBe(200);
    expect(pro.data!.doc_type).toBe('proforma');
    invoiceIds.push(pro.data!.id);

    const proIssued = await pgRpc<InvoiceRow>('issue_invoice', jwt, { p_invoice_id: pro.data!.id });
    expect(proIssued.status).toBe(200);
    expect(proIssued.data!.status).toBe('issued');
    expect(proIssued.data!.number).toMatch(/^PRO \d{4}-\d{4}$/);

    // factura without a fiscal identity → refused
    const facBare = await pgRpc<InvoiceRow>('create_invoice_from_bolo', jwt, {
      p_bolo_id: boloId, p_doc_type: 'factura',
    });
    expect(facBare.status).toBe(200);
    invoiceIds.push(facBare.data!.id);
    const facBareIssue = await pgRpc('issue_invoice', jwt, { p_invoice_id: facBare.data!.id });
    expect(facBareIssue.status).toBeGreaterThanOrEqual(400);

    // wire an issuer (workspace override) + a receiver, then issue a factura
    const issuer = await pgPost<FiscalRow>('fiscal_identity', jwt, {
      workspace_id: wsId, kind: 'issuer', legal_name: `MüK ${RUN}`, tax_id: 'ESB99999999',
      address_line_1: 'Carrer Test 1', postal_code: '08001', city: 'Barcelona', country: 'Espanya',
      iban: 'ES9121000418450200051332', swift_bic: 'CAIXESBBXXX',
    });
    expect(issuer.status).toBe(201);
    fiscalIds.push(issuer.rows[0]!.id);

    const receiver = await pgPost<FiscalRow>('fiscal_identity', jwt, {
      workspace_id: wsId, kind: 'receiver', legal_name: `Teatre R ${RUN}`, tax_id: 'P1700001B',
      address_line_1: 'Plaça 1', postal_code: '17004', city: 'Girona', country: 'Espanya',
    });
    expect(receiver.status).toBe(201);
    fiscalIds.push(receiver.rows[0]!.id);

    const wire = await pgRpc('update_workspace', jwt, {
      p_workspace_id: wsId, p_patch: { fiscal_identity_id: issuer.rows[0]!.id },
    });
    expect(wire.status).toBe(200);

    const fac = await pgRpc<InvoiceRow>('create_invoice_from_bolo', jwt, {
      p_bolo_id: boloId, p_doc_type: 'factura', p_payer_fiscal_identity_id: receiver.rows[0]!.id,
    });
    expect(fac.status).toBe(200);
    invoiceIds.push(fac.data!.id);

    const facIssued = await pgRpc<InvoiceRow>('issue_invoice', jwt, { p_invoice_id: fac.data!.id });
    expect(facIssued.status).toBe(200);
    expect(facIssued.data!.status).toBe('issued');
    expect(facIssued.data!.number).toMatch(/^FAC \d{4}-\d{4}$/);
    expect(facIssued.data!.issuer_snapshot).toBeTruthy();
    expect(facIssued.data!.payer_snapshot).toBeTruthy();
  });

  it('create_payment rejects an invoice + a scope anchor together (no anchor smuggling)', async () => {
    const draft = await pgRpc<InvoiceRow>('create_invoice_from_bolo', jwt, {
      p_bolo_id: boloId,
      p_doc_type: 'proforma',
    });
    expect(draft.status).toBe(200);
    invoiceIds.push(draft.data!.id);
    const issued = await pgRpc<InvoiceRow>('issue_invoice', jwt, { p_invoice_id: draft.data!.id });
    expect(issued.status).toBe(200);

    // an issued invoice takes an invoice-only payment…
    const ok = await pgRpc<{ id: string }>('create_payment', jwt, {
      p_invoice_id: draft.data!.id,
      p_amount: 10,
    });
    expect(ok.status).toBe(200);
    if (ok.data?.id) paymentIds.push(ok.data.id);

    // …but a payment carrying BOTH an invoice and a scope anchor is rejected:
    // the SECURITY DEFINER RPC would otherwise write the anchor without an
    // edit:money check on it (cross-project money escalation).
    const smuggled = await pgRpc('create_payment', jwt, {
      p_invoice_id: draft.data!.id,
      p_amount: 10,
      p_bolo_id: boloId,
    });
    expect(smuggled.status).toBeGreaterThanOrEqual(400);
  });
});
