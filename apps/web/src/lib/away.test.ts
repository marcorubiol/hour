/**
 * The absence sentence's grammar. It lives here because it was written twice
 * and both copies drifted — see away.ts.
 */
import { describe, expect, it } from 'vitest';
import { awayRest, coversDay, daysBetween, type AwayWords } from './away';

const W: AwayWords = {
  until: 'until',
  back: 'back tomorrow',
  left: '{n} days left',
  leftOne: '1 day left',
};
const dm = (iso: string) => `${Number(iso.slice(8, 10))} Aug`;

describe('the absence, as a sentence for one day', () => {
  it('counts what is LEFT from the day you are on, not the run length', () => {
    expect(awayRest('2026-08-14', '2026-08-20', W, dm)).toBe('until 20 Aug · 6 days left');
    expect(awayRest('2026-08-17', '2026-08-20', W, dm)).toBe('until 20 Aug · 3 days left');
  });

  it('the last day does not count to zero — it says what happens next', () => {
    expect(awayRest('2026-08-20', '2026-08-20', W, dm)).toBe('back tomorrow');
  });

  it('one day gets its own word: a language may not build it from the plural', () => {
    expect(awayRest('2026-08-19', '2026-08-20', W, dm)).toBe('until 20 Aug · 1 day left');
  });

  it('a run covers both its ends — a one-day absence still covers its day', () => {
    expect(coversDay('2026-08-14', '2026-08-14', '2026-08-14')).toBe(true);
    expect(coversDay('2026-08-20', '2026-08-14', '2026-08-20')).toBe(true);
    expect(coversDay('2026-08-13', '2026-08-14', '2026-08-20')).toBe(false);
    expect(coversDay('2026-08-21', '2026-08-14', '2026-08-20')).toBe(false);
  });

  it('daysBetween is whole days in UTC — a DST month must not shave one off', () => {
    // 25 Oct 2026 is the European clock change; local-midnight arithmetic
    // returns 6.958… days here and rounds the count wrong on one day a year.
    expect(daysBetween('2026-10-24', '2026-10-31')).toBe(7);
  });
});
