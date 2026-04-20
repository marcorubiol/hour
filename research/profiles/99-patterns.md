> Hour — user research
> Cross-cutting patterns across the 8 profiles
> Status: draft v1 · 2026-04-19

# 99 — Cross-cutting patterns

This document reads across profiles 01-08 and extracts what recurs, what diverges, and where profiles contradict each other. It is written as input to Hour's data model and product priorities, not as a marketing piece. Where a pattern is strongly attested across multiple profiles, it is flagged as **universal**. Where it is contested or partial, it is flagged as such.

The most important sections for the architecture are **§3 (the show-vs-artist split)**, **§5 (the multi-tenant reality of freelancers)**, and **§6 (conflicts between profiles)** — these three determine whether Hour is a single product or a fork.

---

## 1. What all eight profiles share

### 1.1 The rider-versioning problem is universal

Every profile — company, band, production company, self-managed act, solo artist, distributor, technician, manager/agent — reports the same structural failure: **a canonical document (rider, dossier, EPK, ficha técnica, stage plot) exists in 3-5 versions, the wrong one goes to the venue, and it is only caught at advance or load-in**.

- Theatre companies (01): venue builds a plot from an obsolete rider; discount comes out of the fee.
- Bands (02): drummer changes backline; old rider goes to festival; PA team reconfigures on show day.
- Production companies (03): same problem at roster scale.
- Self-managed bands (04): often no formal rider at all — a WhatsApp text describing the backline.
- Solo artists (05): dossier for a residency application shipped in stale version.
- Distributors (06): wrong-folder rider is the canonical friction story; belongs to Company B, sent for Company A.
- Tour techs (07): the "email inline addendum" pattern — decisions that never merge back into the master.
- Managers / booking agents (08): same roster-scale rider drift as production companies.

This is the strongest single signal across the research. Hour needs to treat **versioned documents attached to the show** as a first-class entity — not as "files in Drive". The question is not "can we host the file?" but "is this the version the venue received, and is it still current?".

### 1.2 The stack is almost always the same: Gmail + Drive + Sheets + WhatsApp

Across all eight profiles the default stack is essentially identical:

- **Gmail** (or Outlook for some institutional arrangements) as the thread-of-record.
- **Google Drive** (or Dropbox for technicians) as the file store.
- **Google Sheets or Excel** as the tracker.
- **WhatsApp** as the real-time layer.
- A seasonal attempt at **Airtable** or **Notion** that collapses every 18-36 months.

The stack fails for the same structural reason in every profile: **it has no concept of "show"**. The show has to be reconstructed in the head of the operator every time by correlating an email thread, a folder path, a row in a sheet, and a WhatsApp group. Hour's core value proposition, stated at product level, is: *bind these four planes to a single show record so the operator never has to reconstruct them in their head.*

### 1.3 Airtable is the "promised land" that never lands

Six of the eight profiles (company, band, production company, distributor, technician, manager/agent) report the same Airtable cycle: build a schema, use it for six months, fall behind during a peak season (fair, tour, album release), never catch up, fall back to Sheets. The community forum evidence is clear — freelance music supervisors and distributors are actively trying to *hire* Airtable consultants because maintenance is the real cost.

This is a product-design warning, not a competitive flex. Airtable's flexibility is exactly what makes it fail: it gives operators the rope to build a bespoke CRM that they do not have the capacity to maintain. Hour should not offer a configurable schema. It should offer a strong, opinionated show-centric model that the operator cannot drift out of.

### 1.4 Purpose-built tools are either too expensive or too narrow

- **Artifax, ArtsVision, Propared** — venue / large producing theatre scale; pricing models that assume an institution, not a 5-person shop.
- **Gigwell, Overture, Master Tour** — booking-agency oriented; assume single-roster-single-agency data model; English-only interfaces; US / UK centric on pricing and tax handling.
- **Muzeek, Stagent** — closer to a small European shop; holds system works; limited to music.
- **ABOSS** (theatre admin) — organisation-internal, not multi-client.

**Nothing on the market handles the multi-client freelance comfortably.** This is also the loudest signal from the research. See §5.

### 1.5 Long sales cycles are the norm

- **Theatre / dance**: 9-18 months from first pitch to performance.
- **Music**: 3-12 months, with festival season booked further ahead (12-18 months for headliners at major European festivals).
- **Residencies and co-productions**: 18-36 months from proposal to premiere.

