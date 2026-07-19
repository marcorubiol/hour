# Hour — Design prompt: creating a multi-day block

> **STATUS: NOT DESIGNED.** The model, the write path and the month rendering exist and
> are live (ADR-084 §1, 2026-07-20); what is missing is the interface that creates one.
> For the design tool. Origin: ADR-084 §1 + ADR-078 §1 (unified create dialog).

## What Hour is, visually

Calm, editorial tool for live performing arts. Large serif display, mono small-caps
labels, warm paper background, 8 project-accent hues, light + dark as equal contracts.
Calm over gamified. Zero pictographs: typeable characters only.

Inherit the existing grammar — do not reinvent it:
- **Solid fill + rounded corners = settled.** **Hatch + dashed + square corners = held.**
- Time-as-glyph: hours in mono.
- Truth-only microcopy: every string maps to a real field.

## The job

A company proposes **five weeks of rehearsals** and, weeks later, confirms two of them.
Today they would have to create ~25 separate dates by hand. This dialog creates the whole
block in one gesture.

## The one model fact that shapes the whole design

A block is **not one long event**. It is **N rows, one per day, sharing an invisible
series key**. That is deliberate, and it is the reason the feature is worth building:

- **Each day keeps its own hours** — Wednesday can run 10–18 while Tuesday runs 10–14.
- **Each day keeps its own status** — you confirm week 1 and 2 while weeks 3–5 stay
  options.

The month grid already renders such a run as **one continuous strip**: the first day
shows the full card (name, place, type), the following days show only their own hours,
and the strip's edge switches from solid to dashed exactly where the confirmation stops.
The design must not promise anything that contradicts per-day independence.

## What the dialog has to let someone say

- **Which project** (and optionally which line — e.g. a "creation" line).
- **What kind**: rehearsal · residency · press · other. **Travel is excluded** — a travel
  day carries a direction, it is not a block.
- **Which days** — see the open question below.
- **What hours** — one start, optionally one end, applied to every day at creation. Days
  are edited individually afterwards; the dialog does not need per-day hours.
- **Where** — venue name / city / country, shared by the block.
- **Settled or option** — dates are born **tentative**; confirming is a separate act. The
  existing "Opció" pill vocabulary applies.
- **A title** — e.g. "Assaigs · La Mostra".

## The open question — this is what we need you to solve

**How do you choose the days?** The block is rarely "every day from the 6th to the 10th":
it skips weekends, or it is Tuesdays and Thursdays for six weeks, or it is three
scattered weeks. Candidate directions, none decided:

1. Start + end date, plus weekday toggles (M T W T F S S) to exclude days.
2. A small month calendar where you paint the days you want.
3. A range plus a "repeat weekly ×N" multiplier.

Whatever you choose has to survive the real case: **five weeks of rehearsals, weekdays
only.** Show us the state where 25 days are selected without the dialog becoming a wall.

## Non-negotiables

- **It is a mode of the existing unified create dialog** (ADR-078 §1: a type pill drives
  the form), not a second dialog living somewhere else. Show how the single-date form
  becomes the block form — the transition matters more than either end state.
- **Show what will be created before it is created.** The write is atomic and multi-row;
  the user must be able to count the days and see the excluded ones. A wrong click here
  makes 25 rows, not one.
- Limits to respect, and to say plainly if hit: minimum **2 days** (one day is just a
  date), maximum **92 days**, no two rows on the same day.

## Deliver

The dialog in its empty state, in the middle of picking a five-week weekday block, and
the moment before confirming. Plus how the result lands on the month grid as a strip.
Light and dark. Same tokens as the Planner mock.
