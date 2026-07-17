# Hour — Structure model (lenses · modules · entities)

> Status: **canonical**. This is the model we build against now. Not "final" (Phase 0 is
> still learning from real use), but from 2026-07-14 on every structural decision is measured
> against it. If code or another doc contradicts it, either this doc wins or the contradiction
> is a bug to reconcile — flag it, don't silently diverge.
> Recorded: 2026-07-14. Decision + rationale: `_decisions.md` § ADR-063 (model) + ADR-065 (naming: Desk · Calendar · Contacts · Money; the line's cast/crew module = Team).
> Read next to: `architecture.md` (data model / stack), `_decisions.md` (ADR log).

## The one idea

Hour is not a booking app, a CRM, a calendar or a road-sheet tool. It is **one operating base
where the same entities are seen through different concerns**. Everything on screen is either a
place where an entity is **edited in context** (a container) or a place where entities are
**read in aggregate** (a lens). Nothing is a data silo.

## Primitives

**Entity** — where data actually lives: workspace, project, line, performance, date, engagement,
person, venue, invoice, expense, asset, task… Both lenses and modules are *views* of entities.
Editing always lands on an entity, never on "the view".

**Container** — an entity that holds others and can be scoped into. Three nesting levels, billing on top:

`account (billing) → workspace / space → project → line → performance · date`

- **Space (workspace)** = one entity, org or personal, equal rank (ADR-062). No `acto`/roster level.
  Projects hang directly off it.
- **Project** = the show / production. The unit of thought.
- **Line** = a *línea de trabajo* inside a project (tour, booking season, creation, press, fair…).
  Its `kind` drives what it shows.

**Lens** — a **read / aggregation** surface over **one concern** (a data domain: Calendar / Contacts /
Money). Cross-container, scopeable by pins (all / space / project). Owns **no edit logic** — to change
something you jump to where the entity is authored. (The home `/h/` is *not* a lens but the cross-concern
**Desk** digest — see § Read surfaces. ADR-062: "a view, not a container".)

**Module** — a **line-level** section. Compositional, chosen by the line's `kind`/template,
added / removed / reordered. The **edit-in-context** surface of a line. Modules exist *only* at the
line — nothing above the line composes modules.

**Task** — the **verb layer**, not a concern-domain. Polymorphic: attaches to project / line /
performance / engagement — at most one; none = a free workspace task (D3 **live since 2026-07-17**,
ADR-070/071: anytime / from / due+lead, urgency always derived). Never a lens. Surfaces in three
places: inline as an engagement's next-action (live via `engagement.next_action_at`; no backfill —
ADR-070), as the Tasks line module, and as a feed into the Desk (the home). **Authoring**: a
parent-attached task is created where its parent lives (the module's composer); the FREE workspace
task has no container editor anywhere, so its authoring home is the Desk composer — a deliberate
extension of Option 2, recorded here so it reads as a decision, not drift.

## The split that resolves everything

|              | Purpose            | Owns edit logic? | Where                              |
|--------------|--------------------|------------------|------------------------------------|
| **Lens**     | read / aggregate   | No               | cross-container, pinned scope      |
| **Edit surface** | author in context | Yes           | space · project · line (modules)   |

**Editing happens at a container. Three edit levels:**
- **Space** — its own identity/fiscal content: name, domain, city, logo, accent, description;
  fiscal fields later (ADR-062).
- **Project** — the show's own content: name, status, about, **technical rider / canonical assets,
  cast**, poster / dossier.
- **Line → modules** — the composable furniture, scoped to the line.

**A lens only shows. Option 2 (chosen 2026-07-14):** a lens defines no editing of its own, but **may
host an entity's editor inline** for convenience. The editor it embeds is the entity's — the same one
reached from the module/container. So "edit lives at the container" holds even when the widget appears
in a lens. This reconciles today's inline edits in the Money / Calendar / Contacts lenses
(ADR-046 / 043 / 044): those are the entity's editors *hosted*, not lens-owned logic.

## Read surfaces and modules — the categories

A **read surface** is anything that shows entities in aggregate. There are two kinds: a **concern-lens**
(one data domain, all of it — Calendar / Contacts / Money) and the **Desk digest** (cross-concern, ranked
by what needs you now — the home; owns no data, computed over the lenses + tasks). Below, which concern
is a lens, a module, or both:

| Concern / surface               | Global read surface     | Module (line edit)? | Note |
|---------------------------------|-------------------------|---------------------|------|
| **Desk** (the now)              | **digest** (not a lens) | no                  | cross-concern, ranked by urgency; the home; owns no data — a query over the others + tasks; no per-line form |
| Calendar                        | lens                    | yes                 | month grid / planning; distinct from Desk (now/triage vs planning) |
| Contacts                        | lens                    | yes                 | your booking network — **people AND organizations** (a theatre is a contact, not a person); persons + engagements; comms folds in later |
| Money                           | lens                    | yes                 | fees, invoices, expenses |
| Team                            | — (module only)         | yes                 | cast + crew executing the line — **distinct from Contacts** (Contacts = who you book with; Team = who does the show) |
| Notes · Materials · Road sheets | — (module only)         | yes                 | entity-bound content; no meaningful global view (ADR-009) |

Rule of thumb: **single-concern transversal read → lens. Cross-concern "what needs me now" → the Desk
digest (not a lens). Entity-bound content → module only. Verb that hangs off objects → task.**

## Canonical vocabulary (locked)

- **Lens / lente** — a global read surface. Never composed, always present, narrowed by pins.
- **Module / módulo** — a line-level composable section. The only place modules exist.
  Catalog: Calendar · Contacts · Money · Notes · Materials · Team · Road sheets · Tasks (live, ADR-071).
  (Contacts module = the line's booking conversations — the Contacts lens scoped to it; Team = its cast/crew.)
- **Task / tarea** — the verb layer. Not a lens. Module + inline next-action + Desk feed.
- **Space / project edit content** — a container's own intrinsic editable fields. **Not** modules.

Do not blur these. If "module" starts appearing above the line, or a lens grows its own edit logic,
or a task is treated as a fourth data-domain lens — that's drift. Fix it back to this doc.

## Lens set — settled 2026-07-14 (ADR-065)

The nav layer is **one home + three lenses**:

- **Desk** — the home / the "now": what needs me + what's next + tasks (planned or not). Reached by the
  logo. Revives the ADR-008 name (fits now that tasks return); replaces "Agenda", which reads as
  "calendar" in ES/CA/FR and blurred with the Calendar lens.
- **Calendar** — month grid / planning / conflict-detection. A ⌘K lens.
- **Contacts** — your booking network: persons + engagements. **Not "People"** — the lens holds
  organizations too (theatres, town halls, festivals), and a theatre is not a person; a *contact* is
  whoever you deal with, individual or org. Comms folds in later as a per-contact timeline (ADR-056
  direction). A ⌘K lens.
- **Money** — fees / invoices / expenses; gated by `read:money`. A ⌘K lens.

**Dropped: the "Time" merge** (Agenda + Calendar into one lens). Good naming dissolved it — with **Desk**
clearly ≠ **Calendar**, the redundancy that motivated the merge is gone. They stay separate (the "now /
what do I do" vs planning), a gap D3 (tasks) only widens.

A fourth lens, **Work / Flow**, appears only if the task entity (D3) lands and Desk needs to separate
tasks from events.

**Killed: the "Archive" lens** — never scoped, only a placeholder in ADR-009. Gone.

## Persona-fit = role, not composition

Different people need different views (a booker vs a finance person vs a tour manager). The need is
real — but it is met by **role**, never by a user-operated view builder. Two mechanisms, both
role-driven, both already scaffolded:

- **Access (hard, security):** what a person can even see is RBAC (`read:money`, `read:engagement`, …
  — the 10-permission closed vocabulary, ADR-006). Money is **already fully RLS-gated by `read:money`**
  across fees, invoices and expenses (verified in `rls-policies.sql`: `invoice_select` / `expense_select`
  require it; the redacted performance view masks fees) — a role without it cannot read money at the DB
  level, which is the real boundary. The UI must mirror it: a capability flag hides the Money lens (⌘K),
  the Money module and the € stats when the viewer lacks `read:money`. This is the "roles de verdad"
  capability flag ADR-058 deferred to Phase 0.9.
- **Emphasis (soft, cosmetic):** what is front-and-center is the **default landing lens keyed off role** —
  a difusión-only member lands on Contacts, not Desk; finance lands on Money. Everything else
  stays one ⌘K away. Not a per-user layout; a `default = f(role)`.

Why not composition: the lens set stays fixed and opinionated (the moat). Composing read-cards per
container reintroduces the "which view am I on" problem (ADR-009) and the Airtable-escape-hatch risk
(strategy review risk #7). Persona-fit = the system choosing per role, not the user building. If saved
views (serialized `{scope, lens, filter, sort}` — the D-PRE-05 "Master View" scaffold) later prove
necessary for light personalization, they are the ceiling — not a card builder.

## What this supersedes / refines

- **Refines ADR-056** — Materials and Team (cast/crew) as line modules stand, but **canonical assets
  (technical rider, dossiers) and cast are project-level edit content** (ADR-009's original intent). A
  line's Materials / Team module is a *scoped view / adaptation layer* reading from the project's canonical
  set — not the home of the canonical material.
- **Reframes ADR-046 / 043 / 044** — inline editing from the Money / Calendar / Contacts lens is kept,
  understood as the entity's editor **hosted** by a read-only lens (option 2), not lens-owned edit logic.
- **Resolves ADR-057 re-evaluate (a)** ("is project detail a module composition?") → **No.** Project
  detail = its own edit content + its lines + scoped lenses. Modules stay at the line.
- **Confirms ADR-062** — space = one entity (edit surface #1); the `/h/` cross-space home is the widest lens.
- **Closes** — the Archive lens (deleted).

## Re-evaluate when

- D3 (task entity) lands → decide the Work / Flow lens and whether Desk mixes tasks with events.
- A concern appears that is neither a transversal read nor entity-bound content → the three-category
  table needs a fourth row.
