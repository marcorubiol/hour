# Hour — Product strategy review

Date: 2026-05-02
Status: working product strategy
Scope: product model, UX architecture, assisted beta readiness

## Executive diagnosis

Hour is promising, but its main product risk is not technical feasibility. The real risk is whether the conceptual model becomes understandable and useful for real performing-arts teams before it becomes too abstract, too internal, or too wide.

The strongest part of the model is that Hour does not treat the sector as generic sales. It separates conversations from confirmed performances, connects people with shows and venues, treats the calendar as native, and makes road sheets a living projection instead of a static document.

The most important correction after the review: Hour should not be reduced to “booking-first” as product identity. Booking can be one entry point, but the MVP must validate the integrated operating base: House, Room, people, conversations, gigs, venues, assets, road sheets, filters, lenses, and permissions working together. Depth can come later by module; the foundation must prove the interrelation first.

## Product thesis

Hour should become a shared operating layer for performing-arts companies and cultural production teams where relationships, dates, production, assets, money, and communication stay connected.

The sellable wedge can start from a concrete pain such as booking or production, but the differentiated product is not a booking app, a CRM, a calendar, or a road sheet tool. It is the fact that those layers are connected around the same operational objects.

## 1. General diagnosis

### What is solid

- The distinction between `engagement` and `show` is correct for the domain.
- The anti-generic-CRM stance is useful if it means sector-specific workflows, not avoidance of CRM capabilities.
- Calendar as native product surface is essential.
- Road sheet as projection over live data is a strong differentiator.
- Multi-tenant and permission-aware foundation is necessary for assisted beta and later SaaS.
- The two-axis UI model, lenses plus House/Room scope, is strategically right if users understand it.

### What is risky

- The vocabulary layer (`House`, `Room`, `Run`, `Gig`, `Desk`) has personality but is not yet validated enough.
- `Room` is the riskiest term because it can be confused with a physical venue or sala.
- `Desk` promises action, but a useful Desk needs tasks, next actions, waiting items, and today-oriented work.
- If Contacts comes too late, Hour may not validate the booking/relationship side early enough.
- If Road sheet comes without share/snapshot history, users may not trust what has been sent externally.
- If Hour leans too much on custom fields, it may become an Airtable-shaped escape hatch instead of a product with an opinion.

### Correct framing

Hour should not start by building one deep module. It should start by proving that the core map works:

- one company or collective lives in a workspace;
- one work/show/project lives in a project-like container;
- people and conversations attach to that context;
- conversations can become dates or gigs;
- gigs connect venue, production, assets, people, money, and road sheet;
- lenses show the same world from different operational angles.

## 2. Real user map

### Artistic direction / company direction

- Wants: overview of projects, upcoming dates, opportunities, money, and reputation.
- Pain: information scattered across WhatsApp, Drive, email, Excel, and memory.
- Uses: Desk, Room, Calendar, Assets, Road sheet, Money overview.
- Confused by: unclear House/Room distinction, or too much operational detail too early.

### Production / tour manager

- Wants: every date to happen cleanly, with venue, timetable, team, assets, logistics, and changes aligned.
- Pain: old PDFs, WhatsApp changes, contradictory versions, missing technical info.
- Uses: Gig detail, Road sheet, Venue, Assets, crew/cast, Calendar.
- Confused by: assets split between Room and Gig if the UI does not explain canonical vs per-venue adaptation.

### Booking / distribution

- Wants: know who to contact, when to follow up, what is alive, what is dead, and what can become a date.
- Pain: losing follow-up, duplicate contacts, no memory of context, weak next-action tracking.
- Uses: Contacts, Engagements, notes, filters, Calendar, status, next action.
- Confused by: anti-CRM language if it hides necessary CRM-like capabilities.

### Manager / agent

- Wants: manage several artists or productions without mixing contacts, dates, fees, and permissions.
- Pain: multi-client privacy, reporting, contact ownership, overlapping calendars.
- Uses: multiple Houses, Rooms, Contacts, Money, roles, permissions.
- Confused by: when to use one House per agency, one House per artist, or one House per client.

### Technician

