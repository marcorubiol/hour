import { describe, expect, it } from 'vitest';
import { dateStatusFamily, DATE_STATUSES } from './date';

describe('dateStatusFamily', () => {
  it('tentative is a possibility, confirmed/done the solid form', () => {
    expect(dateStatusFamily('tentative')).toBe('hold');
    expect(dateStatusFamily('confirmed')).toBe('confirmed');
    expect(dateStatusFamily('done')).toBe('confirmed');
    expect(dateStatusFamily('cancelled')).toBe('proposed');
  });

  it('unknown statuses never read as commitment', () => {
    expect(dateStatusFamily('nope')).toBe('proposed');
  });

  it('covers the full enum', () => {
    for (const s of DATE_STATUSES) {
      expect(['confirmed', 'hold', 'proposed']).toContain(dateStatusFamily(s));
    }
  });
});
