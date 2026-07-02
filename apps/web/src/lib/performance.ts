/**
 * Performance domain helpers — status → tone/label vocabulary, in one
 * place (same rationale as $lib/engagement.ts).
 *
 * Tone mapping follows the show lifecycle reading documented on
 * StateBadge: proposed → neutral · holds → info · confirmed → success ·
 * invoiced → warning · paid/done → faint · cancelled → danger.
 */

import { Constants, type Enums } from './db-types';

export type PerformanceStatus = Enums<'performance_status'>;

export const PERFORMANCE_STATUSES = Constants.public.Enums.performance_status;

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'faint';

const TONES: Record<PerformanceStatus, StatusTone> = {
  proposed: 'neutral',
  hold: 'info',
  hold_1: 'info',
  hold_2: 'info',
  hold_3: 'info',
  confirmed: 'success',
  invoiced: 'warning',
  done: 'faint',
  paid: 'faint',
  cancelled: 'danger',
};

export function performanceStatusTone(status: string): StatusTone {
  return TONES[status as PerformanceStatus] ?? 'neutral';
}

/** UI label — holds keep their rank visible (hold 1 beats hold 3). */
export function performanceStatusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}
