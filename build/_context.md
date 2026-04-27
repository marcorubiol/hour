# Hour — Build workspace

> Inherits: `.zerø/_system-context.md` · Method: `_methød/`
> Parent: `Hour/_context.md` · Scope: build artifacts (specs, schema, ADRs, planning)

---

## What this folder is

`build/` contains all specs, docs, and planning artifacts for Hour. It is the **shared memory** between Cowork and Claude Code sessions. Chat history is ephemeral. This folder is the source of truth.

When starting any new conversation with Claude (any tool), the first instruction should be:

> Read `_context.md` (Hour root) + `build/_context.md` + `build/architecture.md` + `_decisions.md` (Hour root) + `build/competition.md` before responding.

That loads ~90% of project context in seconds without depending on what was said in any previous chat.

---

## Workflow — which tool for what

| Tool | Use for | Don't use for |
|---|---|---|
| **Windsurf** (primary code editor since 2026-04-19) | All code: schema, migrations, features, tests, debugging, refactors. Updating `build/*.md` during code sessions. | Strategic thinking, cross-app tasks |
| **Cowork — long chat "Hour — Strategy"** | Strategy, competitive analysis, pricing, planning, architectural thinking out loud. Stays open across weeks. Also operates the Supabase MCP for DB migrations. | Code edits inside `apps/` |
| **Cowork — short ad-hoc chats** | One-off tasks: draft an email, analyze a contract, prepare a meeting briefing. Born, done, discarded. | Anything requiring multi-session context |
| **Cowork `.zerø` integration** | Daily briefings, tasks, Ørbit, area-level context. | Hour-specific work |

---

## Rules

1. **Memory lives in files, not chats.** Every decision worth keeping → `_decisions.md` (at Hour root). Every competitive fact → `build/competition.md`. Every architectural choice → `build/architecture.md`.
2. **No code in Cowork.** If code needs to change, open Claude Code.
3. **One strategic Cowork chat at a time.** Don't fragment Hour strategy across multiple threads.
4. **Claude proposes file updates; Marco approves.** After each significant conversation, Claude asks: *"¿Escribo esto en `_decisions.md` antes de seguir?"*
5. **Open any new chat with the read-first instruction** (above). Never assume prior chat context persists.

---

## Files in this folder

> `_decisions.md` lives at the **project root** (`Hour/_decisions.md`), siblings of `Hour/_context.md` — by convention, project decisions sit at root, not nested in subworkspaces.

| File | Purpose | Status |
|---|---|---|
| `_context.md` | This workflow guide (CLAUDE.md is a stub) | v1.3 — 2026-04-19 |
| `architecture.md` | Technical stack, multi-tenancy, security, environments | v1.2 — 2026-04-19 (reset v2) |
| `competition.md` | 20 competitors analyzed with pricing, traction, gap analysis | v2 — 2026-04-20 |
| `roadmap.md` | Living implementation plan — phases 0.0 → 1, ADRs, sprints | v1 — 2026-04-24 |

All research files live in `../research/` (see `research/INDEX.md` for full listing):
- `10-ai-integration-patterns.md` — AI patterns from 14 tools
- `11-comms-multichannel.md` — WhatsApp/Telegram/email architecture & costs
- `12-ux-patterns-competitors.md` — UX patterns from 7 competitors
- `13-market-pricing.md` — Market analysis, pricing (19/49/99€), revenue timeline
- `14-ux-proposals.md` — 6 app structure proposals

| `schema.sql` | Full Postgres schema — 18 tables, reset v2 | v3 — 2026-04-19 (rewritten from scratch) |
| `rls-policies.sql` | RLS helpers + policies + audit triggers + access-token hook + show_redacted view | v3 — 2026-04-19 (rewritten from scratch) |
| `seed.sql` | Pre-seed + post-signup claim script for marco-rubiol/mamemi | v1 — 2026-04-19 (may need `membership → workspace_membership` one-liner rename) |
| `bootstrap.md` | Step-by-step setup guide (Supabase + CF + DNS) | v1.1 — 2026-04-19 (reset v2 refresh) |
| `import-plan.md` | Mapping 156 Difusión programmers into person + engagement | v1.1 — 2026-04-19 (reset v2 updates). Loader code needs adjustment in Windsurf. |
| `import/` | 3-stage pipeline: `01_normalize.py` → `02_enrich_from_pdf.py` → `03_load_to_hour.py` | Ready; loader needs reset-v2 adjustment (drop tag/tagging step, drop `type='show'`, status default `contacted`). Supports `--skip-engagements` pre-signup. |
| `adr/` | Extended ADRs for complex decisions (if needed) | Empty |

---

## Status — 2026-04-20

Bootstrap de Phase 0 **cerrado**. Todos los pasos 1-8 de la lista anterior están aplicados. DB poblada con datos reales, Worker desplegado, endpoint `/api/engagements` alineado con reset v2. El trabajo de ahora en adelante es producto (UI).

### Estado DB (aplicado vía MCP)
- 18 tablas + `show_redacted` view, 19 helpers, 53 policies RLS FORCE
- Marco (`fcdc82df-58df-4917-860c-8e3af03900f3`) = owner de workspace `marco-rubiol` · 15 system roles · proyecto `mamemi`
- **154 persons + 154 engagements** cargados (status=`contacted`, `season=2026-27`), 30 enriquecidos con dossier 2026
- Auth hook `custom_access_token_hook` enabled · email+password con Auto-Confirm

### Estado Worker
- `hour-web.marco-rubiol.workers.dev` desplegado con la versión post-reset v2
- `GET /api/engagements` usa default `status=contacted`, embeds person+project sin `type`
- Custom domain `hour.zerosense.studio` atado y sirviendo vía CF (entre 2026-04-20 y 2026-04-25)

### Smoke tests pasados vía MCP
- Hook inyecta `current_workspace_id` ✓
- Marco como `authenticated` (claims simulados) ve 154 engagements ✓
- User sin membership ve 0 filas ✓
- `has_permission` owner bypass ✓
- Endpoint en prod devuelve 401 sin JWT ✓

### Source tree
Clean. Commits clave de hoy: schema.sql (DROP SCHEMA + 18 tablas), rls-policies.sql (has_permission + show_redacted view), fixes de audit durante cascade DELETE, restauración de grants Supabase tras CASCADE, db-types.ts regenerado, `/api/engagements` actualizado, loader Python adaptado.

## Next session — primera pantalla

Lista de engagements de Difusión 2026-27 en `apps/web/`. Requisitos completos en `Hour/_context.md` → "Next". Resumen:
- Login con Supabase Auth (email+password) → JWT
- `GET /api/engagements?project_slug=mamemi&season=2026-27&limit=50` con Bearer JWT
- Tabla con person, organization, city/country, status, next_action_at
- Status editable inline (enum anti-CRM de 7 valores)
- Filtros: status, procedencia, tipologia (ambos en `person.custom_fields.sources.mostra_igualada_2026.*`)

Todo el trabajo en Windsurf bajo `apps/web/src/pages/` y `apps/web/src/components/`. `build/` se mantiene pero no necesita cambios para la UI.

## Diferido (Phase 0.5+)

- `task` entity + tag vocabulary (`_decisions.md` Deferred D1)
- UI de `permission_grants` / `permission_revokes` por persona (D2)
- `show` / `line` / `invoice` flows (cuando confirmes primera fecha real)