- Wants: only the execution information: venue, call time, rider, stage plot, contact, changes.
- Pain: irrelevant info, outdated files, login friction.
- Uses: role-filtered road sheet, technical assets, mobile view.
- Confused by: any full-app navigation. External views must be simple.

### Artist / performer

- Wants: where, when, call time, travel, hotel, contact, repertoire/cast.
- Pain: too much email, late changes, production noise.
- Uses: mobile road sheet, calendar, role-filtered information.
- Confused by: CRM, Money, internal production notes.

### Admin / finance

- Wants: see agreed fees, invoices, payments, pending money, and expenses by show or project.
- Pain: reconciling agreements, invoices, partial payments, scattered fee info.
- Uses: Money, Invoice, Payment, Expense, fee on Gig.
- Confused by: Hour looking like accounting software if it is only operational tracking.

### External collaborator

- Wants: see or contribute the minimum necessary.
- Pain: creating an account for one thing, unclear permissions, outdated links.
- Uses: signed road sheet links, asset delivery, maybe limited guest write later.
- Confused by: full onboarding.

## 3. Conceptual model review

### House

Good as brand vocabulary, but not self-explanatory. It maps to workspace/company/collective. The key UX need is a decision rule: when to create a new House vs a new Room.

Risk: users may see it as cute internal naming unless onboarding anchors it to their real company or collective.

### Room

The riskiest name. It maps to the creative/commercial unit: show, piece, album, production, project.

Risk: in performing arts, room/sala can mean venue. If users interpret Room as physical space, the mental model breaks.

Recommendation: keep schema as `project`; treat `Room` as provisional product vocabulary until tested. Consider contextual labels or alternatives such as Work, Project, Piece, Production, Show, or Creation.

### Run

Conceptually useful as an optional grouping: tour, season, festival circuit, residency block.

Risk: it must stay optional. Users with one-off shows should not be forced to create a Run.

### Gig

Strong for music and informal contexts. May feel too musical or informal for theatre/dance institutions.

Recommendation: allow contextual copy: Gig / performance / date / función, without changing schema.

### Engagement

Excellent as internal model: conversation/opportunity/relationship distinct from event. Weak as visible UI label.

Recommendation: use friendlier UI terms such as Conversation, Follow-up, Relationship, Booking thread, or Contact thread depending on lens.

### Person

Good primitive, but the global-person idea is risky. Marco’s correction is important: do not make Person global as a shared cross-client identity.

Recommendation: workspace-owned contacts plus an importable GDPR-safe directory/list of non-sensitive data.

### Venue

Clear and necessary. Needs strong relationship to contacts, technical specs, access notes, timezone, and road sheet.

### Date

Useful for non-performance events: rehearsal, travel, validation visit, residency, press, fair.

Risk: too generic as label. UI should expose concrete kinds.

### Asset

Good product term, but users need clear states: canonical, adapted, inbound, current, sent, expired.

### Invoice / Money

Useful if framed as operational money tracking, not full accounting.

Recommendation: keep Phase 0 money shallow: agreed fee, invoice status, paid status, expenses overview.

### Desk

Good metaphor, but only if it becomes actionable. A Desk without tasks, next actions, waiting items, or due work is just navigation.

### Calendar

Essential primary surface. Must show holds, confirmed dates, non-performance dates, conflicts, and context.

### Contacts

Critical for booking and relationship memory. It should not be delayed so much that Hour cannot validate its relational core.

### Road sheet

Very strong differentiator. It should be a projection over show-related data, but needs share/snapshot history so users know what was sent.

## 4. Critical workflows before assisted beta

### 1. Build the operational map

User steps:
- Create/select House.
- Create/select Room.
- Add or import people.
- Add one engagement/conversation.
- Add one gig/date.
- See the same world through Desk, Calendar, Contacts, and Road sheet.

Entities:
- House/workspace, Room/project, Person, Engagement, Gig/show, Venue, Asset.

Non-negotiable:
- The interrelation must be understandable before any module is deep.

### 2. Import and rediscover contacts

User steps:
- Bring CSV/Excel/manual import.
- Normalize people and organizations.
- Create workspace contacts and engagements.
- Preserve provenance.
- Filter by Room/status/source.

