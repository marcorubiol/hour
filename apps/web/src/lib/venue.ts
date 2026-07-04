/**
 * Venue domain helpers (ADR-053) — the PATCH contract for editing the
 * linkable venue entity (address, timezone, contacts…), shared by the
 * API endpoint, the edit dialog and the unit tests.
 *
 * Timezone is the field that matters: it feeds the dual-time display on
 * the road sheet (D-PRE-10 — `dualTime()` falls back to the viewer's zone
 * until the venue has one on record).
 */

import * as v from 'valibot';

/**
 * IANA zone check via the native medium: Intl throws a RangeError on
 * unknown zones. No bundled zone list to drift out of date.
 */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * One venue contact — production office, tech manager, box office…
 * Stored in venue.contacts (jsonb array). `name` anchors the row; the
 * rest is whatever the venue gave us.
 */
export const VenueContactSchema = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120)),
  role: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(120)))),
  email: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(254), v.email()))),
  phone: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(40)))),
});

export type VenueContact = v.InferOutput<typeof VenueContactSchema>;

/**
 * PATCH /api/venues/:id body. Whitelist — unknown keys are stripped, so
 * workspace_id/slug/created_by can never ride along. All fields optional;
 * the endpoint rejects an empty patch.
 */
export const VenuePatchSchema = v.object({
  name: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200))),
  city: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(120)))),
  country: v.optional(
    v.nullable(v.pipe(v.string(), v.regex(/^[A-Za-z]{2}$/, 'ISO 3166 alpha-2'))),
  ),
  address: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(300)))),
  capacity: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
  timezone: v.optional(
    v.nullable(
      v.pipe(
        v.string(),
        v.trim(),
        v.maxLength(64),
        v.check(isValidTimezone, 'Not a valid IANA timezone'),
      ),
    ),
  ),
  contacts: v.optional(v.pipe(v.array(VenueContactSchema), v.maxLength(20))),
  notes: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(2000)))),
});

export type VenuePatch = v.InferOutput<typeof VenuePatchSchema>;

/** Columns the venue endpoints return — superset of the ADR-049 list
 * (adds the 1c-editable address/contacts/notes payload). */
export const VENUE_COLS =
  'id,slug,name,city,country,address,capacity,timezone,contacts,notes';
