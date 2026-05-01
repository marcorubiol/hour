# Hour — Architecture (Phase 0)

> Working name: **Hour**
> Subdomain: `hour.zerosense.studio`
> Status: Phase 0 — internal tool for MaMeMi, multi-tenant schema from day one so Phase 1 (SaaS) is config, not rewrite.
> Owner: Marco Rubiol
> Data model: **reset v2** (2026-04-19) — 18 tables, polymorphic core (workspace + project + engagement + show) with `line`/`venue` primitives and a money stack (invoice/invoice_line/payment/expense). Editable RBAC via `workspace_role` catalog + per-project `project_membership.roles/grants/revokes`. Anti-CRM vocabulary. See `_decisions.md` ADR-001..007.
> Last reviewed: **2026-05-01** — synced with ADR-026 (frontend migrated Astro → SvelteKit) and ADR-025 (collab transport refined to `y-partyserver`).

---

## 1. Purpose

**Phase 0 (6 months).** Ship an internal tool Marco (and eventually Anouk) uses every day to run MaMeMi: Difusión (booking outreach), gigs & tours, crew & tech riders, contacts. Single workspace (`marco-rubiol`, `kind=personal`) with one project (`mamemi`, `type=show`), ≤5 users.

**Phase 1 (decision point at month 6).** If daily usage is real and 3+ external people have asked for the beta, flip the multi-tenant switches and onboard the first 10 orgs. If not, Hour stays private and we lost nothing — we needed this tool anyway.

This document describes Phase 0. Phase 1 scaling decisions are in `../build/scale-plan.md` (to be written at month 6).

---

## 2. Stack

| Layer | Choice | Reason |
|------|--------|--------|
| Frontend | **SvelteKit 2 + Svelte 5** (runes, snippets) on `@sveltejs/adapter-cloudflare` 7 | Single-runtime app: client routing, `+server.ts` endpoints, `load()` deps, `hooks.server.ts`. Migrated from Astro 5 + islands on 2026-05-01 (ADR-026). |
| Server-state cache | **TanStack Query** (`@tanstack/svelte-query`) | Stale-while-revalidate, dedupe, invalidation on mutation. Provider in `+layout.svelte`, browser-only. |
| Form/query validation | **Valibot** 1.0 | Schema validation at every `+server.ts` boundary. Smaller bundle than Zod, fits Worker size budget. |
| Bundler | **Vite** 6 | SvelteKit's native build pipeline. |
| Edge runtime | **Cloudflare Worker** `hour-web` (wrangler 4) with **Smart Placement** | Single Worker serves SSR + static assets via `ASSETS` binding. R2 bound as `MEDIA`. Smart Placement co-locates the Worker near Supabase (Frankfurt) to cut Worker→PostgREST round-trips. Hyperdrive doesn't apply — PostgREST is HTTPS, not direct TCP. |
| Backend | **Supabase Cloud** (Postgres 17 + Auth + RLS + Realtime) | Single operator, RLS handles multi-tenancy natively. Project `hour-phase0` in `eu-central-1`. |
| Data access | **Thin PostgREST client** (`$lib/supabase.ts`) over `fetch`, no `@supabase/supabase-js` on the Worker | Keeps Worker bundle small; the JWT forwarded to PostgREST makes the RLS boundary explicit. |
| Media storage | **Cloudflare R2** with signed URLs | Zero egress — critical for media-heavy app (Qlab files, PDFs, riders). Supabase Storage would be ruinous at scale. |
| Realtime collaboration | **`y-partyserver`** on a native Cloudflare Durable Object (declared in `wrangler.jsonc`) | PartyKit's active successor under Cloudflare; runs in the same runtime. Scoped to text-free fields (ADR-025). |
| Realtime structured | **Supabase Realtime** | Last-write-wins for structured fields (status, dates, fees). |
| Queue | **pgmq** on Supabase Postgres | One less moving part. Sufficient to 10k jobs/day. |
| DNS / Edge | **Cloudflare** (Workers, DNS, Access) | Marco's stack. Free tier covers Phase 0. |
| Email | **Resend** (transactional) | Supabase built-in SMTP is dev-only per their docs. |
| Observability | **Sentry SvelteKit** 10.8 (`initCloudflareSentryHandle` server + replay client) tunnelled via `/api/sentry-tunnel` + Supabase dashboard (DB) | Cheap, good-enough; tunnel sidesteps adblockers. |
| CI/CD | **GitHub Actions** → `wrangler deploy` | Standard. CI scaffold pending Phase 0.0 Day 11. |
| DB migrations | **Supabase MCP** + raw SQL files in `build/` (`schema.sql`, `rls-policies.sql`, future `reset_v2_roadsheet.sql`) | Phase 0 reality: applied via MCP, source-of-truth lives in `build/`. Supabase CLI versioning revisited in Phase 1. |

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
- **Workspace-scoped**: workspace, workspace_membership, workspace_role, venue, project, project_membership, line, show, date, engagement, person_note, invoice, invoice_line, payment, expense, audit_log. All carry `workspace_id` directly or via their parent.
- **Global (not workspace-scoped)**: `person` is a shared registry. Anyone in any workspace may reference the same person (e.g. a programmer seen by two booking managers). Privacy comes from `person_note.visibility` (`workspace` vs `private`) and from the workspace-scoped `engagement` row, not from the person row itself.
- **User-scoped**: `user_profile` (mirrors `auth.users`).
- **Cross-workspace** relationships are explicit: a user gains access to another workspace via a `workspace_membership` row; project-level scoping lives in `project_membership` (roles + grants/revokes).

