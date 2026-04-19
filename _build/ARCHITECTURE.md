# Hour — Architecture (Phase 0)

> Working name: **Hour**
> Subdomain: `hour.zerosense.studio`
> Status: Phase 0 — internal tool for MaMeMi, multi-tenant schema from day one so Phase 1 (SaaS) is config, not rewrite.
> Owner: Marco Rubiol
> Data model: polymorphic core (workspace + project + engagement), anti-CRM vocabulary. Rewritten 2026-04-19 — see DECISIONS.md `Polymorphic core`.

---

## 1. Purpose

**Phase 0 (6 months).** Ship an internal tool Marco (and eventually Anouk) uses every day to run MaMeMi: Difusión (booking outreach), gigs & tours, crew & tech riders, contacts. Single workspace (`marco-rubiol`, `kind=personal`) with one project (`mamemi`, `type=show`), ≤5 users.

**Phase 1 (decision point at month 6).** If daily usage is real and 3+ external people have asked for the beta, flip the multi-tenant switches and onboard the first 10 orgs. If not, Hour stays private and we lost nothing — we needed this tool anyway.

This document describes Phase 0. Phase 1 scaling decisions are in `../_build/scale-plan.md` (to be written at month 6).

---

## 2. Stack

| Layer | Choice | Reason |
|------|--------|--------|
| Frontend | **Astro** with islands (Svelte or React for interactive parts) | Static-first, fast, low JS by default, good for content + app hybrid |
| Backend | **Supabase Cloud** (Postgres 15 + Auth + RLS + Storage metadata + Realtime) | Single operator, RLS handles multi-tenancy natively |
| Media storage | **Cloudflare R2** with signed URLs | Zero egress — critical for media-heavy app (Qlab files, PDFs, riders). Supabase Storage would be ruinous at scale. |
| Queue | **pgmq** on Supabase Postgres | One less moving part. Sufficient to 10k jobs/day. |
| DNS / Edge | **Cloudflare** (Pages, DNS, Access) | Marco's stack. Free tier covers Phase 0. |
| Email | **Resend** (transactional) | Supabase built-in SMTP is dev-only per their docs. |
| Observability | **Sentry** (errors) + **Axiom** or Cloudflare Logs (HTTP) + Supabase dashboard (DB) | Cheap, good-enough |
| CI/CD | **GitHub Actions** → Cloudflare Pages | Standard |
| DB migrations | **Supabase CLI**, versioned in git (`supabase/migrations/*.sql`) | Reproducible environments |

### Assumptions flagged

- `zerosense.studio` is registered and its nameservers point to Cloudflare. If the domain lives elsewhere (Namecheap, GoDaddy), either move nameservers to CF or configure a CNAME. **Marco to confirm.**
- Supabase Cloud (not self-hosted). Revisit at Phase 2 only if egress/RLS costs force it.

---

## 3. Environments

| Env | Subdomain | Supabase project | Purpose |
|-----|-----------|------------------|---------|
| Production | `hour.zerosense.studio` | `hour-prod` | Live |
| Staging | `hour-staging.zerosense.studio` | `hour-staging` | Pre-merge validation, migration rehearsal |
| Dev (optional) | `hour-dev.zerosense.studio` | local Supabase via CLI | Local development |

Each env has its own Supabase project, its own Cloudflare Pages build, its own secrets. **No shared DB across envs.**

---

## 4. Multi-tenancy model

### Core rule
Every tenant-scoped row carries `workspace_id UUID NOT NULL`. RLS policies enforce isolation at the database level — **never** trust application code for tenant isolation. The tenant is called a **workspace** (not "organization") because it holds both personal setups (`kind='personal'`) and team setups (`kind='team'`) — this matches the multi-hat freelance reality.

### Entities scope
- **Workspace-scoped**: workspace, membership, project, project_membership, date, engagement, person_note, tag, tagging, audit_log. All carry `workspace_id` directly or via their parent.
- **Global (not workspace-scoped)**: `person` is a shared registry. Anyone in any workspace may reference the same person (e.g. a programmer seen by two booking managers). Privacy comes from `person_note.visibility` (`workspace` vs `private`) and from the workspace-scoped `engagement` row, not from the person row itself.
- **User-scoped**: `user_profile` (mirrors `auth.users`).
- **Cross-workspace** relationships are explicit: a user gains access to another workspace via a `membership` row; project-level scoping lives in `project_membership`.

