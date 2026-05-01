# Decisions Log — Hour

Chronological record of decisions taken during Hour's design and build.
Latest entries at the bottom. Each entry is an ADR (Architecture Decision Record) lite.

Format:
```
## [YYYY-MM-DD] — Short title
- Decision: what we chose
- Context: why this came up
- Alternatives considered (rejected): what else was on the table
- Rationale: why this wins
- Status: firm | provisional | deferred
```

---

## [2026-04-18] — Project scope: Phase 0 first, Phase 1 deferred
- **Decision**: Build Hour as a Phase 0 internal tool for MaMeMi (Marco + Anouk + ≤5 users, 1 organization). Phase 1 (SaaS with paying customers) decision deferred to month 6 checkpoint.
- **Context**: Marco has finite bandwidth across MaMeMi, agency, studio, personal life. Committing to SaaS product upfront risks overload and mission drift.
- **Alternatives**: (a) Start immediately as SaaS with marketing site + billing + tiers — rejected, premature optimization, no validated usage yet. (b) Skip multi-tenant architecture and just build a private tool — rejected, retrofitting tenancy later is a 6-month rewrite.
- **Rationale**: Phase 0 is valuable regardless of Phase 1 outcome. Marco was going to build this tool anyway for MaMeMi. Making it multi-tenant-ready costs ~2 extra lines per migration. If daily usage is real at month 6 and external demand exists unprompted → Phase 1 activates. Otherwise Hour stays private, nothing lost.
- **Status**: Firm.

## [2026-04-18] — Subdomain for Phase 0 deployment
- **Decision**: Deploy at `hour.zerosense.studio`.
- **Context**: Need a URL without committing to a full product brand name yet.
- **Alternatives**: Buy dedicated .com (candidates from naming research: Kairoz, Ensara, Voltari, Tessen, Noctari). Rejected for Phase 0 — brand decision should follow product validation, not precede it.
- **Rationale**: Subdomain decouples branding from build. Zero cost (assuming `zerosense.studio` is already Cloudflare-managed). Product name decision moves to Phase 1 kickoff if and when it happens.
- **Status**: Firm for Phase 0. Revisit if Phase 1 activates.

## [2026-04-18] — Stack choice for Phase 0
- **Decision**: Supabase Cloud (Postgres + Auth + RLS + Realtime) + Cloudflare Pages + Cloudflare R2 + pgmq (in-db queue) + Resend (transactional email) + Sentry (errors) + GitHub (source) + Astro with Svelte islands (frontend) + pnpm monorepo.
- **Context**: Need zero-cost infra for Phase 0, multi-tenant-ready from day 1, operable by one person.
- **Alternatives considered**:
  - Supabase self-host — rejected, ops overhead doesn't fit solo operator.
  - Vercel — rejected, no native R2 equivalent, egress more expensive.
  - Next.js — rejected, overkill for list/detail UI that is 80% of the app.
  - SvelteKit full-SPA — rejected, Astro islands is lighter and cache-friendlier.
  - Cloudflare D1 — rejected for main DB, RLS in Postgres is cleaner and Supabase gives more out of the box.
  - Supabase Storage — rejected for media, R2 zero-egress is decisive at scale.
- **Rationale**: Every component has a free tier sized adequately for Phase 0. Multi-tenant via Postgres RLS is production-grade. R2 is non-negotiable for a media-heavy app.
- **Status**: Firm for Phase 0.

## [2026-04-18] — Zero infra cost target for Phase 0
- **Decision**: Phase 0 runs entirely within free tiers. Only paid item: `zerosense.studio` domain renewal (~30€/year) if not already owned.
- **Context**: Internal tool, no external users, no validation that product justifies recurring spend yet.
- **Rationale**:
  - Supabase free: 500MB DB, 1GB storage, 2GB bandwidth/mo, 50k MAU — 100× headroom for Phase 0.
  - CF Pages free: unlimited bandwidth.
  - CF R2 free: 10GB storage + 10M class A + 1M class B requests — ample.
  - Resend free: 3k emails/mo, 100/day — magic link + team notifications fit.
  - Sentry free: 5k errors/mo.
  - GitHub private repo: free.
- **Status**: Firm. Re-evaluate any single component only if it overflows its free tier.

## [2026-04-18] — Multi-tenancy from day one
- **Decision**: All tenant-scoped tables carry `organization_id UUID NOT NULL` from the first migration. RLS policies enforce tenant isolation at DB level. Tenant context travels in the JWT `current_org_id` claim.
- **Context**: Even though Phase 0 has 1 organization, Phase 1 (if activated) cannot afford a retrofit.
- **Alternatives**: Single-tenant schema, add tenant column later — rejected, proven 6-month rewrite pattern.
- **Rationale**: Cost now is 2 extra lines per migration. Benefit is optionality to flip to SaaS without rebuilding.
- **Status**: Firm.

## [2026-04-18] — Primary key type: UUID v7
- **Decision**: All tenant-data PKs use UUID v7 (time-ordered).
- **Context**: Need PKs safe to expose, index-friendly, no enumeration vector.
- **Alternatives**: Sequential bigints (rejected — tenant enumeration leak), UUID v4 (rejected — fragmented B-tree hot-spotting at scale).
- **Rationale**: Time-ordered UUIDs preserve index locality (like bigints) while being safe to expose and unique across tenants.
- **Status**: Firm.

## [2026-04-18] — Competitive positioning vs Ares
- **Decision**: Hour does NOT build Spanish labor compliance features (prenòmines, altas/bajas Seg. Social, subvention statistics). That space stays with Ares, accounting software, or gestoría.
- **Context**: Ares covers that vertical well. Replicating would trap Hour in Spanish regulatory churn and block European ambition.
- **Alternatives**: Build own compliance (rejected — BOE trap), integrate with Ares API (deferred — no public API known).
- **Rationale**: Hour's value lives in Difusión + touring + technical production, not local payroll paperwork. Customers who need both can use Ares + Hour side-by-side. Eventual integration with gestoría software (Holded, Quipu) is Phase 2+.
- **Status**: Firm.

## [2026-04-18] — Indicative pricing tiers for Phase 1
- **Decision**: Target SaaS pricing (if Phase 1 activates): LITE 25€/mes, STANDARD 60€/mes, PRO 120€/mes. No setup fee. 14-day free trial. Optional paid migration service (200–500€) for teams coming from Excel/Ares/Notion.
- **Context**: Ares charges 30/60€/mes + 150€ setup. Need a pricing stance.
- **Rationale**:
  - LITE at 25€ undercuts Ares LITE (30€) with better base features.
  - STANDARD at 60€ matches Ares GENERAL but bundles Google Calendar sync (which Ares charges 15€ extra for).
  - PRO at 120€ targets companies with international touring + technical integrations — segment Ares does not serve.
  - No setup fee removes entry friction; Ares's 150€ fee is a growth blocker.
  - Optional migration service as one-off revenue without penalizing self-service onboarding.
- **Status**: Provisional. Confirm at Phase 1 kickoff with real customer conversations.