### Polymorphism without a `type` tag
No `project.type` column (ADR-007). Polymorphism is **emergent from subentity presence**: a project with `line` rows is a tour/season; a project with `show` rows is performance-driven; a project with only `date` rows is a creation cycle; combinations are legitimate.

`engagement` and `show` are the two primitives at the next layer — engagement carries the conversation (anti-CRM status), show is the atomic performance (project × performed_at × venue) with its own hold lifecycle. They connect via optional `show.engagement_id`. `date` remains the calendar primitive for non-performance events (rehearsal, residency, travel_day, press, other); `date.show_id` optionally ties a rehearsal or travel day to a specific show. Money flows through `invoice` → `invoice_line` (optionally referencing shows, supporting tour-as-one-invoice) with `payment` rows N:1 against invoice, and `expense` rows grounded in either a show or a line (XOR CHECK).

"Difusión 2026-27" is not a row anywhere — it's a filtered view over `mamemi`'s engagements via `custom_fields->>season='2026-27'`.

### RLS pattern (standard)
```sql
-- Simple workspace-scoped read (for tables that do not need per-project gating)
CREATE POLICY <name>_ws_read ON <table>
  FOR SELECT TO authenticated
  USING (workspace_id = public.current_workspace_id());

-- Per-project gate (uses the permission catalog — ADR-006)
CREATE POLICY <name>_select ON <table>
  FOR SELECT TO authenticated
  USING (has_permission(project_id, '<required_permission>'));
```

`public.current_workspace_id()` reads the `current_workspace_id` claim from `auth.jwt()`. The claim is injected by `public.custom_access_token_hook(event jsonb)`, which Supabase invokes at sign-in and on each session refresh — it picks the user's first accepted `workspace_membership` row. Workspace switching = re-issue the session (Supabase `auth.refreshSession()` with a new active workspace stored in user metadata, then replay the hook).

Per-project access goes through `has_permission(project_id, perm)` (ADR-006) — effective permissions are `union(workspace_role.permissions for role in project_membership.roles) + permission_grants - permission_revokes`. Workspace `owner`/`admin` on `workspace_membership` bypass the per-project check. The 10-permission vocabulary is closed: `read:money, read:engagement, read:person_note_private, read:internal_notes, edit:show, edit:engagement, edit:money, edit:project_meta, edit:membership, admin:project`.