### Polymorphic project
`project.type` discriminates the kind of work: `show | release | creation_cycle | festival_edition`. Columns are generic (name, description, dates, custom_fields JSONB) so adding a new type is schema-free. Queries filter by `type` when needed.

`engagement` and `date` are the universal children: every engagement points at a project regardless of type; every date (performance, rehearsal, residency…) also points at a project. "Difusión 2026-27" is therefore not a row anywhere — it's a filtered view over `mamemi`'s engagements and pending dates via `season` (a text column on `date`, and `custom_fields->>season` on `engagement`).

### RLS pattern (standard)
```sql
-- Template policy for any workspace-scoped table (workspace_id is the tenant key)
CREATE POLICY <name>_ws_read ON <table>
  FOR SELECT TO authenticated
  USING (workspace_id = public.current_workspace_id());

CREATE POLICY <name>_ws_write ON <table>
  FOR ALL TO authenticated
  USING (workspace_id = public.current_workspace_id()
         AND public.current_workspace_role() IN ('owner','admin','member'))
  WITH CHECK (workspace_id = public.current_workspace_id());
```

`public.current_workspace_id()` reads the `current_workspace_id` claim from `auth.jwt()`. The claim is injected by `public.custom_access_token_hook(event jsonb)`, which Supabase invokes at sign-in and on each session refresh — it picks the user's first accepted `membership` row. Workspace switching = re-issue the session (Supabase `auth.refreshSession()` with a new active workspace stored in user metadata, then replay the hook).

Role-based refinements (owner / admin / member / viewer / guest) live in extra policies keyed off `public.current_workspace_role()`. Project-level scoping goes through `project_membership.scope TEXT[]` (`dispatch`, `dates`, `riders`, …) with a `has_project_access(project_id, scope)` helper. `person_note.visibility='private'` is readable only by `author_id = auth.uid()`.

---

## 5. Identifiers

- **Primary keys**: UUID v7 (time-ordered → good B-tree locality, safe to expose, no hot spots). Generated via `public.uuid_generate_v7()` (PL/pgSQL over `pgcrypto::gen_random_bytes`, see `schema.sql` §0). Swap for the `pg_uuidv7` extension or PG18's native `uuidv7()` when available — values are shape-identical.
- **User-facing slugs**: `workspace.slug` (unique globally), `project.slug` (unique within workspace). Auto-generated from name, editable.
- **No sequential integer IDs on tenant data** — information leak + tenant-enumeration vector.

---

## 6. Phase 0 entity map (summary)

Full schema in `schema.sql`. Twelve tables, grouped:

