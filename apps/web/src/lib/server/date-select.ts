/**
 * The columns a `date` row is read with, by the list (`GET /api/dates`) and
 * by the one row (`GET /api/dates/:id`, the vistazo of a date, ADR-139 p1).
 * One home, so the Planner's card and the vistazo read the same row and the
 * edit dialog can take either.
 */

import { COMMITMENTS_EMBED } from '$lib/people';
import { SCHEDULE_SLOT_EMBED } from '$lib/schedule-slot';

/** What every database has had since ADR-078: the retry when a column is missing. */
export const DATE_BASE_SELECT = [
  'id,kind,status,title,starts_at,ends_at,all_day,venue_name,city,country',
  'project_id,performance_id',
  'project:project_id(id,slug,name,accent,initials,workspace_id)',
  'venue:venue_id(timezone)',
];

export const DATE_EXTENDED_SELECT = [
  ...DATE_BASE_SELECT,
  'line_id,travel_direction',
  // ADR-089 — a trip's two ends. The card reads origin → destination.
  'origin_city,destination_city',
  // ADR-084 §1 — the multi-day block's grouping key. The planner joins
  // consecutive rows of one series into a band; NULL = a standalone date.
  'series_id',
  'label:custom_fields->>label',
  // ADR-090 P3 — the running order, so the day strip can draw a
  // rehearsal's moments as it draws a gig's.
  SCHEDULE_SLOT_EMBED,
  // ADR-103 — each person's «voy / no voy»: on a date, the only way onto it (ADR-147).
  COMMITMENTS_EMBED,
];
