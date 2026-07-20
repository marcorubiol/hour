# Hour — Build prompt: hall status sentence (`/h`)

> **ARCHIVED — EXECUTED. DO NOT RE-RUN.**

> **STATUS: EXECUTED / LIVE (verificado 2026-07-17).** Construido: `hall-status.ts` (`computeHallStatus` pura, 3 estados show/attention/calm + `hallSentence` i18n) + `hall-status.test.ts`, consumido en `/h/+page.svelte`. Pendiente solo el 4º estado IA `proposal` (futuro intencional, nunca se emite aún).
>
> Handoff prompt for an external coding agent. Self-contained: context + task + constraints.
> Origin: design+data review session 1 (2026-07-17). Decisions: `_decisions.md` ADR-068/069,
> spec: `build/screen-data-spec.md § /h — the hall`.

## Context

- Repo: SvelteKit 2 + **Svelte 5 (runes)** + Cloudflare Workers + Supabase. App in `apps/web`.
- `/h` ("the hall") is the only home (ADR-068): a quiet greeting page whose button
  "posa'm al dia" goes STRAIGHT to `/h/desk`. A two-stage reveal was built and deleted
  (store `hall.svelte.ts` removed) — do **not** reintroduce any reveal/collapse mechanic.
- North star (ADR-069): the app carries a proactive, consent-first AI layer; this sentence
  is its first voice surface. It must always be TRUE, derived from data — never decorative.

## Task

In `apps/web/src/routes/h/+page.svelte`, add a **status sentence** rendered statically
under the greeting/date, above the "posa'm al dia" button.

1. **Data** (TanStack Query; reuse existing caches — check `$lib` for query-options helpers):
   - Conversations: `GET /api/conversations?status=any&limit=100`, shared key
     `['conversations','today']` (same cache DeskBoard uses — reuse, don't duplicate).
   - Performances: `GET /api/performances?status=any&from={today}&limit=200`, key
     `['today-performances']`.
   - Tasks: ONLY if an `/api/tasks` endpoint already exists (the `task` table landed
     2026-07-17; the API may not exist). If absent, leave a clearly marked extension point.

2. **Compute** — a pure function in `$lib` (unit-tested; take `now: Date` as a parameter,
   never call `Date.now()` inside):
   - Working set: conversations with `next_action_at != null` and status NOT in
     {declined, dormant} — read `DeskBoard.svelte` first and keep its exact semantics.
   - `overdue` = next_action_at < now · `open` = the upcoming rest · `next` = earliest
     upcoming · `showToday` = a non-cancelled performance with performed_at = today.

3. **Sentence states**, priority-ordered (first match wins):
   1. **Show day**: "Avui: {venue.name ?? venue_name ?? city}. Load-in a les {HH:mm}."
      — time from `load_in_at`, else `start_at`, else drop the time part. Viewer timezone.
   2. **Attention** (overdue > 0): "{N} coses vençudes — la més antiga fa {X} dies."
      (singular/plural handled).
   3. **Calm**: "Tot tranquil. {N} coses obertes, cap vençuda — la propera espera fins
      {weekday}." · zero open → "Tot tranquil. Res a la vista."
   - Leave a documented, NOT built, 4th slot: AI proposal teaser (ADR-069).

4. **Truth rule**: while loading or on fetch error, render NOTHING (greeting only).
   Never a placeholder, spinner text, or stale sentence — silence over lies.

5. **Locale**: greeting, date and sentence follow the user's language. Discover the repo's
   existing i18n mechanism (`t()` strings / locale detection) and use it — the greeting is
   currently hardcoded Catalan; fix that in this pass. If `user_profile.locale` is not
   plumbed to the client yet, use the existing mechanism and leave a TODO naming
   `user_profile.locale` as the intended source.

## Constraints (project rules — non-negotiable)

- Svelte 5: `$derived` over `$state`+`$effect`. Semantic HTML, no div-with-role.
- CSS through existing tokens (`tokens.css`); selector-level defaults with `:where()`;
  modifiers redeclare CSS variables, not properties. Match the existing hall style
  (large serif greeting, mono small-caps date, italic serif sentence).
- **Both themes are contracts** (ADR-059) — verify light AND dark.
- No new global stores, no new dependencies, no nav changes (button keeps going to `/h/desk`).
- Do **not** deploy (clean-tree deploy guard, ADR-066) and do **not** commit — leave the
  working tree for human review.

## Definition of done

- Sentence renders in the 3 states; state selection + copy building covered by unit tests
  with fixed dates.
- `svelte-check` 0 errors / 0 warnings; existing tests still green.
- A short written summary of files touched and how to verify manually.