`show.fee_*` columns are additionally gated: the `show_redacted` view masks them when the caller lacks `read:money` (read path), and the `guard_show_fee_columns` trigger blocks fee UPDATE without `edit:money` (write path). `person_note.visibility='private'` is readable only by `author_id = auth.uid()` plus `read:person_note_private`; `visibility='workspace'` requires only workspace membership.

---

## 5. Identifiers

- **Primary keys**: UUID v7 (time-ordered → good B-tree locality, safe to expose, no hot spots). Generated via `public.uuid_generate_v7()` (PL/pgSQL over `pgcrypto::gen_random_bytes`, see `schema.sql` §0). Swap for the `pg_uuidv7` extension or PG18's native `uuidv7()` when available — values are shape-identical.
- **User-facing slugs**: `workspace.slug` (unique globally), `project.slug` (unique within workspace). Auto-generated from name, editable.
- **No sequential integer IDs on tenant data** — information leak + tenant-enumeration vector.

---

## 6. Phase 0 entity map (summary)

Full schema in `schema.sql`. **18 tables**, grouped:

**Tenant + identity**
- `workspace` — tenant root. Columns: `slug`, `name`, `kind ∈ {personal,team}`, `country`, `timezone`, `settings jsonb`, `custom_fields jsonb`. Pre-seeded: `marco-rubiol` (Marco's personal workspace).
- `user_profile` — mirrors `auth.users` via `handle_new_user` trigger; name, locale, avatar.
- `workspace_membership` — (workspace_id, user_id, role ∈ {owner,admin,member,viewer,guest}, accepted_at). Flat enum is the authority at workspace entry; per-project permissions live below.
- `workspace_role` — editable per-workspace role catalog (ADR-006). 15 system roles seeded by trigger on workspace INSERT. `(code, label, access_level, permissions text[], is_system, archived_at)`.

**Project + grouping**
- `project` — belongs to workspace. **No `type` column** (ADR-007). `status ∈ {draft,active,archived}`, generic `description`, `starts_on`, `ends_on`, `dossier_url`, `poster_url`, `custom_fields jsonb`. Polymorphism emerges from which subentities exist.
- `project_membership` — per-user access with `roles text[]` (codes from `workspace_role`), `permission_grants text[]`, `permission_revokes text[]`. Effective perms = `union(role.permissions) + grants - revokes`.
- `line` — optional grouping between project and show (ADR-005). `kind ∈ {tour,season,phase,circuit,residency,other}`, `territory`, `status`, date range.

**People (anti-CRM, 3-layer)**
- `person` — **global** (no `workspace_id`). `full_name` (required), `email citext`, `phone`, `organization_name`, `city`, `country`, `title`, `website`, `languages text[]`, `custom_fields jsonb`. Anyone, any workspace, same row.
- `engagement` — workspace-scoped (person_id, project_id, workspace_id). Conversation state: `status ∈ {contacted, in_conversation, hold, confirmed, declined, dormant, recurring}` (ADR-001). No `date_id` — the linkage to specific dates moved to `show.engagement_id`.
- `person_note` — free-form notes on a person, workspace-scoped. `visibility ∈ {workspace,private}`; `private` readable only by `author_id` + `read:person_note_private`.

**Calendar + venues**
- `venue` — recurring physical place (name, city, country, address, capacity, contacts jsonb, notes).
- `show` — atomic performance (ADR-002). `(project_id, line_id null, engagement_id null, performed_at date, venue_id null, status show_status, fee_amount, fee_currency)`. Status enum covers `proposed → hold / hold_1/2/3 → confirmed → done → invoiced → paid` plus `cancelled`. No UNIQUE on the slot — two simple holds can coexist.
- `date` — non-performance calendar primitive. `kind ∈ {rehearsal, residency, travel_day, press, other}`, `status ∈ {tentative, confirmed, cancelled, done}`. Optional `show_id` and `venue_id` tie a rehearsal or travel day to a specific show/venue.

**Money (ADR-003)**
- `invoice` — header (number, issued_on, due_on, status, subtotal, VAT, IRPF, total, currency, payer_person_id).
- `invoice_line` — line item with optional `show_id` (tour-as-one-invoice). `line_total = quantity * unit_amount` (generated).
- `payment` — abono against invoice (amount, received_on, method, reference). N:1 with invoice.
- `expense` — cost. XOR CHECK: exactly one of `show_id` / `line_id` is set.

**Audit**
- `audit_log` — append-only. Triggers on workspace, workspace_membership, workspace_role, venue, project, project_membership, line, show, date, engagement, person, person_note, invoice, payment, expense.

### What moved where (reset v2 map)
| Polymorphic-reset entity / column | Reset-v2 home |
|---|---|
| `membership` table                 | `workspace_membership` (renamed) |
| `project.type` enum                | Dropped — subentity presence defines kind |
| `date.kind = 'performance'`        | Moved to `show` (atomic performance primitive) |
| `engagement.date_id`               | Moved to `show.engagement_id` (inverted direction) |
| `project_membership.role/scope`    | Replaced by `roles text[]` + `permission_grants/revokes text[]` |
| `tag`, `tagging`                   | Dropped — deferred to Phase 0.5 |
| *(fee on show)*                    | Added `show.fee_amount/fee_currency` + invoice/payment/expense stack |

### Contacts — Difusión migration
The 156 programmers/festivals from MaMeMi's current markdown CRM + dossier PDF import as `person` rows (global) linked to the `mamemi` project via `engagement` rows with `status='contacted'` and `custom_fields.season='2026-27'`. Source provenance preserved in `person.custom_fields.sources.mostra_igualada_2026.*` (no tags — tag/tagging deferred to Phase 0.5). Migration plan + pipeline in `import/` (3-stage normalize→enrich→load). DIY bands are deferred out of Phase 0.

---

## 7. Tasks — deferred

The polymorphic reset (and reset v2) runs without a `task` table. Phase 0 booking-outreach workflow lives in `engagement.next_action_at` + `next_action_note`, and ad-hoc todos live in Marco's `.zerø` _tasks.md. Tag/tagging infrastructure is also deferred — see DECISIONS.md "Deferred → D1" for the combined Phase 0.5 scope.

When tasks come back (early Phase 1, first external user), the taxonomy stays the same — `dispatch → queue → ping → deferred → shelf → trace` — but the table will be polymorphic by `entity_type` (attach to a project, line, show, date, engagement, or sit free at workspace level).

---

## 8. Auth & sessions

- **Auth provider**: Supabase Auth.
- **Phase 0 flow**: email+password as primary method, optional TOTP 2FA (user-enrolled). No OAuth yet. Superseded magic-link-only on 2026-04-19 — see ADR `Auth flow: email+password with optional TOTP 2FA` in `_decisions.md`.
- **Phase 1 additions**: Google OAuth (for calendar sync), Apple Sign-in (iOS app future).
- **Session storage (Phase 0)**: JWT + refresh token + expiry persisted in `localStorage` under `hour_jwt` / `hour_refresh` / `hour_expires_at`. Pragmatic shortcut for Phase 0 (single browser, ≤5 known users); the client posts `Authorization: Bearer <jwt>` to every `/api/*` route, which forwards it to PostgREST. **Phase 1 must move to httpOnly Secure SameSite=Strict cookies** with refresh handled by a dedicated `+server.ts` to remove the XSS exfiltration vector before any external user signs up. Tracked as deuda in `roadmap.md`.
- **Token lifetime**: JWT 1h, refresh 7d (Supabase defaults).
- **Access-token hook**: `public.custom_access_token_hook(event jsonb)` runs at sign-in and on refresh. It looks up the user's first accepted `workspace_membership` row, resolves the `workspace_id`, and injects `current_workspace_id` into the JWT claims. `supabase_auth_admin` has `SELECT` on `workspace_membership` so the hook can read it. The hook is **enabled** in Supabase dashboard → Authentication → Hooks (verified 2026-04-20). Without it, `current_workspace_id()` returns NULL and every RLS policy denies the request.
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
- ❌ Live cursor positional presence (Figma-style) — deferred to Phase 0.5; Phase 0.2 ships text-field CRDT (`y-partyserver`) + simplified presence (border + name on focused field), see ADR-025

---

## 11. Critical decisions already made (with rationale)

| Decision | Choice | Why |
|----------|--------|-----|
| Tenant key | `workspace_id` + `current_workspace_id` JWT claim (injected by `custom_access_token_hook`) | Works with Supabase RLS natively, no app-layer tenant resolution. Renamed from `organization_id` to reflect `kind=personal|team`. |
| Polymorphic core (reset v2) | `workspace + project + engagement + show + line + date`, no `project.type` | ADR-007: type emerges from subentity presence. ADR-001: engagement (conversation) and show (atomic gig) are distinct. ADR-005: `line` is the optional tour/season grouping. |
| Anti-CRM vocabulary | `person`, `engagement`, status `contacted`, `next_action_at` | Fits the working reality of a freelance/collective booking manager; rejects funnel/lead/conversion/campaign language. Reset v2 enum: `contacted, in_conversation, hold, confirmed, declined, dormant, recurring`. |
| Person is global | No `workspace_id` on `person` | Real programmers exist once and are seen by many workspaces; privacy lives in `person_note.visibility` and `engagement`, not the person row. |
| Money stack | Three tables + bridge — `invoice` + `invoice_line` + `payment` + `expense` | ADR-003. Partial payments, tour-as-one-invoice, Spanish VAT/IRPF, expenses grounded in show or line (XOR). |
| RBAC (reset v2) | Flat `workspace_membership.role` + editable `workspace_role` catalog + per-membership overrides | ADR-006. 10-permission closed vocabulary. Owner/admin bypass project-level checks explicitly. 15 system roles seeded by trigger on workspace INSERT. |
| Fee gating on show | View `show_redacted` (read) + trigger `guard_show_fee_columns` (write) | ADR-003 column-level gate. `edit:show` suffices for most edits; fee edits require `edit:money`. |
| PK type | UUID v7 via PL/pgSQL | Time-ordered, index-friendly, safe to expose, no enumeration risk. `pg_uuidv7` not on Supabase Cloud whitelist. |
| Media storage | R2 (not Supabase Storage) | Zero egress cost — Supabase Storage egress is the silent killer |
| Queue | pgmq | Zero new infra. 10k jobs/day ceiling is fine for Phase 0-1. |
| Frontend | SvelteKit 2 + Svelte 5 (ADR-026, 2026-05-01) | Single-runtime stack: 95 % of code was already vanilla JS or Svelte; Astro was a 30-LoC SSR envelope. Gains client routing, form actions, `load()` deps, hooks, cross-route stores. |
| Collab transport | `y-partyserver` on native CF Durable Object (ADR-025) | PartyKit was acquired by Cloudflare; `y-supabase` is abandoned. Same runtime as Hour. |
| Multi-tenant from day one | Yes | Retrofitting tenancy later is a 6-month rewrite. Cost now: 2 extra lines per migration. |
| i18n scaffold from day one | Yes (`$lib/i18n.ts` simple `t(key, locale)` + en.json/es.json), content **EN only** in Phase 0 (D-PRE-03) | Wire i18n early so retrofit is mechanical; defer ES content + paraglide-js v2 migration to Phase 1 when copy volume justifies it (currently ~15 strings). Target market is multilingual European productions. |
| Migrations in git | Yes, from commit 1 | Non-negotiable for two-env setup |

## 12. Critical decisions deferred to kickoff — ✓ all closed

Resolutions (closed by 2026-05-01, kept here as audit trail):

- **Frontend framework**: SvelteKit 2 + Svelte 5 (ADR-026, 2026-05-01). Astro 5 + islands ran from 2026-04-19 to 2026-04-30; migration triggered by audit showing Astro was a thin SSR envelope around code that was already 95 % Svelte / vanilla JS.
- **Islands framework**: superseded — single Svelte runtime now.
- **Auth flow**: email+password with optional TOTP, no OAuth in Phase 0 (`_decisions.md` 2026-04-19). Magic link rejected.
- **Repo location**: `github.com/marcorubiol/hour` (private, personal user). Transferable to a `zerosense` org if Phase 1 activates.
- **Staging frequency**: deploy on merge to `main` only. No per-PR previews in Phase 0. Staging Worker (`hour-staging`) deferred until first external tester.

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
- **Secrets**: Cloudflare Worker `[vars]` in `wrangler.jsonc` for non-secret public values (PUBLIC_SUPABASE_*); Cloudflare dashboard → Settings → Variables and Secrets for service-role keys; `apps/web/.env` for build-time vars consumed by `$env/static/public` (PUBLIC_SENTRY_DSN, PUBLIC_SUPABASE_*) — gitignored, copy from `.env.example`.

---

## 15. Repo layout (proposed)

```
hour/
├── apps/
│   └── web/                          # SvelteKit app
│       ├── src/
│       │   ├── app.html
│       │   ├── hooks.client.ts       # Sentry browser init + replay
│       │   ├── hooks.server.ts       # initCloudflareSentryHandle + sentryHandle
│       │   ├── lib/
│       │   │   ├── components/       # primitives (Button, Input, Sidebar, …)
│       │   │   ├── auth.ts           # extractBearer
│       │   │   ├── supabase.ts       # thin PostgREST client (pgGet, pgPostRpc)
│       │   │   ├── db-types.ts       # generated Supabase types
│       │   │   └── i18n/             # t(key, locale) + en.json/es.json
│       │   ├── routes/
│       │   │   ├── +layout.svelte    # QueryClientProvider
│       │   │   ├── login/+page.svelte
│       │   │   ├── booking/+page.svelte
│       │   │   ├── playground/+page.svelte
│       │   │   └── api/<name>/+server.ts
│       │   └── styles/
│       │       ├── tokens.css        # OKLCH three-tier (base / status / contextual)
│       │       └── base.css          # cascade layers + skeletons
│       ├── svelte.config.js          # adapter-cloudflare
│       ├── vite.config.ts
│       ├── wrangler.jsonc            # Worker config (DO declared here in Phase 0.0)
│       └── package.json
├── build/                            # specs, ADRs, schema, planning (this folder)
├── research/                         # competitor / pricing / UX research
├── _context.md                       # project rules (inherits .zerø)
├── _decisions.md                     # ADR log
├── CLAUDE.md                         # stub (@_context.md) for Claude Code / Cowork
├── pnpm-workspace.yaml
└── package.json
```

Monorepo via pnpm 10 workspaces. Today: one app (`apps/web`). `packages/shared` to be created when a second app needs shared types.

---

## 16. Open questions to close before first commit

1. **Legal entity for the SaaS future.** Do we ship Phase 0 under Marco personal, or under a new sociedad? Affects where the domain sits and what appears in the footer. (Phase 0: personal is fine; Phase 1: needs sociedad for invoicing EU clients.)
2. **Data residency commitment.** If EU-only → Supabase Frankfurt. Phase 0 fine. Phase 1 if any US client signs up → consider.
3. **Branding on Phase 0.** Minimal or themed? Recommendation: minimal (logo = wordmark, no illustration). Save branding spend for when marketing starts.
4. **Who else besides Marco touches this before Phase 1 checkpoint?** Only Anouk? +1 tester? Affects invite flow priority.

---

## 17. API routes (SvelteKit endpoints on the Worker)

Location: `apps/web/src/routes/api/<name>/+server.ts`. Validation is enforced
with Valibot at every endpoint boundary. All data endpoints forward the
caller's Supabase JWT to PostgREST — **RLS is the access-control boundary;
the Worker is not.**

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/engagements` | GET | `engagement` rows with embedded `person` and `project`, filtered by `project_slug` (default `mamemi`), `status` (default `contacted`, `any` to disable), `season` (default `2026-27`). Thin PostgREST wrapper; RLS scopes by `current_workspace_id`. |
| `/api/sentry-tunnel` | POST | Forwards Sentry envelopes from the browser SDK to the Sentry ingest host (DSN-derived) so adblockers / Brave Shields / Firefox ETP don't drop them. |
| `/api/sentry-test` | GET | Smoke endpoint that throws an uncaught error so the server-side Sentry handle captures it. Dev-only by default; `?force=1` allowed in prod. |

Planned (per `roadmap.md` Phase 0.1+): `/api/houses`, `/api/rooms`, `/api/runs`, `/api/gigs`, `/api/gigs/:id/roadsheet`, plus mutations.

Shared helpers:
- `src/lib/auth.ts` — JWT extraction from `Authorization` header (`extractBearer`).
- `src/lib/supabase.ts` — thin PostgREST client over `fetch` (`pgGet`, `pgPostRpc`, `PostgrestError`). No `@supabase/supabase-js` on the Worker.
- `src/lib/db-types.ts` — generated types + convenience aliases `Row<T>`, `Insert<T>`, `Update<T>`, `Enum<T>`, `RpcArgs<T>`, `RpcReturn<T>`. Regenerate via the Supabase MCP `generate_typescript_types` (or `supabase gen types typescript --project-id lqlyorlccnniybezugme`).

Conventions:
- Read `platform.env` from the SvelteKit `RequestHandler` arg to access bindings.
- Validate query params via Valibot `safeParse`; return `{ error, issues }` on schema violation.
- Return `{ error, detail?, hint? }` on failure; never log JWT or request body.
- No `prerender` flag needed (SvelteKit defaults endpoints to dynamic).

Open dependency: the `custom_access_token_hook` is enabled in Supabase
dashboard → Authentication → Hooks (verified 2026-04-20). Without it,
`current_workspace_id()` returns NULL and RLS returns zero rows for
authenticated users.

---

## 18. Files in `build/`

- `_context.md` — workflow guide for this folder (siblings: chats vs files)
- `architecture.md` — this file
- `roadmap.md` — living implementation plan (phases 0.0 → 1, ADRs, sprints)
- `competition.md` — 20 competitors, pricing, gap analysis
- `schema.sql` — full Postgres schema (18 tables, reset v2)
- `rls-policies.sql` — RLS helpers + policies + guard/audit triggers + `custom_access_token_hook`
- `seed.sql` — pre-seed (marco-rubiol workspace + mamemi project) + post-signup CLAIM block
- `bootstrap.md` — step-by-step: create Supabase project, configure Auth, create CF Worker, configure DNS, first deploy, first user
- `import-plan.md` + `import/` — 156 programmers markdown → `person` + `engagement` rows mapping; 3-stage pipeline (normalize → enrich → load)
- (`_decisions.md` lives at project root, not here — it's the ADR log)

---

## 19. Out of scope for this doc

- Visual design (lives in `_methød/design.md`)
- CSS methodology (lives in `_methød/css.md`)
- MaMeMi-specific content (lives in `01_STAGE/MüK CIA - MaMeMi/_context.md`)
- Phase 1 SaaS pricing / packaging (decided at month 6 checkpoint)