Non-negotiable:
- No privacy confusion. Imported contact memory belongs to the workspace.

### 3. Follow up booking conversations

User steps:
- Open Contacts lens.
- Filter by House/Room/status.
- Open contact detail.
- Add note.
- Set status and next action.
- Convert to possible date or gig.

Non-negotiable:
- Next action or task-like behavior is required early.

### 4. Convert conversation into operational date/gig

User steps:
- From an engagement, create tentative or confirmed gig.
- Attach venue and date/time.
- Set status/hold.
- Add fee if known.
- Carry relationship context forward.

Non-negotiable:
- Engagement and Gig remain distinct but linked.

### 5. Prepare a production-heavy gig

User steps:
- Open Gig detail.
- Add venue, timeslots, team, logistics, hospitality, technical info.
- Add validation visit or pre-work day as related Date/Gig context.
- Generate/update road sheet.

Non-negotiable:
- Electrico 28 street-show case must be representable without hacks.

### 6. Share road sheet externally

User steps:
- Open road sheet.
- Choose role view.
- Generate signed link.
- Preview what external person sees.
- Track what was shared.

Non-negotiable:
- No accidental exposure of money or internal notes.

### 7. Manage core assets

User steps:
- Attach canonical Room assets.
- Attach per-gig or per-venue adaptations.
- Mark current version.
- Link assets into road sheet.

Non-negotiable:
- Users must know which asset is the one to send.

### 8. See what matters today

User steps:
- Open Desk.
- See upcoming gigs, next follow-ups, production gaps, pending money.
- Jump to the object that needs work.

Non-negotiable:
- Desk must be action-oriented, not just a tree.

## 5. Flexibility vs complexity

### Must be flexible

- Project/work types by template or copy, not necessarily by schema type.
- Booking/show states with controlled internal vocabulary and flexible labels if needed.
- Roles and permissions, but with simple presets.
- Contact imports and provenance.
- Assets by kind, language, currentness, direction, and version.
- Road sheet sections and role-filtered views.
- Lenses, filters, and saved views.
- Multi-language UI copy.
- Multi-country basics: timezone, currency, addresses, tax metadata later.

### Should not be too flexible yet

- No custom entities.
- No road sheet page builder.
- No full workflow automation builder.
- No complete accounting/invoicing replacement.
- No full messaging hub yet.
- No AI as primary user-facing feature.
- No arbitrary permission matrix in daily UX.

## 6. Product risks

### 1. Vocabulary confusion

Why it matters: if users do not understand House/Room/Run/Gig quickly, Hour feels like another tool with its own private language.

Detection: five-minute naming tests with real users.

Change: keep schema stable, validate product labels before locking UI copy.

### 2. Room may be the wrong word

Why it matters: it is the central object.

Detection: ask users what they think Room means before explanation.

Change: test alternatives and contextual copy.

### 3. Anti-CRM dogma

Why it matters: users need CRM-like follow-up even if they hate CRM language.

Detection: ask them to manage 50 contacts and watch what is missing.

Change: build CRM capabilities with sector-native language.

### 4. MVP too shallow in interrelation

Why it matters: a good isolated module does not prove Hour.

Detection: can one real case go from contact to date to road sheet to production context?

Change: prioritize transversal thin slices.

### 5. Desk without work

Why it matters: Desk becomes habit only if it tells the user what needs attention.

Detection: daily internal usage.

Change: introduce minimal next-action/task behavior earlier.

### 6. Road sheet trust gap

Why it matters: external sharing needs confidence.

Detection: ask production people how they know which PDF/version was sent.

Change: add share/snapshot history.

### 7. Custom fields dependency

Why it matters: too many custom fields mean the model is under-specified.

Detection: count repeated custom-field needs across first clients.

Change: promote repeated needs to core fields or templates.

### 8. Assisted beta support gap

Why it matters: Marco must onboard and support clients without SQL/manual firefighting.

Detection: simulate first client onboarding.

Change: admin/support minimum remains non-negotiable before external workspaces.

## 7. Validation plan with known clients

### First target

Electrico 28 is a strong first beta candidate because it combines:

- collective structure;
- around 15 people;
- 4 shows;
- Ares usage;
- booking needs;
- production complexity;
- one street show requiring in-situ validation and pre-gig work day.

