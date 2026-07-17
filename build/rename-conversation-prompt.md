# Hour — Build prompt: full rename `engagement` → `conversation` (ADR-075)

> Handoff prompt for a coding agent. **Runs BEFORE the pending UI builds**
> (`desk-prompt.md`, `contacts-prompt.md`, `money-prompt.md`) so they don't build on dead
> vocabulary. Origin: ADR-075 in `_decisions.md` (reopens ADR-065 naming with cause).
> Precedent to read first: the show→performance rename (ADR-036) and its migration.

## The decision (summary — full rationale in ADR-075)

- Lens: **Contacts → Conversations** (route `/h/contacts` → `/h/conversations`, 308
  redirect, ADR-067 pattern). The word "contact" survives ONLY as the book concept:
  the lens's "by contact" grouping toggle + person-file language.
- Entity: **`engagement` → `conversation`** everywhere — DB, API, client, tests.
- `person` is untouched. Historical ADRs and OLD migration files are untouched
  (history is history).

## Scope, in order

1. **DB migration** (one new file, house style; do NOT apply — the human applies via
   Supabase MCP; write the apply note):
   - `ALTER TABLE engagement RENAME TO conversation;`
   - Rename FK columns: `performance.engagement_id` → `conversation_id`;
     `task.engagement_id` → `conversation_id`. Sweep for any other `engagement_id`
     column first (grep the live schema/types, not just schema.sql — it is stale by
     design).
   - `ALTER TYPE engagement_status RENAME TO conversation_status;`
   - Rename indexes and constraints (`engagement_*` → `conversation_*`) for hygiene.
   - Recreate RPCs (`create_engagement`/`delete_engagement` → `create_conversation`/
     `delete_conversation`), DROP the old ones; same bodies, claim-bound pattern intact.
   - Recreate/rename RLS policies referencing the table; verify coverage identical
     post-rename (the RLS test suite is the proof).
   - Update COMMENTs. Old migration files: DO NOT touch.
2. **API**: `/api/engagements` → `/api/conversations` (all methods, same contracts).
   Clean cut, no legacy API route — the client updates in the same deploy (single-user
   Phase 0; note the atomic-deploy requirement in your summary).
3. **Client**:
   - Route folder + 308 redirect stub from `/h/contacts` (mirror how ADR-067 did the
     lens redirects).
   - Lens label through the i18n mechanism: EN "Conversations" · ES "Conversaciones" ·
     CA "Converses" · FR "Conversations" — in the VIEW AS control, ⌘K, and anywhere the
     lens is named.
   - `EngagementTable.svelte` → `ConversationTable.svelte`; all `engagement` symbols,
     types, props, query keys (`['engagements',…]` → `['conversations',…]`) — every
     consumer: the lens page, DeskBoard, HomeView/portada, line ContactsModule (rename
     to ConversationsModule + its module label/catalog key — check `MODULE_LABELS` /
     `MODULES_BY_KIND`; decide whether the stored `line.modules` jsonb keys need a data
     migration or a read-time alias — prefer a tiny data migration in the same SQL file,
     it keeps the system alias-free), stats queries, task context labels.
   - Regenerate `db-types` (or hand the command + hand-patch so svelte-check passes).
   - The "by contact" toggle keeps the word contact. Desk verbs unchanged.
4. **Tests**: rename across unit / RLS / e2e suites; keep coverage identical. RLS suite
   must run green against the renamed schema (after the human applies the migration —
   coordinate: hand the apply-then-test order in your summary).
5. **Docs (mechanical only)**: `build/structure-model.md` canonical-vocabulary section
   (engagement → conversation, with a dated one-line note referencing ADR-075) and
   `build/screens-inventory.md` route/name mentions. Do NOT rewrite `_decisions.md`,
   `_notes/`, or old migrations.
6. **Final sweep**: `grep -ri engagement` over the repo must return ONLY: old
   migrations, `_decisions.md`/`_notes/` history, and this prompt. Anything else is a
   miss — fix it. List the sweep result in your summary.

## Constraints

No new dependencies · no commits · no deploys · migration NOT applied by you ·
`svelte-check` 0/0 · all suites green (post-apply for RLS/e2e) · summary: files touched,
apply order (migration via MCP → atomic deploy of worker+client when Marco decides),
sweep result, manual verification steps (open `/h/contacts` → lands on
`/h/conversations`; create/edit a conversation end-to-end; Desk rows intact).
