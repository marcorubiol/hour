import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import { ExpenseCreateSchema, ExpensePatchSchema, owedToTeam, type ExpenseItem } from './expense';

describe('ExpenseCreateSchema', () => {
  const base = {
    line_id: '019f2f03-f1f2-71a0-9e1f-9c8c9cf331c8',
    description: 'Hotel Aarhus',
    amount: 240.5,
  };

  it('accepts a minimal line-scoped expense with defaults', () => {
    const r = v.safeParse(ExpenseCreateSchema, base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.output.category).toBe('other');
      expect(r.output.currency).toBe('EUR');
    }
  });

  it('uppercases the currency and enforces 3 letters', () => {
    const ok = v.safeParse(ExpenseCreateSchema, { ...base, currency: 'dkk' });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.output.currency).toBe('DKK');
    expect(v.safeParse(ExpenseCreateSchema, { ...base, currency: 'EURO' }).success).toBe(false);
  });

  it('rejects zero/negative amounts', () => {
    expect(v.safeParse(ExpenseCreateSchema, { ...base, amount: 0 }).success).toBe(false);
    expect(v.safeParse(ExpenseCreateSchema, { ...base, amount: -5 }).success).toBe(false);
  });

  it('rejects impossible calendar dates beyond the regex', () => {
    expect(
      v.safeParse(ExpenseCreateSchema, { ...base, incurred_on: '2026-02-31' }).success,
    ).toBe(false);
  });

  it('rejects unknown categories', () => {
    expect(
      v.safeParse(ExpenseCreateSchema, { ...base, category: 'bribes' }).success,
    ).toBe(false);
  });

  it('strips unknown fields so scope FKs cannot ride along', () => {
    const r = v.safeParse(ExpenseCreateSchema, {
      ...base,
      workspace_id: 'evil',
      deleted_at: 'now',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect('workspace_id' in r.output).toBe(false);
      expect('deleted_at' in r.output).toBe(false);
    }
  });
});

describe('ExpensePatchSchema', () => {
  it('whitelists field edits only', () => {
    const r = v.safeParse(ExpensePatchSchema, {
      description: 'Hotel Aarhus (2 nights)',
      reimbursed: true,
      paid_by_person_id: null,
      line_id: 'should-be-stripped',
      performance_id: 'should-be-stripped',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect('line_id' in r.output).toBe(false);
      expect('performance_id' in r.output).toBe(false);
      // «Devuelto» carries its day: it is its own endpoint, not a field edit.
      expect('reimbursed' in r.output).toBe(false);
      expect(r.output.paid_by_person_id).toBeNull();
    }
  });
});

describe('owedToTeam', () => {
  const row = (over: Partial<ExpenseItem>): ExpenseItem => ({
    id: Math.random().toString(36),
    workspace_id: 'w',
    bolo_id: 'b',
    line_id: null,
    category: 'travel',
    description: 'Gasolina',
    amount: 10,
    currency: 'EUR',
    incurred_on: '2026-10-01',
    reimbursed: false,
    reimbursed_on: null,
    notes: null,
    counterparty: null,
    created_at: '2026-10-01T00:00:00Z',
    paid_by_person_id: null,
    paid_by_name: null,
    ...over,
  });

  it('keeps only advances not yet returned, grouped by person', () => {
    const out = owedToTeam([
      row({ paid_by_person_id: 'ana', paid_by_name: 'Ana', amount: 20, incurred_on: '2026-10-03' }),
      row({ paid_by_person_id: 'ana', paid_by_name: 'Ana', amount: 5.5, incurred_on: '2026-10-01' }),
      row({ paid_by_person_id: 'ana', reimbursed: true, reimbursed_on: '2026-10-05', amount: 99 }),
      row({ paid_by_person_id: null, amount: 500 }),
      row({ paid_by_person_id: 'joan', paid_by_name: 'Joan', amount: 40 }),
    ]);
    expect(out.map((p) => p.personId)).toEqual(['joan', 'ana']);
    const ana = out[1]!;
    expect(ana.totals).toEqual([['EUR', 25.5]]);
    expect(ana.items.map((e) => e.incurred_on)).toEqual(['2026-10-01', '2026-10-03']);
  });

  it('never adds across currencies', () => {
    const [p] = owedToTeam([
      row({ paid_by_person_id: 'ana', amount: 10, currency: 'EUR' }),
      row({ paid_by_person_id: 'ana', amount: 30, currency: 'GBP' }),
    ]);
    expect(p!.totals).toEqual([
      ['GBP', 30],
      ['EUR', 10],
    ]);
  });
});
