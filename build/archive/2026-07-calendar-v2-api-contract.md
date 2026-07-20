# Calendar v2 — API contract (stages 2+3 of 3)

> **ARCHIVED AS-BUILT SNAPSHOT.** Verify current contracts in code before reuse.

> **Status: IMPLEMENTED (endpoints + `$lib/calendar.ts` pure functions).**
> Written 2026-07-18, calendar-v2 branch. Binding source: `_decisions.md § ADR-078`
> (+ ADR-071/072 access + day semantics). Stage 1 delivered the migrations
> (`build/migrations/2026-07-18_*.sql`) and the db-types hand-patch; stage 2 (this
> doc + code) delivered the endpoints; stage 3 (2026-07-18, same day) implemented
> the pure functions in `$lib/calendar.ts` (§ 5 below now shows the AS-BUILT
> signatures) + their unit suite + the RLS suites
> (`tests/rls/availability-block.test.ts`, `tests/rls/date-cascade.test.ts` —
> both self-skip via live probes while the migrations are unapplied). The UI
> builds against THIS document.
>
> **The migrations are NOT applied to any live DB yet.** Every consumer of the new
> endpoints must follow § Graceful absence.

Conventions shared by every endpoint below (the house pattern):

- Auth: `Authorization: Bearer <supabase JWT>` — missing → `401 {"error":"missing_authorization"}`.
- All responses `application/json; charset=utf-8` (except 204).
- Query/body validation via Valibot; failures → `400 {"error":"invalid_query"|"invalid_body", issues?, hint?}`.
- `*_ids` query params: comma-separated uuids, invalid entries silently dropped, deduped.
- Errors ride `$lib/server/errors.ts#pgErrorResponse`: stable machine codes to the
  client, full detail to the server log. Unmapped upstream failures → `502 {"error":"postgrest_error"}`.
- RLS is the authorization layer. Zero rows = not found OR not allowed — indistinguishable by design.
- **No money columns anywhere in these payloads.** The money door stays `/api/money/*`.

---

## 1. `/api/availability` — blackouts (`availability_block`)

Entity: person (or whole company when `person_id` is null) unavailable for a day
range. Day-precision (`starts_on`/`ends_on` are DATEs). **No `kind`/reason axis**
(ADR-078 §4) — the why, if any, is free prose in `note`. Access: workspace-member
RLS (venue/person_note/task family, NOT `has_permission`).

Domain module: `$lib/availability.ts` — `AVAILABILITY_CERTAINTIES`,
`AvailabilityCreateSchema`, `AvailabilityPatchSchema`, `AvailabilityItem`,
`AVAILABILITY_SELECT`.

```ts
type AvailabilityCertainty = 'unavailable' | 'tentative';

type AvailabilityItem = {
  id: string;
  workspace_id: string;
  person_id: string | null;        // null = the whole company
  starts_on: string;               // YYYY-MM-DD, inclusive
  ends_on: string;                 // YYYY-MM-DD, inclusive, >= starts_on
  certainty: AvailabilityCertainty;
  note: string | null;
  created_at: string;
  updated_at: string;
  person: { id: string; slug: string; full_name: string } | null; // embed for chip labels
};
```

### GET `/api/availability`

| Param | Type | Notes |
|---|---|---|
| `workspace_ids` | uuid list | optional — none = everything RLS lets through (cross-space visibility for shared people comes free, ADR-078 §5) |
| `from`, `to` | ISO date | optional, **OVERLAP semantics**: matches when `starts_on <= to AND ends_on >= from` (a blackout is a range — unlike `/api/dates`, which windows on starts only) |
| `limit` | 1–500 | default 200 |

→ `200 {"items": AvailabilityItem[]}` ordered `starts_on.asc`.

### POST `/api/availability`

Body (`AvailabilityCreateSchema`):

```ts
{
  workspace_id: string;            // uuid, REQUIRED — write-target is always ONE workspace (no fan-out)
  person_id?: string | null;       // omit/null = whole company; must be visible (can_see_person)
  starts_on: string;               // real ISO date
  ends_on: string;                 // real ISO date, >= starts_on (400 otherwise)
  certainty?: AvailabilityCertainty; // default 'unavailable'
  note?: string | null;            // trimmed, max 500
}
```

Rides the `create_availability_block` RPC (claim-bound INSERT policy; RPC is
member-gated, workspace taken verbatim).

→ `201 {"block": <availability_block row>}` — the **bare row** (no `person`
embed; the list GET carries it). Errors: `400 invalid_input` (22023) ·
`403 forbidden` (42501 — collapses unknown workspace/person and no-membership).

