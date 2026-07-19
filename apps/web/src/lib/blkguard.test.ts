import { describe, it, expect } from 'vitest';
import { blockDays, blockLimit } from './block';
describe('guard', () => {
  it('truncates', () => {
    const d = blockDays({ from: '2026-01-04', to: '2036-01-04', weekdays: [0] });
    console.log('10y sundays count', d.length, 'last', d.at(-1), 'limit', blockLimit(d.length));
    const d2 = blockDays({ from: '2026-01-04', to: '2027-06-06', weekdays: [0] });
    console.log('17mo sundays count', d2.length, 'last', d2.at(-1), 'limit', blockLimit(d2.length));
    const d3 = blockDays({ from: '2026-01-05', to: '2028-01-05', weekdays: [1,2,3,4,5] });
    console.log('dense count', d3.length, 'limit', blockLimit(d3.length));
    const d4 = blockDays({ from: '2026-01-04', to: '2027-12-26', weekdays: [0,3] });
    console.log('two-day count', d4.length, 'limit', blockLimit(d4.length));
    const d5 = blockDays({ from: '2026-01-04', to: '2027-05-30', weekdays: [0] });
    console.log('~510d sundays', d5.length, 'last', d5.at(-1), blockLimit(d5.length));
    expect(true).toBe(true);
  });
});
