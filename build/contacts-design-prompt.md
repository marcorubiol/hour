# Hour — Design prompt: Conversations lens (the booking network, at booking speed)

> **STATUS: NOT STARTED (2026-07-17).** Depende de Conversations v1.5 (no construido).
>
> For the design tool. Origin: S1 2026-07-17 — ADR-073, spec `§ Conversations`, personas in
> `research/profiles/06-freelance-distribution.md` + `99-patterns.md`.
> Amendment 2026-07-17 (ADR-075): the lens ADR-073 named "Contacts" is now **Conversations**
> (route `/h/conversations`). "Contact" survives only as the book concept — the by-contact
> grouping, the provenance chip "on a contact" and the contact-card language below are
> correct as written.

## Who uses this

The difusión person: relational professional, 500–2000 programmers built over years,
sales cycles of 9–18 months, two yearly peaks (pre-fair prep, post-fair follow-up).
Hates CRM vocabulary and SaaS urgency: a two-month silence is NORMAL, dormant is rest.
The tone is a well-kept address book, never a sales pipeline.

## Visual language

Calm editorial (large serif, mono small-caps labels, warm paper, 8 accents, light+dark
equal). **This lens is mobile-first** (ADR-015) — fairs happen standing up.

## To design

1. **The table (by conversation)** — columns: name, organization, location, status badge
   (inline-editable), next action, **last contact** (quiet relative date — informative,
   zero alarm tones even when old).
2. **By-contact grouping** (toggle): one row per person, their conversations as small
   project chips (status-toned). Show both states of the toggle.
3. **Organization rows** (design ahead of build — entity lands after S2): a theatre /
   festival / town hall as an openable row: name, kind, city, its people indented or
   chipped. Design how person rows show their affiliation ("directs Théâtre X · Lyon")
   next to where they live (Paris) — both places visible, per the Lyon/Paris case.
4. **Provenance chip** (design ahead): "FiraTàrrega 2026" on a contact — where you know
   them from — and a **post-fair queue** view: "met at {fair}, not yet followed up" as a
   filtered state of the same table.
5. **Fair mode (mobile)**: a quick-capture sketch — name + org + one context line, three
   taps between meetings, offline-tolerant feel.
6. **Empty state**: warm, points to importing an existing spreadsheet ("bring your book").

## States & platforms

Loading / error / empty (see 6) · search + status filter row · pagination footer ·
both themes · desktop table + mobile list (mobile is primary here).

## Deliverable

High-fidelity mockups: desktop (both grouping states) + mobile (list + fair-mode capture),
both themes, realistic data (a programmer who directs a theatre in Lyon and lives in
Paris; a recurring contact untouched since last season — shown calmly; one org row with
two people).