## [2026-04-18] — Build workflow — tool choice
- **Decision**: Claude Code (CLI, per Marco's preference — Desktop is equivalent, same engine) is the primary coding environment. Cowork is for strategy, research, briefings, and cross-app tasks. Memory lives in repo files (`build/*.md`), never in chat history.
- **Context**: Project will run for months. Need sustainable AI-collaboration workflow that doesn't depend on remembering what was said in which chat.
- **Alternatives**: All in Cowork (rejected — loses precision on long code sessions, no native git workflow). All in Claude Code (rejected — Cowork is better for strategic thinking, docs, cross-app tasks).
- **Rationale**:
  - Claude Code is project-based: auto-reads `CLAUDE.md` at root + domain + project, has persistent memory across sessions, supports parallel sessions, git-native (commits/branches/PRs), runs tests locally.
  - Cowork is session-based, sandboxed Linux VM, optimized for polished document creation and cross-app workflows.
  - Shared memory between them = files in the repo, not chat context.
- **Status**: Firm.

## [2026-04-18] — Chat structure with Claude
- **Decision**:
  1. **One long Cowork chat "Hour — Strategy"** for strategic thinking, planning, competitive analysis, architecture decisions.
  2. **Claude Code (CLI) in `hour/` repo** for all coding work.
  3. **Short ad-hoc Cowork chats** for one-off tasks (email draft, contract review, meeting briefing).
  4. **Separate `.zerø` Cowork integration** for daily briefings, tasks, Ørbit — kept distinct from Hour work.
  5. Standard opening instruction for any new chat: *"Read `CLAUDE.md` + `build/architecture.md` + `_decisions.md` + `build/competition.md` before responding."*
- **Context**: Avoid fragmenting knowledge across dozens of chats. Avoid losing context on long threads.
- **Rationale**: Fewer chats, each with clear purpose. Memory persists in files, not in Claude's memory of any single chat. Any new session can catch up in seconds by reading four markdown files.
- **Status**: Firm.

## [2026-04-18] — Project location (physical folder) — initial
- **Decision**: Phase 0 lives at `/Users/marcorubiol/Zerø System/01_STAGE/ZS_MaMeMi/build/`. When promoted to its own git repo, move to `02_STUDIO/Hour/` or `04_BACKSTAGE/Hour/` and update `.zerø` dashboard accordingly.
- **Context**: Hour was conceived inside the MaMeMi Difusión problem. By Marco's rule "a project lives where it's born", Hour inherits from STAGE for now.
- **Alternatives**: Start a fresh folder immediately — rejected, premature separation before we know if Hour outgrows the MaMeMi context.
- **Rationale**: Keep it simple. One folder for now. Move later if/when Phase 1 activates.
- **Status**: Superseded on 2026-04-18 by the next entry.

## [2026-04-18] — Project location (updated — supersedes previous)
- **Decision**: Hour lives at `03_AGENCY/Hour/` with build artifacts under `03_AGENCY/Hour/build/`. Separated from `ZS_MaMeMi/` the same day it was first scaffolded.
- **Context**: Marco reflected that bundling Hour inside MaMeMi didn't fit. He created `03_AGENCY/Hour/` and asked to relocate all `build/` files there.
- **Alternatives**: `02_STUDIO/Hour/` (Claude's proposal, by the "project lives where it's born" rule — Hour emerged out of the Difusión problem which lives in STAGE). Rejected by Marco.
- **Rationale**: Marco frames Hour primarily as a *vehicle/product for others*, not as a private creative tool. AGENCY is defined as "the vehicle, work for others" — that matches Hour's ambition. Also aligns with the planned multi-tenant SaaS direction if Phase 1 activates.
- **Status**: Firm.

## [2026-04-19] — GitHub repo location: personal user, private
- **Decision**: Repo lives at `github.com/marcorubiol/hour`, private, under Marco's personal GitHub account.
- **Context**: Milestone 5 (`git init` + first push) reached before a Phase 1 decision on branding or org structure.
- **Alternatives**: Create a `zerosense` GitHub org now and host the repo there — rejected. The org/brand decision belongs to Phase 1 kickoff, not to the push timing.
- **Rationale**: GitHub supports lossless repo transfer between user and org (history, issues, PRs, stars all preserved). Creating an org now under pressure from an unrelated milestone would force a premature brand/fiscal decision. Private is obvious for Phase 0 (internal code, no external users).
- **How to apply at Phase 1**: If Phase 1 activates and a `zerosense` org is created, use GitHub's "Transfer ownership" flow — keeps remote URL redirects active for grace period, no force-push required for clones.
- **Status**: Firm for Phase 0. Revisit at Phase 1 kickoff.

## [2026-04-19] — UUID v7 generation: PL/pgSQL function, not pg_uuidv7 extension
- **Decision**: Provide `uuid_generate_v7()` as a PL/pgSQL function built on `pgcrypto.gen_random_bytes()`. Remove `CREATE EXTENSION "pg_uuidv7"` from the first migration.
- **Context**: Original schema.sql (commit `dbd6eed`) requires the `pg_uuidv7` extension. Verified 2026-04-19 that Supabase Cloud does not whitelist this extension, and Postgres 17 (Supabase current) does not ship native `uuidv7()` (that arrived in PG18).
- **Alternatives considered**:
  - Wait for Supabase to whitelist `pg_uuidv7` — rejected, indefinite timeline, blocks deploy.
  - Wait for Supabase to upgrade to PG18 native `uuidv7()` — rejected, unconfirmed and blocks deploy.
  - Install the `cem@uuidv7` TLE package from database.dev — rejected, extra dependency for a ~10-line function.
  - Downgrade to UUID v4 via `uuid_generate_v4()` — rejected, loses index locality benefits already committed to in DECISIONS (2026-04-18 UUID v7 entry).
  - Use `gen_random_uuid()` (UUID v4) — same objection as above.
- **Rationale**: A ~10-line PL/pgSQL function using `pgcrypto` produces RFC 9562-compliant UUID v7 values on any Postgres 13+. Performance delta vs C extension is irrelevant at Phase 0 scale (1 org, ≤5 users). When Supabase adds `pg_uuidv7` or upgrades to PG18, swap the function body to call the native implementation — schema, PKs, and all FKs stay untouched because they reference the function name, not the implementation.
- **How to apply**: First migration creates the function. Schema migrations keep calling `uuid_generate_v7()` as default. Future migration can replace the function body once native support arrives.
- **Status**: Firm for Phase 0. Revisit when Supabase ships native UUID v7.

## ~~[2026-04-19] — Auth flow: magic-link only for Phase 0~~ (SUPERSEDED same day)
- ~~**Decision**: Supabase Auth with email magic-link as the only sign-in method. Email+password disabled. OAuth providers (Google, Apple) deferred to Phase 1.~~
- ~~**Context**: Phase 0 has ≤5 users (Marco, Anouk, up to 3 collaborators). First-time setup of `hour.zerosense.studio` required an auth choice.~~
- ~~**Alternatives considered**:~~
  - ~~Email + password — rejected, passwords to remember/rotate for 5 internal users is pure friction.~~
  - ~~Magic-link + Google OAuth from day one — rejected, OAuth adds callback URLs, token rotation, and a larger auth surface with no Phase 0 benefit (all 5 users have email).~~
  - ~~Passkey/WebAuthn — rejected, Supabase support is still preview-level and it's overkill for an internal tool.~~
- ~~**Rationale**: Magic link is zero-friction for trusted small teams. Resend's free tier (3k/month, 100/day) is ~100× what 5 users need. Adding OAuth when external users appear in Phase 1 is a dashboard toggle + config change, not a migration. Session length will be set to 30 days so mobile users don't re-auth daily.~~
- ~~**How to apply**: Bootstrap §2.1 enables Magic Link and disables Password in the Supabase dashboard. Site URL = `hour.zerosense.studio`, redirect = `http://localhost:4321/*` for dev.~~
- **Status**: **Superseded 2026-04-19 by "Auth flow: email+password with optional TOTP 2FA"** (below). Marco preferred a traditional account + password flow with opt-in 2FA over magic-link-only.

## [2026-04-19] — Auth flow: email+password with optional TOTP 2FA for Phase 0
- **Decision**: Supabase Auth with email+password as the primary sign-in method, TOTP (app authenticator) as an optional second factor that users can enroll themselves. OAuth providers (Google, Apple) deferred to Phase 1. Magic-link-only approach (earlier same-day ADR) rejected in favor of this.
- **Context**: Marco reconsidered the magic-link-only choice on 2026-04-19 during the Phase 0 Supabase dashboard setup. Preference: a traditional "make an account, log in with password, optionally turn on 2FA" flow, which is more familiar for the target Phase 1 audience (non-technical cultural programmers) and removes dependency on email deliverability for every login.
- **Alternatives considered (this pass)**:
  - Stay with magic-link-only — rejected, adds friction on every login (check email, click), hard requirement on Resend uptime for day-to-day access.
  - Password + SMS 2FA — rejected, costs money per SMS, vulnerable to SIM-swap, requires a paid SMS provider (Twilio) that conflicts with Phase 0 zero-cost target.
  - Password + email OTP as 2FA — rejected, redundant (email is already the account identifier and password recovery channel — adding it as 2FA adds zero real security).
  - Password + mandatory TOTP from day 1 — rejected for Phase 0, would block Marco/Anouk/collaborators from a simple signup flow; can be escalated to mandatory for admin roles in Phase 1 via AAL2 policies.
- **Rationale**: Email+password is the most familiar pattern for the target audience. Optional TOTP lets security-conscious users (Marco) harden their account without forcing every collaborator through an enrollment flow on day 1. TOTP specifically (not SMS, not email-OTP) is the industry-standard second factor — free (no SMS cost), phishing-resistant (codes don't leave the user's device), and already familiar to anyone who uses a banking app or GitHub.
- **How to apply**: Supabase dashboard settings (applied 2026-04-19):
  - Authentication → Sign In / Providers → Email: `Enable email provider` ON, `Confirm email` ON (verification email required before first login), `Secure email change` ON, `Minimum password length` raised to 8 from default 6, password complexity requirements enabled.
  - Authentication → Multi-Factor: TOTP enabled. UI in `apps/web/` will later expose self-service enrollment under account settings.
  - Authentication → URL Configuration: Site URL = `https://hour.zerosense.studio`, Redirect URLs = `https://hour.zerosense.studio/**` + `http://localhost:4321/**`.
  - Authentication → Sessions: kept at Free-plan defaults (JWT expiry 1h, refresh tokens persistent — time-box and inactivity timeout are Pro-plan features, not needed in Phase 0).
  - App code (not yet written): `signUp({ email, password })`, `signInWithPassword({ email, password })`, `auth.mfa.enroll()` / `challenge()` / `verify()` for 2FA. No call to `signInWithOtp` unless we later add a magic-link fallback.
- **Upgrade path at Phase 1**: (a) add OAuth providers (Google, Apple) as additional signup paths, (b) optionally enforce TOTP for admin roles via AAL2 RLS policies on sensitive tables.
- **Status**: Firm for Phase 0. Revisit if a customer explicitly demands passwordless or SSO in Phase 1.

## [2026-04-19] — Supabase region: eu-central-1 (Frankfurt)
- **Decision**: Create the Supabase Cloud project in `eu-central-1` (Frankfurt).
- **Context**: First-time Supabase project creation for Hour. Region is effectively immutable — changing later means a full export/import migration.
- **Alternatives considered**:
  - `eu-west-3` (Paris) — rejected, latency from Madrid is ~25ms vs Frankfurt's ~35ms, a difference imperceptible to users. Frankfurt has longer Supabase operational history and fewer reported incidents.
  - `us-east-1` (Virginia) — rejected, GDPR transit risk + 100ms+ latency penalty for zero benefit.
  - Any non-EU region — rejected, Hour targets European customers and must keep data inside the EU for GDPR.
- **Rationale**: Frankfurt is Supabase's most-used EU region, with the most mature infra. Latency difference with Paris is negligible. EU data residency satisfies GDPR without extra contractual work.
- **How to apply at Phase 1**: If customer acquisition reveals a meaningful user base outside Europe, evaluate a second Supabase project in that region rather than migrating the primary one.
- **Status**: Firm.

## [2026-04-19] — Frontend framework: Astro + Svelte islands
- **Decision**: Astro as the application shell, Svelte for interactive islands. Cloudflare adapter for deploy. Single Astro app at `apps/web/`.
- **Context**: First frontend scaffold needed before Cloudflare Pages setup. Framework choice shapes every future component.
- **Alternatives considered**:
  - SvelteKit (full SPA) — rejected for Phase 0, worse first paint for list/detail UI, heavier JS payload, overkill when most pages are server-rendered.
  - Next.js (React) — rejected, ~2× bundle size for equivalent UI, larger dependency surface, and Marco's existing tooling preference is Svelte-side.
  - HTMX + plain HTML — rejected, too skeletal for Supabase Realtime subscriptions and the drag-drop interactions planned for the task board.
- **Rationale**: 80% of Hour's UI is list/detail views (contacts, projects, events, tasks). Astro server-renders these by default; Svelte islands add interactivity only where needed (forms, drag-drop, realtime updates). Result: minimal client JS, SEO out of the box, fast first paint. When Phase 1+ needs a heavily interactive sub-app (Gantt-style production timeline, touring calendar), it can be a separate SvelteKit app in the monorepo.
- **How to apply**: Bootstrap §7 scaffolds `apps/web/` with `astro + @astrojs/svelte + @astrojs/cloudflare`. `output: 'server'` on Pages adapter to support auth callbacks and API routes.
- **Status**: Firm for Phase 0. Revisit if a sub-app needs full-SPA interactivity.

## [2026-04-19] — Node runtime: 22 LTS
- **Decision**: Node 22 as the runtime for local dev and Cloudflare Pages builds. Pinned via `NODE_VERSION=22` env var on Pages.
- **Context**: CF Pages needs an explicit Node version pin; default is old.
- **Alternatives considered**:
  - Node 20 LTS — rejected, still valid but more conservative. New project should start on the most recent Active LTS.
  - Node 24 (Current) — rejected, not LTS, not recommended for production.
- **Rationale**: Node 22 entered LTS in October 2024, Active support through October 2027. Native top-level `await`, stable `require(esm)`, and V8 12.4 perf improvements. Works out of the box with Astro, Svelte, Supabase SDK, and CF Pages.
- **Status**: Firm.

## [2026-04-19] — Custom fields: hybrid JSONB + definition table (deferred implementation)
- **Decision**: Hour will support per-organization custom fields on the main entities (`contact`, `project`, `event`) via a hybrid pattern: a `custom_field_definition` table per org defines schema (name, type, required, options, display order), and each entity carries a `custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb` column that stores values. UI renders form fields dynamically from the definitions. GIN index on the JSONB column when filtering needs it.
- **Context**: B2B live-performing-arts organizations have widely different metadata needs on contacts and projects (sala vs festival vs programmer require different fields; SGAE/AIE contract flags, aforo, taquilla garantizada, ficha técnica links, etc). Without a custom fields system, users inflate the `notes` free-text field and lose structure, or we get an endless stream of "add column X" requests post-launch.
- **Alternatives considered**:
  - Native columns only — rejected, can't anticipate every tenant's needs, leads to bloated schema or escape-valve via `notes`.
  - Pure JSONB with no definitions — rejected, no validation, no dynamic UI, each org builds its own conventions and the data gets incoherent.
  - EAV (separate `custom_field` + `custom_field_value` tables) — rejected, join-heavy, N+1 risk, complex queries for a use case that rarely needs relational analytics across custom fields.
  - Per-tenant schema migrations (add columns per org) — rejected, operational nightmare at SaaS scale, breaks multi-tenant RLS.
- **Rationale**: Hybrid keeps native columns for universally needed fields (name, email, status, organization_id, etc.) where we need indexing, RLS filtering, and typed joins; puts the genuinely per-tenant stuff in JSONB where it flexes without migrations. The `custom_field_definition` table gives us dynamic form rendering + app-layer validation. GIN on JSONB handles the filtering needs of Phase 1 scale (thousands of rows per org, not millions). When a custom field "graduates" (becomes universal across tenants), it migrates from JSONB to a native column cleanly.
- **When to implement**: NOT Phase 0 (only Marco + Anouk, no demand). Implement when either (a) the first Phase 1 customer explicitly requests custom fields, or (b) we find ourselves adding native columns for single-tenant needs for the second time. Estimated cost when triggered: ~2 days for schema + RLS + dynamic form rendering.
- **Prep work done now (Phase 0)**: ~~none yet. Open question — whether to land the 3 `custom_fields` JSONB columns (contact / project / event) now as migration 0005 so adding the definition table and UI later is purely additive, or defer all of it. Pending Marco's decision.~~ → **Resolved 2026-04-19 (same day): JSONB columns landed.** See next ADR below.
- **UI corollary**: the same `form_schema`/definition pattern can drive native-field rendering too, but we won't go that route. Native entities (contact, project, event, rider) get hand-written forms for polished UX; only custom fields are schema-driven. Two form engines, converging at the composition layer.
- **Status**: Partially implemented — JSONB storage columns + GIN index present (migration 0005). `custom_field_definition` table and dynamic UI rendering still deferred to Phase 1 or on-demand.

## [2026-04-19] — Activate `custom_fields jsonb` columns in Phase 0
- **Decision**: Land migration `0005_custom_fields` now, which adds `custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb` to `contact`, `project`, and `event`, plus a GIN index (`jsonb_path_ops`) on `contact.custom_fields`. The earlier ADR "Custom fields: hybrid JSONB + definition table (deferred implementation)" was marked as prep-work pending; this resolves it: the storage columns ship now, the `custom_field_definition` table and dynamic UI remain deferred.
- **Context**: The real import dataset (Mostra Igualada 2026 — 4 CSV exports + 1 PDF dossier) introduces two classes of metadata that do not justify native columns:
  1. **Provenance** — `Número Registre`, raw `Tipologia`, raw `Categoria procedència`, `ingested_at` timestamp. Per-batch, per-source, variable shape across future imports.
  2. **Qualitative enrichment** — the PDF dossier carries per-programmer `INTERÈS ARTÍSTIC` and `DESCRIPCIÓ` fields that won't exist in the next source.
   Storing these in `notes` collapses structure; creating columns per source bloats the schema and doesn't scale past the first festival.
- **Alternatives considered (at this decision point)**:
  - Store provenance in `notes` as free text — rejected, unsearchable and loses fidelity.
  - Create dedicated columns (`source_id INT`, `source_name TEXT`, etc.) — rejected, any second festival adds more columns, same anti-pattern the original ADR was trying to avoid.
  - Defer until Phase 1 — rejected, import-plan.md needs a home for provenance today, not in six months. Refactoring the import in-place later is more expensive than the zero-cost migration now.
  - Activate only on `contact` — rejected, consistent with the original design that named all three entities; `project` and `event` are also likely to pick up per-tenant metadata (e.g. custom project status codes, external-calendar sync cursors).
- **Rationale**: The zero-cost bet (one ALTER TABLE per tenant entity, one GIN index) was the gating question in the earlier ADR. The real first import provides the concrete justification to flip the switch. Keeping the `custom_field_definition` table and dynamic UI deferred respects the original ADR's cost/benefit position — tenant-configurable fields are not needed while MaMeMi is the only tenant.
- **How to apply**: Migration 0005 already applied via Supabase MCP. `build/schema.sql` reconciled. Import-plan.md §3.5 specifies the JSONB shape (`sources.<source_slug>` namespace for provenance; `dossier_2026` for PDF enrichment).
- **Consumer conventions**: Always merge with `jsonb ||` (never overwrite). Prefer namespaced keys (`sources.mostra_igualada_2026.*`, never root-level `registre`). Reserved root keys: `sources` and anything ending in `_*` for future internal uses.
- **Upgrade path**: When the first Phase 1 customer needs tenant-configurable fields, the `custom_field_definition` table + dynamic renderer is purely additive — no changes to the storage columns already in place.
- **Status**: Firm. Migration applied 2026-04-19.

## [2026-04-18] — Deferred to kickoff session
Items NOT yet decided, to address when starting schema work:

- ~~Frontend framework confirmation~~ — resolved 2026-04-19 (Astro + Svelte). See ADR above.
- ~~Auth flow: magic link only (Phase 0) vs + Google OAuth (Phase 1)~~ — resolved 2026-04-19 (magic-link only, later superseded by password+TOTP). See ADRs above.
- ~~Repo under Marco's GitHub user vs new `zerosense` org~~ — resolved 2026-04-19, see entry above.
- ~~Custom fields: whether to land the 3 `custom_fields` JSONB columns now (Phase 0) as prep~~ — resolved 2026-04-19 (landed). See ADR "Activate `custom_fields jsonb` columns in Phase 0" above.
- Staging deploy frequency: per-PR vs on-merge-only
- Ableton/Qlab integration depth (read-only metadata vs two-way sync) — Phase 1+ feature

## [2026-04-19] — Polymorphic core: workspace + project + engagement (supersedes organization/contact/event model)
- **Decision**: Rewrite the schema around three concentric entities —
  1. **`workspace`** (replaces `organization`) with `kind` ∈ { `personal`, `team` }. Every user gets a personal workspace by default; teams are workspaces shared by membership.
  2. **`project`** gains a `type` ∈ { `show`, `release`, `creation_cycle`, `festival_edition` }. Replaces the need for per-artefact tables (no separate `release`, `tour`, `campaign`).
  3. **`date`** is the universal child of a project with `kind` ∈ { `performance`, `rehearsal`, `residency`, `travel_day`, `press`, `other` }. Replaces `event`.
 
  Contacts are split into a three-layer model:
  - **`person`** — global, cross-workspace identity (one row per real human, deduped on email).
  - **`engagement`** — per (person × project × workspace) row carrying the professional relationship (role, status, first_contacted_at, last_contacted_at, provenance). Replaces `contact_project` and the `contact_tier`/`contact_project_status` enums.
  - **`person_note`** — workspace-scoped note on a person with `visibility` ∈ { `workspace`, `private` }. Enables the "mine vs ours" separation called out in the research (`99-patterns.md §3.1`).
 
  Per-project permissions go through a new **`project_membership`** with `role` ∈ { `lead`, `collaborator`, `viewer` } and `scope text[]` drawn from { `dates`, `engagements`, `documents`, `notes`, `finance` }. The workspace-level `membership` gains a `guest` role for external collaborators scoped to one project only.
 
  Anti-CRM vocabulary becomes canonical: use `date`, `hold`, `letter_of_interest`, `programmer`, `promoter`, `gig`, `engagement`. Prohibited in schema, code, and UI: `lead`, `pipeline`, `funnel`, `conversion`, `deal`, `prospect`. `difusion-2026-27` is **not** a schema entity — it is a filtered view over `date` rows of the MaMeMi show where `date.status ∈ { tentative, held }` and the season matches.
 
- **Context**: Marco uploaded a 10-file research dossier on Hour's target profiles (theatre company, indie band, production company, self-managed band, solo artist, freelance distribution agent, tour technician, manager/booking agent) plus a cross-cutting synthesis. The existing schema — organization / contact / contact_project / event — has **five structural fractures** against what the research shows is actually needed:
  1. The research (`99-patterns.md §3.1`) documents a clean "mine vs ours" contact split across every profile. The current `contact` table has no concept of visibility scope — anyone with workspace access sees every note on every contact. This is a showstopper for the freelance-distribution and manager/booking-agent profiles, where the contact book *is* the business asset.
  2. Profiles 5, 6, 7, 8 (solo artist, freelance distribution, tour technician, manager) each work across multiple principals in parallel. They need one identity that can switch or aggregate across workspaces. The current model treats `organization` as the only top-level scope and has no place for a personal workspace. Research §5 calls this the "multi-tenant freelance reality".
  3. The current `event` table is music-tour-centric. Theatre and dance profiles' calendars mix performances, residencies, rehearsals, travel days, and press days as first-class rows; releases and festival editions share the same calendar primitive. A polymorphic `date` with a `kind` enum is the right generalization (research §8 thesis validation).
  4. `project` has no `type` discriminator. A show, a record release, a creation cycle, and a festival edition are all "projects" but have different timelines and different child sets. A `type` enum closes this without multiplying entity tables.
  5. Per-project permissions don't exist — today's `membership` is all-or-nothing per workspace. The research's manager-booking-agent profile (profile 08) needs `guest` collaborators who see exactly one project and nothing else. `project_membership.scope text[]` is the minimal surface that covers this.
 
  Marco's anchor for scope: *"quiero que lo estuvieras escribiendo y pensando como si fuera la primera vez que lo escribas. Si se rompen cosas, se rompen cosas. Es lo menos importante ahora mismo... haz absolutamente todo lo que has dicho incluido la ola 3."* → all three waves (vocabulary rename, polymorphic structure, engagement + private layer) ship in Phase 0 as a single destructive reset. No data to preserve (0 auth.users, 0 real rows — only the `mamemi` organization stub from an earlier manual seed).
 
- **Alternatives considered**:
  - **Iterative migration (Wave 1 → 2 → 3 across weeks)** — rejected. Marco's explicit instruction was to treat it as a first-write; also, the intermediate states (e.g. `contact` + new `person` coexisting) would double the RLS surface for a stretch of days and invite inconsistencies.
  - **Keep `organization`, add `personal` as a kind** — rejected. The word "organization" is wrong for a solo artist's personal workspace; the research shows the vocabulary matters to the target audience. Rename to `workspace` is cheap at zero users.
  - **`campaign` entity for Difusión-2026-27** — rejected. Marco corrected the model: a season's booking outreach is a filter over the show's pending `date` rows, not a separate artefact. Introducing `campaign` would create exactly the duplication the research warns against.
  - **Keep `event` and add `type` enum** — rejected in favour of renaming to `date`. Theatre/dance vocabulary universally says "fecha" / "date"; "event" in this audience implies a programmer-side listing, which conflates two different concepts.
  - **Per-entity visibility flags (`note.is_private boolean`)** — rejected in favour of a `visibility` enum on `person_note`. Enum leaves room for `team`/`workspace`/`project`/`private` gradations later; boolean would force a future ALTER.
  - **Include DIY bands (profile 04 — self-managed band) in Phase 0 import/seed** — rejected per research §10. DIY bands' workflow centres on DAW/streaming/merchandise tooling Hour does not serve. Phase 0 personas are: small-medium theatre/dance/circus company, freelance distribution agent, manager/booking agent, solo artist. Phase 1 re-evaluates DIY bands separately.
 
- **Rationale**:
  - **Cost is lowest now.** Zero auth.users, zero real data rows. The destructive reset is one MCP migration (`DROP ... CASCADE` + recreate). A month from now the same refactor is a days-long data migration; a quarter from now it is a rewrite.
  - **Schema encodes the business model.** The three-layer contact split and the personal/team workspace distinction are not implementation details — they are the research's primary finding. Shipping a schema that can't express them would force a rewrite before the first external user.
  - **Polymorphism via `type` + `kind` enums keeps table count down.** Four project types × one `project` table is still simpler than four parallel tables with shared-but-slightly-different columns. `date.kind` does the same for the calendar layer.
  - **`scope text[]` on `project_membership` is expressive enough.** Research profile 08 (manager) gave the concrete constraint: "see this one project's dates and engagements, but not finance, and not other projects". A text array of capability tokens checked in RLS helper `has_project_access(project_id, scope)` covers that without adding a capability table.
  - **Anti-CRM vocabulary is a product decision.** The research profiles (esp. 01 theatre company and 05 solo artist) explicitly reject CRM framing in interviews. Enshrining the vocabulary in the schema makes it impossible to drift: a column called `engagement_status` will get translated to "estado" in the UI, never "stage in the pipeline".
 
- **Table changes (one destructive migration)**:
  - **CREATE**: `workspace`, `date`, `person`, `engagement`, `person_note`, `project_membership`.
  - **RENAME/RESHAPE**:
    - `organization` → `workspace` (add `kind workspace_kind NOT NULL`, drop `type org_type`).
    - `project` gains `type project_type NOT NULL`; `status` stays.
    - `membership` gains `guest` as a new `membership_role` value.
  - **DROP CASCADE**: `contact`, `contact_project`, `event`, `rider`, `file`, `note`, `task`, `crew_assignment`.
  - **SURVIVE intact**: `audit_log`, `user_profile`, `tag`, `tagging`.
 
- **Enum changes**:
  - **ADD**: `workspace_kind` (`personal`, `team`), `project_type` (`show`, `release`, `creation_cycle`, `festival_edition`), `date_kind` (`performance`, `rehearsal`, `residency`, `travel_day`, `press`, `other`), `date_status` (`tentative`, `held`, `confirmed`, `cancelled`, `performed`), `engagement_status` (`idea`, `proposed`, `discussing`, `held`, `confirmed`, `cancelled`, `declined`, `performed`, `dormant`), `project_member_role` (`lead`, `collaborator`, `viewer`), `person_note_visibility` (`workspace`, `private`).
  - **DROP**: `contact_project_status`, `contact_tier`, `event_status`, `event_type`, `file_status`, `linkable_entity`, `notable_entity`, `org_type`, `task_section`.
  - **ALTER**: `membership_role` gains `guest`. `project_status` stays.
 
- **RLS and auth-hook contract**:
  - Rename helper `current_org_id()` → `current_workspace_id()`; `current_user_role()` → `current_workspace_role()`. Claim name changes from `current_org_id` → `current_workspace_id` in the JWT; `custom_access_token_hook` updated accordingly.
  - New helper `has_project_access(project_id uuid, scope text)` reads `project_membership` joined to workspace membership; called from RLS policies on `date`, `engagement`, `person_note`, and future per-project tables.
  - `person` is **global** (no `workspace_id`); readable to any authenticated user who has at least one `engagement` referencing the person, writable by the user who created the row plus any workspace the person is currently engaged with. (Enforced via policy, not via ownership column.)
  - `person_note` with `visibility='private'` is readable only by the author; `visibility='workspace'` follows the workspace membership rules.
 
- **Seed after migration**:
  - One workspace: `Marco Rubiol` (kind=`personal`, slug=`marco-rubiol`). Membership: Marco as owner.
  - One project inside it: `MaMeMi` (type=`show`, status=`active`, slug=`mamemi`).
  - The 156 contacts from the Difusión-2026-27 CSV re-seed as `person` rows (global, deduped on email) + `engagement` rows (workspace=Marco Rubiol, project=MaMeMi, status=`proposed`).
  - `Difusión 2026-27` has **no** row in any table. It is a saved UI filter: project=MaMeMi AND engagement.status IN (`proposed`, `discussing`, `held`) AND season=`2026-27`.
 
- **Impact on existing artefacts**:
  - `build/schema.sql` — rewritten from scratch (Task #22).
  - `build/rls-policies.sql` — rewritten from scratch (Task #23).
  - `build/auth-hooks.sql` — claim renamed `current_org_id` → `current_workspace_id`; read-target table renamed `membership` stays (workspace-level `membership` retains the name).
  - `build/architecture.md`, `_context.md`, `bootstrap.md` — updated to reflect new model (Task #28).
  - `scripts/03_load_to_hour.py` — emits `person` + `engagement` pairs instead of `contact` + `contact_project` (Task #26).
  - `apps/web/src/api/prospects.ts` → rename to `engagements.ts` (Marco applies in Windsurf — Task #27).
  - db-types.ts regenerated post-migration (Task #27).
 
- **Supersedes**:
  - **"Multi-tenancy from day one" (2026-04-18)** — the *principle* stands (tenant isolation at DB level from day one), but the tenant column is now `workspace_id`, not `organization_id`, and the JWT claim is `current_workspace_id`. The "2 extra lines per migration" promise holds.
  - **"Activate `custom_fields jsonb` columns in Phase 0" (2026-04-19)** — JSONB columns carry over onto the new tables: `person.custom_fields`, `project.custom_fields`, `date.custom_fields`. GIN index follows (`person.custom_fields`). `engagement.custom_fields` added for provenance (replaces the old `contact_project` ad-hoc fields).
 
- **Does NOT supersede**:
  - UUID v7 PK choice — stands.
  - Stack (Supabase / CF Workers / R2 / Astro+Svelte) — stands.
  - Auth flow (email+password + optional TOTP) — stands.
  - Region (eu-central-1) — stands.
  - Subdomain (hour.zerosense.studio) — stands.
 
- **How to apply**: Tasks #22 → #28 execute in order. Migration is one MCP `apply_migration` call with `DROP ... CASCADE` + full recreate. Rollback plan: none needed (0 real users, 0 real data). If recreation fails, restore from the `initial_schema` + `rls_and_audit` + `hardening_search_paths` + `policy_consolidation_and_fk_indexes` migration chain already in history.
 
- **Research citations**: `research/99-patterns.md` §3.1 (mine vs ours contact split — architectural requirement), §5 (multi-tenant freelance reality — workspace kind=personal|team), §6.1 (Phase 0/1 must-have features), §8 (polymorphic project thesis validation), §10 (headline recommendations, incl. DIY band exclusion from Phase 0).
 
- **Status**: Firm. Scope locked: no DIY-band profile handling in Phase 0, no `campaign` entity, no separate release/tour/festival tables. Wave-by-wave iteration explicitly rejected in favour of a single destructive reset.

## [2026-04-19] — ADR-001 — Engagement is a distinct entity from Show
- **Context**: The polymorphic reset earlier today introduced a single `engagement` row per (person, project, workspace) to carry the booking relationship. A later director review found that "the conversation" and "the actual gig" have different lifecycles: one engagement can produce 0, 1, or N shows (recurring venues, tours, follow-ups, conversations that never materialize). Without an explicit `show` entity, confirmed gigs had no place to live except by overloading `engagement` or `date` with venue/fee columns — conflating two distinct concepts.
- **Decision**: `engagement` persists and is bound to (person × project × workspace), carrying anti-CRM status. `show` is a separate atomic entity bound to (project, performed_at, venue_id). Holds without a confirmed date live in `engagement` (status=`hold`); holds with a date live in `show` (status=`hold`/`hold_1/2/3`). Shows connect back to their originating engagement through an optional `show.engagement_id uuid null` FK — standalone shows (cold bookings) are valid, engagements without shows are valid.
- **Alternatives considered**:
  - Conflate engagement and show into one table — rejected, forces every confirmed gig to overwrite the conversation history; can't model recurring engagements (same programmer, multiple seasons).
  - Make engagement a child of show (N:1) — rejected, inverts the natural timeline (conversation precedes gig, not the other way around).
  - Keep engagement only, add venue/fee columns on engagement — rejected, leaves N-shows-per-engagement unrepresentable and pollutes the engagement status enum with execution states (done/invoiced/paid) that belong to the gig.
- **Rationale**: Two lifecycles, two entities. Engagement status is about conversation state (`contacted, in_conversation, hold, confirmed, declined, dormant, recurring`). Show status is about execution state (`proposed, hold, hold_1/2/3, confirmed, done, invoiced, paid, cancelled`). Clean separation keeps both enums short and meaningful.
- **Consequences**:
  - Schema: new `show` table with `engagement_id uuid null` FK. `engagement.date_id` dropped (the linkage now lives on the show side).
  - RLS: `show` and `engagement` have independent permission checks (`edit:show` vs `edit:engagement`).
  - Import: the Mostra 2026 loader creates `engagement` rows (status=`contacted`) but no shows. Shows land as Marco confirms dates manually.
  - UI: two distinct views — "conversaciones" (engagement list) vs "calendario" (show calendar). A show detail view shows the parent engagement if any.
  - Docs: ARCHITECTURE §6 entity map, import-plan §3.5, bootstrap §4 count.
- **Status**: Firm.

## [2026-04-19] — ADR-002 — `show.status` with simple and prioritized hold variants
- **Context**: The performing arts industry uses two distinct "hold" semantics: (a) theatre/dance — a programmer blocks a slot tentatively while they work out the season; two "simple holds" on the same slot can coexist until one resolves; (b) music industry — holds are explicitly ranked (`hold 1`, `hold 2`, `hold 3`) by priority, where the `hold 1` has first right to convert to confirmed. Modelling only one of these two conventions would force Phase 1 music-industry customers (Phase 1 target: solo artists, booking agents) into awkward workarounds, or force theatre users (Phase 0) to pick an arbitrary priority number.
- **Decision**: Single enum `show_status` with values in lifecycle order: `proposed, hold, hold_1, hold_2, hold_3, confirmed, done, invoiced, paid, cancelled`. `hold` is the simple theatre/dance variant. `hold_1/2/3` covers prioritized music-industry holds. No UNIQUE constraint on `(project_id, performed_at, venue_id)` — two simple holds on the same slot coexist until one resolves. The UI adapts its affordances by workspace settings (`settings.booking_mode ∈ {simple, prioritized}`), but the enum supports both.
- **Alternatives considered**:
  - Separate `is_held bool` + `hold_priority int null` columns — rejected, scatters the state across two columns, breaks the clean lifecycle order useful for queries like `WHERE status >= 'confirmed'`.
  - Per-workspace hold conventions with pluggable enum — rejected, Postgres enums can't be per-tenant without a `text` column that loses type safety.
  - Two enums (`show_status` + `hold_priority_enum`) — rejected, doubles the state space and makes transitions harder to reason about.
- **Rationale**: One enum, lifecycle-ordered, covers both conventions without forcing a choice at the schema level. The absence of the unique constraint is what makes simple holds workable — two coexisting holds on the same slot is a valid business state.
- **Consequences**:
  - Schema: `show.status` is `show_status` enum with 10 values. No UNIQUE `(project_id, performed_at, venue_id)`.
  - UI: needs a setting at workspace level to pick the default booking mode; hold pickers and conflict indicators depend on that setting.
  - Reports: "confirmed or later" queries use `status IN ('confirmed','done','invoiced','paid')`; "any hold" uses `status LIKE 'hold%'` (careful with Postgres enum — use `status IN ('hold','hold_1','hold_2','hold_3')` in practice).
  - Migration in Phase 1: adding a fourth hold priority (`hold_4`) is a single `ALTER TYPE` — trivial.
  - Docs: ARCHITECTURE §11 decisions table, bootstrap smoke test.
- **Status**: Firm.

## [2026-04-19] — ADR-003 — Money lives in three tables (invoice, payment, expense) + `invoice_line` bridge
- **Context**: An earlier draft put fee columns directly on `show` (`fee_amount`, `fee_currency`) with status flags `invoiced`, `paid`. That shape breaks on three real scenarios: (1) **partial payments** — a booking typically pays 30% advance + 70% on the day; the show can't carry one amount and one paid_at. (2) **Multi-show invoices** — a tour of 8 shows is billed as one invoice with 8 line items; the shows can't each hold a fragment of the invoice. (3) **Tax retentions** — Spanish invoices separate subtotal, IVA (VAT), and IRPF (withholding); the show row would balloon with tax columns that rarely apply.
- **Decision**: Three first-class tables plus one bridge:
  - `invoice` — header row (number, issued_on, status, subtotal, vat, irpf, total, payer_person_id). Can reference a project (`project_id null`) or stand alone (workspace-level invoicing).
  - `invoice_line` — line item (invoice_id, show_id null, description, quantity, unit_amount, line_total generated). Multiple lines per invoice; lines optionally reference shows (tour billing) or describe other work.
  - `payment` — abono against an invoice (invoice_id, amount, received_on, method, reference). N:1 with invoice — supports advance + rest.
  - `expense` — cost incurred (category, amount, incurred_on, receipt_url, paid_by_user_id, reimbursed). CHECK constraint: exactly one of `show_id` OR `line_id` is set (never both, never neither) — grounds every expense in a project via the show/line chain.
  - Fee columns stay on `show` (`fee_amount`, `fee_currency`) as the **intended** price. The `invoice_line.unit_amount` is the **billed** price; they should usually match but can diverge (discount, tax recalc).
  - Column-level gating for `show.fee_*`: a trigger `guard_show_fee_columns` (BEFORE UPDATE) requires `has_permission('edit:money')` when fee columns change; a SQL view `show_redacted` hides the fee columns when the caller lacks `read:money`. Policy on the base table stays simple (`edit:show`) and the fee gate lives in the trigger — same pattern as the other `guard_*` triggers.
- **Alternatives considered**:
  - Fee columns on show + status flags for invoice/paid — rejected, breaks on all three scenarios above.
  - Single `transaction` table polymorphic by `kind` — rejected, loses the structural difference between an invoice (has tax breakdown) and a payment (has method); polymorphic tables hide shape at the cost of query clarity.
  - External billing system (Holded/Quaderno) from day 1 — rejected, Phase 0 doesn't justify an external integration; the `build/architecture.md` §10 already scopes this out.
- **Rationale**: Three clean entities that map to how a production company actually tracks money. `invoice_line` lets one invoice bill N shows — the tour-as-one-invoice pattern is common enough to deserve schema support. The fee columns on `show` capture "what we agreed on", which is different from "what we billed" and "what was paid" — shadowing all three is necessary for reconciliation.
- **Consequences**:
  - Schema: 4 new tables (invoice, invoice_line, payment, expense) + `show.fee_amount` / `show.fee_currency`.
  - RLS: `read:money` / `edit:money` permissions gate all four tables. `show` read-path has a `show_redacted` view that masks fee when caller lacks `read:money`; write-path has the `guard_show_fee_columns` trigger that blocks fee UPDATE without `edit:money`.
  - UI: invoice editor supports N lines; payment list hangs off invoice detail; expense list lives on show/line detail with a total roll-up.
  - Reports: "facturado pero no cobrado" = `SUM(invoice.total - payments)`. "Ingresos reales por proyecto" = `SUM(payments on invoices where invoice.project_id=X)`.
  - Docs: ARCHITECTURE §6 entity map, bootstrap count, import-plan (not affected — loader doesn't create money rows).
  - Spanish gestoría integration (Phase 2+): `invoice.number` is free-text so any numbering scheme fits (Holded, manual, custom).
- **Status**: Firm for Phase 0. Revisit invoice_line shape if Phase 1 needs multi-currency lines within one invoice (currently `invoice.currency` applies to the whole invoice).

## [2026-04-19] — ADR-004 — Reset v2 executes before any real data
- **Context**: Seven decisions (ADR-001..007) ship as a bundle. They touch tables, enums, RLS helpers, and the import pipeline. The alternative — shipping them incrementally over weeks — would require writing data migrations (rename `contact_project` → `engagement`, add `line`, split show from engagement) that each carry risk and require rollback plans. Current DB state: 0 auth.users, 0 real business rows (only the earlier polymorphic reset's table skeletons; the loader has not run).
- **Decision**: One destructive reset. `build/schema.sql` and `build/rls-policies.sql` are rewritten from scratch (the files become the canonical readable copy of the new DB). The applied migration is `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` followed by the full schema + RLS recreation. Marco signs up after the reset lands, the `custom_access_token_hook` is enabled manually, and only then the 156-contact loader runs against the new schema.
- **Alternatives considered**:
  - Incremental migrations — rejected, high coordination cost and no business value while the DB is empty.
  - Wave-by-wave rollout (rename first, then add tables, then RBAC) — same rejection as above, plus the intermediate states carry inconsistent RLS surfaces for days.
  - Branch DB and dual-write — rejected, pointless with zero data.
- **Rationale**: Zero data = zero data loss. The cost of the reset now is one migration; the cost of the same refactor in a month is a multi-day data migration; in a quarter, a rewrite. Ship the reset while the cost is still zero.
- **Consequences**:
  - Schema: supersedes parts of the earlier "Polymorphic core" ADR (table set and enums change; the three-layer contact model — person + engagement + person_note — survives unchanged).
  - Migration: single MCP `apply_migration` call replacing the prior history. No rollback plan needed.
  - Docs: every artefact under `build/*` gets a coherent "v2" stamp; README references bump.
  - Import pipeline: the loader ran pre-flight checks but never executed a real load; this is still the zero-loss window.
  - Bootstrap §4 table count shifts from 12 to 18.
- **Status**: Firm. Window closes the moment Marco signs up and runs the loader.

## [2026-04-19] — ADR-005 — `line` as its own table between project and show
- **Context**: A project is too coarse for many real groupings — a tour of 8 shows across Catalunya + Madrid + Valencia is one project (the MaMeMi show) but three distinct touring batches that each have a budget, a contact at a presenter, and a settlement window. Putting all 8 shows directly under the project loses that grouping; renaming `project` to mean "tour" breaks the polymorphic model. The research dossier profiles (tour manager, manager/booking agent) all manage tour-shaped objects.
- **Decision**: New table `line`, an optional middle layer: `(id, workspace_id, project_id, name, kind line_kind, territory, status, start_date, end_date, dossier_url, notes, custom_fields)`. `kind ∈ {tour, season, phase, circuit, residency, other}`. Show gets `line_id uuid null FK line` — shows without a line are valid (one-offs). Expense also gets `line_id uuid null FK` but with the CHECK `(show_id IS NOT NULL) XOR (line_id IS NOT NULL)` — an expense grounds in either a show or a line (tour-level hotel bills, season-level insurance), never both.
- **Alternatives considered**:
  - Use a tag on show (`tour: "Catalunya primavera 2026"`) — rejected, tags don't carry territory, dates, or dossier; and we already deferred the tag infrastructure to Phase 0.5.
  - Use `show.custom_fields.tour_name` — rejected, same problem, plus the grouping can't be queried or joined cleanly.
  - Create `tour`, `season`, `residency` as separate tables — rejected, multiplies schema for one structural pattern.
- **Rationale**: One table, one discriminator enum, covers all known grouping patterns in live-arts production. Optionality (`line_id nullable`) means small projects don't pay the overhead.
- **Consequences**:
  - Schema: new `line` table; `show.line_id` FK; `expense.line_id` FK with XOR CHECK against `show_id`.
  - RLS: `line` uses `edit:show OR edit:project_meta` — producers can manage lines without being project leads.
  - UI: a project with any line row shows a "tour/season" tab; without, the project shows flat show list.
  - Reports: "contribution margin per line" = `sum(invoice_lines on shows of line) - sum(expenses on line) - sum(expenses on shows of line)`.
  - Docs: ARCHITECTURE §6 entity map, bootstrap count, expense CHECK.
- **Status**: Firm.

## [2026-04-19] — ADR-006 — Editable role catalog (`workspace_role`) + granular RBAC + per-membership overrides
- **Context**: The v1 flat `membership_role` enum (`owner, admin, member, viewer, guest`) mixed two concerns: *workspace access level* (can I even enter this tenant?) and *what can I do inside a project* (can I edit shows? see money?). The research profiles (theatre company with external press, solo artist with a distribution collaborator) show real teams need fine-grained permissions per project — a press agent should read engagements but not money; a tour manager should edit shows but not manage memberships. Forcing every case into 5 flat roles misrepresents the real permission surface.
- **Decision**: Three-layer permission system, all living in the schema from day 1:
  1. **Workspace-level access (`workspace_membership.role`)**: keeps the flat `membership_role` enum as authority for *workspace entry*. `owner` and `admin` bypass all project-level permission checks (Phase 0: Marco and Anouk are owners and must see everything). The enum **is retained, not superseded** — `workspace_role` **complements** it, not replaces it.
  2. **Editable role catalog (`workspace_role` table)**: per-workspace list of named roles (`code, label, access_level, permissions text[], is_system bool, archived_at`). 15 system roles seeded on workspace creation via trigger `seed_system_roles_on_workspace` (owner, admin, producer, production_manager, tour_manager, distribution, director, author, technical_director, performer, light_design, sound_design, stage_design, costume_design, press). Users can add custom roles, archive unused ones, edit labels and permissions — even on system roles (system flag only prevents DELETE, not UPDATE).
  3. **Per-project assignment with overrides (`project_membership`)**: `roles text[]` (codes from `workspace_role` of the same workspace, validated by trigger), `permission_grants text[]` (extra perms on top), `permission_revokes text[]` (perms removed). Effective permissions = `union(role.permissions for role in roles) + grants - revokes`. Phase 0 UI only edits role presets; `permission_grants` / `permission_revokes` are schema-ready for Phase 0.5/1 when external collaborators need fine-tuning.

  Vocabulary of permissions is **closed and hardcoded** (not user-editable): 10 strings across 3 groups — read (`read:money, read:engagement, read:person_note_private, read:internal_notes`), edit (`edit:show, edit:engagement, edit:money, edit:project_meta, edit:membership`), admin (`admin:project`). The `owner` system role holds all 10 listed **explicitly** in its `permissions` array — no `*` wildcard, no magic. Helper `has_permission(project_id, perm)` does an exact-match scan over effective permissions; the only bypass is the workspace owner/admin fallback, which is explicit in the function body.
- **Alternatives considered**:
  - Keep the flat enum only — rejected, can't model press-reads-engagement-but-not-money without proliferating roles or adding side tables.
  - Full policy engine (Casbin / OPA) — rejected, operational overhead for a Phase 0 team of 2.
  - Wildcard `*` permission for owner — rejected, hides the permission surface behind magic; explicit list is auditable and makes migrations (add a permission) visible.
  - Make `workspace_role` global (not per-workspace) — rejected, each team wants to name roles their own way ("dramaturg" vs "literary manager"); per-workspace is the right scope.
- **Rationale**: The 10-permission vocabulary covers every access-control decision the Phase 0 and Phase 1 UI needs to make. `workspace_role` turns the vocabulary into team-editable presets. `project_membership.roles/grants/revokes` gives per-case flexibility without a UI for it yet. The owner/admin bypass keeps the Phase 0 team (Marco + Anouk) from tripping over their own permission checks while still enabling principled fine-grained access for external collaborators later.
- **Consequences**:
  - Schema: new `workspace_role` table, new enum `workspace_role_access_level`, `project_membership` refactored (drop role/scope, add roles/grants/revokes).
  - Triggers: `seed_system_roles_on_workspace` (AFTER INSERT on workspace, 15 rows with explicit permissions) and `validate_project_membership_roles` (BEFORE INSERT/UPDATE on project_membership, rejects unknown or archived codes).
  - RLS helper: new `has_permission(project_id, perm)` replaces most `current_workspace_role() IN (...)` checks. Explicit workspace owner/admin bypass documented in the function.
  - UI: Phase 0 only exposes role presets from the catalog; `permission_grants/revokes` exist but are not yet editable.
  - Auditability: `workspace_role` rows are in `audit_log`; role changes are traceable.
  - Docs: ARCHITECTURE §6 entity map, bootstrap helper count, plus this ADR as the canonical reference for the permission vocabulary.
- **Status**: Firm for the schema. UI for per-person overrides explicitly deferred (see "Deferred" section).

## [2026-04-19] — ADR-007 — Drop `project.type`; polymorphism comes from which subentities a project has
- **Context**: The earlier polymorphic reset added a `project.type` discriminator (`show | release | creation_cycle | festival_edition`). With `line`, `show`, and `date` now first-class children, the type tag becomes redundant: the adaptive UI can already tell what kind of project it is by looking at which child rows exist (any `line` rows → tour/season project; any `show` rows → performance project; only `date` rows → creation cycle; etc.). Maintaining a type tag in parallel with subentity presence creates two sources of truth that can drift (project marked `type=show` but has zero show rows).
- **Decision**: Drop `project.type` and the `project_type` enum entirely. Polymorphism is **emergent from subentity presence**, not declared up front. The UI inspects which children exist and adapts — "add a show", "add a tour", "log a rehearsal" — based on what the user does, not what the user declared.
- **Alternatives considered**:
  - Keep the type tag for quick filtering ("show me all releases") — rejected, the same filter works as "projects with `engagement` but no `show` yet" or via custom_fields conventions; not worth the type-drift risk.
  - Replace the enum with a view (`project_type_view`) that computes type from children — rejected, adds complexity for a UI affordance that doesn't need SQL-level support.
  - Keep type as a user-editable text field — rejected, invites inconsistent capitalisation and no-one will fill it out reliably.
- **Rationale**: Data model follows behaviour. If a project has shows, it's a show project — no additional declaration needed. Lets users mix (a creation cycle that also has a premiere tour without forcing "pick one").
- **Consequences**:
  - Schema: `project.type` column and `project_type` enum dropped. The `type` column in earlier migrations will be removed in the reset.
  - Import: `build/import/03_load_to_hour.py` no longer passes `type='show'` when upserting the mamemi project. Already flagged for Windsurf adjustment.
  - RLS: no change — project policies never branched on type.
  - UI: project detail is a single adaptive view; it shows the "Tour" tab only when `line` rows exist, the "Calendario" tab only when `show` or `date` rows exist, etc.
  - Partial supersession of the earlier "Polymorphic core" ADR — the three-layer contact model, workspace kind, and date/show split all stand; only the project type discriminator is retired.
  - Docs: ARCHITECTURE §6 entity map (remove `type` from project description), bootstrap (no `type` in seed SQL), import-plan §3.2.
- **Status**: Firm.

---

## Deferred

Explicit non-goals and schema-ready-but-UI-deferred items. Not addressed in the 2026-04-19 reset; captured here so they don't get lost.

### D1 — Tasks + Tags (Phase 0.5)
- **Scope**: `task` entity (polymorphic by `entity_type`, attaches to project/line/show/date/engagement or sits free at workspace level) with the `dispatch → queue → ping → deferred → shelf → trace` taxonomy already established in `_methød/markdown.md`. Tag vocabulary split in three groups: (a) event kinds — already covered by `date.kind` and `show.status`, no new column; (b) work categories — `#creative`, `#admin`, `#logistics`; (c) cross-cutting behaviour triggers — `#billable`, `#contract`, `#urgent`. Per-workspace tag catalog + polymorphic tagging join table restricted by a `taggable_entity` enum.
- **Why deferred**: Phase 0 runs without tasks (ad-hoc todos live in Marco's `.zerø` _tasks.md and in `engagement.next_action_*` if we add it back). Tags are a Phase 0.5 convenience; reintroducing them now bloats the reset scope.
- **Trigger to activate**: first external user, or first time Marco repeatedly needs to group persons/projects by a property that custom_fields can't cover cleanly.

### D2 — UI for per-person permission overrides
- **Scope**: Visual editor for `project_membership.permission_grants` / `permission_revokes`. Lets an admin grant "press agent sees money on this one project" or revoke "tour manager can't edit membership on this one tour".
- **Why deferred**: Schema supports it from day 1 (ADR-006); UI in Phase 0 only edits role presets because the team is Marco + Anouk and they don't need per-person fine-tuning. Phase 0.5 or Phase 1 when external collaborators join.
- **Trigger to activate**: first external collaborator who needs a permission the role preset doesn't cover.

### D3 — Task entity (Phase 0, pre-UI)
- **Scope**: `task` table with polymorphic association (`project_id`, `line_id`, `show_id`, `engagement_id` — all nullable, at most one set). `origin` field: `manual | protocol | ai`. Manual tasks ship in Phase 0; protocol-driven tasks (automated from engagement lifecycle rules) in Phase 0.5; AI-suggested tasks in Phase 1+.
- **Why included in Phase 0**: Without tasks, the Desk view (primary screen) has no actionable content. Tasks are the backbone of the daily workflow for every research profile.
- **Trigger for protocol layer**: after 3+ months of manual task usage reveals which patterns Marco actually repeats.

### D4 — Communication layer (Phase 1+)
- **Scope**: Unified communication view (email, text, WhatsApp, calls) contextualised by House/Room/engagement. Filterable by the same sidebar filters as all other lenses. Not a CRM "activity feed" — a conversation view tied to the engagement lifecycle.
- **Why deferred**: Requires email integration (IMAP or provider API), WhatsApp Business API, call logging. Heavy infrastructure for Phase 0.
- **Trigger to activate**: Phase 1 kickoff, or when Marco's daily workflow repeatedly requires switching between Hour and Gmail to track the same conversation.

## [2026-04-20] — ADR-008 — Product vocabulary: House · Room · Run · Gig + Desk lens
- **Context**: Schema entity names (`workspace`, `project`, `line`, `show`) are technically correct but don't resonate with performing-arts professionals. The research across all 8 profiles shows that vocabulary determines whether users feel the tool is "for them" or "borrowed from another sector." A naming session on 2026-04-19/20 explored 15+ alternatives for the 3-level hierarchy (project → line → show), testing each against all 8 research profiles. Key findings: (a) Room fits the show/piece better than the company — theatre people think in shows, not companies; (b) the company/collective level already exists as `workspace` but needed a name; (c) "gig" is the universal word for an individual performance event across all profiles; (d) the primary UI view needed its own name.
- **Decision**: Four-level product vocabulary mapping to existing schema entities, plus one UI lens name:
  - **House** = `workspace` = the company, collective, or personal brand. Organisational boundary. Examples: "MaMeMi", "La Veronal", "Marco Rubiol".
  - **Room** = `project` = the show, piece, album, or production. The creative/commercial unit. Examples: "De què parlem...", "Espectáculo A", "Album 3".
  - **Run** = `line` = a grouping of gigs within a room. A tour, season, festival circuit, residency block. Examples: "Gira Catalunya primavera", "Festival run summer 2026", "Residència Aarhus".
  - **Gig** = `show` = a single performance event at a venue on a date. The atomic unit. Examples: "Teatre de l'Aurora, 9 mayo, €2.400".
  - **Desk** = the primary UI lens (the "Today/Home" view). What's on your plate — tasks, upcoming gigs, pending money, waiting items. Named to extend the house metaphor (House → Room → Desk = where you sit to work).
- **Vocabulary coherence**: House, Room, and Desk share a spatial/domestic metaphor (the planning space). Run and Gig are action/sector-native words (the execution space). The split is intentional: planning happens inside the house; execution happens outside. Both register types are monosyllabic, physical, and informal.
- **Alternatives explored and rejected**:
  - *Project · Line · Show* — technically accurate but generic; "line" means nothing in performing arts vocabulary.
  - *Project · Block · Show* — "Block" is neutral but cold; no emotional resonance.
  - *Project · Season · Show* — "Season" doesn't fit short tours or residencies.
  - *Project · Leg · Show* — "Leg" only works for touring; excludes non-touring profiles.
  - *Work · Arc · Show* — "Work" is good but "Arc" is too literary for daily use.
  - *Piece · Wave · Gig* — "Wave" is poetic but operationally unclear.
  - *Score · Movement · Beat* — too musical; excludes theatre/dance profiles.
  - *World · Path · Stop* — "World" is grandiose for small projects.
  - *Desk · Thread · Spot* — "Desk" as top level conflicts with its better fit as the UI lens name.
  - *Room · Set · Gig* — "Set" has too much technical theatre baggage (stage set, set list, DJ set).
  - *Room · Run · Show* — "Show" is good but less universal and informal than "Gig"; Marco confirmed "Gig" resonates better.
  - 3-level model with Room = company — rejected by Marco; Room must be the show/piece, which elevated the workspace to a named entity (House).
  - Not naming the workspace level — rejected; the sidebar groups rooms by house, so the house needs a label.
  - *Now* for the primary lens — rejected, too urgent/pressured.
  - *Home* for the primary lens — rejected, confuses with homepage and with House.
  - *Plate* for the primary lens — rejected, too informal and not spatial.
- **Validation against all 8 research profiles**:
  - Profile 01 (theatre/dance co): House = La Calòrica, Rooms = each piece in repertoire, Runs = tours/seasons, Gigs = performances. ✓
  - Profile 02 (indie band): House = the band, Room = the album/show project, Runs = tour legs/festival circuits, Gigs = individual concerts. ✓✓ (native vocabulary)
  - Profile 03 (label/agency): Houses = workspace per artist on roster, Rooms = each artist's active projects, Runs = tour campaigns, Gigs = bookings. ✓
  - Profile 04 (DIY band): House = the band (single), Room = the show, Run = mini-tour, Gig = the gig. ✓ (excluded from Phase 0 but vocabulary fits)
  - Profile 05 (solo artist): House = personal brand, Room = each piece/monologue/choreography, Runs = touring blocks, Gigs = dates. ✓
  - Profile 06 (freelance distributor): Houses = each represented company (COLLABORATING in sidebar), Rooms = shows being distributed, Runs = seasonal campaigns, Gigs = booked dates. ✓✓ (multi-tenant native)
  - Profile 07 (tour technician): Houses = companies worked for (COLLABORATING), Rooms = shows assigned to, Runs = touring blocks, Gigs = individual show calls. ✓ (also full user, not just invitee)
  - Profile 08 (manager/booking agent): Houses = workspace per artist, Rooms = each artist's active projects, Runs = tours/festival circuits, Gigs = bookings. ✓
- **Schema mapping** (no schema changes required — this is a vocabulary layer):
  - `workspace` → House (UI label, API documentation, user-facing copy)
  - `project` → Room
  - `line` → Run
  - `show` → Gig
  - Code-level: schema retains technical names (`workspace`, `project`, `line`, `show`). Product vocabulary (House, Room, Run, Gig) appears in UI labels, API documentation, user-facing copy, and onboarding. Internal code may use either; public-facing always uses product vocabulary.
- **Consequences**:
  - UI: sidebar groups Rooms under House headers. Lenses (Desk, Calendar, Contacts, Money) respect active House/Room filter.
  - Onboarding: "Create your first House" → "Add a Room" → "Plan a Run" → "Book a Gig".
  - Documentation: all user-facing docs use product vocabulary. Technical docs (schema, RLS) keep DB names.
  - Marketing (Phase 1): vocabulary becomes brand identity — "the tool that speaks your language."
- **Status**: Firm.

## [2026-04-20] — ADR-009 — UI architecture: single view + filter sidebar + lens tabs
- **Context**: Traditional SaaS navigation uses separate pages per section (Contacts page, Calendar page, etc.). During UI exploration on 2026-04-19/20, Marco proposed a filter-first model inspired by the WPML Etch plugin he built: the main content area is always "the view," and it changes dynamically based on two axes of control — what type of information you see (lens) and what context you filter by (sidebar). This eliminates the "which page am I on?" problem and makes the sidebar a universal filter rather than navigation.
- **Decision**: Two-axis UI architecture with a **dual-mode sidebar** (filter in most lenses, destination in Desk):
  1. **Lenses** (sidebar, top section): Desk, Calendar, Contacts, Money — determines *what type* of content is displayed. Lenses live in the sidebar (not as top tabs) to allow unlimited future expansion (Comms, Archive, Files, Reports) without layout changes. Each lens shows the same data pool through a different presentation.
  2. **Sidebar entities** (sidebar, bottom section): flat list of Houses, each containing Rooms. No MY HOUSES / COLLABORATING separation — all houses listed equally regardless of user's role (owner, member, or guest). Role information lives inside house settings, not in navigation. Houses ordered by recent activity or user preference. Archived houses/rooms are collapsed but accessible (one click to reactivate). Room count badges show active gig count.
  3. **Dual-mode sidebar interaction** — the sidebar behaves differently depending on the active lens:
     - **Desk + nothing selected** = panoramic view ("Hello Marco, everything on your plate") — tasks, upcoming gigs, pending money, waiting items across all houses. Each item shows its House indicator (colored dot + name).
     - **Desk + House selected** = **House detail view** — the House's rooms, aggregate stats, recent activity. This is a destination, not a filter.
     - **Desk + Room selected** = **Room detail view** — the Room's full profile: runs, gigs, assets (riders, dossiers, QLab sessions, Ableton sessions, stage plots, photos, videos), team, about. Assets live here because they belong to the show/piece, not to the company or user. Assets can be Room-level (canonical, used for all gigs) or Gig-level (per-venue adaptations). This is a destination, not a filter.
     - **Calendar + House selected** = filter — only gigs from that House's rooms.
     - **Calendar + Room selected** = filter — only gigs from that Room.
     - **Contacts + House selected** = filter — only persons with engagements in that House.
     - **Contacts + Room selected** = filter — only persons with engagements in that Room.
     - **Money + House/Room selected** = filter — only invoices/expenses for that scope.
     Summary: **Desk treats sidebar selections as destinations (detail views). All other lenses treat sidebar selections as filters.**
  4. **Filters persist across lens switches** with context adaptation. If MaMeMi Room A is selected and you switch from Desk (showing Room A detail) to Calendar, the calendar shows only Room A's gigs. Switching back to Desk returns to Room A's detail view.
  5. **⌘K command palette** is a first-class navigation element from day 1. Must support: switching houses, switching rooms, jumping to a specific gig/person/run, switching lenses, executing actions (create gig, add task). Power users should be able to hide the sidebar entirely and navigate exclusively via ⌘K.
- **Sidebar layout**:
  ```
  Desk            ← active lens (highlighted)
  Calendar
  Contacts
  Money
  ────────────
  ● MaMeMi        ← houses, flat list, no ownership grouping
    Room A    3
    Room B    2
  ● Kairos
    Room C    1
  ● La Veronal
    Room X    5
  ● Co C [arch]
  ────────────
  Marco Rubiol
  ⌘K · search
  ```
- **Room detail view (Desk + Room selected)** has tabs within the content area:
  - **Work** — runs, gigs, tasks for this room
  - **Assets** — riders (versioned), dossiers (multi-language), stage/lighting/sound plots, QLab sessions, Ableton sessions, photos, videos, press kit. Each asset tracks: current version, upload date, uploader, last sent (to whom, when). Assets are Room-level by default; Gig-level variants exist for per-venue adaptations (e.g., "Rider adapted for Teatre Lliure").
  - **Team** — project_membership for this room
  - **About** — description, tags, creation date, status
- **Why assets live in Room, not as a lens**: Assets don't have a meaningful cross-house view. Nobody needs "all riders from all companies." A rider belongs to a show. A QLab session belongs to a show. Cross-cutting views (Calendar, Contacts, Money) are lenses; entity-bound content (assets, team) lives inside the entity's detail.
- **Alternatives considered**:
  - Separate pages per section (Contacts page, Calendar page, etc.) — rejected, creates "where am I?" confusion.
  - Sidebar as pure filter everywhere — rejected; Room detail (assets, team, about) doesn't make sense as filtered Desk content. The Room IS a destination when you need to manage its assets.
  - Sidebar as pure navigation everywhere — rejected; Calendar filtered by Room is not a "Room calendar page," it's the same calendar with a scope.
  - Lenses as top tabs instead of sidebar — rejected; tabs don't scale beyond 5-6 items. Sidebar scales to 8+ lenses. Also consolidates all controls in one panel.
  - MY HOUSES / COLLABORATING grouping in sidebar — rejected by Marco. The user's role doesn't affect how they navigate; all houses are peers in the sidebar.
  - No sidebar option as default — rejected, but ⌘K-only mode is supported for power users who prefer minimal UI.
- **Rationale**: The performing-arts professional works in two modes: (a) "everything at once" (Monday morning, what's on my plate across all houses) and (b) "deep in one show" (managing the assets and team of a specific piece). The dual-mode model supports both without page switches. Desk absorbs the "detail page" function, eliminating the need for separate project/show pages. ⌘K ensures keyboard-first users are never blocked by the UI structure.
- **Consequences**:
  - Frontend: single layout component with sidebar (lenses + houses) and content area. Content area renders based on `(active_lens, selected_entity)` tuple. Desk lens has three render modes: panoramic (nothing selected), house detail, room detail. Other lenses have one render mode each with optional filter.
  - State management: `(lens, house_id?, room_id?, run_id?)` in URL params. Persists across lens switches. Lens switch preserves entity selection but changes render mode.
  - Assets: stored in R2, metadata in a future `asset` table (or `file` table) with `room_id` + optional `gig_id`. Versioning is append-only (new version = new row with same `asset_group_id`, latest = highest `version`).
  - ⌘K: requires indexed search across houses, rooms, runs, gigs, persons, tasks, assets. Supabase full-text search or client-side index.
  - Responsive/mobile: sidebar collapses to a drawer; ⌘K becomes primary navigation on mobile.
  - Performance: panoramic Desk (no filter) must load efficiently across all houses — requires proper RLS + pagination.
- **Status**: Firm for the architecture. Lens list (Desk, Calendar, Contacts, Money) is firm for Phase 0. Future lenses (Comms, Archive) add a sidebar line each — no layout changes needed.

## [2026-04-20] — ADR-010 — View modes: calendar primary, kanban and timeline as complementary views

- **Context**: UX research (UX-PATTERNS-RESEARCH.md) showed that no competitor uses kanban for bookings — calendar + table is the validated pattern. However, Marco identifies a real use case: when you sit down to work on difusion, you want a board view of "what needs my attention" organized by status, not by date. Additionally, a timeline view is needed for visualizing task chains that cascade backwards from a date (e.g., a gig on May 5 auto-generates prep tasks going back weeks).
- **Decision**: Three complementary view modes available within relevant lenses:
  1. **Calendar** (primary) — the default. Shows dates, gigs, events on a time grid. Status encoded via color (contacted=neutral, in_conversation=warm, hold=amber, confirmed=green, declined=muted, dormant=gray). Minimum views: month + list. Year and week views in Phase 0.5.
  2. **Kanban/Board** (work mode) — available in Desk and Contacts lenses. Groups engagements/tasks by status columns. For when you sit down to work and need "what do I need to do?" not "what's happening when?". This is a work tool, not the primary navigation.
  3. **Timeline** (planning mode) — horizontal or vertical timeline showing cascading task chains. When a gig is created on a date, the system generates prep tasks backwards (send dossier → follow up → confirm details → send rider → etc.). Timeline makes these chains visible. Also useful for fair/event preparation chains.
- **Key principle**: these are views of the same data, not separate sections. Switching view mode doesn't change what data you see — it changes how you see it.
- **Status**: Firm on calendar as primary. Kanban and timeline are Phase 0.5 — they depend on the `task` entity (D3) which isn't built yet.

## [2026-04-20] — ADR-011 — Automatic task chains from events (protocol tasks)

- **Context**: Marco identifies a core workflow: when a potential gig is placed on May 5, a series of prep tasks should auto-generate backwards from that date (send dossier 8 weeks before, follow up 6 weeks before, confirm tech details 4 weeks before, send rider 2 weeks before, etc.). Same pattern applies to fairs: when a fair date is set, tasks generate for pre-fair outreach, attendee research, post-fair follow-ups.
- **Decision**: Implement "task protocols" — reusable templates that define chains of tasks with relative date offsets from a trigger event.
  - A protocol is a named sequence: e.g., "Difusion outreach" = [{task: "Send dossier", offset: -56d}, {task: "Follow up #1", offset: -42d}, {task: "Confirm tech", offset: -28d}, {task: "Send rider", offset: -14d}]
  - When a gig/date is created or moved, linked protocol tasks recalculate their dates automatically
  - Protocols are per-Room or per-House (some are show-specific, some are company-wide)
  - The `task` entity (D3) already specifies `origin: manual/protocol/ai` — protocol tasks have origin=protocol and link back to their source event
- **Depends on**: D3 (task entity)
- **Status**: Firm on concept. Protocol structure TBD when D3 is designed.

## [2026-04-20] — ADR-012 — Fair/event intelligence: attendee cross-referencing

- **Context**: When a fair (e.g., Mostra Igualada) approaches, Marco wants to: (1) import the list of attending professionals (CSV or even a screenshot processed by AI), (2) cross-reference against existing contacts in Hour, (3) see matches ("these 15 people you already know are attending"), (4) discover new contacts to reach out to. This is a core difusion workflow.
- **Decision**: Support fair attendee cross-referencing:
  - A "fair" is a special type of date/event with an attendee list
  - Attendee import: CSV upload (structured), image/screenshot upload (AI extraction via vision model)
  - Cross-reference engine: fuzzy match imported names/organizations against `person` table (name, organization, city)
  - Output: matched (existing engagement), unmatched (potential new contact), and confidence scores
  - Matched contacts get a flag: "Attending [Fair Name]" — visible in their engagement record and in the Contacts lens filter
- **DB implications**: May need a `fair` entity or a `date.kind = 'fair'` with an `attendees` junction table, or simpler: store attendee lists as engagement metadata. TBD during D3/schema work.
- **Depends on**: AI integration strategy, task entity (D3)
- **Status**: Concept firm. Implementation design pending.

## [2026-04-20] — ADR-013 — AI integration philosophy: invisible helper, never imposer

- **Context**: Marco wants AI deeply integrated but as a helper — it suggests, automates, surfaces information, but never takes over or forces decisions. Research pending (AI-RESEARCH.md) on how Linear, Notion, Height, Attio, etc. handle this.
- **Decision**: AI in Hour follows the "invisible helper" principle:
  - **Suggests, doesn't impose**: AI surfaces suggestions (next action, draft email, contact enrichment) as dismissible hints, never as mandatory steps
  - **Works in background**: enrichment, classification, summarization happen automatically but results appear as suggestions until confirmed
  - **Contextual, not chatbot**: AI appears inline where relevant (in an engagement card, in a task, in a contact profile), not as a separate "AI assistant" panel or chat window
  - **Examples of intended AI use**:
    - Auto-enrich new contacts (find organization, role, social links from name+email)
    - Suggest next action on an engagement based on status and time since last contact
    - Extract structured data from screenshots/PDFs (fair attendee lists, venue specs)
    - Draft follow-up emails based on engagement context and communication history
    - Detect scheduling conflicts and suggest alternatives
    - Summarize communication threads
  - **What AI should NOT do**: auto-send messages, auto-change statuses, auto-create gigs without confirmation, make decisions on behalf of the user
- **Status**: Philosophy firm. Feature list and implementation order pending AI research results.

## [2026-04-20] — ADR-014 — Theme: light mode primary, dark mode available

- **Context**: UX research showed dark mode is the industry default in booking/music tools. However, Marco explicitly prefers light mode as primary, with dark mode as a user-selectable option. His product, his call — and it differentiates from the dark-default competitors.
- **Decision**: Light theme is the default. Dark theme is available as user preference. No system-auto-detection for Phase 0 — explicit toggle.
- **Status**: Firm.

## [2026-04-20] — ADR-015 — Mobile: creation capabilities for distributors

- **Context**: UX research suggested mobile should be consumption-only. Marco corrects: if the user is a distributor or booking agent on the road (at a fair, in a meeting), they need to create contacts and update engagement statuses from mobile. "Consultation only" is too limiting.
- **Decision**: Mobile supports creation of core entities (contacts, engagements, status changes, notes, call logs) — not just viewing. Full complex workflows (invoice creation, protocol setup, asset management) remain desktop. Mobile creation is streamlined: minimal fields, smart defaults, expand later on desktop.
- **Status**: Firm.

## [2026-04-20] — ADR-016 — Calendar is native, not integration-dependent

- **Context**: Integration research (16-integration-ecosystem.md) prioritized Google Calendar sync as #1. Marco corrects: Hour must have its own calendar as a first-class feature. The user shouldn't need Google Calendar — they should have a complete calendar inside Hour. Google Calendar sync is an OPTIONAL integration for people who want it, not the foundation.
- **Decision**: Hour's calendar is native and self-sufficient. Users can manage all their dates, gigs, rehearsals, travel inside Hour without any external dependency. Google Calendar / .ics sync is available as an optional export/import — not required for core functionality.
- **Broader principle**: Hour should do everything it needs to do natively. Integrations are bridges to existing workflows, not crutches for missing features. Every integration adds complexity — add only when the value clearly outweighs the cost. "Lo más sencillo del mundo" is the north star.
- **Status**: Firm.

## [2026-04-20] — ADR-017 — Integration philosophy: simplicity over connectivity

- **Context**: Marco flags that adding integrations isn't always better. The tool should be simple first. Each integration adds UI, settings, edge cases, support burden. The temptation to "connect everything" can destroy the simplicity that makes a tool lovable.
- **Status**: Firm.

## [2026-04-20] — ADR-018 — Skin-ready architecture (design tokens from day 1)

- **Context**: During design exploration in Stitch (Google) and Claude, Marco produced multiple visual directions: "Analogue" (warm, amber, textured, backstage feel — appeals to technicians), "Modern" (clean, minimal, refined — appeals to distributors/agents), and a Desk mockup with serif headings and warm off-white that sits between both. Marco observes that different user profiles will gravitate toward different aesthetics. A skin/theme selector is inevitable, but premature for Phase 0.
- **Decision**:
  1. **All visual properties go through design tokens from day 1**: colors, typography (families, sizes, weights), border-radius, spacing scale, textures/noise, shadow styles, density levels. No hardcoded visual values in components.
  2. **Launch with ONE skin** (the warm default: light background, serif headings, subtle texture, color-for-state). Light + dark variants of this skin.
  3. **Skin selector is a Phase 1+ feature**: when user base reaches 30-50 and profile distribution is clear, introduce 2-3 skins (e.g., Backstage/amber for technicians, Studio/clean for distributors, Stage/dark for performers). Can tie to persona selection in onboarding.
  4. **Technical requirement**: switching skin = swapping a token file. No component changes, no layout changes. CSS custom properties or equivalent.
- **Rationale**: Preparing costs nothing (good CSS hygiene). Launching multiple skins multiplies testing, screenshots, docs. The token architecture is the investment; the skins are free once it exists.
- **Status**: Firm on token architecture. Skin selector deferred to Phase 1+.
- **Decision**: Integrations are evaluated with a high bar:
  1. Does this eliminate a painful manual step that happens daily? (not weekly, not monthly — daily)
  2. Can we solve it natively instead? (if yes, prefer native)
  3. Does it add complexity to the UI? (if yes, it better be worth it)
  - Phase 0: ZERO integrations. Everything native. Prove the tool works standalone.
  - Phase 1: Only integrations that early adopters explicitly request after using the tool.
  - The 5 integrations identified in research (16-integration-ecosystem.md) are a menu of options, not a roadmap. Each one must pass the bar above before building.
- **Status**: Firm.

## [2026-04-20] — ADR-019 — Decision windows as AI-inferred field, not standalone feature

- **Context**: Explored three creative differentiators for Hour vs the competition. One was "Decision Windows" — the idea that each programmer decides their next season's program at a specific time of year, and Hour could learn that pattern and surface optimal contact timing. Marco's reaction: this isn't a differentiator, it's a basic function of AI-as-helper. The AI should observe when you contacted someone, when they responded, when they closed — and fill in a `decision_window` field automatically. The user sees the data and decides.
- **Decision**: Decision windows are an AI-inferred field on `person` (or `engagement`), not a standalone feature or selling point. The AI observes contact/response/close patterns over seasons and surfaces the inferred window transparently. The user always sees the reasoning ("based on 2 seasons of contact history, this programmer decides between January and March").
- **Rejected framing**: Marketing it as a "strategic intelligence" differentiator. It's table stakes for an AI-assisted tool — the AI fills fields, the user decides.
- **Connects to**: ADR-013 (AI invisible helper philosophy). This is a concrete instance of "AI fills, user confirms."
- **Status**: Firm on the principle. Implementation deferred until enough seasonal data exists (2+ seasons of engagement history per programmer).

## [2026-04-20] — ADR-020 — "Generate dossier draft" from real data (Show Biography evolution)

- **Context**: The "Show Biography" differentiator (auto-generated history of a show: venues played, dates, press, festivals) resonated with Marco but he identified the real value: not the biography itself, but a **"Create draft ficha/dossier"** button that compiles real Hour data into a first draft of the show's difusion document. The dossier is what gets sent to programmers — today it's manually assembled once a year (if at all).
- **Decision**: Room detail view (Assets tab) will have a "Generate dossier draft" action that:
  1. Pulls real data from Hour: gig history (venues, cities, countries, dates), run summaries, engagement stats (X gigs in Y venues across Z countries), notable festivals/venues
  2. Combines with Room metadata: description, team credits, press links, photos
  3. Produces an editable first draft (not a final document) that Marco reviews, adjusts, and exports as PDF or shareable link
  4. The draft updates itself as new gigs are confirmed — but never overwrites manual edits (append-only suggestions: "3 new gigs since last export, add them?")
- **What this is NOT**: An auto-updating live page (the "biography" concept). It's a **draft generator** — a tool that saves hours of manual dossier assembly. The human always edits the final version.
- **Rejected alternative**: Structured rider matching (machine-readable rider fields that auto-match venue specs). Marco judged this doesn't work in the real world — technicians work with PDFs and phone calls, not structured data exchange.
- **Connects to**: ADR-013 (AI as invisible helper — draft generator is the "puntual and explicit" AI pattern, vs decision windows which is the "continuous and invisible" pattern).
- **Status**: Firm on concept. Implementation depends on having enough gig data in Hour to make the draft meaningful. Phase 0.5 at earliest.

## [2026-04-20] — ADR-021 — AI-touched fields: visual distinction + accept/dismiss UX

- **Context**: Marco identifies that if AI fills a field, the user must be able to see at a glance that it was the AI — not a human — who wrote that value. And depending on context, the user should explicitly accept or dismiss the suggestion before it becomes "real" data.
- **Decision**: Two tiers of AI contribution, each with its own visual and interaction pattern:
  1. **Low-stakes enrichment** (contact city inferred from organization, decision window inferred from history): the field shows the AI-suggested value with a **visual marker** (subtle styling distinction — e.g., different text treatment, small indicator icon). The value is usable immediately but visually flagged as "AI-suggested" until the user edits it or explicitly confirms it. No blocking modal, no mandatory accept step. If the user edits the field, the AI marker disappears — the human value replaces it.
  2. **High-stakes generation** (dossier draft, email draft, bulk status suggestions): requires an **explicit accept/dismiss** action before the content is saved or sent. The generated content appears in a review state — the user reads, edits if needed, and hits accept. Dismiss discards it. Nothing is committed without the user's explicit action.
- **Visual language**:
  - AI-suggested values get a consistent visual treatment across the entire app (same marker everywhere — not a different pattern per feature). Exact styling TBD during design phase, but the principle is: **one glance tells you "AI wrote this"**.
  - Once accepted (explicitly or by editing), the value becomes indistinguishable from human-entered data. No permanent "AI" badge — the point is trust, not traceability.
  - Data model: fields that support AI suggestions carry an `ai_suggested` metadata flag (in `custom_fields` or a parallel structure). Flag clears on human edit or explicit accept.
- **Connects to**: ADR-013 (invisible helper), ADR-019 (decision windows as AI-inferred field), ADR-020 (dossier draft as explicit generation).
- **Status**: Firm on the two-tier principle. Visual design and data model details deferred to implementation.

## [2026-04-24] — ADR-022 — URL architecture: three levels, canonical routes, shareable views

- **Context**: With the composable UI model defined in ADR-009 and refined 2026-04-24 (Plaza + Desk + Views + chip bar + multi-select), any combination of selections is potentially "app state". Open question was how to structure URLs: encode everything (noisy history, frágil sharing) or encode nothing (nothing shareable). The answer is neither — separate what deserves URL from what doesn't. The road sheet (ADR-023) surfaced the question concretely: it needs shareable URLs, including public signed links for external recipients.
- **Decision — three levels of URL-ness**:
  1. **Ephemeral session state — NOT in URL.** Plaza/Desk selections, chip bar state, scroll, hover, checkbox-on-hover state. Lives in memory + `localStorage`. If URL-encoded, every click pushes history and sharing URLs becomes fragile.
  2. **Canonical entity URLs — in URL, stable, shareable.** Each first-class entity has a canonical URL. Opening it reconstructs a reasonable state (selects entity in Plaza/Desk, activates the default lens for that entity type) but does NOT arrange the viewer's previous filters or chip bar. Use: *"mira esto"*.
  3. **View-state URLs — in URL, but only by explicit gesture.** When the user wants to share a specific filtered view (e.g., "Calendar of Ombra, May 2026, only confirmed"), a **"Copy link"** action serializes the filters into querystring. Never automatic. Master View (see `project_hour_layout_decisions.md`) stays in `localStorage` unless the user explicitly shares its URL.
- **URL schema**: `/h/:workspace-slug/:entity/:slug-or-id`.
  - Multi-tenant path prefix `/h/:workspace-slug/` — **not subdomain-per-tenant** in Phase 0. Subdomain can come later if Phase 1 demands.
  - Entities with canonical URLs in Phase 0: `house` (workspace), `room` (project), `run` (line), `gig` (show), `engagement`, `person`, `venue`, `asset`. Road sheet is a sub-view of `gig`, not its own route (see ADR-023): `/h/:workspace/gig/:slug/roadsheet`.
  - Slugs: human-readable where meaningful (`ombra/spring-2026-tour`), UUID v7 fallback when none exists. Unique per `(workspace, entity_type)`. Slug collision rules finalized at implementation.
- **Public access — signed links**: Phase 0 supports signed-token public URLs for road sheet only (partial D6 activation). Format `/public/roadsheet/:signed-token`. Other entities defer to full D6.
- **Role-aware URLs**: optional `?role=` query param filters visible fields via RLS-backed views. Same URL, different content by viewer role. Mechanism: Postgres RLS policies + read-only views layered on top of ADR-006's 10-permission RBAC.
- **Rejected alternatives**:
  - URL-encoding all UI state automatically (history pollution + fragile share URLs).
  - Subdomain-per-tenant in Phase 0 (cost + DNS complexity without real benefit yet).
  - Separate route per lens (`/h/:workspace/calendar/:id`) — breaks entity-as-canonical-URL.
  - Query-string-heavy URLs carrying chip bar multi-select by default (URLs > 400 chars, unreadable).
- **Connects to**: ADR-006 (RBAC enables role-filtered URLs), ADR-009 (URLs orthogonal to composable sidebar state), ADR-023 (road sheet uses this scheme), D6 deferred (public guest links — partially activated here for road sheet only).
- **Status**: Firm on the three-level principle and path-prefix multi-tenancy. Slug collision rules, full D6 activation, and Master View sharing-via-URL deferred to implementation.

## [2026-04-24] — ADR-023 — Road sheet: projection over `show` + asset versioning + role-filtered views

- **Context**: Open product question since 2026-04-20: how to model the "hoja de ruta" (per-gig consolidated document with venue specs, load-in/soundcheck/show times, backstage amenities, technical crew, travel + hotel, per diem, etc.). Three competing framings: lens of its own in top nav, part of Assets (Room tab), or detailed Calendar view. Resolved 2026-04-24 through three parallel agent investigations that converged:
  - **Schema audit** (agent A) of `reset_v2` identified 5 critical gaps that could be closed by extending `show` + two junctions, without a new `road_sheet` entity.
  - **Industry landscape** (agent B) across Master Tour, Prism.fm, Daysheets, TourPro, RoadOps, Overture, Stagent: no major tool treats road sheet as a first-class entity. Dominant pattern is hybrid — live view as source of truth + PDF export as distributable artifact. Role-based filtering is the norm, not the exception. No tool found uses a formal draft/locked/sent state machine; change propagation is via push-on-change.
  - **Real practice** (agent C) in MaMeMi / Komunumo / The Place: Marco already operates a distributed road sheet per gig — canonical rider PDF (Room-level), stage plot adapted per venue (Gig-level variant of the canonical), inbound docs returned by the venue (their tech sheet, bar plot), a working `notes.md` checklist, and email/WhatsApp coordination. The road sheet is not a single artifact but a constellation.
- **Decision — road sheet is NOT an entity**. It is a view composed over `show` + related junctions, filtered by viewer role.
  - **Extend `show`** with 5 timeslot columns (`load_in_at`, `soundcheck_at`, `show_start_at`, `loadout_at`, `wrap_at` — all `timestamptz`) + 3 consolidated `jsonb` columns (`logistics`, `hospitality`, `technical`) to absorb venue access codes, facilities (dressing rooms, showers), per-diem / catering / dietary, emergency info, merch policy, accommodation, parking notes, visa flags. GIN indexes on the jsonb columns. Rejected the audit agent's alternative of 10-12 explicit columns — jsonb is chosen for schema stability and evolution.
  - **New table `crew_assignment`**`(id, show_id, person_id, role text, contact_override jsonb, notes text)` — gig-specific crew roster with per-gig override of a `person`'s canonical contact (tour-specific mobile number, backup contact).
  - **New table `cast_override`**`(id, show_id, person_id, role, replaces_person_id uuid null, reason text)` — gig-specific cast changes (understudy, rotation) without polluting project-wide engagements. **Included in Phase 0** (not deferred).
  - **New table `asset_version`**`(id, gig_id null, line_id null, room_id null, kind enum, direction enum, adapted_from_id fk null, url text, uploaded_at timestamptz, uploaded_by uuid, notes text)`. `direction` enum: `outbound | inbound | adapted`. Tracks:
    - Canonical assets at Room level (rider, stage plot) — `direction='outbound'`.
    - Variants adapted per venue at Gig level — `direction='adapted'` with `adapted_from_id` FK back to canonical.
    - Inbound assets returned by the venue at Gig level (their tech sheet, bar plot, ContraRider) — `direction='inbound'`.
    - Export snapshots (road sheet rendered to PDF for distribution) — `kind='roadsheet_snapshot'`, `direction='outbound'`.
- **No formal state machine**. Drop draft → locked → sent. Industry evidence (ADR-022 research) shows push-on-change is the dominant pattern. "Export PDF" is an explicit user gesture that persists an `asset_version` snapshot; it does not "lock" the underlying data.
- **Role-based filtering** uses existing ADR-006 RBAC (10-permission + editable role catalog) + Postgres RLS + views. Road sheet is rendered differently for tour manager, performer, technical crew, and external venue viewer. No new permission vocabulary introduced.
- **UI location**: road sheet is a sub-view of Gig detail, accessed via `/h/:workspace/gig/:slug/roadsheet` (ADR-022). **Not** a top-nav lens.
- **Top-nav lens "Technical" rejected**. Closes the "Lens Technical y hojas de ruta" pendiente that was open since 2026-04-20. The contents that motivated a possible Technical lens are covered by: road sheet (gig-level, sub-view of Gig), Assets tab (room-level canonical assets), Calendar (timeline). The lens would have duplicated these.
- **Public external access**: road sheet supports signed public links in Phase 0 (partial D6 activation, per ADR-022). `?role=venue|performer|tech_manager` filters fields for specific shared recipients.
- **Bidirectional asset flow is explicit**: the inbound `asset_version(direction='inbound')` is a first-class part of the model, not an afterthought. It reflects how venues routinely return their own tech sheets and bar plots.
- **Rejected alternatives**:
  - Standalone `road_sheet` table — all three agent voices (schema, market, practice) argued against. Would duplicate data already expressible on `show` + junctions.
  - State machine with `approved_at` / `approved_by` — market does not do it; Marco does not do it; adds complexity without evidence of need. Approval can emerge later as a jsonb annotation if real need surfaces.
  - Explicit column-per-field on `show` (~10-12 columns) — schema rigidity without gain over 3 consolidated jsonb with GIN indexes.
  - Deferring `cast_override` — Marco confirmed it needs to be in Phase 0.
- **Connects to**: ADR-001 (engagement vs show), ADR-005 (line/run as own table), ADR-006 (RBAC enables role filtering), ADR-009 (UI architecture — sub-view of Gig detail), ADR-022 (URL scheme), D3 deferred (task entity — the `notes.md` checklist pattern implies tasks attached to Gig; integrates cleanly when D3 lands), D6 deferred (public guest links — partially activated here for road sheet only).
- **Status**: Firm on the principle and the table-level decisions (extend `show`, new junctions, no state machine, role-filtered views). Exact column names, enum values, and internal jsonb schemas finalized at implementation. Migration to be drafted as a single `reset_v2_roadsheet` migration covering all four schema changes.

## [2026-04-24] — ADR-024 — Slug naming: clean names forced + hard reject + rename redirect table

- **Context**: ADR-022 defines URL scheme `/h/:workspace-slug/:entity/:slug` but left slug rules "finalized at implementation". Marco's explicit preference is "clean URLs". Two strategies in tension: auto-dedupe with numeric suffix (`ombra-2`) vs. hard reject on collision (force rename at creation). An agent investigation (2026-04-24) surveyed how GitHub, Linear, Notion, Vercel, Supabase, Airtable, Figma, Cal.com, Slack, and Discord handle this.
- **Research finding**: **no major SaaS uses numeric-suffix auto-dedupe as its default UX.** Two dominant industry patterns emerged:
  - Hard reject at creation + redirect-on-rename (GitHub, Vercel, Cal.com, Slack, Notion custom slugs).
  - Opaque ID + cosmetic name (Supabase, Airtable, Figma, Linear issues, Discord).
  Numeric suffixes appear only as emergency fallback (Cal.com managed-event → `-personal-{id}`), never as the primary pattern.
- **Decision**: adopt the **"clean names forced + hard reject + redirect table"** strategy (GitHub/Slack model).
  1. **Hard reject at creation.** Modal on collision: *"A Room named 'Ombra' already exists. Try 'Ombra 2026' or 'Ombra Tour'."* Suggest candidate names, do not auto-append a number.
  2. **Rename preserves access.** Each entity stores a `previous_slugs text[]` column. Any old slug resolves to the current entity for at least 12 months (GitHub holds redirects indefinitely; Hour starts at 12 months and extends later if simple).
  3. **Redirect invalidates on slug reclaim.** When a new entity claims a freed slug, the old redirect stops resolving for the previous holder. Predictable; no dangling reservations.
  4. **Internal model**: every entity has an immutable `id uuid` primary key. All foreign keys reference `id`, never the slug. The slug is a mutable `text` column plus the `previous_slugs text[]` history. URL resolution: `(workspace_slug, entity_type, slug) → id`, with fallback through `previous_slugs` when the direct match misses.
  5. **Uniqueness scope**: per `(workspace_id, entity_type)` — not global. Two workspaces can each have a `room/ombra`.
- **Migration impact** (folds into `reset_v2_roadsheet.sql`): add `slug text NOT NULL` + `previous_slugs text[] NOT NULL DEFAULT '{}'` to `project` (Room), `line` (Run), `show` (Gig), `engagement`, `person`, `venue`, `asset_version`, `workspace`. Partial unique index on `(workspace_id, slug)` per entity table. `slug_generator(name)` SQL function: slugify + collision check within workspace scope; raises exception on collision (hard reject surfaced to UI as modal).
- **Rejected alternatives**:
  - Numeric suffix auto-dedupe (Strategy A) — telegraphs "I had an Ombra that failed" in every shared URL; industry rejects it.
  - Opaque-ID only (Supabase/Airtable model) — sacrifices human readability; Marco explicitly wants clean URLs.
  - Hybrid slug + opaque-ID tail (Notion/Linear model) — viable fallback if Hour ever regrets clean names; superset migration path, not the default.
- **Connects to**: ADR-022 (URL scheme — this closes the deferred slug rules).
- **Status**: Firm on strategy. Implementation details (exact regex for slugify, reserved slugs like `new`/`edit`/`settings`, redirect cache) finalized in Phase 0.0 when the migration ships.

## [2026-04-24] — ADR-025 — CRDT transport for collaborative editing: y-partykit on Cloudflare Durable Objects

- **Context**: ADR-023 road sheet requires collaborative editing of text-free fields (notes, description) without last-write-wins destroying concurrent edits. Tentative plan was Yjs + `y-supabase` + `y-indexeddb`. Agent investigation (2026-04-24) verified the state of the Yjs + Supabase ecosystem and compared alternatives.
- **Research findings**:
  - **`y-supabase` is abandoned.** All 12 versions published Feb 4–7 2023, still tagged `-alpha`, GitHub last push 2023-08-17, open issue #9 (2026-03-10) asking about maintenance/transfer has zero maintainer response at 6 weeks. Weekly downloads 640 vs. `yjs` 3.9M. Author explicitly said "nowhere near production ready."
  - **Supabase has no blessed Yjs pattern.** `pg_crdt` experiment shelved without follow-up; broadcast-as-Yjs-transport still "investigating" after ~4 years.
  - **PartyKit was acquired by Cloudflare in April 2024.** Now lives at `cloudflare/partykit`. Last push 2026-04-23. 1088 stars, first-class Yjs support (`withYjs` + `YServer`). Runs on Durable Objects — the same runtime Hour's Worker already uses. `y-partykit` weekly downloads 13.5k, maintained by Cloudflare directly.
- **Decision**: **adopt `y-partykit` on Cloudflare Durable Objects** as Hour's CRDT transport. Architecture:
  - **One Durable Object per collaborative document** — primarily per road sheet (`workspace_id/show_id/roadsheet`). Name encodes scope. DO persists Yjs state to its own storage + snapshots to Postgres `asset_version` or a dedicated `collab_snapshot` table every N updates.
  - **Client transport**: `y-partykit/provider` opens a WebSocket to the DO. Svelte island component wraps the input (`<YInput>`, `<YTextarea>`) and binds to a shared `Y.Doc`. `y-indexeddb` mirrors locally so offline edits survive and re-sync on reconnect.
  - **Authentication at connect time**: `onBeforeConnect` on the DO verifies the Supabase JWT (passed as `params.token`) using `cloudflare-worker-jwt`, then checks workspace membership via Supabase REST (service-role key) before accepting the WebSocket. RLS never sees Yjs binary — it gates the connection, not the doc.
  - **Awareness/presence** via Yjs awareness protocol on the same channel (not Supabase Presence). Used for "3 personas online + colored border on field in focus" per ROADMAP P10.
  - **Scope of CRDT**: only text-free fields (`show.notes`, `project.notes`, any jsonb text subfields flagged as collaborative). Structured fields (dates, selects, numbers, enums) stay on plain Supabase Realtime with last-write-wins. CRDT is not a hammer for everything.
- **Rejected alternatives**:
  - **`y-supabase`** — abandoned; unfixed concurrency bug (issue #2 "Updates will overwrite each other"); adopting = inheriting an orphaned project.
  - **Custom relay over Supabase broadcast** — no production open-source example exists; rate limits and message caps; would make Hour the maintainer of a CRDT transport layer (~60-120h + ongoing). Three independent "no" signals.
  - **HocusPocus** — Node.js only; would require a separate persistent server outside Cloudflare. Breaks Worker-only runtime constraint.
  - **`y-webrtc`** — P2P, no server persistence, NAT issues, no access control enforcement. Demo-grade.
  - **`y-websocket` + self-hosted Node** — wrong runtime, adds deploy target.
  - **Liveblocks Yjs** — fully managed and works, but paid beyond free tier (MAU cap, 8 GB) for overkill value at Hour's Phase 0 scale. Vendor lock.
  - **`y-durableobjects`** (napolab) — good fallback on same runtime, smaller community than PartyKit, no built-in auth helpers. Drop-in alternative if PartyKit ever goes sideways.
- **Effort estimate** (Svelte + Supabase dev new to Yjs): ~12-20 h to scaffold the Durable Object, wire auth gate, persist snapshots, and wire the Svelte client with `y-indexeddb`. Split: ~5-8 h in Phase 0.0 (DO scaffold + auth + persistence table schema) and ~8-12 h in Phase 0.2 (first collaborative field live on road sheet).
- **Connects to**: ADR-023 (road sheet — concrete CRDT path for collaborative fields), ADR-022 (Worker runtime — PartyKit runs inside the same Cloudflare account as `hour-web`).
- **Status**: Firm on path. Exact DO naming scheme, snapshot frequency, and Postgres persistence column design finalized in Phase 0.0 when the scaffold ships.

## [2026-05-01] — ADR-026 — Migrate from Astro 5 to SvelteKit 2 (reopens D-PRE-02)

- **Context**: D-PRE-02 (closed 2026-04-24) decided "do not migrate to SvelteKit", citing five operational reasons: (1) already on Astro, migration is churn; (2) Astro file-routing covers `/h/[workspace]/[entity]/[slug]` natively; (3) islands hydrate only where there's interaction; (4) CF Worker deploy already works with Astro adapter; (5) collaborative multiuser can be solved with stores inside islands + Realtime + CRDT, no SvelteKit needed. The caveat acknowledged in the same D-PRE-02: "if we eventually need a Figma-style collaborative visual canvas, islands falls short".

  An audit of `apps/web/` on 2026-05-01 revealed that the operational arguments for *not migrating* no longer hold at this size — and the audit caveat applies sooner than projected, because Phase 0.2 road sheet collaboration already needs cross-route shared state, presence, focus tracking and form-action progressive enhancement. These are the cases where SvelteKit cuts the cost in half.

- **Audit findings (`apps/web/` on 2026-05-01)**:
  - **4 pages**, all SSR (`output: 'server'`, no prerender). Zero SSG, the headline reason for choosing Astro.
  - **1 layout** (`Base.astro`, 30 LoC) — accepts `title`, renders `<slot/>`. Maps 1:1 to a SvelteKit `+layout.svelte`.
  - **1 API route** (`/api/engagements`, 141 LoC) — request/response plumbing, helpers (`pgGet`, `pgPostRpc`, `extractBearer`) reusable verbatim.
  - **5 Svelte components** (Button, Input, LinkButton, Checkbox, Radio) — Svelte 5 runes, reusable verbatim under SvelteKit.
  - **0 use of**: content collections, `astro:assets`, MDX, view transitions, middleware, prerender, image optimization, dynamic Astro components, slots beyond the trivial layout slot.
  - **`@astrojs/i18n`** configured with locales `en`/`es`, default `en` no prefix — minimal usage; will be reimplemented under SvelteKit with `@inlang/paraglide-sveltekit` (compile-time, type-safe, tree-shakeable).
  - **CF deploy**: `@astrojs/cloudflare` adapter with `output: 'server'` and `platformProxy.enabled: true`. The replacement is `@sveltejs/adapter-cloudflare` (first-class; `@sveltejs/adapter-cloudflare-workers` is deprecated). Same `wrangler.toml` bindings (R2 `MEDIA`, env vars, observability, `nodejs_compat`).
  - **% of UI logic in Astro vs Svelte**: ~5% Astro frontmatter (env access, redirects, layout slot), ~95% vanilla JS or Svelte. Astro is acting as a 30-line SSR envelope around Svelte islands.

- **Decision**: migrate `apps/web/` from Astro 5 to **SvelteKit 2.x with Svelte 5 + `@sveltejs/adapter-cloudflare`**. Reverts D-PRE-02. Done now while the surface area is minimal (4 pages, 1 layout, 1 API route, 5 primitives — all 2026-04-19 to 2026-05-01).

- **What SvelteKit gives that the current setup does not**:
  1. **Client-side routing.** Plaza → Room → Gig without full-page reload. Today every navigation re-renders from the Worker. This is the most palpable UX delta for any user of Hour.
  2. **Form actions with progressive enhancement.** Forms work without JS, enrich with JS. Aligns with offline/PWA strategy (Phase 0.0 work). Today this is hand-coded `addEventListener` + `fetch` in each page.
  3. **`load` functions with dependency tracking.** When data invalidates, dependent queries re-run. Today `/booking.astro` has 150+ lines of fetch+render manual; SvelteKit collapses to ~10 lines + `$page.data`.
  4. **`hooks.server.ts`** for global auth, cleaner than repeating `Astro.locals.runtime.env` access per endpoint.
  5. **Cross-route shared stores** without nanostore-cross-island workarounds. Naturalises D-PRE-05 (`$selection`, `$lens`, `$chipBar`, `$presence`).
  6. **End-to-end types via `$types`** between `+page.server.ts` and `+page.svelte`. Removes manual `db-types.ts` regeneration friction at the route boundary.
  7. **Smaller bundle** for an interactive shell (~15-30 KB Svelte runtime + route, vs Astro's island-per-component hydration footprint).
  8. **Streaming SSR** native — quick shell + data-in-streaming, useful for Plaza/Desk.

- **What Astro gives that we lose**: nothing in active use. Content collections, image optimization, MDX, view transitions, prerender — none of these are present in the codebase as of audit.

- **Rejected alternatives**:
  - **Stay on Astro** — D-PRE-02's position. Reasonable when "migrating is churn" actually meant tearing up dozens of files; today churn is 6-10 hours, no UI rework, no data model change. Trades a one-time cost for permanent friction in routing/state/forms.
  - **Hybrid (keep Astro shell, add SvelteKit subroute for the dashboard)** — rejected. Two routers, two adapters, two i18n setups. The cost of split exceeds the cost of clean migration at this size.
  - **Migrate later (Phase 0.2 or after Plaza)** — rejected. Each phase added increases the migration surface. Deferring is a bet that the stack doesn't matter; the audit shows it does.

- **Migration plan** (in worktree `migrate/sveltekit`, branched from main at `pre-sveltekit-migration` tag):
  1. Scaffold SvelteKit 2 + Svelte 5 + `adapter-cloudflare` + paraglide-sveltekit + Vitest. Drop `@astrojs/*` deps.
  2. Map `Base.astro` → `+layout.svelte`. Reuse `tokens.css` + `base.css` unchanged.
  3. Reuse 5 Svelte primitives unchanged.
  4. Migrate `/login`, `/booking`, `/index`, `/playground` → `+page.svelte` + `+page.server.ts` (where applicable). Replace inline fetch+render with `load()`. The `/booking` 306-LoC page becomes ~80 LoC + a clean Svelte table component.
  5. Migrate `/api/engagements.ts` → `+server.ts`. Helpers reused verbatim.
  6. Replace `@astrojs/i18n` with `@inlang/paraglide-sveltekit`. Same locales, same default-no-prefix scheme. Compile-time bundles.
  7. Update `wrangler.toml` build command (`vite build` instead of `astro build`). Output structure changes (no more `dist/_worker.js/index.js`); same bindings.
  8. Add Valibot at `+server.ts` boundaries (validate query/body in `/api/engagements`). Schema shared with future endpoints.
  9. Wire Sentry via `@sentry/sveltekit` with `handleError` in `hooks.client.ts` + `hooks.server.ts`.
  10. Install `@tanstack/svelte-query` + `QueryClientProvider` in layout — not used in Phase 0 routes (the new `load()` is enough), ready for Plaza/Desk in Phase 0.1 where server-state cache becomes load-bearing.
  11. Smoke test: `/login` → JWT → `/booking` shows 154 engagements with paging, exactly as before. Deploy to `hour-web` from feature branch.
  12. Merge to `main` when green.

- **Effort estimate**: ~6-10h focused. Cost is an order of magnitude lower than the value gained (every Phase 0.0-0.4 day is now built on the right substrate).

- **What this changes in the roadmap**:
  - `roadmap.md` Day 10 of Phase 0.0: replace `partykit.json + y-partykit` with `wrangler.jsonc DO + y-partyserver + withYjs(Server) + hibernation` (separate from this ADR; same edit).
  - `roadmap.md` Phase 0.1: add bullet on TanStack Query as the server-state cache for Plaza/Desk (no extra work — already wired).
  - `_context.md` Stack line: `Astro/Svelte` → `SvelteKit + Svelte 5`.

- **Connects to**: D-PRE-02 (reopens and reverts), D-PRE-03 (i18n migrates from `@astrojs/i18n` to `paraglide-sveltekit`), ADR-022 (URL routing — SvelteKit's `[workspace]/[entity]/[slug]` covers it natively), ADR-009 (sidebar/lens shell — easier under SvelteKit's shared-state model), ADR-025 (CRDT path unchanged but co-located cleaner under hooks.server).

- **Status**: Firm. Implementation in worktree `migrate/sveltekit`; merge to `main` when smoke tests pass and Marco approves.
