# Hour — Build prompt: Conversations lens v1.5 (last contact + grouping)

> Handoff prompt for an external coding agent. Deliberately SMALL: everything depending on
> the organization entity and the conversation log (gaps #1/#2) waits for review session 2
> — do not anticipate those schemas.
> Origin: S1 2026-07-17, ADR-073. Spec: `build/screen-data-spec.md § /h/conversations`.
> Amended 2026-07-17 (ADR-075, supersedes ADR-073's naming): the lens is **Conversations**
> and the entity is `conversation` (was `engagement`). Filename kept — it is cited from
> `_tasks.md` / `_decisions.md`. "Contact" below is the surviving book concept: a contact
> is whoever you deal with, person OR organization.

## Context

Read first: `apps/web/src/routes/h/conversations/+page.svelte` + `ConversationTable.svelte`
(filters, pagination, optimistic status PATCH, next-action dialog). Keep their semantics.
`conversation.first_contacted_at` / `last_contacted_at` exist in the schema since v2 —
nothing reads or writes them.

## Task

1. **"Last contact" column** in ConversationTable: `last_contacted_at` as a quiet relative
   date ("3 weeks ago" / "—"), absolute date on hover/title. **Calm styling — no urgency
   tones**: 9–18-month cycles are normal in this domain (research: a two-month silence is
   not "cold"); this column informs, it never nags.
2. **Write path** (server, in the existing `/api/conversations` handlers):
   - PATCH that changes `status` also stamps `last_contacted_at = now()` and sets
     `first_contacted_at` if null (a status change reflects a real interaction).
   - New explicit gesture in the row menu: "Contacted today" → PATCH
     `{last_contacted_at: now}` (+ first if null). No other fields touched.
3. **Grouping toggle** — "By conversation | By contact" (client-side, over the fetched
   page): by-contact = one row per person (name, org, location, last contact = max across
   their conversations) with those conversations as project chips (status-toned, click →
   filters/expands). Persist choice in localStorage. Pagination note: grouping applies to
   the loaded page — state that honestly in the UI if a person could span pages (fine at
   LIMIT 50 for Phase 0).
4. **Empty state**: when the lens has zero contacts, point at the import path
   (`build/import/` pipeline exists) — copy only, no import UI in this build.

Explicitly OUT of scope (S2 dependencies): organizations as rows, conversation log /
timeline, provenance ("met at fair X"), inbound/outbound, tags (parked), season filter.

## Constraints

Svelte 5 runes (`$derived` first) · semantic HTML · existing tokens, both themes (ADR-059)
· no new stores/deps · unit-test the grouping function (pure) · no commits, no deploys ·
`svelte-check` 0/0 · short summary + manual verification steps.
