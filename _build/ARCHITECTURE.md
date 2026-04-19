# Hour — Architecture (Phase 0)

> Working name: **Hour**
> Subdomain: `hour.zerosense.studio`
> Status: Phase 0 — internal tool for MaMeMi, multi-tenant schema from day one so Phase 1 (SaaS) is config, not rewrite.
> Owner: Marco Rubiol

---

## 1. Purpose

**Phase 0 (6 months).** Ship an internal tool Marco and Anouk use every day to run MaMeMi: Difusión (booking CRM), gigs & tours, crew & tech riders, contacts, tasks. Single organization (`mamemi`), ≤5 users.

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
Every tenant-scoped row carries `organization_id UUID NOT NULL`. RLS policies enforce isolation at the database level — **never** trust application code for tenant isolation.

### Entities scope
- **Tenant-scoped**: organization, membership, project, contact (private), event, task, file, note, rider, crew_assignment. All have `organization_id`.
- **Global**: user (mirrors `auth.users`), public_entity (shared registry — venues, festivals, promoters publicly known), tag_catalog.
- **Cross-tenant by invitation**: collaboration_invite (user A invites user B from org Y to project in org X).

### RLS pattern (standard)
```sql
-- Template policy for any tenant-scoped table
CREATE POLICY tenant_isolation ON <table>
  USING (organization_id = (auth.jwt() ->> 'current_org_id')::uuid)
  WITH CHECK (organization_id = (auth.jwt() ->> 'current_org_id')::uuid);
```

`current_org_id` is set in the JWT when the user picks an org from the switcher. Changing org → re-issue JWT via Supabase session refresh.

Role-based refinements (admin vs member vs viewer) are extra policies that check `memberships.role`.

---

## 5. Identifiers

- **Primary keys**: UUID v7 (time-ordered → good B-tree locality, safe to expose, no hot spots). Generated via `gen_random_uuid()` wrapped for v7 format, or `pg_uuidv7` extension when GA.
- **User-facing slugs**: `organization.slug`, `project.slug` (auto-generated, editable, unique within parent scope).
- **No sequential integer IDs on tenant data** — information leak + tenant-enumeration vector.

---

## 6. Phase 0 entity map (summary)

Full schema in `schema.sql`. High-level:

- `organization` — tenant root
- `user` — synced from `auth.users` via trigger
- `membership` — (user, organization, role)
- `persona` — view derived from (membership.role + organization.type). No table.
- `project` — belongs to org; in MaMeMi terms ≈ a show / tour / season
- `contact` — 3-tier strategy:
  1. private (org-level, not shared)
  2. project-tagged (org-level, linked to projects)
  3. public_entity link (reference to shared registry — opt-in, Phase 1 feature)
- `event` — gig, rehearsal, meeting, travel. Mirrors Google Calendar (sync both ways later)
- `task` — with `section` enum (dispatch | queue | ping | deferred | shelf | trace)
- `file` — metadata row; actual bytes in R2. Stores R2 key, size, mime, uploaded_by
- `note` — free-form markdown per entity (project, contact, event)
- `rider` — tech rider document (text + attached files)

### Contacts — Difusión migration
The 168 existing leads from MaMeMi's current markdown CRM import as `contact` rows in the MaMeMi org, tier "project-tagged" (linked to the MaMeMi project). Migration plan in `import-plan.md`.

---

## 7. Tasks — mirror of .Zerø taxonomy

Tasks in Hour use the same sections Marco already uses in `.Zerø`:

```
dispatch → queue → ping → deferred → shelf → trace
```

Plus date markers (`@on`, `@from`, `@due`) and routines (area-level only, Phase 1).

**Reasoning**: Marco's brain is already wired to this vocabulary. Forcing "todo / doing / done" would be friction.

Tasks live per project AND per organization (org-level catch-all, not every task belongs to a named project).

---

## 8. Auth & sessions

- **Auth provider**: Supabase Auth
- **Phase 0 flow**: magic link only. No passwords, no OAuth yet.
- **Phase 1 additions**: Google OAuth (for calendar sync), Apple Sign-in (iOS app future).
- **Session**: JWT, 1h expiry, refresh token 7d. Stored in httpOnly cookie.
- **Org switching**: user picks active org → Supabase client re-issues session with `current_org_id` claim → RLS picks it up automatically.

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
| Tenant key | `organization_id` in JWT claim | Works with Supabase RLS natively, no app-layer tenant resolution |
| PK type | UUID v7 | Time-ordered, index-friendly, safe to expose, no enumeration risk |
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
├── CLAUDE.md              # project rules (inherits .Zerø)
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

## 17. Next files in `_build/`

- `schema.sql` — full Postgres schema with constraints, indexes, triggers
- `rls-policies.sql` — RLS policies for every tenant-scoped table
- `bootstrap.md` — step-by-step: create Supabase project, create Cloudflare Pages project, configure DNS, first deploy, first user
- `import-plan.md` — 168 leads markdown → `contact` rows mapping
- `adr/` — Architecture Decision Records for anything non-obvious we decide later

---

## 18. Out of scope for this doc

- Visual design (lives in `_METHØD/design.md`)
- CSS methodology (lives in `_METHØD/css.md`)
- MaMeMi-specific content (lives in `ZS_MaMeMi/CLAUDE.md`)
- Phase 1 SaaS pricing / packaging (decided at month 6 checkpoint)