### PATCH `/api/availability/:id`

Body (`AvailabilityPatchSchema`) — all optional, at least one:

```ts
{ starts_on?, ends_on?, certainty?, note? }   // NO workspace_id/person_id — rescope = delete + recreate
```

Direct PostgREST PATCH (member-gated policy, not claim-bound). → `200 {"block": AvailabilityItem}`
(with `person` embed). Errors: `400 empty_patch` · `400 constraint_violation`
(final row breaks `ends_on >= starts_on`) · `404 not_found`.

### DELETE `/api/availability/:id`

Rides `delete_availability_block` RPC (soft-delete; no DELETE policy, ADR-048).
→ `204`. Unknown/foreign id → `404 not_found` (no existence oracle).

---

## 2. `/api/dates` — the non-performance calendar primitive

Domain module: `$lib/date.ts` — `DATE_KINDS`, `DATE_STATUSES`,
`DATE_CREATE_STATUSES`, `TRAVEL_DIRECTIONS`, `DateCreateSchema`,
`DatePatchSchema`, `DateRow`.

```ts
type DateKind = 'rehearsal' | 'residency' | 'travel_day' | 'press' | 'other' | 'day_off';
type DateStatus = 'tentative' | 'confirmed' | 'cancelled' | 'done';
type TravelDirection = 'outbound' | 'return' | 'leg';
type DateRow = Tables<'date'>;      // full row: + line_id, travel_direction, custom_fields, …
```

### GET `/api/dates` — EXTENDED select with graceful 42703 fallback (as built)

Same filter contract as before (union filter `project_ids`/`workspace_ids`,
window on `starts_at`, embeds `project` + `venue(timezone)`). The select **now
asks for the ADR-078 columns up front** — `line_id,travel_direction` and
`label:custom_fields->>label` (awayBands + the Altres label chip) — and
degrades when the migrations aren't applied yet: an undefined-column error
(PostgREST `42703`) retries **once** with the legacy select, so the live
calendar keeps working and the new fields simply arrive absent (§ Graceful
absence — feature silently off, zero errors surfaced). Consumers (MonthGrid,
AgendaList) must therefore tolerate the new fields being `undefined` on any
given response — they may be missing pre-migration even though the route
already requests them.

### POST `/api/dates`

Body (`DateCreateSchema`):

```ts
{
  project_id: string;              // uuid, REQUIRED
  kind: DateKind;                  // REQUIRED
  starts_at: string;               // REQUIRED — ISO timestamp (timestamptz; type the hour in the VENUE's local time, ADR-078 §11)
  ends_at?: string | null;
  all_day?: boolean;               // default false
  title?: string | null;           // trimmed, max 200
  venue_name?: string | null;      // trimmed, max 200
  city?: string | null;            // trimmed, max 120
  country?: string | null;         // ISO 3166 alpha-2 (uppercased server-side)
  status?: 'tentative' | 'confirmed';  // CREATE WHITELIST (§9) — default 'tentative'; cancelled/done are lifecycle, PATCH-only
  line_id?: string | null;         // must belong to project (else 400 invalid_input)
  performance_id?: string | null;  // must belong to project (else 400 invalid_input)
  travel_direction?: TravelDirection | null; // only with kind='travel_day' (else 400)
  label?: string | null;           // only with kind='other' (else 400); trimmed, max 120 → stored at custom_fields.label
}
```

Rides the `create_date` RPC — claim-independent, gated on
`has_permission(project, 'edit:performance')`. Every cross-field rule above is
enforced BOTH at the endpoint (400 + hint) and inside the RPC (strict AI=UI
parity, §7 — no write path can bypass the contract). The RPC is the **only**
writer of `custom_fields` on create (§8).

→ `201 {"date": DateRow}`. Errors: `400 invalid_body` (schema/cross-field) ·
`400 invalid_input` (RPC 22023: line/performance ∉ project, bad status…) ·
`403 forbidden` (42501 — collapses unknown project and no-permission).

### PATCH `/api/dates/:id`

Body (`DatePatchSchema`) — all optional, at least one:

```ts
{
  kind?, status?,                  // status accepts the FULL 4-state lifecycle here (residency holds resolve as 1 confirmed + N cancelled)
  starts_at?, ends_at?, all_day?,
  title?, venue_name?, city?, country?,
  line_id?, performance_id?,       // relink guard: must belong to the date's project → else 400 cross_project_link
  travel_direction?,               // requires effective kind='travel_day' → else 400
  label?                           // requires effective kind='other' → else 400; null/'' removes it
}
// NO project_id / workspace_id — rescoping is delete + recreate.
```

