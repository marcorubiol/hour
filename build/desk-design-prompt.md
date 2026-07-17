# Hour — Design prompt: Desk (the "what needs me" home)

> For the design tool. Origin: S1 2026-07-17 — decisions in `_decisions.md` ADR-068/069/070,
> data spec in `build/screen-data-spec.md § /h/desk`.

## What Hour is, visually

A calm, editorial tool for a live-performing-arts company. Current language: large serif
display type, mono small-caps labels, warm paper background, 8 accent hues (one per
space/project), light + dark themes as equal contracts. The home (`/h`, "the hall") greets
with one serif sentence; the Desk is one click deeper — the single catch-up surface of the
whole app. Calm over gamified, always: no progress bars, no confetti, no badges shouting.

## The screen to design: Desk

One ranked feed answering "what needs me now", grouped by day buckets:
**OVERDUE · TODAY · TOMORROW · {weekday} · NEXT WEEK · LATER · ANYTIME** (quiet tail).
Item types are MIXED inside buckets by urgency — type is expressed by verb + glyph, never
by separate blocks.

Four item types to design:

1. **Conversation next-action** (the booking work): verb ("Reply", "Chase", "Confirm") +
   person or organization name + project color dot + up to 2 `#tags`. The workhorse row.
2. **Task**: done-toggle + title + parent entity (project/line/gig/conversation) + meta
   "due Fri · surfaces Tue" (the computed surfacing date is always visible and editable —
   trust through transparency). Variant: **AI-proposed task** — visibly marked (badge/tone),
   with two quiet actions: accept / dismiss. It's a proposal awaiting consent, not an alarm.
3. **Performance day-anchor**: a gig today/tomorrow is the HEADLINE of its bucket — bigger
   than rows: venue, city, load-in time. On a show day, the show owns the day.
4. **Money alert**: overdue invoice ("Invoice 2026-014 · 12 days overdue") and
   gig-done-without-invoice. Quiet red — informative, not alarmist.

Plus: a **quick-capture line** at the very top — one unobtrusive input ("add a loose end…"),
keyboard-first, drops into Anytime.

## Urgency expression

- OVERDUE: red accent, but restrained — a mark, not a siren.
- Urgent window (surfaced, due approaching): warm emphasis.
- Open / Anytime: low contrast, recede.
- Empty feed: it should feel like an achievement — same voice as the hall's "Tot tranquil."

## States & platforms

- States: loading (skeleton or nothing — no text spinners), error (one honest line),
  empty (see above).
- **Both themes** (light editorial / dark) — mandatory, equal quality.
- Desktop first + a mobile pass: single column, bucket labels as sticky headers, capture
  reachable without scrolling.

## Deliverable

High-fidelity mockups: desktop + mobile, both themes, one realistic day —
1 gig today (day-anchor), 2 overdue conversations, 3 tasks (1 of them AI-proposed),
1 overdue-invoice alert, a 3-item Anytime tail, quick-capture visible.
