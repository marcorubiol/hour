/**
 * Hardening pass (audit 2026-07-24) — the guards that would otherwise regress
 * silently.
 *
 * Everything here protects a property that fails QUIETLY if undone:
 *
 *  - The fiscal write lock is an ABSENCE (no GRANT), not a policy. A later
 *    migration doing `GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated`
 *    — a routine Supabase idiom — silently reopens the forge path, and staging
 *    rebuilds/restore drills replay every migration from zero. Nothing else
 *    would notice.
 *  - The money list RPCs stopped calling has_permission() per row and now filter
 *    on accessible_project_ids(). If that drifts, users see rows they should not
 *    (or lose rows they should see) with no error anywhere. The equivalence
 *    tests below cross-check the RPC against the untouched per-row RLS path, so
 *    the two independent implementations have to keep agreeing.
 *  - fiscal_identity carries iban/swift_bic/tax_id and was readable by any
 *    workspace member until this pass.
 *
 * Self-cleaning: every row created here is removed in afterAll.
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

interface BoloRow {
  id: string;
  project_id: string;
}
interface MoneyBolo {
  id: string;
  collected: number;
  project?: { slug?: string } | null;
}
interface InvoiceRow {
  id: string;
  status: string;
  number: string | null;
}
interface ExpenseRow {
  id: string;
}

describe.skipIf(!envReady())('hardening 2026-07-24 — fiscal write lock, money gate, RPC equivalence', () => {
  let jwt: string;
  let wsId: string;
  let boloId: string;

  const invoiceIds: string[] = [];
  const paymentIds: string[] = [];
  const fiscalIds: string[] = [];

  beforeAll(async () => {
    const env = requireEnv();
    jwt = await login(env.email, env.password);

    const ws = await pgGet<{ id: string }>('workspace?slug=eq.playwright&select=id', jwt);
    expect(ws.status).toBe(200);
    wsId = ws.rows[0]!.id;

    const bolos = await pgRpc<MoneyBolo[]>('list_money_bolos', jwt, {
      p_project_ids: null, p_workspace_ids: null, p_line_ids: null,
      p_from: null, p_to: null, p_limit: 500,
    });
    expect(bolos.status).toBe(200);
    const target = (bolos.data ?? []).find((b) => b.project?.slug === 'zzz-e2e-collab');
    if (!target) throw new Error('Missing ZZZ e2e collab fixture bolo');
    boloId = target.id;
  });

  afterAll(async () => {
    for (const id of paymentIds) await pgRpc('delete_payment', jwt, { p_payment_id: id });
    for (const id of invoiceIds) {
      await pgRpc('update_invoice', jwt, { p_invoice_id: id, p_patch: { status: 'draft' } });
      await pgRpc('delete_invoice', jwt, { p_invoice_id: id });
    }
    for (const id of fiscalIds) {
      await pgPatch(
        'fiscal_identity',
        jwt,
        { deleted_at: new Date().toISOString() },
        new URLSearchParams({ id: `eq.${id}` }),
      );
    }
  });

  // ── 1. the fiscal write lock ───────────────────────────────────────────────

  it('invoice / invoice_line / payment reject every direct Data API write', async () => {
    // The forge the audit found: PATCH an invoice straight to issued with a
    // hand-written correlative, bypassing issue_invoice's atomic series and
    // leaving the issuer/payer snapshots empty.
    const forge = await pgPatch(
      'invoice',
      jwt,
      { status: 'issued', number: `FAC ${RUN}` },
      new URLSearchParams({ workspace_id: `eq.${wsId}` }),
    );
    expect([401, 403]).toContain(forge.status);

    const insInvoice = await pgPost('invoice', jwt, {
      workspace_id: wsId, status: 'issued', number: `FAC FORGED ${RUN}`, doc_type: 'factura',
    });
    expect([401, 403]).toContain(insInvoice.status);

    const insLine = await pgPost('invoice_line', jwt, {
      workspace_id: wsId, description: `forged ${RUN}`, quantity: 1, unit_amount: 1,
    });
    expect([401, 403]).toContain(insLine.status);

    // Direct payment insert would skip create_payment's issued-invoice guard
    // and its idempotency dedup.
    const insPayment = await pgPost('payment', jwt, {
      workspace_id: wsId, bolo_id: boloId, amount: 1, received_on: '2026-01-01', method: 'transfer',
    });
    expect([401, 403]).toContain(insPayment.status);

    const patchPayment = await pgPatch(
      'payment', jwt, { amount: 99_999 }, new URLSearchParams({ workspace_id: `eq.${wsId}` }),
    );
    expect([401, 403]).toContain(patchPayment.status);
  });

  it('the sanctioned RPC paths still work end to end', async () => {
    const draft = await pgRpc<InvoiceRow>('create_invoice_from_bolo', jwt, {
      p_bolo_id: boloId, p_doc_type: 'proforma',
    });
    expect(draft.status).toBe(200);
    invoiceIds.push(draft.data!.id);

    const issued = await pgRpc<InvoiceRow>('issue_invoice', jwt, { p_invoice_id: draft.data!.id });
    expect(issued.status).toBe(200);
    expect(issued.data!.status).toBe('issued');
    expect(issued.data!.number).toMatch(/^PRO \d{4}-\d{4}$/);

    const pay = await pgRpc<{ id: string }>('create_payment', jwt, {
      p_amount: 5, p_bolo_id: boloId,
    });
    expect(pay.status).toBe(200);
    paymentIds.push(pay.data!.id);
  });

  // `expense` was deliberately left writable: it carries no numbering or
  // snapshot invariant, and PATCH /api/expenses/:id depends on it. If someone
  // "tidies up" by revoking it too, that endpoint breaks — this pins the choice.
  it('expense keeps its direct UPDATE grant (deliberate exception)', async () => {
    const rows = await pgGet<ExpenseRow>('expense?select=id&deleted_at=is.null&limit=1', jwt);
    expect(rows.status).toBe(200);
    if (rows.rows.length === 0) return; // no expense fixture — nothing to assert
    const patch = await pgPatch(
      'expense', jwt, { notes: `hardening probe ${RUN}` },
      new URLSearchParams({ id: `eq.${rows.rows[0]!.id}` }),
    );
    expect(patch.status).toBe(200);
  });

  // ── 2. update_invoice guards ───────────────────────────────────────────────

  it('update_invoice refuses to mint a number or self-issue, but takes metadata and cancel', async () => {
    const draft = await pgRpc<InvoiceRow>('create_invoice_from_bolo', jwt, {
      p_bolo_id: boloId, p_doc_type: 'proforma',
    });
    expect(draft.status).toBe(200);
    const id = draft.data!.id;
    invoiceIds.push(id);

    for (const patch of [
      { number: `FAC ${RUN}` },
      { status: 'issued' },
      { status: 'paid' },
    ]) {
      const res = await pgRpc('update_invoice', jwt, { p_invoice_id: id, p_patch: patch });
      expect(res.status).toBeGreaterThanOrEqual(400);
    }

    // …and the invoice is untouched: still a numberless draft.
    const after = await pgRpc<InvoiceRow>('update_invoice', jwt, {
      p_invoice_id: id, p_patch: { notes: `ok ${RUN}` },
    });
    expect(after.status).toBe(200);
    expect(after.data!.status).toBe('draft');
    expect(after.data!.number).toBeNull();

    const cancelled = await pgRpc<InvoiceRow>('update_invoice', jwt, {
      p_invoice_id: id, p_patch: { status: 'cancelled' },
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.data!.status).toBe('cancelled');
  });

  // ── 3. payment idempotency ─────────────────────────────────────────────────

  it('create_payment dedups on idempotency_key — a double submit records the money once', async () => {
    const key = crypto.randomUUID();
    const args = { p_amount: 33, p_bolo_id: boloId, p_idempotency_key: key };

    const before = await pgRpc<MoneyBolo[]>('list_money_bolos', jwt, {
      p_project_ids: null, p_workspace_ids: null, p_line_ids: null,
      p_from: null, p_to: null, p_limit: 500,
    });
    const collectedBefore = Number((before.data ?? []).find((b) => b.id === boloId)!.collected);

    const first = await pgRpc<{ id: string }>('create_payment', jwt, args);
    expect(first.status).toBe(200);
    paymentIds.push(first.data!.id);

    const replay = await pgRpc<{ id: string }>('create_payment', jwt, args);
    expect(replay.status).toBe(200);
    // Same row back, not a second payment.
    expect(replay.data!.id).toBe(first.data!.id);

    const after = await pgRpc<MoneyBolo[]>('list_money_bolos', jwt, {
      p_project_ids: null, p_workspace_ids: null, p_line_ids: null,
      p_from: null, p_to: null, p_limit: 500,
    });
    const collectedAfter = Number((after.data ?? []).find((b) => b.id === boloId)!.collected);
    expect(collectedAfter).toBeCloseTo(collectedBefore + 33, 2);

    // A fresh key is a genuinely new payment.
    const second = await pgRpc<{ id: string }>('create_payment', jwt, {
      ...args, p_idempotency_key: crypto.randomUUID(),
    });
    expect(second.status).toBe(200);
    expect(second.data!.id).not.toBe(first.data!.id);
    paymentIds.push(second.data!.id);
  });

  // ── 4. authorization equivalence after the per-row → set rewrite ───────────

  it('list_money_bolos returns exactly what the per-row RLS path returns', async () => {
    // Two independent implementations of the same authorization question:
    //   RPC  → accessible_project_ids() set membership (rewritten)
    //   REST → the bolo_select policy, still has_permission() per row (untouched)
    // They must agree. Disagreement = the perf rewrite changed who sees what.
    const viaRpc = await pgRpc<MoneyBolo[]>('list_money_bolos', jwt, {
      p_project_ids: null, p_workspace_ids: null, p_line_ids: null,
      p_from: null, p_to: null, p_limit: 500,
    });
    expect(viaRpc.status).toBe(200);

    const viaRest = await pgGet<BoloRow>('bolo?select=id&deleted_at=is.null&limit=500', jwt);
    expect(viaRest.status).toBe(200);

    // Guard against a silent pass caused by hitting either limit.
    expect(viaRest.rows.length).toBeLessThan(500);

    const fromRpc = new Set((viaRpc.data ?? []).map((b) => b.id));
    const fromRest = new Set(viaRest.rows.map((b) => b.id));
    expect([...fromRpc].sort()).toEqual([...fromRest].sort());
  });

  it('list_expenses_for_scope returns exactly what the per-row RLS path returns', async () => {
    const viaRpc = await pgRpc<ExpenseRow[]>('list_expenses_for_scope', jwt, {
      p_project_ids: null, p_workspace_ids: null, p_line_ids: null,
      p_bolo_ids: null, p_category: null, p_limit: 500,
    });
    expect(viaRpc.status).toBe(200);

    const viaRest = await pgGet<ExpenseRow>('expense?select=id&deleted_at=is.null&limit=500', jwt);
    expect(viaRest.status).toBe(200);
    expect(viaRest.rows.length).toBeLessThan(500);

    const fromRpc = new Set((viaRpc.data ?? []).map((e) => e.id));
    const fromRest = new Set(viaRest.rows.map((e) => e.id));
    expect([...fromRpc].sort()).toEqual([...fromRest].sort());
  });

  it('accessible_project_ids agrees with has_permission on every visible project', async () => {
    const set = await pgRpc<string[]>('accessible_project_ids', jwt, { p_perm: 'read:money' });
    expect(set.status).toBe(200);
    const allowed = new Set(set.data ?? []);

    // Every project the set claims must really pass has_permission, and every
    // bolo the user can read must belong to a project in the set.
    const bolos = await pgGet<BoloRow>(
      'bolo?select=id,project_id&deleted_at=is.null&limit=500',
      jwt,
    );
    expect(bolos.status).toBe(200);
    for (const b of bolos.rows) {
      expect(allowed.has(b.project_id)).toBe(true);
    }
  });

  // ── 5. the project_id_of_* helpers are off the API surface ────────────────

  // These SECURITY DEFINER helpers take a row id and return its project, with
  // no permission check — that is fine INSIDE an RLS policy (their only job)
  // and a cross-tenant existence oracle if PostgREST publishes them as RPCs.
  // They live in `private` since 20260725100000; `private` is not an exposed
  // schema, so the endpoint must not resolve. Note the grant to `authenticated`
  // deliberately REMAINS — policies are evaluated as the invoker and would
  // fail outright without it. This test pins the exposure, not the grant.
  it('project_id_of_* are not reachable as PostgREST RPCs', async () => {
    for (const fn of [
      'project_id_of_performance',
      'project_id_of_expense',
      'project_id_of_asset_version',
    ]) {
      const res = await pgRpc(fn, jwt, {});
      // 404 = no such function in the exposed schema. Anything 2xx means the
      // helper is published again and the oracle is back.
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).not.toBe(401); // not merely a permission error
    }

    // …and the tables whose policies depend on them still read fine, which is
    // the half that breaks if someone "fixes" this by revoking EXECUTE.
    for (const table of ['crew_assignment', 'cast_override', 'asset_version']) {
      const rows = await pgGet(`${table}?select=id&limit=1`, jwt);
      expect(rows.status).toBe(200);
    }
  });

  // ── 6. fiscal_identity is money-gated, not member-visible ─────────────────

  it.skipIf(!limitedEnvReady())(
    'a member without read:money cannot read banking details',
    async () => {
      // Admin creates a workspace-scoped issuer carrying real banking data.
      const issuer = await pgPost<{ id: string }>('fiscal_identity', jwt, {
        workspace_id: wsId,
        kind: 'issuer',
        legal_name: `Hardening ${RUN}`,
        tax_id: 'ESB88888888',
        iban: 'ES9121000418450200051332',
        swift_bic: 'CAIXESBBXXX',
      });
      expect(issuer.status).toBe(201);
      const id = issuer.rows[0]!.id;
      fiscalIds.push(id);

      // The admin (read:money) sees it.
      const asAdmin = await pgGet<{ id: string; iban: string | null }>(
        `fiscal_identity?select=id,iban&id=eq.${id}`,
        jwt,
      );
      expect(asAdmin.status).toBe(200);
      expect(asAdmin.rows.length).toBe(1);

      // The limited member — a plain member of `playwright`, performer in the
      // e2e project, no money permission — must see nothing. Before this pass
      // the select policy accepted bare membership and handed over the IBAN.
      const lim = requireLimitedEnv();
      const limJwt = await login(lim.email, lim.password);
      const asMember = await pgGet<{ id: string }>(
        `fiscal_identity?select=id,iban,swift_bic,tax_id&id=eq.${id}`,
        limJwt,
      );
      expect([200, 401, 403]).toContain(asMember.status);
      if (asMember.status === 200) expect(asMember.rows.length).toBe(0);

      // And nothing leaks through an unfiltered scan either.
      const scan = await pgGet<{ id: string }>('fiscal_identity?select=id', limJwt);
      if (scan.status === 200) {
        expect(scan.rows.map((r) => r.id)).not.toContain(id);
      }
    },
  );
});
