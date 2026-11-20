/**
 * THE DAY OF MANY (ADR-237): up to three things the Day draws each one whole
 * (its piece with the running order); from the fourth performance, lines,
 * grouped in morning, afternoon and night, with three filters: all, the ones
 * that need you, the ones you go to. What is done stays, dimmed; a line opens
 * its pase.
 */
export type DayPart = 'morning' | 'afternoon' | 'night' | 'untimed';
export type DayFilter = 'all' | 'need' | 'mine';
export const DAY_PARTS: readonly DayPart[] = ['morning', 'afternoon', 'night', 'untimed'];

/** Morning before 14h, afternoon before 20h, night after; no hour, its own group. */
export function dayPart(hour: number | null): DayPart {
  if (hour === null) return 'untimed';
  if (hour < 14) return 'morning';
  if (hour < 20) return 'afternoon';
  return 'night';
}

/** "20:30" → 20.5; anything else, null. */
export function hourOfClock(clock: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(clock ?? '');
  return m ? Number(m[1]) + Number(m[2]) / 60 : null;
}

export interface DayLineIn {
  hour: number | null;
  need: boolean;
  mine: boolean;
}

/** The groups with something after the filter, in the day's order; each keeps its rows' order. */
export function dayLineGroups<T extends DayLineIn>(rows: readonly T[], filter: DayFilter): { part: DayPart; rows: T[] }[] {
  const kept = rows.filter((r) => filter === 'all' || (filter === 'need' ? r.need : r.mine));
  return DAY_PARTS.map((part) => ({
    part,
    rows: kept.filter((r) => dayPart(r.hour) === part).sort((a, b) => (a.hour ?? 0) - (b.hour ?? 0)),
  })).filter((g) => g.rows.length > 0);
}
