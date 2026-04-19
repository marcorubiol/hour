# Hour — Phase 0 build workspace

> Project: **Hour** (working name)
> Parent: `03_AGENCY/Hour/`
> Inherits rules from: `.zerø/context.md`, `_methød/`, and `03_AGENCY/context.md`

---

## What this folder is

`_build/` contains all specs, docs, and planning artifacts for Hour. It is the **shared memory** between Cowork and Claude Code sessions. Chat history is ephemeral. This folder is the source of truth.

When starting any new conversation with Claude (any tool), the first instruction should be:

> Read `context.md` + `_build/context.md` + `_build/ARCHITECTURE.md` + `_build/DECISIONS.md` + `_build/COMPETITION.md` before responding.

That loads ~90% of project context in seconds without depending on what was said in any previous chat.

---

## Workflow — which tool for what

| Tool | Use for | Don't use for |
|---|---|---|
| **Windsurf** (primary code editor since 2026-04-19) | All code: schema, migrations, features, tests, debugging, refactors. Updating `_build/*.md` during code sessions. | Strategic thinking, cross-app tasks |
| **Cowork — long chat "Hour — Strategy"** | Strategy, competitive analysis, pricing, planning, architectural thinking out loud. Stays open across weeks. Also operates the Supabase MCP for DB migrations. | Code edits inside `apps/` |
| **Cowork — short ad-hoc chats** | One-off tasks: draft an email, analyze a contract, prepare a meeting briefing. Born, done, discarded. | Anything requiring multi-session context |
| **Cowork `.zerø` integration** | Daily briefings, tasks, Ørbit, area-level context. | Hour-specific work |

---

## Rules

1. **Memory lives in files, not chats.** Every decision worth keeping → `DECISIONS.md`. Every competitive fact → `COMPETITION.md`. Every architectural choice → `ARCHITECTURE.md`.
2. **No code in Cowork.** If code needs to change, open Claude Code.
3. **One strategic Cowork chat at a time.** Don't fragment Hour strategy across multiple threads.
4. **Claude proposes file updates; Marco approves.** After each significant conversation, Claude asks: *"¿Escribo esto en DECISIONS.md antes de seguir?"*
5. **Open any new chat with the read-first instruction** (above). Never assume prior chat context persists.

---

## Files in this folder

| File | Purpose | Status |
|---|---|---|
| `context.md` | This workflow guide (CLAUDE.md is a stub) | v1.2 — 2026-04-19 |
| `ARCHITECTURE.md` | Technical stack, multi-tenancy, security, environments | v1.1 — 2026-04-19 (polymorphic) |
| `DECISIONS.md` | Chronological log of decisions with rationale | Active — append-only |
| `COMPETITION.md` | Ares, Bresca, other competitors | v1 — 2026-04-18 |
| `schema.sql` | Full Postgres schema — 12 tables, polymorphic core | v2 — 2026-04-19 (rewritten from scratch) |
| `rls-policies.sql` | RLS policies + helpers + audit triggers + access-token hook | v2 — 2026-04-19 (rewritten from scratch) |
| `seed.sql` | Pre-seed + post-signup claim script for marco-rubiol/mamemi | v1 — 2026-04-19 |
| `bootstrap.md` | Step-by-step setup guide (Supabase + CF + DNS) | v1 — 2026-04-19 (needs polymorphic refresh) |
| `import-plan.md` | Mapping 156 Difusión programmers into person + engagement | Implemented via `import/*.py` |
| `import/` | 3-stage pipeline: `01_normalize.py` → `02_enrich_from_pdf.py` → `03_load_to_hour.py` | Ready; loader supports `--skip-engagements` pre-signup |
| `adr/` | Extended ADRs for complex decisions (if needed) | Empty |

---

## Next session — agenda

Ordered checklist to finish Phase 0 bootstrap:

1. Marco signs up through the Hour app with `marcorubiol@gmail.com` (creates the `auth.users` row + triggers `handle_new_user`).
2. Apply the CLAIM block in `_build/seed.sql` (Supabase SQL editor or MCP) — attaches Marco as owner of the pre-seeded `marco-rubiol` workspace and deletes the trigger-created duplicate.
3. Enable `public.custom_access_token_hook` in Supabase dashboard → Authentication → Hooks (the function already exists; only the toggle is manual).
4. `python3 _build/import/03_load_to_hour.py` (no flags) → loads 156 persons, taggings, and `status='proposed'` engagements on the MaMeMi project with `custom_fields.season = '2026-27'`.
5. Verify `GET /api/engagements?project_slug=mamemi&season=2026-27` with a real JWT.
6. Wire `hour.zerosense.studio` custom domain on the CF Worker (Workers & Pages → Settings → Domains & Routes).

All work happens in Windsurf for code changes and Cowork for strategy; `_build/` is the source of truth.
