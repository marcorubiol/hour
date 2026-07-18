# Hour — Screen data spec (cold proposal)

> What: normative data spec per screen — what each surface SHOULD contain, anchored to the
> real schema and the real UI. Task 1 of the design+data pass (`_tasks.md` § Queue).
> Written: 2026-07-17 by .zerø, cold (no prior dump from Marco — his real-use contrast
> happens in the joint review sessions, screen by screen).
> Method: every proposal measured against `structure-model.md` (lens / module / entity edit
> surface) and the live schema (`schema.sql` + migrations through `2026-07-17_task_entity.sql`
> — schema.sql alone is stale by design; migrations are the truth).
> UI baseline: working tree 2026-07-17 (shell redesign in flight: `/h` is a greeting hall,
> ScopeStrip removed, lens routes space-less per ADR-067).
> Design checklist stays in `screens-inventory.md`; this doc owns the data dimension.

## How to read this

Every data item carries one tag:

- **[now]** — exists in schema AND is shown/editable in the UI today.
- **[db]** — exists in schema, NOT surfaced (or not editable) in the UI. Build work, no migration.
- **[gap]** — does not exist in the schema. Needs a migration (consolidated in § Schema gaps).

Per screen: **Is** (its structure-model category), **Today** (what it shows now, condensed),
**Should contain** (the normative proposal), **Open** (decisions for the review session).

## Cross-cutting findings — the headline deltas

**North star, declared mid-pass (ADR-069, 2026-07-17)**: Hour exists for a proactive,
consent-first AI layer over this data ("gig in Paris in a month + 20 contacts usually around
Paris → propose emailing them"). Every "should contain" below is also judged by "does this
feed or surface that layer". It promotes gaps #1 (organizations) and #2 (conversation
conversation log) from nice-to-have to **critical path** — they are the AI's network model
and negotiation memory. AI surfaces already in the model: `task.origin='ai'`, the hall
status sentence.
**Timezone rule — cross-cutting (2026-07-18, foreign gigs)**: *store the instant · display
venue-local as primary truth with viewer time as secondary courtesy only when they differ ·
ENTER times in venue-local · group by the venue's day.* Infrastructure exists: timeslots
are `timestamptz`, `venue.timezone` (IANA), `dualTime()` in `$lib/datetime.ts` (already
used by ScheduleTable + RoadsheetView). Pending: **entry bug** — performance dialogs
interpret typed times in the BROWSER tz (a "20:30" London show typed from Barcelona stores
19:30 London, silently wrong); coverage in Desk show-card / hall sentence / Calendar chip
times; no-linked-venue fallback = `workspace.timezone` with a visible label (never the
browser's, and push venue linking at create). `performance.performed_at` is a DATE (poster
day) — already tz-safe for bucketing; timed `date` events bucket by their venue's day when
linked.

