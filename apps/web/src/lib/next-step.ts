/**
 * The days a next step almost always lands on (ux-flujos § 17): tomorrow,
 * next Monday, in two weeks and the first of next month. The date field
 * stays for anything else. Days are the viewer's calendar days (YYYY-MM-DD),
 * like every date-input seed (`localDayISO`).
 */
import { localDayISO } from '$lib/datetime';

export type NextStepShortcut = { key: 'tomorrow' | 'monday' | 'two_weeks' | 'next_month'; day: string };

function plusDays(from: Date, n: number): Date {
  return new Date(from.getFullYear(), from.getMonth(), from.getDate() + n);
}

export function nextStepShortcuts(now: Date = new Date()): NextStepShortcut[] {
  // Monday strictly after today: on a Monday, «Monday» is the next one.
  const toMonday = ((8 - now.getDay()) % 7) || 7;
  return [
    { key: 'tomorrow', day: localDayISO(plusDays(now, 1)) },
    { key: 'monday', day: localDayISO(plusDays(now, toMonday)) },
    { key: 'two_weeks', day: localDayISO(plusDays(now, 14)) },
    { key: 'next_month', day: localDayISO(new Date(now.getFullYear(), now.getMonth() + 1, 1)) },
  ];
}
