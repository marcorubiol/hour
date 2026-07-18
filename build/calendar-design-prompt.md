# Hour — Design prompt: Calendar lens (planning without alarm)

> **STATUS: READY FOR DESIGN (updated 2026-07-18).** Design does NOT depend on the build —
> it precedes it (the Desk proved the loop: design converges, then the builder gets the
> final system). Rewritten post-ADR-076 (two projections) and post-Desk design system.
>
> For the design tool. Origin: ADR-072 (conflicts/availability/travel) + ADR-076 (one door,
> two projections) + the timezone rule, all in `_decisions.md` / `build/screen-data-spec.md
> § Calendar`.

## What Hour is, visually

Calm, editorial tool for live performing arts. Large serif display, mono small-caps labels,
warm paper background, 8 project-accent hues, light + dark as equal contracts. Calm over
gamified — a conflict is information, never a siren. Zero pictographs: typeable characters
only.

## Inherit the Desk system (already converged — do not reinvent)

- Time-as-glyph: timed rows lead with their hour in mono.
- Hold grammar: **outline = possibility (hold\*), solid = commitment (confirmed+)**.
- Left-gutter type labels in mono small-caps where rows mix kinds.
- Reds reserved for real conflict/overdue; tentative things read as questions, not alarms.
- Truth-only microcopy: every string maps to a real data field.

## The lens: ONE door, TWO first-class projections (ADR-076)

A single nav entry (Calendar) with a projection toggle — neither is secondary:

### Projection 1 — Month grid (desktop primary)

- **Performance chips**: venue/city label, project accent rail, outline/solid per hold
  grammar, hour when known (venue-local — the timezone rule: venue time is the truth,
  viewer time is the courtesy shown only when they differ).
- **`date` chips**: italic (rehearsal, press, residency…), quieter than performances.
- **Travel chips**: direction typographically — "→ Lyon" (ida), "Lyon →" (vuelta).
- **Blackout bands**: company-wide = full-width quiet band; person-level = named narrow
  band ("Anouk — fora"). Tentative = dashed/soft ("el 8 en dubte") — a question mark of
  a band, not an alarm.
- **Conflict marks**: two chips sharing PEOPLE the same day get a clash mark + tooltip
  card naming the shared people ("Anouk — també a X"). The honest variant "possible
  conflict — no team data" is visually softer. Never date-collision alone as confirmed.
- Month nav ← Today → · status filter (All | Holds | Confirmed) · per-day "+" offering
  Performance | Date.

### Projection 2 — Agenda list (mobile primary, desktop peer)

The Desk's sibling: same row DNA, but pure chronology (no urgency ranking — this is
planning, not triage). Day headers as sticky mono labels; rows = time-as-glyph + title +
place + project accent; performances vs dates distinguished by the hold grammar + italic;
blackout days show their band inline; conflicts carry the same mark as the grid.

## Dialogs to sketch

- **New date**: project* → line? → performance? cascade, kind, title, start/end, all-day,
  travel direction (only for travel days).
- **New blackout**: person (optional — empty = whole company), date range, certainty
  (unavailable | tentative), kind, note.
- Both are the entity's editor HOSTED by the lens (the lens owns no edit logic).

## States & platforms

Loading (dimmed grid, no spinner text) · error (one honest line) · empty month (quiet, not
sad) · both themes, equal quality · desktop grid + mobile agenda.

## Deliverable

High-fidelity mockups: desktop month grid + desktop agenda + mobile agenda, both themes,
one realistic month: 2 holds on the same day sharing an actor (people-conflict) · 1
possible-conflict pair (no team data) · a tentative person blackout · a travel pair around
a confirmed foreign gig showing venue-local hour with viewer courtesy · a rehearsal week ·
one company-wide blackout weekend.
