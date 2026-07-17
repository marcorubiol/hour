# Hour — Design prompt: Calendar lens (planning without alarm)

> **STATUS: NOT STARTED (2026-07-17).** Depende de Calendar v2 (no construido).
>
> For the design tool. Origin: S1 2026-07-17 — ADR-072 in `_decisions.md`, data spec in
> `build/screen-data-spec.md § Calendar`.

## What Hour is, visually

Calm, editorial tool for live performing arts. Large serif display, mono small-caps labels,
warm paper background, 8 accent hues (project identity), light + dark as equal contracts.
Calm over gamified — a conflict is information, never a siren.

## The screen: Calendar lens, month grid + list view

The planning surface: "can I take this gig?" answered at a glance.

**Chip grammar to design** (the core of this brief):
- **Performance**: solid = committed (confirmed/done/invoiced/paid), **outline = hold**
  (possibility). Project accent rail; venue/city label; time when known (load-in).
- **Date events**: italic label (rehearsal, press, residency…), quieter than performances.
- **Travel**: direction expressed typographically (e.g. "→ Lyon" outbound, "Lyon →" return)
  — typeable symbols only, no pictograph icons.
- **Blackout bands**: company-wide = full-width quiet band across the day cell(s);
  person-level = named narrow band ("Anouk — away"). Tentative blackout = dashed/soft
  variant, reads as a question.
- **Conflict marks**: two chips sharing people the same day get a visible clash mark +
  tooltip card naming the shared people ("Conflicts: Anouk (cast) — also in X").
  Variant "possible conflict — no team data" is visually softer, honest about uncertainty.

**Views**: month grid (desktop primary) + agenda list (same data grouped by day —
the mobile primary). Month nav ← Today →; status filter (All | Holds | Confirmed).

**Dialogs to sketch**: New date (project → line → performance cascade, kind, travel
direction when travel), New blackout (person optional — empty = whole company, range,
certainty).

## States & platforms

Loading (dimmed grid, no spinner text) · error (one honest line) · empty month (quiet,
not sad). Both themes mandatory, equal quality. Mobile: list view, sticky day headers.

## Deliverable

High-fidelity mockups desktop (month) + mobile (list), both themes, one realistic month:
2 holds on the same day sharing an actor (people-conflict), 1 possible-conflict pair,
a tentative person blackout, a travel pair (outbound/return) around a confirmed gig,
a rehearsal week, one company-wide blackout weekend.