Direct PostgREST PATCH (permission-gated `date_update` policy, not claim-bound).
Invariant maintenance the DB can't express, done by the endpoint:

- `kind` moves away from `'travel_day'` without an explicit `travel_direction`
  → the endpoint writes `travel_direction: null` (instead of dying on the CHECK).
- `label` is not a column: folded into `custom_fields` (merge — only the `label`
  key is ever touched). `kind` moves away from `'other'` → any stored label is
  stripped (keeps `/api/dates/labels` honest).

→ `200 {"date": DateRow}`. Errors: `400 empty_patch` · `400 cross_project_link`
· `400 invalid_body` (travel/label rules) · `400 constraint_violation` (23514) ·
`404 not_found`.

### DELETE `/api/dates/:id`

Rides `delete_date` RPC (soft-delete, `edit:performance`-gated). → `204`.
Unknown/foreign id → `404 not_found`.

### GET `/api/dates/labels?workspace_ids=uuid,...`

`workspace_ids` REQUIRED (≥1 valid uuid, else 400). Returns the distinct
non-null `custom_fields->>'label'` values of the workspaces' live date rows —
the autocomplete corpus for the "Altres" label (§8; the vocabulary IS the usage
history, no vocabulary table).

→ `200 {"labels": string[]}` — deduped, locale-sorted. Scan capped at 2000 rows.

---

## 3. GET `/api/team?workspace_ids=uuid,...` — the blackout dialog's person select

`workspace_ids` REQUIRED (≥1 valid uuid, else 400). The workspaces' TEAM:
distinct persons appearing in `cast_member ∪ crew_assignment` (deduped per
`(workspace_id, person_id)`), **not** the contact book (ADR-078 §5). Deleted or
RLS-invisible persons drop out (inner-join embed).

```ts
type TeamItem = {
  person_id: string;
  workspace_id: string;
  slug: string;
  full_name: string;
};
```

→ `200 {"items": TeamItem[]}` sorted by `full_name`. Works against the live DB
today (source tables already exist).

---

## 4. GET `/api/performances?rosters=1` — roster opt-in (conflict engine feed)

Existing month fetch, plus `rosters` (`'0'`|`'1'`, default `'0'`). With
`rosters=1` every item gains:

```ts
person_ids: string[]   // who is on this gig: project cast_member − replaced + cast_override + crew_assignment, deduped
```

Batched server-side in 3 set-based queries (`$lib/server/rosters.ts#fetchPerformanceRosters`),
reduced through the same pure rule as the detail bundle (`rosterPersonIds`, § 5) —
month view and detail page can never disagree. An **empty `person_ids` means "no
team data"**: RLS hid the team tables or none exist — `conflictsFor()` degrades
that to `'possible'`, honestly. Field absent when `rosters` not requested.
Works against the live DB today.

---

## 5. `$lib/calendar.ts` exports

Pure, day-precision, dates injected, unit-tested (`calendar.test.ts`). Existing:
`monthGrid`, `addMonths`, `addDaysIso`, `dayKeyInTz`.

### Implemented in stage 2

```ts
interface RosterParts {
  cast: string[];                                                    // project cast_member person ids
  overrides: Array<{ person_id: string; replaces_person_id: string | null }>;
  crew: string[];
}
function rosterPersonIds(parts: RosterParts): string[];
// project cast − replaced + overrides + crew, deduped. The single roster rule —
// both the batched ?rosters=1 fetch and performanceRoster() reduce to it.
```

### Implemented in stage 3 (as-built — deviations from the stage-2 promise noted inline)