The universal implication: **pipeline CRMs built for SaaS or e-commerce sales fail because their velocity assumptions are wrong**. A lead that hasn't moved in two months is not "cold" in performing arts — it is normal. A "stuck" status is not a status; progress is measured in months, not days.

### 1.6 The fair / showcase calendar dictates the year

- **Performing arts companies, distributors**: FiraTàrrega (September), FETEN (February), Fira Mediterrània, CINARS (biennial November), IETM, Aerowaves — these dates structure the sales cycle. Tanzmesse 2026 cancellation is a genuine industry shock that Hour should not embed as a fixed reference.
- **Music agencies, managers, bands**: Eurosonic (January), Jazzahead! (April), Primavera Pro (May-June), Reeperbahn (September), WOMEX (October), ILMC (March).
- **Self-managed artists and DIY bands**: the fair calendar is *received* as information rather than actively worked — they can attend as passholders but rarely as sellers.

**Pre-fair prep and post-fair follow-up are the two sharpest workload peaks of the year for selling profiles.** Hour should model these as discrete modes of work, not as continuous background activity.

### 1.7 Seasonality (shared across theatre and music, different shape)

- **Theatre / dance**: September-May is the main programming season; summer is festival; August collapses.
- **Music**: September-November + February-May for clubs; June-August for festivals; December dead except for Christmas tours.
- **Tax crunch** (Spain): quarterly IVA in January/April/July/October; annual renta April-June. Every profile with autónomo status lives inside this quarterly rhythm.

### 1.8 Payment delays are universal and demoralising

Across every invoicing profile:

- **Spanish municipal / public venues**: 60-90 days, sometimes 120.
- **Spanish FACe e-invoicing portal**: 30-day legal limit, practice diverges.
- **French CDN / scène nationale**: 30-45 days (generally fastest).
- **Private clubs / promoters**: 30-60 days.
- **Festivals**: variable, some day-of, most 30 days.
- **Commission split to distributor or agent**: typically 50% at confirmation, 50% after performance — so the freelance is also waiting months.

No single industry source quantifies this well. The 60-90 day figure for Spanish public venues is triangulated anecdote, widely attested but not published. Hour should **track invoice aging against expected payment terms per venue type**, because this is one of the few concrete, painful, measurable metrics the operator cares about daily.

### 1.9 Private notes vs shared records

Every profile keeps two layers:

- A **record layer** — contracts, riders, schedules, invoices — that is shared with counterparties.
- A **private layer** — notes like "this programmer hates cold pitches", "house crew at venue Y is understaffed", "this drummer hates early calls" — that must never leak.

The private layer is the operator's professional capital. Losing access to it (through platform lock-in, access revocation when a client leaves, or poor UI that accidentally shares it) is catastrophic. This is the same concern across distributor (06), technician (07), manager/agent (08), and — read carefully — inside companies too: production managers and bookers keep private notes about their own collaborators and venues.

Hour needs a **strict, opinionated, and visible** distinction between private and shared fields. The UI should make the sharing boundary *hard to cross accidentally*.

### 1.10 Real-language polyglotism

