import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import {
  HOLD_NOTICE_DEFAULT,
  PERFORMANCE_STATUSES,
  PerformanceCreateSchema,
  PerformancePatchSchema,
  decideBy,
  isHoldStatus,
  performanceStatusFamily,
  performanceStatusLabel,
  performanceStatusTone,
} from './performance';

const PROJECT = '019e0bb1-8541-7189-bfec-6c0e6826d497';

describe('PerformanceCreateSchema', () => {
  it('accepts the minimal create (project + date)', () => {
    const r = v.safeParse(PerformanceCreateSchema, {
      project_id: PROJECT,
      performed_at: '2031-01-15',
    });
    expect(r.success).toBe(true);
  });

  it('rejects impossible dates and bad countries', () => {
    expect(
      v.safeParse(PerformanceCreateSchema, {
        project_id: PROJECT,
        performed_at: '2031-02-31',
      }).success,
    ).toBe(false);
    expect(
      v.safeParse(PerformanceCreateSchema, {
        project_id: PROJECT,
        performed_at: '2031-01-15',
        country: 'ESP',
      }).success,
    ).toBe(false);
  });

  it('strips unknown fields (fee cannot ride along)', () => {
    const r = v.safeParse(PerformanceCreateSchema, {
      project_id: PROJECT,
      performed_at: '2031-01-15',
      fee_amount: 5000,
      workspace_id: PROJECT,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect('fee_amount' in r.output).toBe(false);
      expect('workspace_id' in r.output).toBe(false);
    }
  });
});

describe('PerformancePatchSchema', () => {
  it('accepts a status-only patch and a full schedule patch', () => {
    expect(v.safeParse(PerformancePatchSchema, { status: 'confirmed' }).success).toBe(
      true,
    );
    const r = v.safeParse(PerformancePatchSchema, {
      performed_at: '2031-01-15',
      load_in_at: '2031-01-15T11:00:00.000Z',
      soundcheck_at: null,
      start_at: '2031-01-15T19:00:00.000Z',
      venue_name: '  Sala X ',
      city: null,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.output.venue_name).toBe('Sala X');
  });

  it('hold_notice_days: 0..365 or null pass, out-of-range and fractions fail (ADR-079 §2)', () => {
    expect(v.safeParse(PerformancePatchSchema, { hold_notice_days: 0 }).success).toBe(true);
    expect(v.safeParse(PerformancePatchSchema, { hold_notice_days: 45 }).success).toBe(true);
    expect(v.safeParse(PerformancePatchSchema, { hold_notice_days: 365 }).success).toBe(true);
    expect(v.safeParse(PerformancePatchSchema, { hold_notice_days: null }).success).toBe(true);
    expect(v.safeParse(PerformancePatchSchema, { hold_notice_days: -1 }).success).toBe(false);
    expect(v.safeParse(PerformancePatchSchema, { hold_notice_days: 366 }).success).toBe(false);
    expect(v.safeParse(PerformancePatchSchema, { hold_notice_days: 12.5 }).success).toBe(false);
  });

  it('rejects garbage timestamps and money fields never pass', () => {
    expect(
      v.safeParse(PerformancePatchSchema, { start_at: 'not-a-time' }).success,
    ).toBe(false);
    const r = v.safeParse(PerformancePatchSchema, {
      status: 'hold',
      fee_amount: 9000,
      notes: 'sneak',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect('fee_amount' in r.output).toBe(false);
      expect('notes' in r.output).toBe(false);
    }
  });
});

describe('status vocabulary', () => {
  it('every enum value has a tone and a label', () => {
    for (const s of PERFORMANCE_STATUSES) {
      expect(performanceStatusTone(s)).toBeTruthy();
      expect(performanceStatusLabel(s)).not.toContain('_');
    }
  });
});

describe('performanceStatusFamily', () => {
  it('maps every status to its chip shape', () => {
    expect(performanceStatusFamily('confirmed')).toBe('confirmed');
    expect(performanceStatusFamily('invoiced')).toBe('confirmed');
    expect(performanceStatusFamily('done')).toBe('confirmed');
    expect(performanceStatusFamily('paid')).toBe('confirmed');
    expect(performanceStatusFamily('hold')).toBe('hold');
    expect(performanceStatusFamily('hold_1')).toBe('hold');
    expect(performanceStatusFamily('hold_3')).toBe('hold');
    expect(performanceStatusFamily('proposed')).toBe('proposed');
    expect(performanceStatusFamily('cancelled')).toBe('proposed');
  });

  it('unknown statuses never read as commitment', () => {
    expect(performanceStatusFamily('whatever')).toBe('proposed');
  });

  it('covers the full enum — a new status must pick a shape', () => {
    for (const s of PERFORMANCE_STATUSES) {
      expect(['confirmed', 'hold', 'proposed']).toContain(performanceStatusFamily(s));
    }
  });
});

describe('isHoldStatus', () => {
  it('true for every hold rank, false for the rest', () => {
    expect(isHoldStatus('hold')).toBe(true);
    expect(isHoldStatus('hold_1')).toBe(true);
    expect(isHoldStatus('hold_2')).toBe(true);
    expect(isHoldStatus('hold_3')).toBe(true);
    expect(isHoldStatus('proposed')).toBe(false);
    expect(isHoldStatus('confirmed')).toBe(false);
    expect(isHoldStatus('cancelled')).toBe(false);
    expect(isHoldStatus('whatever')).toBe(false);
  });
});

describe('decideBy (ADR-079 §2)', () => {
  it('NULL notice follows the standard default', () => {
    expect(HOLD_NOTICE_DEFAULT).toBe(30);
    expect(decideBy('2031-08-15', null)).toBe('2031-07-16');
    expect(decideBy('2031-08-15', undefined)).toBe('2031-07-16');
  });

  it('explicit N subtracts N days from the gig day', () => {
    expect(decideBy('2031-08-15', 7)).toBe('2031-08-08');
    expect(decideBy('2031-08-15', 60)).toBe('2031-06-16');
  });

  it('0 = no notice — no decide-by day at all', () => {
    expect(decideBy('2031-08-15', 0)).toBeNull();
  });

  it('accepts a full instant and crosses month/year boundaries', () => {
    expect(decideBy('2031-08-15T20:30:00.000Z', 15)).toBe('2031-07-31');
    expect(decideBy('2031-01-10', 30)).toBe('2030-12-11');
  });
});
