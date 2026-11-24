/**
 * THE DAY IS ALWAYS THE SAME (ADR-247, amending ADR-237): one box per thing,
 * by hour, whatever the day holds. The three filters (all, the ones that need
 * you, the ones you go to) only when the day holds more than one project:
 * they separate what is yours from another show's, and with one show there
 * is nothing to separate. What is done stays, dimmed; a box opens its pase.
 */
export type DayFilter = 'all' | 'need' | 'mine';

/** "20:30" → 20.5; anything else, null. */
export function hourOfClock(clock: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(clock ?? '');
  return m ? Number(m[1]) + Number(m[2]) / 60 : null;
}

export interface DayRowIn {
  need: boolean;
  mine: boolean;
}

/** The rows the filter keeps, in their order. */
export function dayFilterRows<T extends DayRowIn>(rows: readonly T[], filter: DayFilter): T[] {
  return rows.filter((r) => filter === 'all' || (filter === 'need' ? r.need : r.mine));
}

/** The filters show when the day's things belong to more than one project. */
export function dayFiltersShown(projectIds: readonly (string | null)[]): boolean {
  return new Set(projectIds.filter(Boolean)).size > 1;
}
