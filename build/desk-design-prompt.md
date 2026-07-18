# Hour — Design: Desk — CONVERGED (system record)

> **STATUS: DESIGN CONVERGED 2026-07-18** through live iteration with Marco in his design
> tool. His final mockups (light + dark) are the **canonical visual reference**; this file
> records the converged system so any future regeneration or variant starts from the
> contract, not from scratch. Build contract: `desk-prompt.md § Converged design`.
> Semantic source of truth: `build/screen-data-spec.md § /h/desk`.

## The converged visual system

- **Editorial calm**: large serif headline ("10 need you" — counts dated items only, the
  Anytime tail is excluded), mono small-caps labels, warm paper / deep dark as equal
  themes, zero pictographs — typeable characters only.
- **Marginalia gutter**: the type system lives in the left gutter, not on the rows — one
  mono small-caps label per run: TAREA · AGENDA · CONVERSACIÓN · DINERO (singular,
  locale-resolved), tinted per concern, fine vertical hairline per run. **Labels are
  clickable doors** to their lens, carrying the current scope (the gutter is wayfinding:
  it teaches the app's structure while you work).
- **Clean rows, no leading marks**: one line by default; an earned second line only for
  urgent why-nows ("expected reply Jul 10", "92 of ~60 days"). Context path
  `space · project · line` in quiet mono — identity is textual, no color codes to learn.
  Verb labels tinted per concern on derived calls only (reply / chase / confirm / remind /
  revive); tasks appear in their own words, neutral ink. AGENDA rows lead with their hour
  (venue-local per the timezone rule). Money amounts only where money is the decision
  (remind / confirm). Actions on hover — persistent in OVERDUE.
- **The show-day card**: the single banner — serif venue title, the 5 real timeslots
  (venue-local, viewer courtesy only when different), Road sheet door. On a show day the
  show owns the day.
- **Pulse strip**: one computed mono line under the headline — ambient state, each
  fragment a door to its lens. Never widgets, never placeholders.
- **Ghost proposal**: PROPOSED badge + reason line + Add/dismiss in a tinted container
  inside the TAREA block — consent, not alarm.
- **Anytime**: recedes (low contrast); excluded from the headline count.
- **No per-bucket counters** — deliberate (Marco: never >4 items/day; a number is noise).
  Empty days don't render.
- **Calm mode**: clock-corner pill (outline = available, solid = active, keyboard `c`).
  ON: the feed reduces to today, the rest folds, overdue collapses to one quiet footer
  line ("N vençudes i M coses més esperen fora del mode calma →" — click exits), and the
  whole page drops one contrast step. The mode is felt, not just read. Never automatic.
- **Urgency language**: red only for OVERDUE, restrained; tentative reads as a question;
  the empty feed reads as achievement (the hall's "Tot tranquil" voice).

## If regenerating mockups

Produce: busy day (show today + overdue + AI proposal) · quiet day (revive calls) · calm
mode ON — desktop + mobile, both themes, side by side where the comparison matters
(calm on/off especially).
