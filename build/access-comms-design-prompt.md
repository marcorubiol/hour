# Hour — Design prompt: access + comms (who is who, and where they talk)

> **STATUS: MODEL VALIDATION PASS (2026-07-19).** ADR-082 (people / roles / access) and
> ADR-083 (comms layer) are **provisional, unimplemented, zero schema touched**. This design
> pass exists to break the model before the schema does: if a screen creaks, the finding goes
> back to the ADRs, not into code. There is a hard gate before any build — use the app with a
> real difusión season first.
>
> Four working HTML prototypes already exist in `app design/`, built on the REAL token file
> (they `<link>` `apps/web/src/styles/base.css`), light + dark:
> `comms-hub-performance-prototype.html` · `permissions-editor-prototype.html` ·
> `person-roles-org-prototype.html` · `operator-invite-flow-prototype.html`.
> They carry inline `.qnote` annotations — the open questions, marked so they can never be
> mistaken for UI. **Read them before redesigning; they are the argument, not decoration.**
>
> Origin: grill 2026-07-19 → `_decisions.md § ADR-082` + `§ ADR-083`.
> Structure model that constrains all of this: `build/structure-model.md`.
> Do NOT inherit from `build/design-prompt.md` — that file is stale (House/Room/Run/Gig
> vocabulary, two-axis sidebar, 8 accents; all superseded).

## What Hour is, visually

Calm, editorial tool for live performing arts. Large serif display (Newsreader), mono
small-caps micro-labels (JetBrains Mono), sans for body (Inter), warm paper background,
**12** project-accent hues, light + dark as equal contracts. Zero pictographs — typeable
characters only. Color communicates state, never decoration. Calm over gamified.

## Inherit the Desk system (converged 2026-07-18 — do not reinvent)

Full contract in `build/desk-design-prompt.md`. The pieces that carry over here:

- **Marginalia gutter**: one mono small-caps label per run, tinted per concern, fine
  vertical hairline down the run. The label is a **door** to its surface.
- **Clean rows, no leading marks**: one line by default; a second line only when earned.
  Context path `space · project · line` in quiet mono.
- **Hold grammar**: outline = possibility · solid = commitment.
- **Reds reserved** for real overdue/conflict. Everything tentative reads as a question.
- **Consent-first proposals**: `PROPOSED` badge + reason line + accept/dismiss in a tinted
  container. Never a blast, never an alarm.
- **Truth-only microcopy**: every string maps to a real field. No placeholders.

## The model, in one page (needed to design it)

Three concepts that must never fuse — fusing them is the failure this design is testing:

| Concept | What it is | Power? |
|---|---|---|
| **Rol** (label) | what a person *does* — sound, distribution, road manager. **Multiple** per person. Standard + custom. | **None.** Pure label. |
| **Membresía** | which containers they are in (space / project / line / performance) | decides **what they see** |
| **Permisos** (access) | a bundle of `view \| view+edit` pairs, per facet | decides **how much** inside what they see |

- **Naming (locked):** the label is **rol**, the access is **permisos**. The DB still calls
  access `role` — a known UI/schema mismatch to document at implementation time.
- **Scope comes from the LEVEL where you assign**, not from an attribute of the permission.
  The same preset is wide at space level and narrow at one performance. Effective = **union**.
- **Presets, not a capability composer.** The client picks Guest / Team / Production /
  Direction; per-person **overrides** toggle one pair. Dangerous capabilities (delete,
  membership, billing) are off the menu entirely.
- **Hard requirement:** a **"what you see and where it comes from"** view — preset +
  overrides, always resolvable. Without it, overrides rot into WordPress-grade mystery.
- **Login is for OPERATORS only.** Counterparts (programmers, theatres) never log in — they
  are subjects, reached by email and signed links. "Dar de alta" is a deliberate act, by
  **invitation**; a cold signup matching an email does NOT link to the contact.
- **Organization is an entity.** A conversation anchors on org and/or person (at least one).
  Person↔org is a **relation** with context and history — several, not a column.
- **Comms**: one polymorphic thread that hangs off any container. Async, Slack-shaped, a hub
  per container. **Sub-threads = the facets** (fixed, few) + free threads with a label.
  Fixed threads: audience derived from capability. Free threads: explicit participants.
  **Always show the resolved audience**, including the automatic ones. Realtime is out.
- The bolo channel is **not created — it exists**, because the bolo is a container. What is
  proposed (consent-first) is *telling the crew it is open*.

## The screens to design