### What to show

- A populated House with 4 Rooms.
- Contacts connected to Rooms.
- One engagement becoming a tentative/confirmed Gig.
- Calendar with performance and non-performance dates.
- Gig detail with production info.
- Road sheet role-filtered preview.
- Minimal Money state.

### What to ask

- What would you call this object?
- Where would your 4 shows live?
- Where would the street show validation day live?
- Where would you put a venue contact?
- What information cannot be exposed externally?
- What do you currently do in Ares that Hour must not try to replace?
- What would make you use this weekly?

### What to make them do

- Create or identify a Room.
- Add a booking conversation.
- Convert it to a date/gig.
- Add production requirements.
- Prepare and share a road sheet.
- Find what needs attention today.

### Validation signals

Positive:
- They map their real work to the model without heavy explanation.
- They understand the difference between conversation, gig, and road sheet.
- They see why Hour connects booking and production.
- They accept manual onboarding.
- They ask for import/migration more than new features.

Negative:
- Room means venue to them.
- They cannot place non-performance production days.
- They see Hour as duplicating Ares badly.
- They only value one module and ignore the integrated model.
- External sharing feels unsafe.

## 8. Recommended changes before building more

### 1. Reframe Phase 0 as MVP transversal integrated

Phase 0 should not be described as building isolated modules. It should be framed as a thin, coherent operating base across the main objects.

### 2. Reopen product vocabulary as validation-needed

ADR-008 can stay as current working vocabulary, but its status should not be treated as immovable for UI copy. `Room` needs real-user validation.

### 3. Add naming decision protocol

Before locking UI labels:

- define 3-5 naming candidates;
- test with MaMeMi, Electrico 28, and 2-3 other known users;
- ask users to place real objects without explanation;
- keep schema names independent from product copy;
- decide based on comprehension and emotional fit.

### 4. Bring Contacts/Engagement visibility earlier in the MVP definition

Contacts does not need full depth early, but the integrated model is incomplete without people and conversations visible.

### 5. Add minimal next-action/task behavior earlier

This can be lightweight and not the full D3 task entity, but Desk and booking need it.

### 6. Make Electrico 28 the beta scenario document

The street-show case should become a canonical validation scenario for production complexity.

### 7. Keep Money shallow

Money should be present as operational context, not as invoicing product depth.

### 8. Define anti-scope for the next 12 months

The biggest remaining strategic unknown is what Hour explicitly refuses to become.

## Naming decision protocol

### Question

Is `Room` the right word for the central project/show/work container?

### Current position

Use `Room` as current working vocabulary, but do not lock it as final until tested with real users.

### Evaluation criteria

- Users can infer the meaning in under 30 seconds.
- It does not conflict with Venue/sala.
- It works for theatre, dance, music, street arts, production companies, and collectives.
- It feels specific without feeling cute.
- It works in navigation and URLs.
- It works in English but can be explained in Spanish/Catalan/French contexts.

### Candidate set

- Room
- Work
- Project
- Piece
- Production
- Show
- Creation

### Test

Show users a sidebar with House → candidate → Run/Gig and ask:

1. What do you think this object is?
2. Where would you put each of your current shows/pieces?
3. Where would you put a venue?
4. Where would you put a tour?
5. Which word feels least like software?
6. Which word would confuse your team?

### Decision rule

If `Room` is confused with venue/sala by more than one serious beta user, do not use it as the primary UI label. Keep `project` in schema and choose a clearer product label.

## Hard questions still open

1. What exactly is out of scope for the first 12 months?
2. Is Desk allowed to launch without real tasks/next actions?
3. Should Contacts move earlier than Phase 0.3 as a thin lens?
4. Does road sheet need share/snapshot history in Phase 0.2 or 0.5?
5. What does Hour deliberately not replace in Ares?
6. What minimum production flow must Electrico 28 complete before beta is considered valid?
7. How many custom fields are acceptable before the model is failing?
8. What does “manual onboarding” include as a repeatable service?
9. Which vocabulary is brand identity and which is replaceable copy?
10. What is the smallest complete end-to-end story that proves Hour works?
