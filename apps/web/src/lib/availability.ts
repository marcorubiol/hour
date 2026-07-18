/**
 * Availability-block (blackout) domain helpers — ADR-072 §2 / ADR-078 §4.
 * Single home for the certainty vocabulary and the POST/PATCH contracts
 * shared by the API endpoints and the calendar UI.
 *
 * A blackout is a person (or the whole company when person_id is null)
 * being away for a day range. Deliberately NO `kind`/reason axis (ADR-078
 * §4): "no estoy" is complete information — the why, if any, is free
 * prose in `note`.
 */

import * as v from 'valibot';
import type { Tables } from './db-types';
import { realIsoDate } from './datetime';

/**
 * Runtime vocabulary for `availability_block.certainty`. TEXT + CHECK in
 * the DB, not an enum (promotion is additive if a third state ever earns
 * its place) — so the mirror lives here, not in db-types Constants.
 */
export const AVAILABILITY_CERTAINTIES = ['unavailable', 'tentative'] as const;

export type AvailabilityCertainty = (typeof AVAILABILITY_CERTAINTIES)[number];

/**
 * POST /api/availability body. Write-target is always ONE workspace
 * (ADR-078 §5 — no fan-out); person_id null/absent = the whole company.
 * Creation rides the `create_availability_block` RPC (claim-bound INSERT
 * policy, same pattern as every create_*).
 */
export const AvailabilityCreateSchema = v.object({
  workspace_id: v.pipe(v.string(), v.uuid()),
  person_id: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
  starts_on: realIsoDate,
  ends_on: realIsoDate,
  certainty: v.optional(v.picklist(AVAILABILITY_CERTAINTIES), 'unavailable'),
  note: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500)))),
});

export type AvailabilityCreate = v.InferOutput<typeof AvailabilityCreateSchema>;

/**
 * PATCH /api/availability/:id body — field edits ride a direct PostgREST
 * PATCH (availability_block_update is member-gated, not claim-bound, and
 * the row stays SELECT-visible after a field edit; ADR-048 only bites
 * soft-deletes). Scope FKs (workspace_id, person_id) stay out — rescoping
 * a blackout is delete + recreate, same as the expense whitelist.
 */
export const AvailabilityPatchSchema = v.object({
  starts_on: v.optional(realIsoDate),
  ends_on: v.optional(realIsoDate),
  certainty: v.optional(v.picklist(AVAILABILITY_CERTAINTIES)),
  note: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500)))),
});

export type AvailabilityPatch = v.InferOutput<typeof AvailabilityPatchSchema>;

/**
 * Shape the availability endpoints return: the row plus a person embed for
 * chip labels (null = whole company OR a person RLS hides — the calendar
 * renders both as scope, never guesses).
 */
export type AvailabilityItem = Omit<
  Tables<'availability_block'>,
  'deleted_at' | 'created_by'
> & {
  person: { id: string; slug: string; full_name: string } | null;
};

/** PostgREST embed clause matching `AvailabilityItem` — shared by GET and PATCH. */
export const AVAILABILITY_SELECT = [
  'id,workspace_id,person_id,starts_on,ends_on,certainty,note,created_at,updated_at',
  'person:person_id(id,slug,full_name)',
].join(',');