```ts
interface RosterBundle {                     // structural slice of PerformanceBundleResult —
  performance: {                             // declared in $lib/calendar so the module stays
    cast_override: Array<{                   // client-importable (no $lib/server import);
      person: { id: string } | null;         // the real bundle is assignable as-is
      replaces_person: { id: string } | null;
    }>;
    crew_assignment: Array<{ person: { id: string } | null }>;
  };
  cast_members: Array<{ person: { id: string } | null }>;
}

function performanceRoster(bundle: RosterBundle): string[];
// Thin adapter: maps the detail bundle (cast_members, performance.cast_override,
// performance.crew_assignment) into RosterParts and returns rosterPersonIds(parts).
// Person embeds RLS hid (null) are dropped; an override whose substitute is
// hidden is dropped WHOLE (removal without addition would understate the roster).

type ConflictSeverity = 'people' | 'possible' | 'blackout' | 'blackout-tentative';

interface CalendarEvent {                    // day-precision projection of a performance or date row
  id: string;
  day: string;                               // YYYY-MM-DD (bucketed via dayKeyInTz upstream)
  project_id: string;
  workspace_id: string;                      // ADDED in stage 3: company-wide blackouts scope by
}                                            // workspace — unresolvable from project_id inside a pure
                                             // function; both month fetches already return it

interface Conflict {
  severity: ConflictSeverity;
  event_ids: [string, string] | [string];    // pair for people/possible; single event vs a blackout
  person_ids: string[];                      // the shared/blocked people ('possible' and
                                             // company-wide blackouts: empty)
  availability_block_id?: string;            // set on blackout severities
}

type BlackoutInput = Pick<                   // structural subset — AvailabilityItem[] fits as-is,
  AvailabilityItem,                          // tests/bare rows don't need the full item
  'id' | 'workspace_id' | 'person_id' | 'starts_on' | 'ends_on' | 'certainty'
>;

function conflictsFor(
  events: CalendarEvent[],
  rosters: Record<string, string[]>,         // event id → person_ids (from ?rosters=1; dates have no roster)
  blackouts: BlackoutInput[],
): Conflict[];
// 'people'    — same day, DIFFERENT projects, shared person, BOTH rosters known (non-empty).
// 'possible'  — same day, different projects, ≥1 roster empty (honest "no team data" degradation).
// 'blackout'  — event day ∈ [starts_on, ends_on] of a certainty='unavailable' block
//               whose person is on the event's roster (any workspace — cross-space
//               visibility is free, ADR-078 §5), or company-wide (person_id null,
//               same workspace as the event).
// 'blackout-tentative' — same overlap, certainty='tentative'.
//
// SAME-PROJECT PAIRS NEVER CLASH (stage-3 precision): a project's gig + travel +
// rehearsal on one day is its own plan, and its people overlap by construction —
// zero signal. Cross-company double-booking (ADR-072 §6) is cross-project by nature.
// Output ordering: most severe first — people → blackout → blackout-tentative →
// possible, stable within a rank.

function awayBands(
  dates: Array<Pick<DateRow, 'id' | 'project_id' | 'line_id' | 'kind' | 'travel_direction' | 'starts_at'>>,
  ownEventDays?: Record<string, string[]>,   // project_id → days that carry an own event
): Array<{ from: string; to: string; project_id: string; line_id?: string }>;
// ADR-078 §6: an 'outbound' travel_day on day X paired with the NEXT 'return'
// travel_day on day Y of the SAME LINE (line-less travel days pair per project —
// the fallback; the scopes never mix) ⇒ the days strictly between (X, Y) with no
// own event for that project form ONE band. Unpaired outbound/return ⇒ NO band
// (the AI layer proposes missing legs — never a second inference rule). 'leg'
// rows neither open nor close a trip; a second outbound while a trip is open is
// ignored (the earliest brackets). An own-event day INSIDE the bracket splits
// the band into contiguous runs (stage-3 precision: a {from,to} range cannot
// represent a hole). Day key = starts_at.slice(0, 10) — travel days are
// day-level facts and the slice keeps the function timezone-free. Deterministic,
// no geography. DISPLAY-ONLY in v1: never an input to conflictsFor().
```

---

## 6. Graceful absence (BINDING for every UI consumer)

The ADR-078 tables/columns/RPCs **do not exist in the live DB** until the
migrations are applied. Consequences the UI must absorb as **"feature silently
absent"** — no crashes, no error toasts:

| Call | Failure until migrated | UI behavior |
|---|---|---|
| GET/POST/PATCH/DELETE `/api/availability*` | 502 (missing table/RPC) | render no blackouts; hide/disable nothing loudly |
| POST `/api/dates`, PATCH/DELETE `/api/dates/:id` | 502 (missing RPC/columns) or 400 | creation UI may exist, failures fail quiet |
| GET `/api/dates/labels` | works (custom_fields exists) — returns `[]` | fine |
| GET `/api/team` | works today | fine |
| GET `/api/performances?rosters=1` | works today | fine |
| GET `/api/dates` | extended select 42703s pre-migration | route retries once with the legacy select; new fields arrive `undefined`, UI renders without them |

Rule of thumb: any non-2xx from the new write/read paths above → treat as
absent/no-op, log to console at most. Only `400 invalid_body`-class responses on
user-initiated writes may surface as inline form errors.

Apply channel when the time comes: Supabase MCP `apply_migration`, additive-only,
in order `date_kind_day_off` → `date_cascade_travel` → `date_write_rpcs` (+
`availability_block`, `user_profile_person_id`), then regenerate db-types.