**Calm mode — cross-cutting, DECIDED, UI in design (Marco, 2026-07-18)**: the whole app
gets two modes, **calm** and **open**. Calm cleans every surface — on the Desk it shows
only today + overdue; each surface defines what calm hides. Toggle placement being designed
(Marco's mock); scope per surface, persistence and default pending → ADR when the UI lands.
Pending builds should not bake in assumptions that fight a global display-mode filter.

**Hard boundary on the AI's contact reach** (from `research/profiles/99-patterns.md § 3.1`
+ the profile refusals): proposals draw contacts ONLY from the workspace(s) in scope —
contact books are never blended across workspaces (the freelance's book is her capital;
"do not suggest contacts across clients" is a stated refusal). And outreach proposals are
**per-recipient hand-crafted drafts approved one by one — never a blast** ("every pitch is
hand-crafted" is universal across selling profiles).

1. **`task` landed today with zero UI.** Migration `2026-07-17_task_entity.sql`: polymorphic
   (project / line / performance / conversation / free), `title, note, due_at, status, origin
   (manual|protocol|ai)`. Per structure-model D3 it surfaces in three places: Desk feed,
   a Tasks module, inline next-actions. None built. The single biggest [db] item — it touches
   Desk, project, line, performance and conversation below.
2. **`payment` has zero UI.** The advance+rest model (N payments per invoice) exists in DB;
   the app only flips `invoice.status` by hand. Money lens should own it.
3. **Conversation detail is a stub.** The page renders a de-slugged title and a back link —
   nothing else. For a booking tool, the conversation view is core, and it also exposes the
   one real schema hole: **no conversation log entity** (only `next_action_note`, 1 slot).
4. **Organizations are a text field.** ADR-065 says Contacts = people AND organizations;
   today an org is `person.organization_name` (free text) — can't be a contact, can't be an
   invoice payer, can't group people. Schema gap with the widest blast radius.
5. **cast/crew tables have no editors.** `cast_member`, `crew_assignment`, `cast_override`
   exist and render (line Team module, performance, road sheet) but nothing in the UI writes
   them. Same for `date` (rehearsals/travel): displayed, never creatable.
6. **Entity edit surfaces are half-missing.** Project and line have create dialogs but no
   edit dialogs (can't rename, can't change status/dates/description from the UI). Person
   has no field editor at all. Performance and workspace are the only complete ones.
7. **Settings is mostly vapor by design** — but three DB columns it pretends to manage are
   real and unwired: `user_profile.full_name`, `avatar_url`, `locale`.

---

## Shell + home

### `/h` — the hall — SETTLED (S1, 2026-07-17)

**Is**: entry point after login; sole home (ADR-068); the AI's first voice surface (ADR-069).
**Decision (review session 1)**: the **status sentence** renders statically with the
greeting — the two-stage reveal (built 07-16, deleted by ADR-068) stays dead; Marco
reopened it in S1 and re-rejected it knowingly. "Posa'm al dia" remains a straight door
to `/h/desk`. Rationale: silence without information is uncertainty, not calm; a click
made 100% of the time is a tax, not a choice — consent gates the demand-list (Desk),
not the awareness.
**Contains**:
- Greeting + date [now] — **in the user's locale**, not hardcoded Catalan
  (`user_profile.locale` exists, unwired) [db].
- **Status sentence** — truth-computed prose, never decorative; on load error render
  nothing (silence over lies). Three tonal states, priority-ordered:
  show-day ("Avui: Balsareny. Load-in a les 17h." — a gig day outranks everything) ·
  attention ("Dues coses vençudes — la més antiga fa cinc dies.") ·
  calm ("Tot tranquil. Tres obertes, cap vençuda — la propera espera fins dijous.").
  Inputs: conversation next-actions (DeskBoard semantics) + tasks when the API lands +
  today/tomorrow performances [db].
- Fourth state, slot only: **AI proposal teaser** ("Tinc una proposta per París — quan
  vulguis.") — consent-first door to an `origin='ai'` task (ADR-069). Not built yet.
- "torna al silenci" = the return link from Desk back to the hall (vocabulary kept);
  no collapse gesture exists.
**Build**: dispatched 2026-07-17 to an external agent via `build/hall-prompt.md`.

### `/h/desk` — Desk

**Is**: THE cross-concern digest (structure-model: not a lens; ranked by what needs me now;
owns no data — a query over the concerns + tasks).
**Today**: conversation next-actions only — verb (from status) + person/org + `#tags` (first 2,
from `conversation.custom_fields.tags`) + project dot, bucketed OVERDUE / TODAY / TOMORROW /
weekday / NEXT WEEK / LATER. Scoped by pins.
**Contains — SETTLED (S1, 2026-07-17)**: one ranked feed, four sources, grouped in day
buckets. **Within each bucket the type order is FIXED (Marco, 2026-07-18): tasks →
calendar → conversations → money** — mirroring the lens nav order (Desk · Calendar ·
Contacts · Money), so the feed and the nav speak one vocabulary and every paper has its
place. The show-day card sits above everything in its day (banner, outside the order);
within each type-block, natural secondary sort (calendar by time, conversations by due,
money by severity). Urgency lives in the buckets + overdue reds, not in within-day
reordering. (Supersedes the earlier "mixed by urgency within buckets" phrasing.)
- Conversation next-actions [now].
- **Tasks** per the ADR-070 model: surface at `max(from_at, due_at − lead_days)`; dormant
  (`from_at` future) never rendered; undated → quiet "Anytime" tail; urgency derived, never
  stored; row shows the computed "surfaces" date, editable (AI-proposed lead visible).
  `origin` badge for `protocol`/`ai`; **ai rows are the consent inbox** (ADR-069) [db + gap
  → migration `from_at`/`lead_days`, dispatched].
- **Performances as day-anchors**: today's/tomorrow's gig opens its bucket (venue, city,
  `load_in_at`) — on a show day the gig IS what needs you [db].
- **Money alerts**: invoices `issued` past `due_on`; performances `done` with no invoice.
  Only for `read:money` viewers [db].
- **`date` events** for today/tomorrow (rehearsal, travel_day) [db].
- Quick-capture at top: one line → creates an anytime task [db].
**Desk row system — settled in design iteration (2026-07-17/18, Marco + .zerø)**:
- **Derived calls, stored tasks**: nothing enters the Desk as a mere fact — the entry
  ticket is actionability. Only TASKS are stored; every other row is a **call computed
  from entity state** (invoice past expected → "remind"; conversation due → "reply") that
  **disappears when the state changes** — nothing to tick, nothing to clean. Optional
  gesture: promote a call to a task (human-decided, never automatic). Same
  derived-over-stored theorem as paid=Σpayments and away-days.
- **FINAL row system (converged 2026-07-18; Marco's mockups = canonical visual ref)**:
  - **The left gutter carries the type**, not the rows: one mono small-caps label per
    run — **TAREA · AGENDA · CONVERSACIÓN · DINERO, singular**, tinted per concern,
    with a fine vertical hairline. **Labels are doors**: click → that lens with the
    current scope applied (the gutter is wayfinding — it teaches the app's structure).
  - **Rows carry NO leading marks** (no dots, no glyphs — the marginalia won). One-line
    default; the second line must be EARNED by an urgent why-now. Context path
    `space · project · line` in quiet mono (identity is textual — no color codes to
    learn). Verb labels only on derived calls (reply/chase/confirm/remind/revive),
    tinted per concern; a task's title IS its verb. AGENDA rows lead with their hour
    (time-as-glyph, venue-local per the timezone rule).
  - Actions (done, open conversation, prepare reminder) on **hover only — persistent
    in OVERDUE**. Money amounts only on remind/confirm rows. Anytime recedes AND is
    **excluded from the headline count** ("10 need you" counts dated items only).
  - **No per-bucket counters** (Marco, 2026-07-18: noise — never more than ~4 items a
    day). Empty days don't render.
  - AI proposal = ghost row inside the TAREA block: tinted container, PROPOSED badge,
    reason line, Add/dismiss. The show-day card remains the single banner exception.
- **Pulse strip** (Marco's desk metaphor, approved): ONE computed prose line under the
  header replacing static subtitle — "3 conversaciones vivas · 2 holds esperando ·
  €12.400 pipeline · próxima función sábado" — each fragment truth-derived, each a door
  to its lens. The Desk-level sibling of the hall sentence (another AI voice surface,
  ADR-069). No widgets, no mini-lenses (ADR-068 lesson: surfaces don't duplicate).
- **Revive on quiet days**: when the day has no overdue and no show, the feed offers
  1-2 season-calibrated relationship-maintenance calls (`revive · Teatre X · sin
  contacto esta temporada`, ADR-073 semantics) — proposal-toned, capped, never on
  loud days. Silence becomes opportunity, not emptiness.
- **Calm mode (settled 2026-07-18)**: a USER-ACTIVATED filter — entering calm is a
  consent act, never automatic. ON: the Desk reduces to today (show card + today's
  dated items + quick capture); tomorrow / the week / Anytime fold away. Overdue is
  NOT itemized but never denied: one quiet footer line — "2 vençudes i 7 coses més
  esperen fora del mode calma →" (click exits). The pulse strip stays (ambient truth,
  one line); the headline counts only what's visible ("3 need you · la resta espera").
  Truth rule: silence without lies — the footer line is the difference between calm
  and denial. Control: the clock-corner pill, **outline = available / solid = active**
  (reuses the possibility/commitment grammar so it reads as a control, not a system
  diagnosis); when active the whole page drops one contrast step — the mode is felt,
  not just read. Remembered across sessions; keyboard `c`. Future (ADR-069): the AI
  may PROPOSE calm on show days ("¿modo calma hasta el load-in?"), consent-first.
**Watch** (not open — settled to wait): if the task+event mix gets noisy in real use, that's
the structure-model trigger for the Work/Flow lens. Don't pre-build it.
**Build**: dispatched 2026-07-17 — `task-model-prompt.md` (schema+API, first) →
`desk-prompt.md` (UI) · `desk-design-prompt.md` (design tool), all in `build/`.

### `/h/[workspace]` — space portada

> **Moved out of S1 by Marco (2026-07-17)**: workspace + project + line review as ONE pack
> — the containers session (R2). S1 closed the views (hall, Desk, lenses); this section's
> proposal below stands as the cold input for R2. Post-S1 notes for R2: the 7-day
> mini-Desk is now triple-redundant (Desk v2 coming); the people block gained weight
> (person conflicts + blackouts + user↔person bridge, no invite path for Anouk yet);
> fiscal identity (gap #3) must come out of R2 designed-and-migrable; with the
> cross-workspace vision (ADR-074 §6) the portada is "the room you visit" in a client's
> space.

**Is**: entity edit surface #1 (space identity) + the space's project map.
**Today**: masthead (domain · city kicker, name, description, accent, edit pencil), stats bar
(projects / confirmed / holds / conversations), Next-7-days DeskBoard, projects grid ordered
by activity with per-line rows, + New project / + New line.
**Should contain**:
- Masthead identity [now] + **logo** (`workspace.logo_url` — column live, no upload flow;
  needs R2 + CSP, known ADR-062 deferral) [db].
- Stats bar [now]; add **season framing** ("2026-27: N confirmed · N in play") once seasons
  are real — `date.season` exists but nothing writes it [db, low priority].
- Projects grid [now]. Per-card: add next upcoming performance date [db — cheap, high value].
- **People block**: workspace members (`workspace_membership` + `user_profile`) — who's in
  this space, role. Today invisible everywhere except vapor-Settings [db].
- **Fiscal identity** (for invoicing): legal name, VAT id, address, IBAN — ADR-062 said
  "fiscal fields later"; `account` has only `billing_email`/`country` [gap — § Schema gaps #3].
**Open**: does the portada show a scoped Desk (as today) or move closer to a "space
dashboard" (stats + projects only) now that Desk is one key away?

---

## Lenses

### `/h/calendar` — Calendar lens

**Is**: concern-lens over time. Read/aggregate; hosts entity editors inline (option 2).
**Naming + projections (ADR-076, 2026-07-18)**: ONE time lens in the nav, pill fixed
"Calendar" — inside it TWO first-class projections: grid (calendar) and list (**agenda**),
named visible toggle, projection carried in the URL and persisted. Never two nav pills,
never a pill that changes word, never "Time" as the lens name. The Desk's AGENDA row label
points at the agenda projection (two-level vocabulary rule: gutter names item kinds, nav
names surfaces).
**Today**: month grid; performance chips (venue/city/project, status tone, accent) +
`date` chips (title/kind, italic); pins scope; New performance (+ per-day +); ICS feed dialog.
**Contains — direction SETTLED (S1, 2026-07-17)**:
- Month grid with both event kinds [now].
- **Conflict surfacing — PERSON-based, not date-based** (Marco's correction, S1): two
  same-day events conflict only if they **share people**. Roster of a performance =
  project `cast_member` − `cast_override` replacements + `cast_override` additions +
  `crew_assignment`. Honest degradation (same truth contract as the hall): while an
  event has no team data, same-day collision renders as "possible conflict — no team
  data", never as a confirmed clash [db — tables exist; the cast/crew EDITORS don't
  (S2, performance detail) — conflict quality grows as those land]. `date` events have
  no people junction yet — phase them into the engine later.
- **Create `date` events** (rehearsal / residency / travel_day / press) — no creation UI
  exists anywhere. Per-day "+" offers performance | date. **Line-aware** (Marco, S1):
  the dialog asks project* + line? + performance? — which materializes the Shelf item:
  `date.line_id` does not exist [gap → § Schema gaps #6].
- **Availability / blackout — wanted, "essential"** (Marco, S1; reverses the cold-pass
  deferral): entity for "not available" periods, feeding both conflict detection and the
  AI's date proposals (ADR-069: "¿le ofrezco el 12 o el 19?") [gap → § Schema gaps #5].
- **Status filter** (holds only / confirmed only) — planning vs commitment mode [db].
- **Hold visual grammar** (outline = possibility, solid = commitment) [db — unobjected S1].
- Chips carry **time when known** (`load_in_at`/`start_at`; `starts_at`) [db].
- Agenda/list view besides the month — cheap, the natural mobile view [db].
- ICS feed per workspace [now]; per-scope feeds later [db-ish].
- **Travel, outbound/return** (Marco, S1 — day-to-day reality, not supposition): travel days
  are `date` kind `travel_day` linked to their performance, plus a **direction**
  (outbound | return | leg) — column folded into the gap #6 migration. Not mandatory, but
  the usual pair around a gig. **The AI proposes them** (ADR-069): home base
  (`workspace.city` / `person.city` — both exist) + show time + load-in ⇒ "22h show, 5h
  load-in → leave same morning; 10h show → leave the day before". Proposals land as
  suggested dates awaiting consent [db + gap #6].
- **Away-days (días fuera)** — gig Monday + gig Wednesday 1000 km from home ⇒ Tuesday the
  company is away, even with zero events. **Derived overlay, never a stored truth**:
  computed from event geography + home base, rendered as a quiet band on the calendar.
  Direct consumer: **per-diem accrual** (dietas) — away-days × people on the road feed
  proposed `expense` rows, category `per_diem` (enum value already exists). Rate/config
  belongs with fiscal identity (gap #3) [db compute + AI proposal].
- **Persona symmetry** (Marco, S1): the same lens must serve an individual actor/tech
  managing their own calendar. The S1 model already carries it — person-based conflicts
  catch THEIR double-booking across companies, person-level blackouts are their
  availability, `person.city` is their home base. The missing bridge is gap #8
  (user ↔ person link) — without it "my gigs / my conflicts / my blackout" cannot resolve.

### `/h/conversations` — Conversations lens (renamed from Contacts, ADR-075 2026-07-18)

> Rename SHIPPED 2026-07-17 (ADR-075): lens Contacts → Conversations, entity `engagement`
> → `conversation` (DB, API, client). **No 308** — the app is pre-public, so `/h/contacts`
> was deleted, not aliased. "Contacts" survives as the book concept only (by-contact
> toggle, person file).

**Is**: concern-lens over the booking conversations; the book (people AND organizations)
lives inside it as the by-contact view (ADR-065 → ADR-075).
**Today**: conversation table (person, org text, location, status editable inline, next action
editable) + q search + status filter + pins + Add contact (multi-space) + pagination 50.
**Contains — SETTLED (S1, 2026-07-17)**:
- The conversation table [now] + **one "last contact" column** (date, quiet styling) — the
  full history lives in the contact's file, not the lens (Marco, S1). Write path: stamp
  `last_contacted_at` on status change + a "contacted today" gesture; `first_contacted_at`
  set once [db — dispatched].
- **Tags: PARKED** (S1) — seed-era `custom_fields.tags` nobody knew existed; structured
  fields (org, city, season) beat free labels for the AI. Reopen only on a real need.
- **Organizations as rows** [gap #1, direction fixed S1]: juridical actor ≠ `venue`
  (place); **person↔org as a DATED affiliation** — programmers change theatres constantly
  and the relationship follows the person (research 99-patterns). Covers the Lyon/Paris
  case: `person.city` (lives) + org's city (works) = "where can I find X". Fine shape in S2.
- **Contact-centric grouping toggle** (one row per person, project chips) [db — dispatched].
- Per-contact timeline in the contact file — blocked by gap #2 (the lens just links).
**From the profile research (06 + 99-patterns), added S1**:
- **Fair rhythm**: meeting provenance ("met at FiraTàrrega 2026, re show X") as gap #2 log
  entries (kind=meeting + event ref) + a **post-fair follow-up queue** ("everyone from fair
  Y not yet followed up"). Fair-mode mobile quick capture (lens is mobile-first, ADR-015).
- **Season-calibrated coldness**: 9–18-month cycles are normal — "going cold" = recurring
  relationship untouched this SEASON, never week-scale SaaS urgency. Dormant is rest, not
  failure.
- **Contact-book boundary** → hard AI rule recorded in § north star (scope-only contacts,
  hand-crafted per-recipient drafts, never a blast).
- **Inbound ≠ outbound**: an inbound offer is scarce and fast-flowing — `direction` field
  in the gap #2 log design; possible highlight in the lens.
- **Import is adoption-critical** (the Airtable-collapse catch): `build/import/` pipeline
  already exists — the lens's empty state should point at it.
**Open (minor)**: season filter exists server-side, unused in UI — unanswered S1, park.
**Build**: v1 dispatched 2026-07-17 (`contacts-prompt.md` + `contacts-design-prompt.md`);
the model prompt (orgs + conversation log) follows S2's shapes.

### `/h/money` — Money lens

**Is**: concern-lens over money; gated by `read:money` (RLS-enforced via `performance_redacted`).
**Today**: totals (pipeline/invoiced/paid), by-line rollup with progress bars, fees table
(click-to-edit fee), invoices list (status menu, discard draft), New invoice from fee.
**Contains — SETTLED (S1, 2026-07-17)**:
- All of today's [now] — **by-line grouping KEPT** (the line is the operating unit;
  project view comes from pins).
- **Payments with UI**: record `payment` rows (amount, received_on, method, reference);
  invoice shows paid-vs-total; **"paid" DERIVES from Σ payments** — derived state over
  manual flag, same principle as task urgency [db — table complete, zero UI; dispatched].
- **Two truths per invoice** (Marco, S1 — the collector's pain, both hats: company←town
  halls and freelancer←companies): `due_on` = contractual · **`expected_on` = realistic**
  [gap #9]. **Aging measures against expected**: "47 of 60 — normal" calms; "92 of 60"
  escalates and feeds the Desk money alerts.
- **expected_on source cascade**: (1) **observed payer behavior** — issued→paid delta per
  payer computed from payment history, zero maintenance; (2) declared payer terms — on the
  organization (gap #1, S2); (3) **cascade condition** ("they pay when the town hall pays
  them"): model only what YOU know — condition note + expected date + an auto follow-up
  task with `from_at` (ADR-070) surfacing in the Desk ("ask if they collected"). The AI
  eventually runs this loop (ADR-069).
- **Expenses at lens level** (union API) + **net per line** (fees − expenses) [db].
- **Per-currency totals** [db] · **VAT/IRPF breakdown** on expand [db] · **payer in the
  invoice dialog** (`payer_person_id` exists, never set; org-capable after S2) [db].
- **Real invoicing/PDF: not now** (covered externally) — **but it arrives fast: S2 must
  leave gap #3 designed and migrable** (fiscal identity + numbering series).
**Build**: dispatched 2026-07-17 — `money-model-prompt.md` (first) → `money-prompt.md` ·
`money-design-prompt.md`.

### ⌘K Command Palette

**Is**: the navigation surface — scope builder over spaces/projects/lines.
**Today**: three groups (spaces/projects/lines) from the shared caches, drill navigation,
staged pins, apply, create actions. No entity data of its own.
**Should contain**: what it has [now], plus **direct entity jump**: matching persons,
venues, performances by name from the search box (today only containers) — "type
`balsareny`, land on the person or the gig" [db — search endpoint over person/venue/
performance; no schema change].
**Open**: is entity-jump Phase 0 or noise? (Cheap version: persons only.)

---

## Entity detail

### `/h/[ws]/project/[slug]` — Project detail

**Is**: entity edit surface #2 — the show's own content: name, status, about, canonical
assets (rider, dossier), cast, poster; + its lines + scoped lenses (ADR-063: NOT a module
composition).
**Today**: name, status badge, date range, collab Notes (Yjs), lines list (names only),
"Assets"/"Team" static stubs. No editor of any project field.
**Should contain**:
- Header: name, status, dates [now] — **all editable** (Edit project dialog: name, status,
  starts_on/ends_on, description; every column exists) [db].
- **About**: `project.description` (shown on cards, absent here) [db].
- **Poster + dossier**: `poster_url`, `dossier_url` — columns idle since v2 [db; upload →
  same R2 flow as workspace logo].
- **Canonical cast**: `cast_member` list (person, role, joined/left) + add/remove editor —
  the project owns cast per ADR-063; today nothing writes cast_member [db].
- **Canonical materials**: project-scoped `asset_version` (rider, tech sheet, dossier —
  `project_id` scope exists in the table; API/UI only reach line scope today) [db].
- Lines list [now] + per-line kind/status/date-range meta [db — fetched, not rendered here].
- **Scoped lens summaries**: next 3 performances · conversations by status · money pipeline,
  each linking to the lens pre-pinned to this project [db — all queries exist with
  project_ids filter].
- **Tasks** (project-level) [db — task.project_id].
- Collab notes [now].
**Open**: Work·Assets·Team·About tabs (Shelf item) vs one long page — decide with design.

### `/h/[ws]/project/[slug]/line/[line]` — Line detail

**Is**: THE module composition surface (structure-model: modules exist only here).
**Today**: header (name, kind glyph, status, dates, project link), kind-aware stats
(booking: conversations/holds/confirmed/overdue · tour: next gig/confirmed/holds/pipeline),
sibling-line nav, anchor chips, module stack with add/move/remove, POST /visit.
**Should contain**:
- Everything above [now], plus:
- **Edit line** dialog: name, kind, status, start/end, territory — no line field is editable
  after creation today; `territory` has never had UI [db].
- **Tasks module** in the catalog (task.line_id — the line to-do list; structure-model
  already names it "+ Tasks when D3" — D3 is now) [db].
- `line.dossier_url` (line-specific dossier, e.g. the booking one-pager) [db].
**Open**: should closing a line (status=closed) archive its Desk contributions? (Behavior,
not data.)

#### Line modules (each its own design+data surface)

- **Calendar module** — Today: list/month of line performances + line dates; New performance
  [now]. Should add: create `date` here too (a tour has travel days) [db].
- **Conversations module** — Today: scoped ConversationTable + Add contact (line-bound) [now].
  Should add: same last-contact + tags columns as the lens [db]. Known 409 relink-to-line
  limitation (Shelf) stands.
- **Money module** — Today: fees + line-filtered invoices + expenses with per-currency
  totals [now]. Should add: payments visibility once lens-level payments land [db];
  net line total (fees − expenses) in the header stats [db].
- **Notes module** — Today: Yjs collab notes gated by edit:project_meta preflight [now].
  Sufficient.
- **Materials module** — Today: register outbound link-assets (kind, url, notes), remove
  [now]. Should add: **adapted-from chain** (`adapted_from_id` — "this rider is the Salle
  X adaptation of the canonical one") once project canonical materials exist [db];
  inbound stays performance-scoped by table CHECK.
- **Team module** — Today: read-only cast / crew / venue contacts [now]. Correct per
  ADR-063 (edited at source) — but the sources have no editors yet (see Project cast,
  Performance crew). Fix at source, keep this read-only.
- **Road sheets module** — Today: per-performance road sheet links [now]. Should add:
  share-status column (has public links? roles?) [db — roadsheet_share query exists].

### `/h/[ws]/performance/[slug]` — Performance detail

**Is**: entity edit surface for the gig (the atomic primitive).
**Today**: header (venue/title, status menu, date, place), ProductionStub (venue block +
contacts, 5-slot dual-tz ScheduleTable, logistics/hospitality/technical JsonKV), team
(cast/overrides/crew, read-only), linked dates, programmer (conversation person), assets list,
collab notes, Edit details dialog (date, venue fields, linked venue, 5 timeslots), venue
editor, delete.
**Should contain**:
- Everything above [now], plus:
- **Fee, gated**: viewers with `read:money` see `fee_amount fee_currency` + invoice state
  chip here — walking to the Money lens to check one gig's fee is friction; option 2
  (hosted editor) already legitimizes the fee editor on this page [db — deliberate omission
  today; reverse it consciously].
- **Crew editor**: add/remove `crew_assignment` (person, role, contact_override, notes) —
  the road sheet's crew section is unpopulatable from the UI [db].
- **Cast override editor**: `cast_override` (person, role, replaces, reason) — substitutions
  are tour reality [db].
- **Linked dates editor**: create rehearsal/travel `date` rows with `performance_id` from
  here [db].
- **Inbound assets**: register venue-returned docs (`asset_version` direction=inbound,
  show-scoped — table CHECK already models it; UI/API only do outbound line assets) [db].
- **Conversation link**: `conversation_id` is PATCHable but has no UI — "this gig came from
  that conversation" closes the difusión→gig loop [db].
- Structured **logistics/hospitality/technical editing**: today JsonKV renders whatever the
  jsonb holds; there's no editor. Minimum: key-value editor; better: agreed key sets per
  section [db — jsonb exists; vocabulary is a design decision].
- **Tasks** (performance-level: "send rider", "confirm hotel") [db].
**Open**: does fee-on-performance make Money lens the aggregate-only view (clean per
structure-model) — recommended yes.

### Road sheet — internal `/performance/[slug]/roadsheet` + public `/public/roadsheet/[token]`

**Is**: role-projected read view of the performance (operator + external capability-link).
**Today**: role preview pills (full/venue/performer/tech_manager), server-side section
stripping per role matrix, share links (create/copy/revoke, role-pinned), public variant
drops notes/fees/programmer entirely, no-store, robots-noindex. Print CSS.
**Should contain**:
- The matrix as-is [now] — it's the most finished data design in the app.
- Sections currently starving upstream: crew/cast (no editors), inbound assets, structured
  logistics/hospitality/technical — fixing Performance detail feeds this automatically.
- **Share-link expiry** (`expires_at` on roadsheet_share — today only manual revoke; known
  Shelf) [gap — one column, tiny migration].
- Public sheet: **contact-the-company block** (which phone/email the venue may use) —
  deliberate data, not leaked PII; today the public sheet has no reply channel [db —
  choose source: workspace fiscal/contact identity, § gaps #3].
**Open**: per-section notes (e.g. a note visible only on the venue projection)? Adds a
matrix dimension — only if real use asks.

### `/h/[ws]/conversation/[slug]` — Conversation detail  ← the build gap

**Is**: entity edit surface for a conversation (difusión atom).
**Today**: STUB — de-slugged title + back link. Fetches nothing.
**Should contain**:
- **Header**: person (link) + organization + project/line context + status (editable) +
  season [db — all on the conversation row today].
- **Next action**: date + note, editable (same editor the table hosts) [db].
- **Conversation log**: dated entries — "called, they want video", "sent dossier" — the
  memory of the negotiation. NO entity holds this today (`next_action_note` is one slot;
  `person_note` is person-scoped, wrong axis) [gap — § Schema gaps #2].
- **Linked gigs**: performances with this `conversation_id` (proposed/hold/confirmed out of
  this conversation) + "create performance from conversation" prefilled [db].
- **First/last contacted** stamps, auto-maintained from the log [db columns / write-path].
- **Tasks** (conversation-level — subsumes today's single next-action slot long-term; keep
  both until tasks prove out) [db].
- **Money expectation**: asking fee for this conversation — lives on the eventual
  performance today; a `fee_expectation` on conversation is speculative [open, lean no].
**Open**: this screen is where "Comms folds in later" (ADR-056/065) will land — design the
log entity so an email-integration later writes the same table (§ gaps #2 shape).

### `/h/[ws]/person/[slug]` — Person detail

**Is**: entity edit surface for a person (global entity, RLS-visible slice).
**Today**: identity header (name, title, org text, city/country), contact block (email,
phone, website, languages), conversations list, notes (composer, private toggle, author-only
delete), appearances (cast/crew), Add to project.
**Should contain**:
- Everything above [now], plus:
- **Edit person** dialog: full_name, title, email, phone, website, city, country,
  languages, organization — NO person field is editable after creation today [db].
- **Organization as link** once orgs exist (→ § gaps #1); until then the text field [gap].
- Last-contact context per conversation row [db].
**Open**: person merge (dedup two rows for the same human) — Phase 0 manual-SQL is fine,
but flag it before multi-user.

### `/settings` — Settings

**Is**: system surface (account + platform admin). Mostly scaffold by design.
**Today (real)**: alias-request review (platform admin, wired), Master View (localStorage),
session name/email display. Everything else (privacy, languages, notifications, billing,
danger zone, roles chips) is local-state vapor, honestly marked in the file header.
**Should contain (Phase 0 honest core)**:
- **Profile that persists**: full_name + locale + avatar — `user_profile` has all three
  columns; the form writes none of them [db].
- **Workspace members panel**: list `workspace_membership` + `user_profile` per space,
  role; invite (Anouk is user #2 — currently no UI path to add her) [db — membership table
  + invited_by exist; invite flow needs an email or link mechanism, build not schema].
- Alias review [now]. Master View [now].
- **Cut or hide the vapor** (billing, notifications, privacy toggles) until each is real —
  a settings page that lies erodes trust in the ones that work [design decision].
**Open**: notifications (digest, day-of-show) need infra (email/push) — Phase 0.4 item;
decide channel before designing the panel.

---

## Auth / public / system

### `/login`
Email + password [now]; TOTP slot reserved (design for the second factor field now, wire
later); locale-aware error copy [now]. Sufficient.

### `/offline`
Static + reload on reconnect [now]. Should eventually state WHAT is available offline
(cached lenses?) — depends on the PWA offline strategy (0.0 checkbox still open). Park.

---

## Dialogs — field-by-field deltas

Existing fields verified 2026-07-17; only deltas and open items listed. (Create dialogs
share the AccentSwatchPicker `1-8|auto` pattern — keep.)

| Dialog | Today (fields) | Proposed delta |
|---|---|---|
| New space | name*, accent, description(280) | + city, domain — asked at edit but not create; first-run identity in one shot [db] |
| New project | workspace*, name*, accent, description | + starts_on/ends_on (optional) [db]. Keep lean otherwise |
| New line (template picker) | template*, project*, name*, accent | + territory (optional, kind=tour/campaign) [db]; template cards [now] are right |
| Edit space | name*, domain, city, accent, description + alias request | + logo upload when R2 lands [db]; + fiscal block (→ gaps #3) [gap] |
| New performance | project*, date*, venue, city, status(6), line | + **linked venue select** (dedup at source — free text creates orphan venue_names; "Save as venue" exists only in edit) [db]; + fee (optional, read:money-gated) [db, open] |
| Edit performance | date*, venue, city, country, venue_id, 5 timeslots | + conversation link [db]; + fee (see Performance detail) [db] |
| Edit venue | name*, city, country, capacity, address, tz, contacts[], notes | complete [now] — the reference dialog |
| Delete performance | confirm only | [now] ok (invoice block server-side) |
| Add contact (lens, multi-space) | projects*≥1+line, name*, org, email, phone, status, next action+note | ok; unify with module variant ↓ |
| Add contact (line module) | name*, email, org, status, next action+note | + phone (lens has it, module doesn't — same person shape, one form component) [db] |
| Add to project (person) | project*, status | + line (person joins a conversation ON a line) [db] |
| Fee editor | amount, currency | [now] ok |
| New invoice | vat%, irpf%, number, due_on, notes (+ live total) | + payer (person… → org when gaps #1 lands; payer_person_id column exists, dialog never sets it!) [db]; multi-line stays Shelf |
| Add expense | category, description*, amount*, currency, date, notes | + receipt_url (column exists; file → R2 later, URL field now) [db]; + paid_by (me / company — column exists) [db] |
| Register material | kind*, url*, notes | + adapted_from (once project canonical assets exist) [db] |
| Calendar feed | workspace* (+ list/copy/revoke) | [now] ok; scope-level feeds later |
| Next action editor | date, note(500) | [now] ok; absorbed by tasks eventually |
| Roadsheet share | role* (3) | + expires_at (→ gaps, tiny) [gap] |
| Alias review | approve/reject | [now] ok |
| **Missing dialogs** | — | **Edit project** · **Edit line** · **Edit person** · **New date (rehearsal/travel)** · **New task** · **Crew/cast-override editors** · **Record payment** — all [db], zero migrations |

---

## Schema gaps — consolidated (candidate migrations)

Everything else in this doc is build-only. These need DDL, listed by blast radius:

1. **Organization entity** (ADR-065 debt). `organization` (workspace-scoped: name, kind
   theatre/festival/town_hall/company/agency, city, country, website, notes, custom_fields)
   + `person.organization_id` FK (keep `organization_name` text as fallback during
   migration) + `conversation.organization_id` (a conversation can be with an org before it
   has a human) + `invoice.payer_organization_id`. Touches: Conversations lens, person detail,
   conversation detail, invoices. **Decide shape before building conversation detail** — the
   conversation view wants org context from day one. Note: `venue` overlaps ("a theatre is
   both a place and a programmer") — proposal: keep venue = place; organization = juridical
   actor; optional `venue.organization_id` link. Argue this in session 2.
2. **Conversation log** (entity renamed per ADR-075). `conversation_event` (conversation_id, at, kind
   note/call/email/**meeting**, `direction` inbound|outbound (S1, from research §2.4),
   optional event/fair reference for provenance ("met at FiraTàrrega 2026" — S1), body,
   created_by). Write path stamps `conversation.last_contacted_at` (and first, once).
   Designed so future email integration inserts the same rows (ADR-056 comms direction).
   Unblocks the conversation detail screen + the post-fair follow-up queue.
3. **Fiscal identity for invoicing** — on `account` (billing root; ADR-062 deferral):
   legal_name, tax_id, address, IBAN, default_vat_pct, default_irpf_pct, invoice number
   series. Unblocks: real invoice issuing, public road sheet contact block, invoice PDF
   (Shelf) later.
4. **`roadsheet_share.expires_at`** (+ optional `calendar_share.expires_at`) — one column
   each, check in the RPCs. Known Shelf item, trivially small.
5. **Availability / blackout entity** (S1: Marco wants it, "essential"). Shape CONFIRMED:
   `availability_block` (workspace-scoped: `person_id` **nullable — null = whole company**,
   `starts_on`, `ends_on`, `certainty` **unavailable | tentative** ("el 8 de enero no sé si
   puedo — lo tengo en duda"), `kind` vacation|unavailable|personal, `note`). Person-level
   by design — an actor's "away 15th–25th" is a person row; company closures are null-person
   rows. Consumed by: Calendar chips + conflict engine + the AI's free-date proposals
   (ADR-069: free = no gig for the required people AND no blackout; tentative ⇒ "probably
   free, confirm with {person}").
6. **`date` cascade + travel columns** (S1, option C chosen over line-only / polymorphic:
   mirrors `performance`'s own project*+line? pattern, keeps queries and RLS simple,
   respects lines being optional): `date.line_id` nullable FK + index, plus
   `travel_direction` (outbound | return | leg, nullable — only for kind `travel_day`).
   The New-date dialog asks project* + line? + performance?; attach specific, view
   aggregated (a line's date shows in its module, the project calendar, and the lens).
7. **Task `from_at` + `lead_days`** — ADR-070, already dispatched via
   `build/task-model-prompt.md`.
8. **User ↔ person bridge — CONFIRMED (S1)**: `user_profile.person_id` nullable FK
   (claim-by-email later; person is already email-deduped). Marco's extension: "I work
   with two companies, each with their app — I see BOTH in mine, as long as they share."
   Rule from research §3.3: an invited user sees their OWN participation across
   workspaces, never other orgs' full detail. Prerequisite for the persona-symmetric
   calendar and cross-workspace self conflict detection. **Added to
   `calendar-model-prompt.md` as migration C.**
9. **`invoice.expected_on` + `payment_condition`** (S1, ADR-074): the realistic collection
   date (vs contractual `due_on`) + the cascade-condition note ("when they collect from
   X"). Aging measures against expected. Dispatched via `money-model-prompt.md`.
10. *(deliberately NOT proposed)*: saved views server-side (Master View localStorage is
   the ceiling per structure-model), fee_expectation on conversation (lean no), away-days as
   a stored entity (always derived — storing them would let them lie), modeling the
   payer's own receivables (we only track what the user knows — fiction otherwise).

## Open questions queue (for the review sessions)

Collected from above, in session order:
- S1: hall — keep or fold into Desk? · Desk stream shape (mixed vs grouped)? · portada:
  scoped Desk or dashboard? · calendar hold grammar · availability entity yes/no ·
  contacts season filter now? · money primary grouping (line vs project) · ⌘K entity-jump?
- S2: project tabs vs long page · fee on performance detail (recommended yes) ·
  organization vs venue split (gaps #1 shape) · conversation log shape (gaps #2) ·
  per-section road sheet notes?
- S3: settings — cut vapor or keep as roadmap-ad? · notification channel · dialog deltas
  table (each row is a small yes/no).