**Tenant + identity**
- `workspace` — tenant root. Columns: `slug`, `name`, `kind ∈ {personal,team}`, `country`, `timezone`, `settings jsonb`, `custom_fields jsonb`. Pre-seeded: `marco-rubiol` (Marco's personal workspace).
- `user_profile` — mirrors `auth.users` via `handle_new_user` trigger; owner name, locale, avatar.
- `membership` — (user_id, workspace_id, role ∈ {owner,admin,member,viewer,guest}, accepted_at).

**Work (polymorphic)**
- `project` — belongs to workspace; `type ∈ {show,release,creation_cycle,festival_edition}`, `status ∈ {draft,active,archived}`, generic `description`, `starts_on`, `ends_on`, `poster_url`, `custom_fields jsonb`. MaMeMi is `type=show`.
- `project_membership` — per-user access below workspace level, with a `scope text[]` array (e.g. `{dispatch,dates,riders}`) and `role ∈ {lead,collaborator,viewer}`. Phase 0 unused; ready for Phase 1 collaborator invitations.
- `date` — universal child of `project`: performance, rehearsal, residency, travel day, press, other. Fields: `starts_at`, `ends_at`, `kind`, `status`, `city`, `country`, `venue_name`, `season text`, `custom_fields jsonb`. Difusión's "pending dates" are `project=mamemi + status∈{tentative,held} + season='2026-27'`.

**People (anti-CRM, 3-layer)**
- `person` — **global** (no `workspace_id`). Columns: `full_name` (required), `first_name`, `last_name`, `email citext`, `phone`, `organization_name`, `city`, `country`, `title`, `website`, `languages text[]`, `custom_fields jsonb`. Anyone, any workspace, same row.
- `engagement` — workspace-scoped (person_id, project_id, workspace_id). Captures the relationship in one place: `status ∈ {idea, proposed, discussing, held, confirmed, cancelled, declined, performed, dormant}`, `role` (free text), `date_id` (optional link to a specific date), `first_contacted_at`, `last_contacted_at`, `next_action_at`, `next_action_note`, `custom_fields jsonb` (holds `season`, anything else). Replaces the old `contact_project`; vocabulary is explicitly anti-CRM — no "prospect", "lead", "pipeline", "conversion", "deal", "campaign".
- `person_note` — free-form notes on a person, workspace-scoped. `visibility ∈ {workspace,private}`; `private` is readable only by `author_id`.

**Tagging + audit**
- `tag` — workspace-scoped label catalogue (name, color).
- `tagging` — polymorphic edge. `(entity_type ∈ {person,project,date,engagement}, entity_id, tag_id, workspace_id)`.
- `audit_log` — append-only. Triggers on `person`, `engagement`, `project`, `date`, `person_note`, `workspace`, `membership`, `project_membership`.

### What moved where (post-reset map)
| Old entity                  | New home                                                         |
|----------------------------|------------------------------------------------------------------|
| `organization`              | `workspace`                                                      |
| `contact`                   | `person` (global) + `engagement` (workspace-scoped relationship) |
| `event`                     | `date` (any project type; `kind` enum covers the variants)       |
| `contact_project`           | `engagement` (+ anti-CRM status enum)                            |
| `project` (generic)         | `project` with `type` discriminator                              |
| "difusion-2026-27" (proj.) | A filtered view over `mamemi` engagements/dates, keyed by season |

### Contacts — Difusión migration
The 156 programmers/festivals from MaMeMi's current markdown CRM + dossier PDF import as `person` rows (global) linked to the `mamemi` project via `engagement` rows with `status='proposed'` and `custom_fields.season='2026-27'`. Source tags preserved via `tagging` (`src:mostra-igualada-2026`, `procedencia:*`, `tipologia:*`). Migration plan + pipeline in `import/` (3-stage normalize→enrich→load). DIY bands are deferred out of Phase 0.

---

## 7. Tasks — deferred

The polymorphic reset dropped the old `task` table. Phase 0 runs without it: the booking-outreach workflow lives in `engagement.next_action_at` + `next_action_note`, and ad-hoc todos live in Marco's `.zerø` TASKS.md.

When tasks come back (early Phase 1, first external user), the taxonomy stays the same — `dispatch → queue → ping → deferred → shelf → trace` — but the table will be polymorphic by `entity_type` (attach to a project, date, engagement, or sit free at workspace level).

---

## 8. Auth & sessions

- **Auth provider**: Supabase Auth.
- **Phase 0 flow**: email+password as primary method, optional TOTP 2FA (user-enrolled). No OAuth yet. Superseded magic-link-only on 2026-04-19 — see ADR `Auth flow: email+password with optional TOTP 2FA` in DECISIONS.md.
- **Phase 1 additions**: Google OAuth (for calendar sync), Apple Sign-in (iOS app future).
- **Session**: JWT, 1h expiry, refresh token 7d. Stored in httpOnly cookie.
- **Access-token hook**: `public.custom_access_token_hook(event jsonb)` runs at sign-in and on refresh. It looks up the user's first accepted `membership` row, resolves the `workspace_id`, and injects `current_workspace_id` into the JWT claims. `supabase_auth_admin` has `SELECT` on `membership` so the hook can read it. **Manual step**: enable the hook in Supabase dashboard → Authentication → Hooks. Without it, `current_workspace_id()` returns NULL and every RLS policy denies the request.
- **Workspace switching**: user picks active workspace → app calls `supabase.auth.refreshSession()` after writing the choice into `user_profile` / user metadata → the hook replays and re-issues a JWT with the new `current_workspace_id`. No app-level tenant resolution.

---

## 9. File handling (R2)

- Client requests a **signed upload URL** from a Supabase Edge Function.
- Edge Function checks permission, generates R2 presigned PUT URL (15min TTL), records a `file` row with status `pending`.
- Client uploads directly to R2.
- On success, client calls Edge Function to mark file `ready` + record size/mime.
- Downloads: Edge Function checks permission, generates R2 presigned GET URL (5min TTL), redirects.

**Never proxy bytes through the app server.** Too expensive, too slow.

---

## 10. What Phase 0 is **NOT**

Explicit non-goals — decided now to protect scope:

- ❌ Ticketing / box office
- ❌ Invoicing / accounting (Hour integrates with Holded/Quaderno later, does not replace)
- ❌ Public-facing artist pages (Phase 1+)
- ❌ Mobile apps (Phase 2)
- ❌ AI features (agents, auto-reply, transcription) — add only when core is boring-stable
- ❌ Custom reporting / BI dashboards — Metabase on the read replica later
- ❌ Real-time collaborative editing (Notion-style) — out of scope, use Notion alongside if needed

---

## 11. Critical decisions already made (with rationale)

| Decision | Choice | Why |
|----------|--------|-----|
| Tenant key | `workspace_id` + `current_workspace_id` JWT claim (injected by `custom_access_token_hook`) | Works with Supabase RLS natively, no app-layer tenant resolution. Renamed from `organization_id` to reflect `kind=personal|team`. |
| Polymorphic core | `workspace + project(type) + engagement` | One schema covers shows, releases, creation cycles, festival editions without per-kind tables. Narrative concerns (like Difusión) become filters, not entities. |
| Anti-CRM vocabulary | `person`, `engagement`, `proposed`, `next_action_at` | Fits the working reality of a freelance/collective booking manager; rejects funnel/lead/conversion/campaign language. |
| Person is global | No `workspace_id` on `person` | Real programmers exist once and are seen by many workspaces; privacy lives in `person_note.visibility` and `engagement`, not the person row. |
| PK type | UUID v7 via PL/pgSQL | Time-ordered, index-friendly, safe to expose, no enumeration risk. `pg_uuidv7` not on Supabase Cloud whitelist. |
| Media storage | R2 (not Supabase Storage) | Zero egress cost — Supabase Storage egress is the silent killer |
| Queue | pgmq | Zero new infra. 10k jobs/day ceiling is fine for Phase 0-1. |
| Frontend | Astro + islands | Static-first is correct when most pages are list/detail views |
| Multi-tenant from day one | Yes | Retrofitting tenancy later is a 6-month rewrite. Cost now: 2 extra lines per migration. |
| i18n from day one | Yes (ES + EN) | Target market is multilingual European productions. Retrofitting i18n = string-by-string audit hell. |
| Migrations in git | Yes, from commit 1 | Non-negotiable for two-env setup |

## 12. Critical decisions deferred to kickoff

Items Marco decides in the kickoff session once specs are reviewed:

- **Frontend framework confirmation**: Astro is my recommendation. Alternatives: SvelteKit (if SPA feel matters more), Next.js (if team grows and React hiring matters). I lean Astro.
- **Islands framework**: Svelte vs React inside the Astro shell. Svelte is lighter, React has bigger ecosystem.
- **Magic link provider**: Resend handles transactional well. If Supabase's default works for Phase 0 dev, skip Resend setup until staging.
- **Repo location**: GitHub private repo under Marco's user or a new `zerosense` org.
- **Staging frequency**: deploy every PR vs deploy on merge. I recommend deploy on merge only (Phase 0 doesn't need per-PR previews).

---

## 13. Scalability — Phase 0 targets

| Metric | Phase 0 target | Phase 1 target | Concern trigger |
|--------|----------------|----------------|-----------------|
| Orgs | 1 | 10–100 | none in P0 |
| Users (total) | ≤5 | 100–1000 | none in P0 |
| Contacts | ≤500 | ≤50k | Index audit at >10k |
| Events | ≤100/yr | ≤10k/yr | Partition at >100k |
| Files (R2) | ≤10 GB | ≤500 GB | R2 cost review at 1TB |
| Monthly cost | €0–20 | €50–100 | — |

Full scalability plan up to 100k users in `../scale-plan.md` (written at Phase 1 kickoff, based on Agent 3 stack validator report).

---

## 14. Security & privacy (Phase 0)

- **RLS on every tenant table. No exceptions.** Default DENY; explicit POLICY opens each operation.
- **No service-role key in client code.** Only in Edge Functions and server builds.
- **GDPR**: data in EU region (Supabase Frankfurt). Deletion flow: user requests → soft delete 30d grace → hard delete job. Phase 0 = Marco + Anouk only, no external DPAs needed yet.
- **Audit log**: `audit_log` table with (actor, action, entity, before, after, ts). Append-only. Read-only for non-admins.
- **Secrets**: Cloudflare Pages env vars (prod), `.env.local` (dev, gitignored).

---

## 15. Repo layout (proposed)

```
hour/
├── apps/
│   └── web/               # Astro app
│       ├── src/
│       ├── astro.config.mjs
│       └── package.json
├── supabase/
│   ├── migrations/        # SQL migrations, versioned
│   ├── functions/         # Edge Functions
│   └── seed.sql           # dev seeds only
├── packages/
│   └── shared/            # types, zod schemas, shared utils
├── _build/                # (this folder — specs, ADRs, import plans)
├── .github/workflows/     # CI
├── context.md             # project rules (inherits .zerø)
├── CLAUDE.md              # stub (@context.md) for Claude Code / Cowork
└── README.md
```

Monorepo via pnpm workspaces. One package per app + shared types.

---

## 16. Open questions to close before first commit

1. **Legal entity for the SaaS future.** Do we ship Phase 0 under Marco personal, or under a new sociedad? Affects where the domain sits and what appears in the footer. (Phase 0: personal is fine; Phase 1: needs sociedad for invoicing EU clients.)
2. **Data residency commitment.** If EU-only → Supabase Frankfurt. Phase 0 fine. Phase 1 if any US client signs up → consider.
3. **Branding on Phase 0.** Minimal or themed? Recommendation: minimal (logo = wordmark, no illustration). Save branding spend for when marketing starts.
4. **Who else besides Marco touches this before Phase 1 checkpoint?** Only Anouk? +1 tester? Affects invite flow priority.

---

## 17. API routes (Astro SSR on the Worker)

Location: `apps/web/src/pages/api/*.ts`. All endpoints forward the caller's
Supabase JWT to PostgREST — **RLS is the access-control boundary; the Worker
is not.**

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/engagements` | GET | `engagement` rows with embedded `person` and `project`, filtered by `project_slug` (default `mamemi`), `status` (default `proposed`), `season` (default `2026-27`). Thin PostgREST wrapper; RLS scopes by `current_workspace_id`. Replaces the earlier `/api/prospects`. |

Shared helpers:
- `src/lib/auth.ts` — JWT extraction from `Authorization` header.
- `src/lib/supabase.ts` — thin PostgREST client over `fetch` (`pgGet`, `pgPostRpc`, `PostgrestError`).
- `src/lib/db-types.ts` — generated types + convenience aliases `Row<T>`, `Insert<T>`, `Update<T>`, `Enum<T>`, `RpcArgs<T>`, `RpcReturn<T>`. Regenerate with `supabase gen types typescript --project-id lqlyorlccnniybezugme` or the Supabase MCP `generate_typescript_types`.

Convention: every route sets `export const prerender = false`, returns
`{ error, detail?, hint? }` on failure, and never logs the JWT or body.

Full details + testing recipe: `apps/web/src/pages/api/README.md`.

Open dependency: the `current_workspace_id` JWT claim needs the
`custom_access_token_hook` enabled in Supabase dashboard → Authentication →
Hooks (function already exists, only the toggle is manual). Until wired, RLS
returns zero rows for authenticated users.

---

## 18. Files in `_build/`

- `schema.sql` — full Postgres schema (12 tables, polymorphic core)
- `rls-policies.sql` — RLS helpers + policies + guard/audit triggers + `custom_access_token_hook`
- `seed.sql` — pre-seed (marco-rubiol workspace + mamemi project) + post-signup CLAIM block
- `bootstrap.md` — step-by-step: create Supabase project, configure Auth, create CF Worker, configure DNS, first deploy, first user
- `import-plan.md` — 156 programmers markdown → `person` + `engagement` rows mapping (+ the 3-stage pipeline in `import/`)
- `adr/` — Architecture Decision Records for anything non-obvious we decide later

---

## 19. Out of scope for this doc

- Visual design (lives in `_methød/design.md`)
- CSS methodology (lives in `_methød/css.md`)
- MaMeMi-specific content (lives in `ZS_MaMeMi/context.md`)
- Phase 1 SaaS pricing / packaging (decided at month 6 checkpoint)
