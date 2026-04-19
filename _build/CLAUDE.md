# Hour — Phase 0 build workspace

> Project: **Hour** (working name)
> Parent: `03_AGENCY/Hour/`
> Inherits rules from: `.zerø/CLAUDE.md`, `_methød/`, and `03_AGENCY/CLAUDE.md`

---

## What this folder is

`_build/` contains all specs, docs, and planning artifacts for Hour. It is the **shared memory** between Cowork and Claude Code sessions. Chat history is ephemeral. This folder is the source of truth.

When starting any new conversation with Claude (any tool), the first instruction should be:

> Read `CLAUDE.md` + `_build/CLAUDE.md` + `_build/ARCHITECTURE.md` + `_build/DECISIONS.md` + `_build/COMPETITION.md` before responding.

That loads ~90% of project context in seconds without depending on what was said in any previous chat.

---

## Workflow — which tool for what

| Tool | Use for | Don't use for |
|---|---|---|
| **Claude Code** (CLI preferred, Desktop equivalent) | All code: schema, migrations, features, tests, debugging, refactors. Updating `_build/*.md` during code sessions. | Strategic thinking, cross-app tasks |
| **Cowork — long chat "Hour — Strategy"** | Strategy, competitive analysis, pricing, planning, architectural thinking out loud. Stays open across weeks. | Code sessions |
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
| `CLAUDE.md` | This workflow guide | v1.1 — 2026-04-18 |
| `ARCHITECTURE.md` | Technical stack, multi-tenancy, security, environments | v1 — 2026-04-18 |
| `DECISIONS.md` | Chronological log of decisions with rationale | Active — append-only |
| `COMPETITION.md` | Ares, Bresca, other competitors | v1 — 2026-04-18 |
| `schema.sql` | Full Postgres schema | To be written — next session |
| `rls-policies.sql` | RLS policies per tenant-scoped table | To be written — next session |
| `bootstrap.md` | Step-by-step setup guide (Supabase + CF + DNS) | To be written |
| `import-plan.md` | Mapping of 168 existing Difusión leads to new schema | To be written |
| `adr/` | Extended ADRs for complex decisions (if needed) | Empty |

---

## Next session — agenda

Pending for tomorrow's session:

1. Quick review of `ARCHITECTURE.md`, `DECISIONS.md`, `COMPETITION.md` — tweak anything that doesn't fit
2. Write `schema.sql`: organization, user/membership, project, contact (3-tier), event, task (with Dispatch/Queue/Ping/Deferred/Shelf/Trace sections), file, note, rider
3. Write `rls-policies.sql` for tenant isolation + role-based refinements
4. Write `bootstrap.md`: create Supabase project, wire Cloudflare DNS + Pages, first deploy
5. Start `import-plan.md` for the 168 Difusión leads (source: `ZS_MaMeMi/Difusión/`)

Kickoff in Claude Code (CLI) when ready. The repo doesn't exist yet — first code session will `git init` and set up the monorepo.