Every profile moves daily between 2-4 languages. ES / CA / EN / FR is the common European combination for Barcelona-based operators; DE and IT appear for specific touring territories. Vocabulary is not cleanly translatable (see §7 below). Hour should be built assuming multilingual UI *and* multilingual user-generated content (a programmer's name is in one language, the venue in another, the show title in a third, the rider header in a fourth — all in the same record).

---

## 2. Where profiles diverge — the product's real splits

Not all shared patterns apply identically. The architecture has to decide where to model differences as *configuration* (a flag on the record) and where to model them as *separate entities*.

### 2.1 Primary object: show vs artist

This is the deepest divergence in the research:

- **Theatre, dance, new circus companies (01)**: primary object = **show**. Everything hangs off the show — contracts, tours, cast, rider, dossier, rights.
- **Bands, solo artists, DIY acts (02, 04, 05 music sub-flavours)**: primary object = **artist/act**. Shows are dates. Albums are campaigns. The artist's career is the arc; individual gigs are points on it.
- **Production companies / labels / booking agencies (03)**: primary object = **roster**. Each roster member has their own campaigns.
- **Distribution (06)**: primary object = **the company being represented**. Then per-company, a catalogue of shows.
- **Tour techs (07)**: primary object = **shows they worked on** (cross-company). Each show has venues, plots, cue lists.
- **Managers / booking agents (08)**: primary object = **artist / act**, sub-organised by **tour / release cycle**.

This is the thesis stress test. Hour's working assumption — "the primary object is the show" — fits profiles 01, 03, 06 cleanly; it fits profiles 02, 04, 05, 08 only if the model admits that a "show" in music is a **tour date** nested inside a **release campaign**, which is nested inside an **artist**.

**Recommendation.** Model the primary object as a polymorphic `project` that can be:
- a theatre/dance/circus show,
- an album or release campaign,
- a solo artist's creation-and-touring cycle,
- a festival edition (for technicians working inside a festival).

Underneath `project`, the universal child is `date` (a single performance or event). This abstraction holds across all eight profiles.

### 2.2 Hold systems: music-only

The **1st hold / 2nd hold / challenge / confirm / release** vocabulary is a music-industry invention and does not exist in performing arts. Theatres and festivals either have a slot or do not. This is not a configuration difference — it is a music sub-model that needs to exist only on music projects.

### 2.3 Production involvement by the seller

- Theatre distributor (06) does 30-40% production work (advance, hospitality, rider checking).
- Music booking agent (08) does 0% production for mid-scale artists, 100% for small artists.
- Manager (08) handles life-logistics (visas, flights, personal).
- Production company (03) handles all production internally.
- Self-managed act (04) handles everything themselves.

The seller-vs-producer boundary is not fixed. Hour cannot hard-code "distributors don't do production" — they sometimes do. The permission and visibility model must be **per-field and per-record**, not per-role.

### 2.4 Inbound vs outbound ratio

- Freelance distributor (06): ~90% outbound, ~10% inbound. Warm programmer relationships exist but rarely produce unsolicited offers.
- Known booking agent (08): 30-50% inbound once roster is established.
- Self-managed band (04): ~95% outbound; inbound is rare and precious.
- Established theatre company (01): mixed; inbound from institutional programmers is common for touring warhorse shows.

Hour should track inbound separately from outbound, because the workflow for handling an inbound offer (hold, counter, confirm) is simpler and faster than chasing an outbound pitch (multi-month sequence).

### 2.5 Organisational scale & shape

- Solo: profiles 04 (DIY) and 05 (solo artist).
- 2-5 people: profiles 03, 06, parts of 08.
- 5-15 people: profile 01, parts of 02, 03.
- Invitee into others' organisations: profile 07 always, 06 often, 08 sometimes.

Hour must work in all four scales, with the data model being the same and only the UI density and notification rhythm adapting.

### 2.6 What NOT to automate — the profile-specific refusals

Each profile has a hard "don't touch this" that is non-negotiable:

- **Company (01)**: do not automate programmer communication — relationships are personal.
- **Band (02)**: do not touch creative-side concerns (setlists, stage design).
- **Production company (03)**: do not "dashboard the artist" with scores or rankings.
- **Self-managed band (04)**: do not feel corporate. CRM vocabulary is an anti-signal.
- **Solo artist (05)**: do not auto-pitch or mass-email. Every pitch is hand-crafted.
- **Freelance distributor (06)**: do not share the contact book by default; do not suggest contacts across clients.
- **Tour tech (07)**: do not touch the show-running software (QLab, Eos, grandMA3). Do not automate the craft (plot design, cue design).
- **Manager / booking agent (08)**: do not "algorithmically match" gigs to festivals. Do not auto-score artists.

Read across profiles, the pattern is: **Hour should stay in the admin layer around the craft, never in the craft itself**. This is consistent with what the tour tech and the freelance distributor both described in exactly the same terms.

---

## 3. Conflicts between profiles

This is the section that matters most for Hour's architecture. Where two profiles disagree, Hour must take a side — or design a structural compromise.

### 3.1 The contact book: "mine" vs "ours" (the big one)

**This is the single most important conflict in the research. Marco flagged it as gold, and the evidence confirms it.**

- **Freelance distributor (06)**: "The contact book is mine. I built it over 15 years. The programmer at Théâtre de la Bastille has known me across three companies." The freelance deliberately partitions — four Gmails, one per client — to keep the relational layer personal.
- **Company (01, 03)**: "Every programmer the distributor pitches on our behalf is business we are generating and paying commission for. When she leaves, we expect to inherit those relationships." No standard contract template in Spain or France settles this. Each break-up is a messy negotiation.
- **Tour tech (07)**: same conflict, different axis — the company wants the venue contacts and crew-network visible. The tech wants their personal little-black-book (which house technical director is flaky, which rental house short-delivers) to remain private.
- **Manager / booking agent (08)**: same again — the artist's promoter relationships are a hybrid, and the "key-man" clause in management contracts is the legal equivalent of this fight.

**This conflict cannot be resolved by UI. It is architectural.** The data model must encode three distinct things:

1. A **long-lived human** (a programmer, a tech director, a promoter) — exists independently of any organisation.
2. An **engagement** — the instance of that human working with a specific project, mediated by a specific operator.
3. A **private annotation layer** — notes attached to the human, scoped to a workspace, never leaking.

The same programmer can be:
- a contact inside Company A's Hour workspace (linked to their engagement history with A),
- a contact inside Company B's Hour workspace (different engagement history),
- a private contact in a freelance distributor's personal workspace (with private notes that never leak into A or B),
- known to the freelance *only* through one of those client workspaces (if she never added them personally).

**Leaving a client** must preserve:
- the client's engagement records and correspondence (they own their history),
- the freelance's private contact (she keeps her relationship),
- the public contact record (the programmer is not owned by either).

This is the Hour multi-tenancy design. It is not a feature; it is the architecture. (Profile 06, section 8, states this as requirements; the other profiles broadly confirm.)

### 3.2 Who owns the rider?

- **Theatre company (01)**: "The rider is ours. The technician can suggest changes, but we approve."
- **Tour tech (07)**: "The rider is mine — I designed the plot, I know what it does, I am the one who notices when a venue's house plot is wrong."
- **Production company (03)**: "The rider is the artist's, mediated through us."

In practice the rider is **co-owned**. Hour's model should allow:
- the project owner to hold the canonical version,
- the invited tech to *propose* a new version,
- review / merge / approve as a lightweight workflow,
- version history preserved across all changes regardless of who made them.

This is not a "comments on a PDF" problem. It is a structured-fields-with-review problem, because the rider is partially structured data (gear list, input list, timings, power needs) and partially prose (creative notes, contingencies).

### 3.3 Calendar ownership across profiles

The tour tech (07) is the extreme case: they need **a single calendar view across all their companies**, but each company considers *their* tour calendar their proprietary data. The same tension applies to:

- A co-booker across territories (Profile 08 conflict): the Barcelona agent and the German co-booker both want to see the tour routing.
- A freelance distributor (06): wants to see her own weekends across all five clients' tours to avoid double-booking her own attention.

**The rule Hour needs**: every invited user has the right to see **their own participation across all shows** in a unified calendar — but only the metadata about their *own* participation, not the full show details of other organisations. A tech sees "Saturday — Company B show — venue X" without seeing Company C's offer that same weekend for a different tech.

### 3.4 Permission granularity for mixed roles

The manager-plus-booking-agent-plus-TM reality (08) means one person can wear three hats for the same artist. Hour cannot model them as three separate users with three logins. The permission model has to be:

- user-level identity,
- role-per-project (a user can be both manager and booker on the same artist),
- field-level visibility (booker sees live fees; manager also sees publishing; TM sees day-sheets only).

Generic "admin / editor / viewer" role sets do not fit this. The permission model is one of the hardest architectural decisions in the research.

### 3.5 DIY bands vs professionalised acts

This is a conflict with the product's *scope*, not between profiles. The self-managed band (04) has told us explicitly: **CRM vocabulary is an anti-signal**. The DIY act does not want "pipeline", "leads", "conversion rate", "sales funnel". They want "dates", "friends to email", "who's in the van".

If Hour uses professional vocabulary in its UI, profile 04 will not adopt it even though everything in the data model technically applies to them. The decision is: either serve the DIY profile with a deliberately simpler skin (different vocabulary, fewer fields, no commission tracking), or consciously exclude them from Phase 0 / Phase 1.

**Recommendation for Marco**: exclude profile 04 from Phase 0. They are a real user population but they are a distinct UX problem, and trying to serve them in the same product as profiles 01, 03, 08 will push the UI toward either complexity (loses DIY) or over-simplification (loses pros). Re-evaluate in Phase 2.

### 3.6 Show-centric vs artist-centric — theatre vs music

Already covered in §2.1 as the primary architectural split. Noted here as a conflict rather than a divergence because the two thesis statements *actively contradict*:

- Theatre: **the show is the primary object; the company is an administrative wrapper**.
- Music: **the artist is the primary object; the show is a date**.

Both thesis statements are *true in their domain*. Hour's polymorphic `project` concept is the compromise.

---

## 4. What profiles share that Hour should respect as constraints

These are not product features. They are rules about how Hour must behave, derived from universal patterns:

1. **Hour is not a replacement for email.** Every profile keeps Gmail as the thread-of-record. Hour should thread emails into show records without attempting to be the mail client.

2. **Hour is not a replacement for WhatsApp.** Real-time coordination with band members, crew, drivers, and venues will stay on WhatsApp for the foreseeable future. Hour should *not* try to be a chat app.

3. **Hour is not a replacement for craft software.** QLab, Eos, Vectorworks, Pro Tools, Logic, Ableton Live — these are sacred. Hour hosts the files, does not edit them.

4. **Hour is not a replacement for accountancy software.** Holded, FacturaDirecta, QuickBooks, Tiime — the filings live there. Hour tracks what is owed, what is paid, and hands invoicing-ready data to the accountancy system. It does not *become* the accountancy system.

5. **Hour is not a social network.** No "discover other artists", no "recommend contacts across organisations", no public roster pages. The research is emphatic: the moment the product pushes toward a social layer, trust collapses.

6. **Hour does not export to replace any other tool.** It sits *between* the craft tools (on the left) and the admin tools (on the right) and binds them to the show.

---

## 5. The multi-tenant freelance reality — architectural consequence

Profiles 06, 07, and 08 all describe the same structural user: **one human, multiple organisations, each with partial visibility into her work**. Hour's multi-tenant thesis was already there, but the research sharpens the requirement.

The three profiles share:

- **A personal workspace** that outlasts any single client engagement.
- **Membership in N client organisations** with bounded, role-scoped visibility inside each.
- **A private contact/knowledge layer** that is the freelancer's professional capital.
- **Cross-organisation views** (calendar, pending invoices, upcoming dates) that the freelancer needs to manage their own life but that no client should have access to.

Hour's architecture needs:

1. A `workspace` entity that can be either `organisation` (a company) or `personal` (a freelance's own).
2. A user can belong to 1 personal workspace + N organisation workspaces simultaneously.
3. A `contact` record has an *owner-workspace* and an optional list of *share-surfaces* to other workspaces. Sharing is contact-by-contact and field-by-field, default private.
4. An `engagement` record joins a contact to a project in a specific workspace. A single human can have N engagement records (one per workspace they have been introduced through).
5. The freelancer's personal workspace is Hour's *home view* for them, not a sidebar. Their cross-org calendar, cross-org invoice chase, and private contact layer all live there. Client workspaces are "rooms they visit".

This is the multi-tenant model Marco wrote into Hour's `CLAUDE.md` already, but read against the research it becomes sharper: **the freelance workspace is not a lesser tier of the company workspace. It is a peer tier with a different shape.** A freelance pays for her own plan (if we ever price freelancers). She does not inherit a plan from a client.

---

## 6. Patterns that will change Hour's roadmap

Read across all eight profiles, the following roadmap implications are strongly attested:

### 6.1 Phase 0 / 1 features (must-have)

- **Project (polymorphic show / album / campaign)** as primary object.
- **Date** as universal child of project. Holds, confirms, contracts hang off dates.
- **Contact** as cross-workspace entity with strict ownership and sharing boundaries.
- **Engagement** as join entity (contact × project × workspace).
- **Versioned document** attached to project, with a "latest" pointer and a "what-was-sent-where" trail.
- **Calendar view** per workspace + cross-workspace view for users in multiple workspaces.
- **Invoice tracking** per project with aging against expected payment terms.
- **Private notes** with hard visibility rules.

### 6.2 Phase 1 features (strong signals)

- **Holds system** (music-only project type).
- **Advance / settlement workflow** for dates with structured fields (hospitality, tech, day-sheet).
- **Commission tracking** across shared artists / shows.
- **Rider review workflow** (project owner + invited tech).

### 6.3 Phase 2 features (watch, don't build yet)

- Email integration (Gmail/Outlook threading).
- WhatsApp read-only integration (unlikely to be possible — flag as open question).
- Bookkeeping export (to Holded, FacturaDirecta, QuickBooks).
- Rights-society reporting (SGAE / GEMA / SACEM) — profile-dependent.

### 6.4 Features the research says NOT to build

- AI-based pitch-matching or gig-recommendation.
- "Roster discovery" or public-facing roster pages.
- Contract template library (too legally sensitive; each contract is negotiated).
- Setlist / plot / cue editor (respect craft tools).
- Social feed / activity stream visible to multiple organisations.
- Payment processing (money movement — the product should track, not move, cash; same principle as the budgeting-app guidance).

---

## 7. Vocabulary map across profiles

| EN | ES | CA | FR | Cross-profile note |
|---|---|---|---|---|
| show | espectáculo / obra | espectacle / obra | spectacle | Theatre primary object |
| date / gig | bolo / fecha | bolo / data | date / concert | Universal child |
| tour | gira | gira | tournée | Universal |
| venue | sala / espacio / teatro | sala / espai / teatre | salle / lieu | Universal |
| programmer | programador·a | programador·a | programmateur·rice | Performing arts |
| promoter | promotor·a | promotor·a | promoteur | Music |
| rider | ficha técnica / rider | fitxa tècnica / rider | fiche technique / rider | Universal |
| dossier / EPK | dossier / EPK | dossier / EPK | dossier / EPK | Universal |
| fee | caché | caixet / caché | cachet | Universal |
| hold | hold / reserva | reserva | option | Music only |
| confirmed | confirmado | confirmat | confirmé | Universal |
| advance (tech) | avance técnico | avanç tècnic | préparation | Universal |
| settlement | liquidación | liquidació | décompte | Music primary, theatre secondary |
| invoice | factura | factura | facture | Universal |
| reverse charge | inversión del sujeto pasivo | inversió del subjecte passiu | autoliquidation | EU cross-border |
| IRPF retention | retención IRPF | retenció IRPF | retenue à la source | Spain-specific |
| SGAE / GEMA / SACEM | derechos de autor | drets d'autor | droits d'auteur | Universal (different society) |
| distributor | distribuidor·a | distribuïdor·a | diffuseur·euse | Performing arts |
| booking agent | agente / bóquer | agent | agent / booker | Music |
| manager | mánager | mànager | manager | Music, increasing in theatre |

**Vocabulary traps carried across profiles:**

1. **"Difusión" (music) ≠ "distribución" (theatre)**. Different verb for different domains. Hour should pick one user-facing word per project type.
2. **"Regidor"** means stage manager in theatre, TV floor manager in TV, city councillor in civics.
3. **"Manager"** means career-wide in music, often absent in theatre (the distributor does the manager-like work).
4. **"Catálogo"** in music = recorded-music back catalogue; in theatre = the distributor's current-selling-shows list.

Hour's UI must project-type-aware terminology. A music project shows "holds", a theatre project shows "carta de interés". Same underlying state, different label.

---

## 8. The Hour thesis, re-validated by the research

Marco's original product thesis, restated: **the primary object is not "client" or "project" — it is the show**.

The research says:

- **For 5 of 8 profiles (01, 03, 06 in its show-catalogue aspect, 07 in its cross-company aspect)**: the thesis is correct as written. The show is the anchor.
- **For 3 of 8 profiles (02, 04, 05, 08 music-leaning)**: the anchor is the artist/act, with the show as a child of artist-campaign.

The architectural fix is minimal: make the primary object `project`, with `project.type` in {`show`, `release_campaign`, `creation_cycle`, `festival_edition`}. All the operational entities (dates, documents, contracts, invoices, engagements) hang off `project` regardless of type. The UI and vocabulary adapt per type.

**This is the structural validation Hour needed.** The thesis holds, with one small generalisation.

---

## 9. Open questions from the research

Where the research was thin, inconclusive, or contradictory — flagged here so Marco can decide what to investigate further:

1. **DIY band scope**: include or exclude from Phase 0/1? (§3.5 above — recommendation: exclude.)
2. **Spain "booking agents of Spain" association**: the research did not definitively locate a canonical body. MMF Spain is referenced but has thin web surface. Worth verifying with a practitioner.
3. **APADE (Spain tech association)**: does not appear to exist under that acronym. Closest is PEATE / regional associations.
4. **Tanzmesse 2026 cancellation**: already reflected in the research but Hour copy should not hard-code Tanzmesse dates. Industry volatility is real.
5. **ARC Catalunya (Catalan manager/promoter association)**: referenced but web surface intermittent. Worth a direct outreach.
6. **Specific named individuals flagged for verification**: "Caterina Muñoz" (distribution — may be conflated with María Muñoz, Mal Pelo choreographer); "Iaquinandi Distribution" (not surfaced); "ijet" (no strong public site); Za! band profile page.
7. **Rights-society reporting scope**: SGAE / GEMA / SACEM reporting is profile-specific. Bands (02) and solo musicians (05) care; theatre companies (01) mostly do not. Needs scoping decision per project type.
8. **Holds in theatre**: the research says holds are music-only. But programmers do sometimes issue "cartas de interés" that function like soft holds. Worth probing: is a theatre carta de interés a sufficiently similar entity to a music hold to share a data model?
9. **Per-venue rider variants**: the research makes clear that per-venue adaptation is the working truth, not the master rider. Should Hour model `rider_variant` as a first-class entity, or treat it as a document version with tagged scope?
10. **Cross-border co-booking data sharing**: the research documents the pattern (Barcelona + German co-booker) but does not surface any tooling that handles it. Is this a feature opportunity, or a "too small a use case" trap?

---

## 10. Headline recommendations to Marco

Summarising the most load-bearing findings:

1. **Generalise the primary object from `show` to `project`** (polymorphic). Keep `date` as the universal child. This is the one small change that lets Hour serve profiles 01-08 inside a single data model.

2. **Invest early in the personal workspace + organisation workspace dual model**, not as a Phase 2 add-on. This is the architectural moat against competitors that are single-org first (Muzeek, Gigwell, Propared, Artifax). Profiles 06, 07, 08 are not adoptable otherwise.

3. **Make private vs shared visibility a hard, visible boundary.** Freelancers will adopt Hour only if the boundary is trustworthy. Build the trust early; do not add it after launch.

4. **Do not automate the craft.** Host files, track versions, thread communications — do not try to edit riders, pitch letters, or plots. This is the loudest boundary across all eight profiles.

5. **Build the rider-and-dossier version model as a Phase 0 / early-Phase 1 priority.** It is the single most-complained-about friction in the research.

6. **Treat DIY bands as a Phase 2 target, not Phase 0.** Their vocabulary tolerance is incompatible with a professional CRM UI. Serve them later with a skin.

7. **Name the invoicing/payment-aging tracker explicitly as a Phase 1 feature.** Every profile names payment delay as a top-3 frustration; no tool treats it well; adding it cheap-and-simple is a clear win.

8. **Localise deeply.** Per-project-type vocabulary (show/release/creation/festival), per-territory tax fields (autónomo IRPF, intermittent du spectacle, KSK), per-territory fair-calendar templates. The stack that wins Europe cannot be English-first.

9. **Do not become a communications tool.** Email stays in Gmail, chat stays in WhatsApp, show-running stays in QLab/Eos. Hour is the binder around them, not a replacement for any of them.

10. **Accept the Airtable-rebuild cycle as an opportunity.** Every 18-36 months a new potential user is mid-rebuild of their Airtable. Hour's onboarding should catch them at exactly that moment — short, painful, clear import path from Airtable / Sheets / Notion.

---

## Sources

This document is a synthesis of profiles 01-08 in this same directory. All primary sources are cited in the individual profile documents:

- `01-theater-company.md`
- `02-band.md`
- `03-music-production-company.md`
- `04-self-managed-band.md`
- `05-solo-artist.md`
- `06-freelance-distribution.md`
- `07-tour-technician.md`
- `08-manager-booking-agent.md`

No new primary sources are introduced here; the synthesis draws exclusively on material already cited in the profile-specific source lists.
