# Hour — Build workspace

> Inherits: `.zerø/_system-context.md` · Method: `_methød/`
> Parent: `Hour/_context.md` · Scope: build artifacts (specs, schema, ADRs, planning)

---

## Current onboarding docs for any AI/person

Read in this order:
1. Root [`_context.md`](../_context.md) — project context, phase definition, key decisions
2. [`roadmap.md`](roadmap.md) — living implementation plan
3. [`architecture.md`](architecture.md) — technical stack, security, environments
4. Root [`_decisions.md`](../_decisions.md) — ADR log
5. [`runbooks/rollback.md`](runbooks/rollback.md) — if doing ops

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
| `_context.md` | This workflow guide | v1.4 — 2026-05-02 |
| `architecture.md` | Technical stack, multi-tenancy, security, environments | v1.3 — 2026-05-02 (Phase 0.9 added) |
| `competition.md` | 20 competitors analyzed with pricing, traction, gap analysis | v2 — 2026-04-20 |
| `roadmap.md` | Living implementation plan — phases 0.0 → 1, ADRs, sprints | v1.1 — 2026-05-02 (Phase 0.9 gate) |
| `director-prompt.md` | Prompt for strategic conversations with AI director | v2 — 2026-05-02 (stack updated) |
| `setup.md` | Current setup guide (SvelteKit + Workers + Supabase) | v1 — 2026-05-02 |

All research files live in `../research/` (see `research/INDEX.md` for full listing):
- `10-ai-integration-patterns.md` — AI patterns from 14 tools
- `11-comms-multichannel.md` — WhatsApp/Telegram/email architecture & costs
- `12-ux-patterns-competitors.md` — UX patterns from 7 competitors
- `13-market-pricing.md` — Market analysis, pricing (19/49/99€), revenue timeline
- `14-ux-proposals.md` — 6 app structure proposals

| `schema.sql` | Base reset v2 schema — partial source of truth | v3 — 2026-04-19 (see migrations for current) |
| `rls-policies.sql` | RLS helpers + policies + audit triggers — partial source | v3 — 2026-04-19 (see migrations for current) |
| `seed.sql` | Pre-seed + post-signup claim script for marco-rubiol/mamemi | v1 — 2026-04-19 |
| `migrations/2026-05-01_reset_v2_roadsheet.sql` | Current schema delta — roadsheet additions | v1 — 2026-05-01 (canonical for current) |
| `migrations/2026-05-01_post_roadsheet_cleanup.sql` | Post-apply fixes (constraints, grants) | v1 — 2026-05-01 |
| `runbooks/rollback.md` | Emergency rollback procedures | v1 — 2026-05-02 |
| `import/` | 3-stage pipeline: `01_normalize.py` → `02_enrich_from_pdf.py` → `03_load_to_hour.py` | Executed 2026-05-01 (154/154 contacts loaded) |
| `archive/` | Historical prompts and obsolete docs | See `archive/README.md` |

Historical (do not follow):
| `bootstrap.md` | Astro-based setup — OBSOLETE after ADR-026 | Historical — 2026-04-19 |
| `reset-v2-prompt.md` | Task prompt for reset v2 | Moved to `archive/` |

---

## Status — 2026-05-02

**Phase 0.0 foundation closed** — reset v2 + roadsheet schema applied (22 tables). SvelteKit migration complete. 13/13 UI primitives built. Next: Phase 0.1 (Plaza + Desk shell) after hardening items.

### Phase 0.9 gate defined
No external workspace before: httpOnly cookies, rate limiting, RLS regression suite, restore drill, admin/support minimum, structured logging, health checks.

### Estado DB (aplicado vía MCP)
- **22 tablas** + `show_redacted` view, 19 helpers, 53+ policies RLS FORCE
- Marco = owner de workspace `marco-rubiol` · 15 system roles · proyecto `mamemi`
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

## Next session — Phase 0.0 infra (post fundación visual + routing + schema)

Cerrado 2026-05-01:
- 13/13 primitivos en `$lib/components/` (último: Sidebar desktop static / mobile drawer). Showcase en `/playground`.
- Plum trial en `--primary` (provisional, ver `_decisions.md` 2026-05-01).
- ADR-022 re-evaluada con dossier `build/url-architecture-dossier-2026-05-01.md`; addendum cerrado.
- Routing scaffold día 5: `$lib/reserved-slugs.ts`, `$lib/url-state.ts`, `$lib/stores/{lens,selection}.svelte.ts`, layouts `/h/` (auth) y `/h/[workspace]/` (shell), placeholders entity (`room`, `gig`, `engagement`, `person`).
- **Schema `reset_v2_roadsheet`** aplicado (commit `dbaf308`, migración 20260501190000). 22 tablas en producción. Show extensions + slug system + crew_assignment + cast_override + asset_version + collab_snapshot. Pasó por DB review independiente. `build/migrations/2026-05-01_reset_v2_roadsheet.sql` es el snapshot canónico. Ver `_decisions.md` 2026-05-01 (3 entradas: person.slug global, backup vía GH Actions, backup priority lowering).

Pendiente Phase 0.0 (orden sugerido por independencia + ROI):
1. **Backup automatizado vía GitHub Actions** (1-2h) — `supabase db dump` semanal + R2 retención 12 semanas. **NO** Worker cron (CF Workers no corren binarios; ver `_decisions.md` 2026-05-01).
2. **Testing scaffold** Vitest + Playwright (3-4h) — smoke por capa (component, API, e2e login).
3. **Real-time wrapper** Supabase Realtime + presence (4-5h).
4. **PartyServer DO** scaffold + `withYjs` + persistence (5-8h) — `collab_snapshot` table ya en sitio.
5. **PWA + offline** Service Worker + IndexedDB + write-queue (10-14h, el grande).

Phase 0.1 arranca cuando 5 esté cerrado (offline shell). 1/2/3/4 son perpendiculares y se pueden intercalar.

Todo el trabajo en Windsurf/Claude Code bajo `apps/web/src/routes/` y `apps/web/src/lib/`. `build/` se mantiene pero no necesita cambios para la UI.

## Diferido (Phase 0.5+)

- `task` entity + tag vocabulary (`_decisions.md` Deferred D1)
- UI de `permission_grants` / `permission_revokes` por persona (D2)
- `show` / `line` / `invoice` flows (cuando confirmes primera fecha real)
