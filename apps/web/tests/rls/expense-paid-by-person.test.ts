/**
 * 79 · Gastos adelantados (`20261102100000_expense_paid_by_person`).
 *
 *   1. `create_expense` acepta `p_paid_by_person_id`: una persona con dossier
 *      vivo en el espacio del gasto. Sin dossier, 23514 (400), también por el
 *      PATCH directo de la fila.
 *   2. La llamada de siempre (sin el parámetro nuevo) sigue resolviendo: no hay
 *      sobrecarga (PostgREST respondería 300).
 *   3. `set_expense_reimbursed` pone y quita devuelto con su día; sin
 *      `edit:money` o de fuera, 42501 (403); anon, fuera.
 *
 * En `zzz-e2e-collab` (`playwright`): un bolo, un dossier y dos gastos propios,
 * que se borran al final.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  envReady,
  externalEnvReady,
  login,
  pgGet,
  pgPatch,
  pgRpc,
  requireEnv,
  requireExternalEnv,
} from './_helpers';

type Expense = {
  id: string;
  paid_by_person_id: string | null;
  reimbursed: boolean;
  reimbursed_on: string | null;
};

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const one = <T>(data: T | T[] | null): T | undefined => (Array.isArray(data) ? data[0] : (data ?? undefined));

describe.skipIf(!envReady())('RLS — expense.paid_by_person_id (79)', () => {
  let jwt: string;
  let workspaceId: string;
  let projectId: string;
  let boloId: string;
  let personId: string;
  const expenses: string[] = [];

  beforeAll(async () => {
    const env = requireEnv();
    jwt = await login(env.email, env.password);
    const p = await pgGet<{ id: string; workspace_id: string }>(
      'project',
      jwt,
      new URLSearchParams({
        select: 'id,workspace_id,workspace:workspace_id!inner(slug)',
        'workspace.slug': 'eq.playwright',
        slug: 'eq.zzz-e2e-collab',
        deleted_at: 'is.null',
        limit: '1',
      }),
    );
    if (p.rows.length === 0) throw new Error('zzz-e2e-collab missing in playwright');
    projectId = p.rows[0]!.id;
    workspaceId = p.rows[0]!.workspace_id;

    const b = await pgRpc<{ id: string }>('create_bolo', jwt, {
      p_project_id: projectId,
      p_venue_name: `ZZZ Expense ${RUN}`,
      p_fee_amount: 100,
    });
    expect(b.status, b.error).toBe(200);
    boloId = one(b.data)!.id;

    const d = await pgRpc<{ person_id: string }>('create_workspace_person', jwt, {
      p_workspace_id: workspaceId,
      p_full_name: `Zzz Paid By ${RUN}`,
    });
    expect(d.status, d.error).toBe(200);
    personId = one(d.data)!.person_id;
  });

  afterAll(async () => {
    if (!jwt) return;
    for (const id of expenses) await pgRpc('delete_expense', jwt, { p_expense_id: id });
    if (boloId) await pgRpc('delete_bolo', jwt, { p_bolo_id: boloId });
    if (personId) await pgRpc('delete_workspace_person', jwt, { p_workspace_id: workspaceId, p_person_id: personId });
  });

  const create = async (extra: Record<string, unknown> = {}) =>
    pgRpc<Expense>('create_expense', jwt, {
      p_bolo_id: boloId,
      p_description: `Zzz gasolina ${RUN}`,
      p_amount: 42.5,
      ...extra,
    });

  test('a person with a dossier in the space pays; one without is refused', async () => {
    const ok = await create({ p_paid_by_person_id: personId });
    expect(ok.status, ok.error).toBe(200);
    const row = one(ok.data)!;
    expenses.push(row.id);
    expect(row.paid_by_person_id).toBe(personId);

    const ghost = await create({ p_paid_by_person_id: crypto.randomUUID() });
    expect(ghost.status).toBe(400);
    // 23503 si la persona no existe en absoluto (FK), 23514 si existe sin dossier aquí.
    expect(ghost.error).toMatch(/23503|23514/);

    const patched = await pgPatch<Expense>(
      'expense',
      jwt,
      { paid_by_person_id: crypto.randomUUID() },
      new URLSearchParams({ id: `eq.${row.id}` }),
    );
    expect(patched.status).toBeGreaterThanOrEqual(400);
    expect(patched.rows).toHaveLength(0);
  });

  test('the old call shape still resolves (no overload)', async () => {
    const r = await create();
    expect(r.status, r.error).toBe(200);
    const row = one(r.data)!;
    expenses.push(row.id);
    expect(row.paid_by_person_id).toBeNull();
  });

  test('set_expense_reimbursed sets and clears the day', async () => {
    const id = expenses[0]!;
    const on = await pgRpc<Expense>('set_expense_reimbursed', jwt, {
      p_expense_id: id,
      p_reimbursed: true,
      p_on: '2026-11-01',
    });
    expect(on.status, on.error).toBe(200);
    expect(one(on.data)!.reimbursed).toBe(true);
    expect(one(on.data)!.reimbursed_on).toBe('2026-11-01');

    const off = await pgRpc<Expense>('set_expense_reimbursed', jwt, { p_expense_id: id, p_reimbursed: false });
    expect(off.status, off.error).toBe(200);
    expect(one(off.data)!.reimbursed).toBe(false);
    expect(one(off.data)!.reimbursed_on).toBeNull();

    const ghost = await pgRpc('set_expense_reimbursed', jwt, { p_expense_id: crypto.randomUUID(), p_reimbursed: true });
    expect(ghost.status).toBe(403);

    const anon = await pgRpc('set_expense_reimbursed', null, { p_expense_id: id, p_reimbursed: true });
    expect(anon.status).toBeGreaterThanOrEqual(400);
  });

  test.skipIf(!externalEnvReady())('someone outside the space cannot mark it', async () => {
    const ext = requireExternalEnv();
    const other = await login(ext.email, ext.password);
    const r = await pgRpc('set_expense_reimbursed', other, { p_expense_id: expenses[0]!, p_reimbursed: true });
    expect(r.status).toBe(403);
  });
});