### 1. The comms hub of a performance
The facet sub-threads in the Desk's gutter grammar. **Tinted gutter = facet** (gated by
capability); **dashed, untinted gutter = free thread** (explicit participants). Per thread:
title, last messages as clean rows, and a collapsed audience line — *"seen by 5 — by
LOGÍSTICA permission"* — expanding to the resolved list with a per-person reason.
Then, for the whole hub, **"who enters and why"**: person · rols · which threads they see
(facet chips, present and absent) · where it comes from.
**Must include the money thread that a road manager cannot see** — that case is the entire
reason ADR-082 exists — and **the band below the rule**: derived participants who cannot hold
a login (the venue contact, the programmer), shown as `no access` + *write to them →*.
Drawing that band is mandatory. Dropping them silently is what makes a model look coherent
and behave wrong.

### 2. Assign rol(s) + permissions
Four blocks in this order, because the order is the argument: **Rols** (chips, multiple, with
"changing a rol changes no permission" stated) → **Level** (where this access is given, with
the union of the other levels shown) → **Permissions** (preset chips + a facet × `nothing |
view | view+edit` matrix, overrides visibly marked and attributed) → **"What they will see
and where it comes from"**. Capabilities that do not fit the facet grid ("open free threads",
"invite people") sit in a separate, visibly different block.

### 3. A person with several rols and their organizations
Person file. Person mark (initials, **no hue**) + name + rol chips. **Organizations as
relations with dates**, including a finished one. **Conversations showing all three anchors**:
org+person · org only (negotiating before you have a name) · person only (a freelancer).
Then **Access**: one row per link (person × container) — a door where there is work, no door
where there is difusión.

### 4. The alta flow — from contact to operator
Five panels: the door on the link → the invite (space · level · preset · rols prefilled ·
message, with the effective preview) → sent & pending (plus the "a cold signup does not link"
note) → accepted (operator, seat counted, contacts explicitly unlimited) → **the door that
must not exist** (a difusión-only contact whose file offers no way to make the mistake).

## Binding contract — what the prototypes settled

- **The person mark carries no hue.** Same silhouette as the project monogram (ADR-081), but
  a circle on quiet ink. Color stays the container's language; if people took accents, a
  thread would run two color systems and "color = project" would break.
- **The facet chip and the gutter label are the same object.** They were drawn separately and
  came out identical — which is ADR-083's "triple service" confirming itself. Keep them
  identical; if they ever diverge, the facet has stopped doing triple duty.
- **The audience/effective/preview view is ONE component**, appearing four times (thread
  audience · effective permissions · invite preview · roster). If a redesign needs it to look
  different in each, that is a finding to report, not a styling choice.
- **The invite door hangs off the LINK (person × container), never off the person.** Ana is a
  Grec programmer *and* MüK's sound tech; a per-person door cannot be both present and absent.
- **Design annotations are `.qnote`**: dashed rule, mono, muted, tagged. Never styled as UI.

## Open questions the design must keep visible (do not resolve silently)

1. **The facet list is not one list yet.** ADR-082's access facets (conversations, money, road
   sheet, production, materials) and ADR-083's comms facets (technical, logistics, money,
   general) overlap only on *money* and *general* — yet ADR-083 §4 claims "one list for all
   three jobs". The permissions matrix draws a "has a comms thread?" column precisely so the
   mismatch is unmissable. Three ways out: unify the list · admit two overlapping lists and
   retract the claim · **make the thread a third access option of each facet** (recommended —
   keeps one list, invents no threads nobody opens).
2. **"Rol" still means three things on screen**: the ADR-082 chips, the hardcoded "Roles I
   take on" list in `settings/+page.svelte`, and the free-text `cast · role` / `crew · role`
   on the person file. Same thing or not — decide before two vocabularies exist.
3. **Does comms earn a fifth type in the Desk?** A `MISSATGE` run fits the Desk grammar
   without breaking it, but 4→5 concern labels costs calm, and "everything unread" turns the
   Desk into an inbox — exactly what rejecting live chat avoided. Proposed criterion: only a
   message carrying **an open question addressed to you** surfaces.
4. **The hub's participants are wider than its operators.** The bolo hub derives people from
   both sides of the Conversations/Team boundary (`structure-model.md:86`) plus the venue.
   Either the "outside the thread" band is part of the model, or venue contacts stop being
   derived — and the bolo loses the person you actually talk to that day.
5. **Nothing designed for revoking.** What happens when an operator stops being one at the end
   of a tour — access revoked, person back to contact, everything they wrote in the threads
   kept? ADR-082/083 are silent. It is the other half of "dar de alta" and has no screen.

## States & platforms

Loading · error · empty (a hub with no messages must read as calm, not broken) · the masked
state when the viewer lacks `read:money` (**suppress silently — masked ≠ zero**) · both themes
at equal quality · desktop primary, **mobile pass mandatory for the hub** (the bolo channel is
read standing up on a load-in day).

## Deliverable

High-fidelity mockups of the four screens, desktop + mobile for screen 1, both themes, with
realistic data: a confirmed bolo six days out with four facet threads and one free thread ·
a road manager who sees logistics and not money · a venue contact with no access · a person
holding three rols across two current organizations and one finished one · an invite whose
preview shows one facet deliberately withheld.
