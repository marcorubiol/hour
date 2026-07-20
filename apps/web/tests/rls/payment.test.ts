import { beforeAll, describe, expect, test } from 'vitest';
import {
  envReady,
  limitedEnvReady,
  login,
  pgGet,
  pgPatch,
  pgRpc,
  requireEnv,
  requireLimitedEnv,
} from './_helpers';

const RUN_TAG = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

type MoneyPerformance = {
  id: string;
  fee_amount: number | null;
  project: { name: string } | null;
};

type InvoiceRow = {
  id: string;
  status: string;
  total: number;
};

type PaymentRow = {
  id: string;
  invoice_id: string;
  amount: number;
};

describe.skipIf(!envReady())('payment RLS + derived invoice status', () => {
  let jwt = '';

  beforeAll(async () => {
    const env = requireEnv();
    jwt = await login(env.email, env.password);
  });

  test('anon cannot execute payment mutation RPCs', async () => {
    const create = await pgRpc('create_payment', null, {
      p_invoice_id: '00000000-0000-0000-0000-000000000001',
      p_amount: 1,
    });
    const remove = await pgRpc('delete_payment', null, {
      p_payment_id: '00000000-0000-0000-0000-000000000001',
    });

    expect([401, 403, 404]).toContain(create.status);
    expect([401, 403, 404]).toContain(remove.status);
  });

  test('payments derive paid, soft-delete derives issued, and a non-editor is denied', async () => {
    const listed = await pgRpc<MoneyPerformance[]>('list_money_performances', jwt, {
      p_project_ids: null,
      p_workspace_ids: null,
      p_line_ids: null,
      p_from: null,
      p_to: null,
      p_limit: 500,
    });
    expect(listed.status).toBe(200);
    const performance = listed.data?.find(
      (item) => item.project?.name === 'ZZZ e2e collab' && Number(item.fee_amount) > 0,
    );
    expect(performance).toBeTruthy();
    if (!performance) return;

    const createdInvoice = await pgRpc<InvoiceRow>('create_invoice', jwt, {
      p_performance_id: performance.id,
      p_vat_pct: null,
      p_irpf_pct: null,
      p_number: `rls-payment-${RUN_TAG}`,
      p_due_on: null,
      p_notes: null,
      p_expected_on: null,
      p_payment_condition: null,
      p_payer_person_id: null,
    });
    expect(createdInvoice.status).toBe(200);
    const invoice = createdInvoice.data;
    expect(invoice?.id).toBeTruthy();
    if (!invoice) return;

    const paymentIds: string[] = [];
    try {
      const draftPayment = await pgRpc('create_payment', jwt, {
        p_invoice_id: invoice.id,
        p_amount: 1,
        p_received_on: new Date().toISOString().slice(0, 10),
        p_method: 'transfer',
      });
      expect(draftPayment.status).toBe(400);

      const issued = await pgPatch<InvoiceRow>(
        'invoice',
        jwt,
        { status: 'issued' },
        new URLSearchParams({ id: `eq.${invoice.id}`, select: 'id,status,total' }),
      );
      expect(issued.rows[0]?.status).toBe('issued');

      const manualPaid = await pgPatch<InvoiceRow>(
        'invoice',
        jwt,
        { status: 'paid' },
        new URLSearchParams({ id: `eq.${invoice.id}`, select: 'id,status,total' }),
      );
      expect(manualPaid.status).toBe(400);

      if (limitedEnvReady()) {
        const limited = requireLimitedEnv();
        const limitedJwt = await login(limited.email, limited.password);
        const denied = await pgRpc('create_payment', limitedJwt, {
          p_invoice_id: invoice.id,
          p_amount: 1,
          p_received_on: new Date().toISOString().slice(0, 10),
          p_method: 'transfer',
        });
        expect(denied.status).toBe(403);
      }

      const half = Number(invoice.total) / 2;
      const first = await pgRpc<PaymentRow>('create_payment', jwt, {
        p_invoice_id: invoice.id,
        p_amount: half,
        p_received_on: new Date().toISOString().slice(0, 10),
        p_method: 'transfer',
        p_reference: `advance-${RUN_TAG}`,
        p_notes: null,
      });
      expect(first.status).toBe(200);
      expect(first.data?.id).toBeTruthy();
      if (first.data) paymentIds.push(first.data.id);

      let status = await pgGet<InvoiceRow>(
        'invoice',
        jwt,
        new URLSearchParams({ id: `eq.${invoice.id}`, select: 'id,status,total' }),
      );
      expect(status.rows[0]?.status).toBe('issued');

      const second = await pgRpc<PaymentRow>('create_payment', jwt, {
        p_invoice_id: invoice.id,
        p_amount: Number(invoice.total) - half,
        p_received_on: new Date().toISOString().slice(0, 10),
        p_method: 'transfer',
        p_reference: `rest-${RUN_TAG}`,
        p_notes: null,
      });
      expect(second.status).toBe(200);
      expect(second.data?.id).toBeTruthy();
      if (second.data) paymentIds.push(second.data.id);

      status = await pgGet<InvoiceRow>(
        'invoice',
        jwt,
        new URLSearchParams({ id: `eq.${invoice.id}`, select: 'id,status,total' }),
      );
      expect(status.rows[0]?.status).toBe('paid');

      const removed = await pgRpc('delete_payment', jwt, { p_payment_id: paymentIds.pop() });
      expect(removed.status).toBeLessThan(300);
      status = await pgGet<InvoiceRow>(
        'invoice',
        jwt,
        new URLSearchParams({ id: `eq.${invoice.id}`, select: 'id,status,total' }),
      );
      expect(status.rows[0]?.status).toBe('issued');
    } finally {
      for (const paymentId of paymentIds) {
        await pgRpc('delete_payment', jwt, { p_payment_id: paymentId });
      }
      await pgPatch(
        'invoice',
        jwt,
        { status: 'draft' },
        new URLSearchParams({ id: `eq.${invoice.id}` }),
      );
      await pgRpc('delete_invoice', jwt, { p_invoice_id: invoice.id });
    }
  }, 30_000);
});
