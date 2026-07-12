import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import { ExpenseCreateSchema, ExpensePatchSchema } from './expense';

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
      line_id: 'should-be-stripped',
      performance_id: 'should-be-stripped',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect('line_id' in r.output).toBe(false);
      expect('performance_id' in r.output).toBe(false);
      expect(r.output.reimbursed).toBe(true);
    }
  });
});
