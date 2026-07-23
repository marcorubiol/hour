# Decisions Log — Hour

> **APPEND-ONLY HISTORY, NOT CURRENT STATUS.** Every entry was true or proposed
> in its dated context. Later ADRs may supersede names, routes or implementation
> status. Start with `_context.md` and `_tasks.md`; use this file to answer why.
> Executed prompts and old plans referenced below are indexed in `build/archive/`.

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

### Addendum 2026-05-01 — re-evaluation before scaffold (closes "implementation finalized")

Triggered by Marco's pre-scaffold doubt (Phase 0.0 day 5). Five alternatives evaluated in `build/archive/2026-05-url-architecture-dossier.md`: status quo, subdomain `{w}.hour.app`, drop `/h/` prefix, slug global without entity, Linear-style entity-prefix-id. **Decision unchanged: keep `/h/[workspace]/[entity]/[slug]`.** Three operational closures:

1. **Reserved slugs (~70) listed and enforced.** Categories: router/system, Phase 1 marketing site, conventions, Hour product vocabulary, operational. Source of truth: `apps/web/src/lib/reserved-slugs.ts`. Validation runs (a) client-side in `+layout.svelte` of `/h/[workspace]/` (immediate redirect to `/`), (b) server-side in `slug_generator()` SQL function and at insert/update on `workspace.slug`. Without this list, every new root route in Phase 1 (pricing, docs, blog, signup...) burns a workspace slug retroactively — see Alt C analysis in dossier.

2. **Phase 0.0 entity scope.** Scaffold only `room`, `gig`, `engagement`, `person` placeholders now. Defer `run`, `venue`, `asset`, `invoice` route folders to their respective phases (0.2, 0.3, 0.5).

3. **Migration path to subdomain (Phase 1, not now).** If Phase 1 surfaces vanity workspaces (`mamemi.hour.app`) or marketing-site SEO collisions on the apex, the migration to subdomain is non-destructive: 301 from `/h/{w}/...` → `{w}.hour.app/...`, DB schema untouched, `previous_slugs` unaffected. Estimated cost <1 day on the Worker side (custom domain wildcard + `Host` parsing in `hooks.server.ts`). Documented here so future-self does not re-litigate the path-prefix choice.

**Open**: workspace switching when JWT claim points to a different workspace than the URL (Phase 0.4). Master View URL sharing (D-PRE-05, deferred to Phase 0.4). Public guest links full activation under `/public/[entity]/[token]` (D6, Phase 0.5).

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

## [2026-05-01] — Primary color: terracotta → plum
- **Decision**: Swap `--primary` from `oklch(0.52 0.141 29.7)` (#AB4235 terracotta) to `oklch(0.50 0.14 335)` (~#9D3F70 plum).
- **Context**: Surfaced while testing the Day 4-5 primitives (Select error state, focus outline, chip--selected) in `/playground`. Terracotta sits 5° from `--danger` (hue 25°), so primary surfaces — focus outline, `btn--primary`, `chip--selected`, link, selection bg — read as error-adjacent. Marco saw it on the Select with `error` and asked for an alternative that doesn't compete with the status palette.
- **Alternatives considered**: Indigo `oklch(0.50 0.16 282)`, Cobalt `oklch(0.48 0.15 258)`, Violet `oklch(0.50 0.17 295)`, Aubergine `oklch(0.42 0.10 318)`. All sit in the safe hue range 250°–340° (≥40° from each status: danger 25°, warning 75°, success 145°, info 220°).
- **Rationale**: Plum at 335° is 50° from danger by the long way around — outside every status hue, so primary surfaces stop competing with red/amber/green/blue badges. Keeps the warm/scenic register of the original terracotta (didn't jump to corporate cool blue). All shade derivatives, `--link-color`, `--focus-color`, `--selection-bg` follow automatically via `color-mix()` — single-line token swap, no other code change.
- **Status**: Provisional. Marco confirmed for now ("we move forward with this") but flagged it's not a brand decision. Re-evaluate when the visual design phase begins (Phase 0.4 polish, or earlier if the brand decision starts crystallizing in Phase 1 prep).

## [2026-05-01] — `person.slug` is GLOBAL UNIQUE (no workspace scoping)
- **Decision**: `person.slug` is enforced unique globally (`UNIQUE (slug) WHERE deleted_at IS NULL`), not per-workspace. The other 6 sluggable entities (workspace, project, line, show, engagement, venue) keep per-workspace scope.
- **Context**: Discovered mid-migration apply. `person` has no `workspace_id` column — by ADR-001 / anti-CRM vocabulary, person is "global, shared" (one record per real-world human, referenced from many workspaces via `engagement` + `crew_assignment` + `cast_override`). My initial migration assumed person was tenant-scoped and tried `CREATE UNIQUE INDEX person_slug_uidx ON person (workspace_id, slug)` → `column "workspace_id" does not exist`. The independent DB review missed it too (both of us anchored on the per-workspace pattern shared by the other entities).
- **Alternatives considered**:
  - Add `workspace_id` to person to match the others — rejected. Breaks the global-shared model; would force duplicate person rows per workspace.
  - Junction table `person_workspace_slug(person_id, workspace_id, slug)` to allow workspace-specific renames of the same global person — rejected for Phase 0. Adds complexity, no real use case until multi-workspace operations.
  - Opaque-id-only URL for person (`/h/[ws]/person/[uuid]`) — rejected. Marco wants clean URLs (ADR-024 spirit).
- **Rationale**: Global slug matches global model. URL `/h/[any-workspace]/person/centre-cultural` resolves consistently across workspaces — a feature, not a bug. Backfill collision-resolution (id-suffix) already produces 154 globally-unique slugs from the 154 imported persons. If two distinct persons in different workspaces ever share a name in the future, the second to be created gets the id-suffix (same mechanism as backfill).
- **Status**: Firm for Phase 0. Re-evaluate if Phase 1 multi-workspace operations surface cross-tenant slug rename pain.

## [2026-05-01] — Backup runs in GitHub Actions, not Cloudflare Worker cron
- **Decision**: Automated Supabase → R2 backup runs as a weekly GitHub Action, not a Cloudflare Worker scheduled handler.
- **Context**: `roadmap.md` Phase 0.0 originally specified "Worker cron + R2 + retention 12 weeks". Discovered while planning the script: Cloudflare Workers cannot execute native binaries (the runtime is V8/WASM only). `supabase db dump` is a native Go binary. There's no workable way to produce a real `pg_dump` from inside a Worker.
- **Alternatives considered**:
  - **Worker that hits Supabase via PostgREST and writes JSON-per-table to R2** — rejected. Captures data but not schema/functions/policies/triggers. Recoverable only if `schema.sql` + migrations stay versioned (they do), but a real `pg_dump` is more honest as a backup artifact.
  - **launchd on the mac** — rejected. Only runs when the laptop is awake; silent failure mode is too easy.
  - **GitHub Actions on cron** — chosen. Free for public/private repos under generous quotas (2000 min/mo), `supabase db dump` is just `apt-get install supabase` + a CLI call, push to R2 via `wrangler r2 object put` or `aws-sdk`. Secrets isolated in GH repo settings. Versioned in repo.
- **Rationale**: Real dump (schema + data + functions), free, versioned, and the failure mode is loud (GitHub mails on cron failures). Trades "everything in CF" for "the right tool for the job".
- **Status**: Firm. Implementation in next session (1-2h estimate).

## [2026-05-01] — Backup priority lowered ALTA → MEDIA (derived data)
- **Decision**: Until first non-derivable production data appears, automated backup is MEDIA priority, not ALTA. Re-promotes to ALTA when Phase 0.1-0.2 introduces user-edited content.
- **Context**: I had flagged "no automated backup of 154 production contacts" as an ALTA-priority asymmetric risk. Marco countered: those 154 came from a CSV + 3-stage pipeline (`build/import/01_normalize.py` → `02_enrich_from_pdf.py` → `03_load_to_hour.py`) that is in the repo. Recoverable in <30 min. The DB right now is **derived state**, not authoritative source.
- **Alternatives considered**: Keep ALTA-priority manual backups before every migration — rejected as unnecessary friction when source is versioned.
- **Rationale**: Zero-principle alignment — files survive, derived state is recoverable. Backup-of-derived-data is an anti-pattern when the source pipeline is in version control. The risk asymmetry argument only holds when destruction would lose work that can't be reproduced.
- **Triggers for re-promotion to ALTA**:
  - First `crew_assignment` created manually through UI (Phase 0.2 road sheet work).
  - First `show.notes` or `project.notes` edited via collaborative input (Phase 0.2 CRDT work).
  - First `asset_version` uploaded to R2 (Phase 0.5+).
  - Any custom field added to a person beyond the CSV-derived `custom_fields` blob.
- **Status**: Firm for Phase 0.0 / Phase 0.1 shell. Re-evaluate at every phase gate.

## [2026-05-02] — Phase 0.9 private beta gate before external known clients
- **Decision**: No external workspace before Phase 0.9 hardening complete. Phase 0.9 is a mandatory gate, not optional polish.
- **Context**: Goal changed from "launch SaaS at month 6" to "sell in <12 months, first clients known/assisted". The known clients will be hand-onboarded by Marco, not self-serve. This changes security priorities: external data before self-serve capability.
- **What Phase 0.9 includes**:
  - Session hardening: httpOnly Secure SameSite=Strict cookies (XSS mitigation)
  - Rate limiting: `/api/sentry-tunnel` and auth endpoints via Cloudflare KV
  - RLS regression suite: automated tests for tenant isolation guarantees
  - Restore drill: documented & tested restore from R2 backup to staging in <30 min
  - Admin/support minimum: UI to list workspaces, diagnose memberships, reset slugs
  - Structured logging: JSON logs with request_id correlation
  - Health checks: `/health/live` and `/health/ready` endpoints
  - Sentry PII scrub: hash email/user_id before ingest
- **Consequences**:
  - Phase 1 becomes "public/self-serve launch with billing", not "first hardening"
  - Timeline: Phase 0.9 happens when first external client is identified, not at fixed month
  - Pricing/self-serve onboarding deferred until Phase 0.9 validates demand
- **Status**: Firm.

## [2026-05-02] — Documentation source-of-truth cleanup
- **Decision**: Archive obsolete docs, update file tables, clarify onboarding order.
- **Changes**:
  - `bootstrap.md` marked HISTORICAL (Astro-based, pre-ADR-026)
  - `reset-v2-prompt.md` moved to `build/archive/`
  - `build/_context.md` file table updated with current migrations as canonical
  - `director-prompt.md` rewritten for SvelteKit stack and Phase 0.9
  - Onboarding docs order: `_context.md` → `roadmap.md` → `architecture.md` → `_decisions.md` → `runbooks/rollback.md`
- **Status**: Procedural, completed.

## [2026-05-02] — `/h/` subtree is client-only (`ssr = false`)
- **Decision**: `apps/web/src/routes/h/+layout.ts` exports `ssr = false`. The whole authenticated app shell renders client-only.
- **Context**: The `/h/` subtree is the auth-gated app. JWT lives in `localStorage` (Phase 0 reality, Phase 0.9 will migrate to cookies). The auth guard in `+layout.svelte` runs in `onMount`, so on SSR `localStorage` is unavailable and `authChecked=false` keeps `{#if}` closed — the server renders an empty shell anyway. We were paying for an SSR round-trip whose only output is `<head>` + an empty `<div>`.
- **Alternatives**: (a) Keep SSR + add `+layout.server.ts` cookie check — rejected, requires migrating session storage to cookies first (Phase 0.9 work, 4-6h). (b) Leave SSR on as default — rejected, wasted edge compute on every `/h/*` request for zero functional benefit.
- **Rationale**: App is internal, no SEO requirement, no anonymous render path. Client-only matches the app shape. One-line change, easy to revert.
- **Re-evaluate when**: Phase 0.9 ships httpOnly cookies. Server-side auth guards become possible and SSR can return if there's a concrete UX win (e.g. printable workspace dashboards).
- **Status**: Firm for Phase 0.

## [2026-05-02] — GitHub Actions weekly Supabase backup → R2
- **Decision**: `.github/workflows/backup.yml` runs every Sunday 03:00 UTC (and on `workflow_dispatch`). Dumps `public` schema (data + structure + roles) via Supabase CLI, gzips, pushes to R2 bucket `hour-backups/weekly/<UTC-stamp>/` with 12-week retention auto-prune.
- **Context**: Closes "Open debt #1" — backup automation. Worker cron path was rejected on 2026-05-01 (CF Workers can't execute native binaries). GitHub Actions is the right runner: pre-installed `aws` CLI, free tier covers a 20-min weekly job, secrets management built-in.
- **Activation pending**: requires four GitHub secrets (`SUPABASE_DB_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`) and creation of bucket `hour-backups`. Runbook in `build/runbooks/backup.md`.
- **Re-evaluate when**: First non-derivable data lands (first manual `crew_assignment`, first uploaded `asset_version`, first human `person_note`). At that point a restore drill becomes ALTA.
- **Status**: Firm. Workflow committed, awaiting secret provisioning to actually run.

## [2026-05-02] — Playwright smoke as deploy gate scaffold
- **Decision**: Install `@playwright/test` as devDep. `apps/web/playwright.config.ts` + `apps/web/tests/smoke.spec.ts` cover the critical path: login → `/booking` shows engagements → sign out. Scripts `pnpm test:install` + `pnpm test:smoke`.
- **Context**: Before today, `pnpm check` and `pnpm build` were the only pre-deploy gates — neither catches functional regressions (and `pnpm check` was actually red on a stale type import this session also fixed). A 30-second smoke is enough to catch login/auth/RLS regressions on every deploy.
- **Activation pending**: requires a test user with `workspace_membership` in `hour-phase0`, plus `PW_TEST_EMAIL`/`PW_TEST_PASSWORD` in `.env.test` (gitignored). Test auto-skips when env is unset, so CI doesn't break until secrets are wired.
- **Rationale of "scaffold first, wire later"**: the cost of writing the test now is sunk; the cost of provisioning a test user can be deferred without losing the work.
- **Re-evaluate when**: Phase 0.2 introduces real-time collab — smoke probably needs to expand to cover multi-user scenarios.
- **Status**: Firm. Committed scaffold, awaiting test user.

## [2026-05-02] — Fix stale type imports in `/api/engagements`
- **Decision**: Renamed imports `Enum` → `Enums`, `Row` → `Tables` in `+server.ts`. The `db-types.ts` file (Supabase-generated) exports `Enums<>` and `Tables<>`, not the singular forms used.
- **Context**: `pnpm check` was failing on these two errors. They predate this session — likely a regression from a `supabase gen types` regeneration that renamed the canonical exports. Build wasn't affected (Vite is more permissive than svelte-check), so the deploy stayed green and the breakage went unnoticed.
- **Lesson**: `_context.md` claimed `pnpm check` was green; it wasn't. Worth wiring `pnpm check` into the smoke-test pipeline alongside Playwright so CI fails on type drift, not just functional drift.
- **Status**: Procedural fix.

## [2026-05-02] — ADR-027 — Phase 0 validates an integrated operating base before deep modules
- **Decision**: Phase 0 should validate Hour as a transversal operating system before deepening any single module. Hour is not "booking-first", "production-first", or "road-sheet-first" as product identity. Booking may be an entry point, but the MVP must prove that House, Room, people, engagements, gigs, venues, assets, road sheets, filters, lenses, and permissions work together coherently.
- **Context**: Product strategy review on 2026-05-02 identified that Hour's main risk is not whether one module can work, but whether the conceptual map and interrelations make sense for real performing-arts teams. Marco clarified that booking is only one entry leg; production is another critical leg, and the initial MVP must keep the whole system in view to avoid building a structurally wrong product.
- **Alternatives**: (a) Booking-first MVP — rejected because it could optimize the first entry point while weakening production, road sheet, and cross-lens structure. (b) Production-first MVP — rejected for the same reason. (c) Full-depth modules before beta — rejected because it delays learning and increases scope.
- **Rationale**: Hour's differentiation is not one isolated feature. Its value comes from connecting relationship memory, dates, production, assets, money, and external sharing around the same operational objects. Phase 0 should therefore be shallow but transversal: enough depth to use, enough breadth to validate the model.
- **Consequences**:
  - Roadmap language changes from modular MVPs to transversal MVPs.
  - Phase 0.1 validates the base map: House → Room → Run/Gig, scope, filters, URLs, and detail.
  - Phase 0.2 validates dates, road sheet, production and sharing as connected outputs of the same map.
  - Phase 0.3 completes the four base lenses: Desk, Calendar, Contacts, Money.
  - Contacts/engagement context should appear earlier as a thin slice even if the full Contacts lens remains in Phase 0.3.
  - The current vocabulary ADR-008 remains working vocabulary, but `Room` must be validated with real users before final UI-copy lock.
- **Status**: Firm for Phase 0.

## [2026-05-09] — Backup activated + three operational gotchas captured
- **Decision**: The 2026-05-02 backup workflow is now live. First successful run uploaded `data` (137 KB), `schema` (14 KB), `roles` (208 B) gzipped to `s3://hour-backups/weekly/2026-05-09T06-58-19Z/`. Total ~150 KB. Closes Open Debt #1 from the 2026-05-02 backlog.
- **Context**: Activation took four iterations because of three traps that aren't in any single Supabase doc. Capturing here so any future operator (or me in 6 months) doesn't re-discover them. The runbook (`build/runbooks/backup.md`) inlines all three at the secret table.
- **Three gotchas resolved**:
  1. **`gh` token needs `workflow` scope** to push files in `.github/workflows/`. Without it the push silently 403s and the workflow file gets reverted (this is exactly what produced commit `a65a982` "Remove backup workflow to resolve OAuth scope issue" on 2026-05-02). Fix: `gh auth refresh -h github.com -s workflow`.
  2. **DB password URL-encoding** — Go's `net/url` parser fails on `@`/`/`/`#`/`?`/`:` in the userinfo section. Symptom: `failed to parse as URL ... invalid userinfo`. Fix: rotate to alphanumeric password (chosen) or percent-encode special chars.
  3. **Connection mode** — the "Direct connection" URL (`db.<ref>.supabase.co:5432`) resolves IPv6-only and GitHub Actions runners are IPv4-only. Symptom: `Network is unreachable`. The "Session pooler" URL (`aws-0-eu-central-1.pooler.supabase.com:5432` with user `postgres.<ref>`) is IPv4-compatible and free — the "Enable IPv4 add-on" button in the Connect modal is a paid distraction we don't need. Transaction pooler (port 6543) is wrong because `pg_dump` uses prepared statements that Transaction mode breaks.
- **Why log this**: each of the three errors has a different root cause and a different fix; together they took ~25 min to chain through. Documenting them as a kit lets the next backup-related setup (e.g., adding a daily job in Phase 0.9, restore drill to staging) skip the rediscovery cost.
- **Re-evaluate when**: schema or workflow grows (e.g., per-day backups, multi-region). The pooler URL host might change region; secrets rotate quarterly per Phase 0.9 plan.
- **Status**: Firm. Backup is now operational on weekly cron + manual dispatch.

## [2026-05-09] — ADR-028 — `share`: per-engagement curated microsite as Phase 0.5 wedge feature
- **Decision**: Add `share` as a new entity in Phase 0.5 — a per-engagement curated microsite served via signed URL, presenting a show to one external programmer without requiring login. Lazy-created on first "share" click; show-driven branding with per-engagement subtitle override; assets are visual references to canonical `show.assets` plus engagement-scoped one-offs (no byte duplication); incoming email archived via BCC to a per-engagement address (Basecamp-style "loop in by email"); medium-grain view tracking (which assets were downloaded); link is eternal until manual revoke + rotable.
- **Context**: During *difusión* MaMeMi (154 active contacts for season 2026-27), Marco today juggles dossier delivery across email + WeTransfer + Drive ad-hoc per programmer. Idea surfaced 2026-05-09 to unify this surface inside Hour. Through 4 rounds of grilling, the idea narrowed from "shared bucket" to "curated micro-deal-room with versioning + email archive". Pattern equivalent outside performing arts: DocSend, Dock, Notion deal rooms.
- **Alternatives considered (rejected)**:
  - **Drive folder per engagement** — rejected, no version control surface, no curation layer, no analytics, brand-blind.
  - **Per-show only (no engagement variants)** — rejected, loses "this programmer sees these 4 assets, that one sees those 6" curation, which is the core value-add over Drive.
  - **Per-engagement only (no canonical show assets)** — rejected, would force re-uploading the same dossier 154 times.
  - **Login required for programmer (D6 guest membership)** — rejected for Phase 0.5, fricción of 30s registration kills the "open and see immediately" promise that competes with WeTransfer/Drive links.
  - **Real IMAP/Gmail integration** — rejected for Phase 0.5, blocks on full D4 (Communication layer); BCC-to-archive is the lighter wedge that captures 80% of value.
  - **Auto-create microsite on engagement creation** — rejected, would generate 154 empty stubs and pollute the model; lazy-on-share is cleaner and signals which engagements are "armed".
  - **Link expiry by default (30/90/180 days)** — rejected, performing-arts programmers respond on multi-month timelines; expiry creates fricción without preventing the real leak vector (programmer forwards link in WhatsApp). Manual revoke + rotation handles intentional cleanup; eternal default matches actual usage.
  - **Cero tracking (privacy-first)** — rejected, "did Ana open it? did she download the rider?" is exactly the commercial signal that justifies the feature over Drive. Tracking is server-side, programmer never sees a banner.
  - **Naming `pitch` / `dossier` / `microsite`** — rejected. `pitch` reads commercial; `dossier` already names a specific asset type; `microsite` is generic web-jargon. `share` is plain, action-oriented, anti-CRM, traduces EN/ES.
- **Rationale**:
  1. **Wedge value vs Drive**: curation (which assets per engagement) + version pinning (programmer always sees the version Marco decides) + branded landing presentation + activity tracking — together these are not "Drive with skin", they are a different category of artifact.
  2. **Reuses existing schema**: `asset_version` (direction=outbound) and R2 binding `MEDIA` already in place. Net new: `share` table, `share_item` selector table, `share_email` archive table, `share_view` analytics table, plus an `asset.scope` discriminator (or nullable `asset.engagement_id`).
  3. **Adelanta D6 (public guest links)** ya parcialmente cubierto para road sheet — generaliza el patrón.
  4. **Adelanta D4 (comms) parcialmente** sólo en el ingest side via BCC; envío activo y multi-canal sigue Phase 1.
  5. **Email ingest stack**: Cloudflare Email Workers (free, GA), parses incoming MIME with `postal-mime`, writes raw EML to R2 + indexed row in `share_email`. No third-party (Postmark/Mailgun) needed. Cierra el loop dentro del stack ya pagado/free.
  6. **Phase 0.5, no antes**: requiere Plaza+Desk operacionales primero (sin engagements enriquecidos por uso diario, no hay nada que merezca un microsite curado). Adelantarlo a 0.4 sería premature optimization de venta antes de validar uso interno.
- **Open questions deferred to spec time** (cuando arranque la implementación en Phase 0.5):
  - Schema: `asset.scope` enum vs `asset.engagement_id` nullable. Trade-off legibility vs flexibility.
  - Cardinality `share`↔`engagement`: 1:1 (un share por engagement) o 1:N (varios shares — ej. uno por show distinto si Marco vende 3 obras a la misma persona). Probable 1:N.
  - Email-to-share routing: parser regex sobre `eng-<token>@in.hour.zerosense.studio` o `share-<token>@...`.
  - Public route: `/s/<token>` (corto, opaco) vs `/h/<ws>/share/<slug>` (legible, leak-vector).
  - Tracking granularity: hash de IP (privacy-aware) vs raw IP (más útil para fraude). Probable hash.
  - Token rotation UX: invalida en background y muestra a Marco "share rotado, copia el nuevo link" + permite override "mantener link viejo activo otros 7 días" para no romper a la persona si ya estaba mirando.
- **Roadmap placement en ese momento**: Phase 0.5 — Deferred features. Coste estimado bruto 2-3 semanas (1 sem schema + UI interna + share button; 1 sem microsite público; 0.5-1 sem email ingest). Snapshot: `build/archive/2026-07-roadmap-snapshot.md`.
- **Re-evaluate when**: arranque Phase 0.5, o si en Phase 0.1-0.4 emerge necesidad real (Marco quiere mandar dossier a alguien y se da cuenta de que ya merece la pena). Si Phase 1 se acelera (cliente externo serio), evaluar adelantar a Phase 0.4 como wedge de venta.
- **Status**: Firm decision, deferred to Phase 0.5 implementation.

## [2026-05-14] — Visual design validation: two checkpoints, no formal "visual design phase"
- **Decision de aquel momento**: validar diseño visual en dos checkpoints. El prompt usado como referencia se conserva en `build/archive/2026-05-design-system-prompt.md`; su navegación House/Room fue superseded y no debe usarse como contrato actual.
- **Context**: Pregunta de Marco 2026-05-14 sobre cuándo validar diseño. Hoy el sistema visual existe solo en `/playground`; los primitivos en aislamiento mienten — un Button rodeado de chip bar + tree no se siente igual que en showcase. Plum trial declarado provisional en `_decisions.md` 2026-05-01, pendiente de re-evaluación en "visual design phase".
- **Alternatives considered (rejected)**:
  - **Visual design phase formal antes de Phase 0.1** — rechazado. Validar diseño visual sin Plaza/Desk vivos es validar en el vacío: solo puedes mirar primitivos aislados, que ya están auditados. Lo más caro de equivocar es la estructura informacional, no el color.
  - **Un solo checkpoint al final (antes de 0.4)** — rechazado. Tres lenses construidas sobre un sistema visual no validado = refactor caro. Si plum canta o la densidad agobia, mejor saberlo con 0.1 encima que con 0.3.
  - **Validación continua sin checkpoints explícitos** — rechazado. "Ojo crítico mientras construyes" es lo que hacemos ya; sin un momento formal acaba siendo polish reactivo, no pasada sistemática.
- **Rationale**:
  1. **Coste asimétrico**: cambiar tokens/palette/tipografía cuesta horas en Phase 0.1, días en Phase 0.3+. Validar temprano es barato; validar tarde no.
  2. **Primitivos en aislamiento mienten**: el `/playground` showcase no produce las mismas decisiones que pantallas reales con datos productivos.
  3. **Phase 0.4 ya tenía visual review implícito** (sección "Mobile polish" + "accessibility pass"); el checkpoint 2 lo formalizaba con el prompt hoy archivado.
  4. **Checkpoint 1 = 1 día de tweaks** sobre un sistema vivo. Coste mínimo, valor alto.
- **Re-evaluate when**: si en checkpoint 1 emerge que el sistema visual necesita rework profundo (no tweaks), congelar Phase 0.2 y abrir visual design phase formal antes de continuar. Hasta entonces, los dos checkpoints son suficientes.
- **Status**: Firm.

## [2026-05-14] — Naming gate adelantado del final de Phase 0.4 al final de Phase 0.1
- **Decision**: Mover el naming gate del producto (House, Room, Run, Gig, Desk, Plaza) del final de Phase 0.4 al final de Phase 0.1. El gate de 0.4 queda como **ratificación final**, no decisión. El gate de 0.1 es la decisión real.
- **Context**: Pregunta de Marco 2026-05-14 sobre cuándo se cementa el naming. Phase 0.1 va a meter "Room"/"Gig"/etc en URLs (`/h/:workspace/room/:slug`), endpoints (`/api/rooms`), componentes (`<RoomDetail>`) y copy. El roadmap original (línea 42) difería el gate al final de 0.4. Riesgo #14 en roadmap explícito: "`Room` no se entiende o se confunde con venue/sala".
- **Alternatives considered (rejected)**:
  - **Mantener el naming gate en 0.4** (status quo del roadmap) — rechazado. Para llegar a 0.4 hay que pasar por 0.2 y 0.3, que construyen 2 lenses más encima del naming. Si "Room" canta en 0.4, el refactor es 3× más caro que tras 0.1.
  - **Naming gate antes de Phase 0.1** — rechazado. Sin Plaza vivo con datos reales, el test es abstracto ("¿entiendes que Room = proyecto?") en lugar de situacional ("¿confundes esta `Room: Atrabilis` con sala/venue?"). El test en abstracto no aporta señal.
  - **Lock total del naming sin gate** — rechazado, contradice riesgo #14 explícitamente reconocido.
- **Rationale**:
  1. **Coste de cambio entre 0.1 y 0.9 es medio día**: buscar/reemplazar en routes, rename componentes, actualizar i18n keys. El schema NO cambia (ADR-008 separa nombres técnicos de producto). Entre 0.1 y 0.9 hay ~110-150h de trabajo y meses calendario donde cambiar naming es prácticamente gratis arquitectónicamente.
  2. **"Para siempre" empieza en Phase 0.9**, no en 0.1: clientes externos con URLs guardadas/bookmarks son el primer punto donde un cambio de naming rompe algo real. Hoy no hay externos.
  3. **Plaza vivo en 0.1 es el primer momento testeable** con personas reales (Anouk + 1-2 externos del circuito booking/producción).
  4. **Test específico de riesgo #14**: preguntar directamente "¿confundes Room con sala/venue?" en el contexto de pantalla, no en abstracto.
- **Cómo testear en checkpoint 1**:
  - Anouk delante de la app real (5 min): "¿qué crees que es esto?" señalando Plaza, Desk, Room en sidebar.
  - 1-2 personas externas con caso parecido (Electrico 28 si hay contacto, alguien que conozca booking/producción).
  - Pregunta explícita: "¿confundes Room con sala/venue?" (riesgo #14).
- **Re-evaluate when**: si checkpoint 1 valida el naming → ratificación silenciosa en checkpoint 2 (Phase 0.4). Si checkpoint 1 invalida algo → cambio antes de empezar Phase 0.2.
- **Status**: Firm.

## [2026-05-18] — ADR-032 — Add `account` layer above workspace (billing + entity-level tenancy)

- **Decisión**: añadir una tabla `account` (billing entity) por encima de `workspace`. Cada workspace pertenece a un account vía `workspace.account_id NOT NULL`. `account_membership` controla quién puede gestionar el account (crear workspaces dentro, manejar billing, invitar admins). El acceso "regular" a cada workspace sigue siendo via `workspace_membership` — un user atraviesa accounts distintos vía sus workspace_memberships.
- **Context**: Marco va a abrir Hour a clientes pronto y necesita el modelo "una entidad paga, N workspaces dentro" listo desde el principio. El modelo workspace-as-tenant que teníamos lo expresaba como "una factura por workspace", lo cual no encaja cuando una compañía o un freelance quiere meter varios proyectos bajo una suscripción única (caso Basecamp). La conversación 2026-05-18 evaluó tres opciones (A: solo Stripe, sin schema change; B: account explícito en schema; C: account anémico solo billing). Marco eligió B híbrido: Basecamp-like en facturación + Slack-like en identidad (un user puede ser miembro de workspaces en N accounts distintos simultáneamente, ver sidebar multi-house del boceto).
- **Modelo final**:
  ```
  account (billing entity, Basecamp-like)
    ↓ has_many
  workspace (= "Project" UI, RLS scope)
    ↓ has_many
  section (= "Line / Season / Campaign / ...")
    ↓ has_many
  show (atomic)
  ```
- **Cómo se aplica a casos reales** (research §5 multi-tenant freelance):
  - **Solo artist**: 1 account personal + 1 workspace propio. 1 factura.
  - **Theatre collective**: 1 account team + 1+ workspaces. La factura va al colectivo como entidad legal.
  - **Marco lanza Editorial Z**: segundo workspace dentro de su account personal. Misma factura, dos workspaces.
  - **Freelance distributor (Júlia)**: 1 account personal + invitada vía `workspace_membership` a N workspaces de N clientes. Cada cliente paga su account. Júlia ve todos los workspaces simultáneamente en sidebar (cross-account, Slack-like).
  - **Manager 3-8 artistas**: 1 account "Manager Inc" + N workspaces (uno por artista). Bulk billing.
  - **Agency con 20 clientes**: 1 account "Agency Inc" + 20 workspaces dentro. 1 factura grande.
- **Alternatives considered (rejected)**:
  - **A (solo Stripe, sin schema change)**: rechazado. El concepto "account" queda anémico — solo Stripe lo sabe, Hour interno no. Para admin UI futuro (gestionar workspaces del account, transferir workspace de un account a otro, listar workspaces que pago) hay que volver a tocar schema.
  - **C (account anémico solo billing, sin membership scope)**: rechazado. Si el account no tiene membership propia, no hay forma de expresar "Marco es admin de su account y puede crear workspaces ahí, pero Anouk no" — la autorización queda fuera del schema.
  - **Basecamp-strict (un user pertenece a UN account a la vez)**: rechazado. Contradice el sidebar multi-house del boceto. El research §5 lo descarta también: "the freelancer's personal workspace... client workspaces are 'rooms they visit'" — un user atraviesa accounts.
- **Mecánica del cambio** (migración `add_account_layer`, ver `build/migrations/2026-05-18_add_account_layer.sql`):
  - Nuevos enums: `account_kind` ('personal' | 'team'), `account_role` ('owner' | 'admin').
  - Nueva tabla `account` (slug + previous_slugs + name + kind + billing_email + country + timezone + settings + custom_fields + created/updated/deleted_at). Unique index global sobre `(slug) WHERE deleted_at IS NULL`. set_updated_at + validate_slug triggers. RLS FORCE.
  - Nueva tabla `account_membership` (account_id, user_id, role, invited_at, accepted_at, revoked_at). Composite PK. Index por user_id. RLS FORCE.
  - **`workspace.account_id uuid NOT NULL`** añadida con FK references account. Backfill: 3 accounts iniciales para los 3 workspaces existentes (marco-rubiol-acc, mamemi-acc, playwright-acc). Marco es owner de marco-rubiol-acc + mamemi-acc; playwright es owner de playwright-acc.
  - 4 RLS policies en `account` (select por membership aceptada; insert any authenticated; update solo owners; con check espejo del using).
  - 4 RLS policies en `account_membership` (select para propio user o admins/owners; insert para admins + bootstrap por self cuando account vacío; update para admins+owners; delete solo owners).
  - **`handle_new_user` trigger actualizado**: nuevos signups crean account personal PRIMERO + account_membership (owner) ANTES del workspace personal y su workspace_membership. Slug del account es `{user-slug}-acc` (sufijo `-acc` para evitar colisión con workspace slug).
  - Sin audit trigger en account/account_membership por ahora (write_audit espera workspace_id, account no lo tiene). Account-level audit llega cuando admin UI lo necesite (Phase 1).
- **Verificación post-migration**:
  - 3 accounts + 3 account_memberships + 3 workspaces, todos con account_id NOT NULL. Marco es owner de 2 accounts (personal + MaMeMi). Playwright es owner de 1 (playwright).
  - `pnpm check` 0/0/0, `pnpm build` verde, `pnpm test:smoke` pasa 1.8s. db-types.ts regenerado con `account` y `account_membership` types.
  - Frontend untouched — sidebar sigue mostrando workspaces. La capa account es invisible al user hoy; emerge solo cuando llegue Settings → Account management (Phase 1).
- **Lo que NO cambia ahora**:
  - UI: el sidebar muestra workspaces (los 3 actuales), no accounts. "Account" aparecerá user-facing solo cuando llegue Phase 1 admin UI.
  - RLS workspace-level: sin cambios. Todo el acceso a engagements/sections/shows sigue vía `workspace_membership` + `has_permission()`.
  - Code de aplicación: cero. La regeneración de db-types es la única huella en frontend.
- **Lo que queda preparado para Phase 1**:
  - Stripe wiring: añadir `account.stripe_customer_id text` + `account.stripe_subscription_id text` + `account.plan_tier text` cuando llegue billing. Cero refactor schema-level.
  - Admin UI: Settings → "Manage account" para owners (manage members, view billing, list workspaces of this account).
  - Workspace creation flow: cuando un usuario quiera crear un nuevo workspace, escoge a qué account adscribirlo (default: su personal). Si crea uno nuevo de tipo team, se crea otro account `kind='team'`.
- **Re-evaluate when**:
  - Si emerge que un workspace necesita pertenecer a múltiples accounts (caso atípico: agency Y cliente comparten un workspace y se reparten coste) — añadir tabla join `workspace_billing_split`. No previsto.
  - Si Phase 1 multi-workspace switching encuentra que el JWT `current_workspace_id` claim no escala bien con accounts grandes (10+ workspaces por user), reconsiderar el claim a `current_account_id` o equivalente.
- **Status**: Firm. Migración aplicada en producción 2026-05-18.

## [2026-05-18] — ADR-031 — Rename `line` → `section` y ampliar `kind` enum (Project intermedio del modelo)

- **Decisión**: renombrar la tabla `line` a `section` (y sus columnas `line_id` → `section_id` en `asset_version`, `expense`, `show`). Renombrar el enum `line_kind` → `section_kind` y añadirle cuatro valores (`creation`, `campaign`, `comms`, `misc`) además de los seis existentes (`tour`, `season`, `phase`, `circuit`, `residency`, `other`). El enum `line_status` se renombra a `section_status`. Esto consolida el "nivel intermedio entre Project y Show" del modelo conceptual decidido en la conversación 2026-05-18 — la sección es el contenedor abstracto, la variedad vive en el `kind`.
- **Context**: ADR-005 (2026-04-19) introdujo `line` con la semántica de touring (definido literal como "tour, season, festival circuit, residency block"). El boceto que Marco compartió 2026-05-18 reveló que el nivel intermedio que él imagina **también incluye cosas que no son touring**: "Next creation (untitled)" (fase de creación, sin shows), "Distribution 26/27" (campaign de difusión), "Communication & press" (campaign), "One-offs" (misc bucket). Forzar esos kinds dentro del nombre `line` chirría conceptualmente — el nombre es industry-slang de touring, no concepto abstracto.
- **Alternatives considered (rejected)**:
  - **Opción A: mantener `line`, solo expandir el enum** (`ALTER TYPE line_kind ADD VALUE 'creation', 'campaign', ...`). Cero rename. Rechazado: la palabra `line` chirría en código, docs, conversaciones por años; ahorrar 2h ahora a cambio de fricción mental crónica es un mal trade.
  - **Opción C: mantener `line` en schema, cambiar solo el UI label a "Section"**. Inconsistencia interna schema-vs-UI permanente. Rechazado: el coste del rename (2h) era pequeño relativo a la deuda mental.
  - **Modelo recursivo (parent_project_id en `project`)**: descartado anteriormente (la conversación lo evaluó). YAGNI, complica RLS y UI, Basecamp explícitamente no lo hace.
- **Rationale**:
  1. **Coherencia con la convención `date.kind` ya en el schema**. La tabla `date` se llama por el concepto abstracto (calendar primitive); su `kind` enum carga la variedad (`rehearsal`, `travel_day`, `press`, `other`). `section` aplica la misma lógica: tabla abstracta + enum cargando la diversidad.
  2. **Encaja la realidad del boceto sin forzarla**. Cinco tipos de section conviven naturalmente: SEASON, CREATION, CAMPAIGN, COMMS, MISC. Cada uno con sus shows o sin (campaign + comms + creation pueden no tener shows; season + tour normalmente sí).
  3. **El research de Basecamp valida la simplificación pero no la elimina del todo**. Basecamp colapsó Teams/HQ/Projects a UN concepto en 2022 porque su dominio no necesitaba intermedios con identidad. Hour SÍ los necesita (un season tiene miembros, budget, assets propios). Mantener tres niveles (Project + Section + Show) + tenant invisible es el equilibrio entre Basecamp-flat y over-engineering recursivo.
- **Mecánica del cambio aplicada** (migración `rename_line_to_section`, ver `build/migrations/2026-05-18_rename_line_to_section.sql`):
  - DROP de la view `show_redacted` (depende de `show.line_id`).
  - DROP de 10 RLS policies que referencian `line` directa o vía helper functions (3 de `line`, 4 de `asset_version`, 3 de `expense`).
  - DROP de 2 helper functions (`project_id_of_asset_version`, `project_id_of_expense`) que tenían `p_line_id` como parámetro.
  - `ALTER TABLE line RENAME TO section`.
  - `ALTER TABLE ... RENAME COLUMN line_id TO section_id` en 3 tablas (`asset_version`, `expense`, `show`).
  - `RENAME CONSTRAINT` de 3 FKs.
  - `ALTER TRIGGER ... RENAME` de 5 triggers (`line_audit` → `section_audit`, etc.).
  - `ALTER TYPE line_kind RENAME TO section_kind`; `ALTER TYPE line_status RENAME TO section_status`.
  - CREATE OR REPLACE de las 2 helper functions con `p_section_id` y referencia a `public.section`.
  - CREATE de las 10 RLS policies con nombres y referencias actualizadas.
  - CREATE OR REPLACE de la view `show_redacted` con `section_id` en lugar de `line_id`.
  - Separadamente (non-transactional): `ALTER TYPE section_kind ADD VALUE 'creation', 'campaign', 'comms', 'misc'`.
- **Verificación post-migration**:
  - Tabla `section` existe; tabla `line` desaparece.
  - 4 columnas `section_id` (3 tablas + 1 view); 0 columnas `line_id`.
  - Enum `section_kind` con 10 valores: tour, season, phase, circuit, residency, other, creation, campaign, comms, misc.
  - 154 engagements + project mamemi intactos. `pnpm check` 0/0/0; `pnpm build` verde; smoke test pasa en 2.3s.
- **Código afectado**:
  - `apps/web/src/lib/db-types.ts` regenerado vía Supabase MCP. 31 referencias a `section`, 0 a `line`.
  - No hay referencias a `line` en código de aplicación (el Phase 0.1 no había construido UI de runs/lines todavía). Cero edits manuales necesarios.
- **Nombre user-facing TBD**: schema dice `section`, pero el UI label cuando aterricen los componentes Phase 0.2+ puede ser "Season", "Phase", "Track" o "Section" mismo. Cada section render visualmente puede usar su `kind` como eyebrow (SEASON / CREATION / CAMPAIGN / etc.), como hace el boceto.
- **Supersedes**:
  - ADR-005 (línea: `line` como "tour, season, festival circuit, residency block"). Rationale del entity sigue válido pero el concepto se generaliza; el nombre cambia.
- **Re-evaluate when**:
  - Si emerge un kind nuevo que no encaja en los 10 actuales (ej. "fundraising", "research-residency"), añadir al enum sin renombrar la tabla.
  - Si Phase 0.5 trae task entity (D3) y las "sections" empiezan a usar tasks específicas, evaluar si el modelo recursivo (sub-sections) emerge como necesidad real. Hoy sin evidencia, no se construye.
- **Status**: **Superseded** por ADR-035 (2026-05-19). Naming gate vivido con UI productiva produjo lectura inversa: `line` funciona genéricamente, el chirría estaba sobre-estimado. Schema revertido a `line`. ADR-031 queda como histórico del proceso de validación.

## [2026-05-18] — ADR-030 — Naming gate close: lens primaria "Plaza" + project rename a "Difusión 2026-27"

- **Decisión** (dos cambios atómicos):
  1. **Lens primaria renombrada `Rooms` → `Plaza`**. Supersede parcialmente ADR-029 (la línea que decidió "Desk lens → Rooms lens"). El sidebar upper (componente `Plaza.svelte`) y la lens primaria se llaman ahora igual a propósito — son la misma idea conceptual desde dos ángulos: el sidebar es la navegación visual de la plaza, la lens es el modo de trabajar en ella.
  2. **Project `mamemi` display name renombrado "MaMeMi" → "Difusión 2026-27"**. Slug se mantiene como `mamemi` (no URL break). Workspace MaMeMi (House) y Room/project Difusión 2026-27 dejan de coincidir visualmente.
- **Context**: naming gate al final de Phase 0.1 (decisión 2026-05-14, adelantado del final de 0.4). Marco previewed la UI viva con datos productivos y cazó dos confusiones reales:
  - **Confusión 1 — "MaMeMi" significa cosas distintas en sitios distintos**. Aparecía 3 veces: como House (workspace team), como Room (project dentro), y como display name en sidebar lower + main header. Era un artefacto del seed inicial pre-ADR-029: cuando el workspace era `marco-rubiol` y el project se llamaba `MaMeMi`, el nombre era único. Tras la migración multi-workspace de ADR-029 ese nombre quedó duplicado.
  - **Confusión 2 — Tautología "Rooms lens + sidebar lists rooms"**. ADR-029 renombró la lens primaria de "Desk" a "Rooms" (porque "Desk sin task entity no aporta — strategy review §3"). Pero el sidebar Plaza ya **lista las rooms del usuario**. Tener una lens llamada "Rooms" mientras estás mirando el sidebar que lista las Rooms = redundancia visible que no aporta señal.
- **Por qué "Plaza" (no otro nombre)**:
  - **Era el nombre canónico desde ADR-009 + ADR-022**: "the composable UI model defined in ADR-009 and refined 2026-04-24 (Plaza + Desk + Views + chip bar + multi-select)". Plaza siempre fue el sidebar; ADR-029 lo mantuvo. Lo que se perdió en ADR-029 fue la lens: cambiándola a "Rooms" la saqué de la coherencia con Plaza, en vez de mantener un nombre que refleja el modo de trabajo en la plaza.
  - **Coherencia conceptual**: Plaza el componente + Plaza la lens describen la misma realidad operativa. Calendar / Contacts / Money son cortes transversales (tiempo / personas / dinero) del mismo mapa que la Plaza navega.
  - **Resuelve la tautología sin inventar un nombre nuevo** ("Work" / "Today" / "Plate" eran las alternativas evaluadas — todas más débiles porque cada uno carga semántica que Hour aún no entrega: tasks, urgencia, plato del día).
- **Por qué "Difusión 2026-27"** para el project name:
  - **Describe literalmente qué es**: bucket de los 154 contactos del circuito de difusión de la temporada 2026-27 (anti-CRM vocabulary, `engagement` rows con `custom_fields.season='2026-27'`).
  - **No genérico** (no "Temporada 2026-27" que daría igual) y no específico de un show (no "Ombra 2026" porque la difusión cubre todo el repertorio MaMeMi 2026-27).
  - **Phase 0.5+** Marco puede crear projects más finos ("Ombra", "Nocturnes") dentro del workspace MaMeMi cuando emerja la necesidad — el slug `mamemi` queda como el "catch-all de difusión" y los específicos vendrán al lado.
- **Alternatives considered (rejected)**:
  - **Mantener "Rooms" lens y aceptar la tautología** — rechazado por Marco frente a la UI viva, criterio del naming gate: si una persona externa se confunde, cambia. Marco cazó la confusión en sí mismo dentro de la sesión.
  - **Eliminar la lens primaria** (solo Calendar / Contacts / Money como modos, sin un "modo default") — rechazado. La lens primaria ancla el estado de la app cuando no estás filtrando por tiempo / personas / dinero. Sin ella, la pantalla queda sin etiqueta del modo activo.
  - **Renombrar el slug del project** (`mamemi` → `difusion-2026-27`) — diferido. El display name cambia (visible al usuario); el slug no se toca para no invalidar URLs guardadas, links potencialmente compartidos, o el Master View path de Marco. `previous_slugs[]` lo cubriría si en el futuro se rename, pero por ahora no compensa el coste.
- **Mecánica del cambio aplicada**:
  - **DB**: `UPDATE project SET name='Difusión 2026-27' WHERE slug='mamemi'` vía MCP. Audit trigger captura el cambio. Slug, workspace_id, y todas las FKs intactas.
  - **Código**: `apps/web/src/lib/stores/lens.svelte.ts` — type `Lens` cambia `'rooms'` → `'plaza'`, default también. `apps/web/src/routes/h/[workspace]/+layout.svelte` — `lensOptions[0]` cambia id+label, `provideLens('plaza')`. `apps/web/tests/smoke.spec.ts` — selector + variable rename.
  - **Display name** aparece consistente: sidebar Plaza shows "Difusión 2026-27" como room name, RoomStructure (sidebar lower) shows "Difusión 2026-27" via TanStack cache, Room detail h1 shows "Difusión 2026-27". Una sola fuente, tres consumidores.
- **Supersedes**:
  - ADR-029 línea "Lens primaria: Desk → Rooms". El resto de ADR-029 (shell user-scoped, lens nav top, RoomStructure replaces Desk component, empty home state) queda firme.
- **Re-evaluate when**:
  - Si "Plaza" se confunde en testing externo con Anouk / Electrico 28 / otros — improbable porque Plaza es palabra neutra (no compite con sala/venue, no carga semántica funcional como "Desk"), pero el gate de Phase 0.4 (checkpoint visual 2 + naming gate ratificación) lo confirma.
  - Si Phase 0.5 trae task entity (D3) — entonces "Desk" como nombre podría reaparecer como lens secundaria con sentido propio (Desk-with-actions). Plaza queda como modo de navegación, Desk como modo de trabajo accionable.
- **Status**: Firm. Cambios aplicados en producción 2026-05-18.

## [2026-05-18] — ADR-029 — Shell user-scoped: multi-workspace en sidebar + lens nav top + Desk lens → Rooms

- **Decisión**: el shell de la app se reestructura en torno a un **sidebar user-scoped** (no workspace-scoped) que muestra simultáneamente todas las Houses del usuario y, debajo de cada House, sus Rooms. La **lens nav pasa del sidebar al top del main** como pills horizontales (`Rooms` · `Calendar` · `Contacts` · `Money`). La primera lens se llama **`Rooms`** (no `Desk`). Cuando una Room está seleccionada, el **sidebar lower** muestra la estructura interna de esa Room (Runs colapsables → Gigs) — esto reemplaza el componente `<Desk>` que el roadmap original preveía. El URL sigue siendo path-prefix per workspace (`/h/[workspace]/[entity]/[slug]`, ADR-022 vigente); solo cambia que el sidebar transciende el URL.
- **Context**:
  - **Trigger 2026-05-18**: Marco compartió mockups (ver chat) con multi-house en sidebar, lens nav en top, y `Rooms` en vez de `Desk` como primera lens. Su instinto cazó tres incoherencias antes de implementarlas:
    1. ADR-009 dice "Sidebar entities (bottom): flat list of Houses → Rooms" en plural — sidebar siempre fue user-scoped por diseño, pero la implementación de Phase 0.0 lo construyó workspace-scoped por la simplicidad de path-prefix (ADR-022).
    2. Roadmap Phase 0.1 introducía dos componentes con el mismo nombre `Desk`: la lens (modo de vista) y el sidebar lower (tree Runs→Gigs). Collision de naming reconocido como riesgo #14.
    3. Lens nav vertical en sidebar es una elección no convencional sin justificación de research; top horizontal es lo que hacen Linear/Notion/GitHub y match con la recomendación "Desk skeleton + Rhythm soul" de `research/product/14-ux-proposals.md`.
  - **Respaldo en research** (no opinión, evidencia):
    - **`research/profiles/99-patterns.md §5`** "The multi-tenant freelance reality": "one human, multiple organisations, each with partial visibility... **the freelancer's personal workspace is Hour's home view for them, not a sidebar. Client workspaces are 'rooms they visit'.**" Es la arquitectura fundacional, no un add-on Phase 2 (recommendation #2 del strategy review).
    - **`research/product/20-product-strategy-review.md §3` (Desk)**: "Desk metaphor good only if it becomes actionable. **A Desk without tasks, next actions, waiting items, or due work is just navigation**." Sin task entity en Phase 0 (D3 deferred), `Desk` lens promete acción que no podemos delivery. `Rooms` describe lo que se ve sin prometer comportamiento.
    - **`research/product/14-ux-proposals.md` recommendation**: "Hybrid: Desk skeleton + Rhythm soul. Base structure: dual-mode sidebar + main panel. Inside the panel: **modes/lenses logic** (Rhythm) instead of fixed tabs." Lens nav en top del main es la forma idiomática de este patrón.
    - **`architecture.md §4`**: "The tenant is called a workspace (not 'organization') because it holds both personal setups (`kind='personal'`) and team setups (`kind='team'`) — **this matches the multi-hat freelance reality**". El schema ya soporta multi-workspace per user; solo la UI no lo aprovechaba.
- **Cambios concretos**:
  1. **DB (migration `phase_0_1_multi_workspace_split` aplicada 2026-05-18)**:
     - Workspace `marco-rubiol` (kind=`personal`) **se mantiene** como House personal de Marco.
     - Nueva workspace `mamemi` (kind=`team`) creada como House del colectivo. Marco owner + playwright admin (este último para no romper el smoke test).
     - Project `mamemi` + sus 154 engagements movidos de `marco-rubiol` a `mamemi`. Los triggers `guard_immutable_workspace_id` (project + engagement) se deshabilitan temporalmente durante la migración y se vuelven a habilitar.
     - El JWT `current_workspace_id` claim sigue inyectándose pero deja de ser la primary scoping mechanism — las RLS ya son membership-based (`is_workspace_member()` + `has_permission()`), así que multi-workspace queries funcionan sin refactor RLS adicional.
  2. **API**:
     - `/api/houses` ya devolvía membership-based — ahora devuelve 2 rows para Marco.
     - `/api/rooms` ya no filtra por current_workspace_id — devuelve projects de TODAS las workspaces del user. Sin refactor de código necesario; RLS lo gestiona.
  3. **UI shell**:
     - **Lens nav** mueve del sidebar al top del main. Pills horizontales. Cuatro lenses: `Rooms` · `Calendar` · `Contacts` · `Money` (extensible).
     - **Plaza** (sidebar upper) renderiza multi-house tree: cada House es un header + lista indentada de Rooms. Single-select sigue siendo per Room (vía URL).
     - **RoomStructure** (sidebar lower, componente nuevo): visible solo cuando hay Room seleccionada. Muestra Runs colapsables → Gigs. Empty state "Select a Room to see its structure".
     - **Empty home main**: cuando lens=`Rooms` y sin Room seleccionada → "Hello, Marco. What would you like to work on?" centrado.
     - **`<Desk>` componente del roadmap original**: NO se construye. Funcionalidad absorbida por `<RoomStructure>` + `Rooms` lens.
  4. **Naming**:
     - Lens primaria: `Desk` → `Rooms`. Cambia i18n keys, copy en sidebar/top, componentes referenciantes.
     - **`Desk` como término desaparece del producto en Phase 0**. Si emerge Desk-with-actions en Phase 0.5+ (task entity D3 cuando llegue), se decide entonces si vuelve como nombre de lens o tab.
  5. **Multi-select y "All" chip**: visualmente preparados (checkboxes en Houses+Rooms del sidebar, chip "All" arriba a la derecha) pero **sin funcionalidad real en este sprint**. Wiring real con chip bar D-PRE-05 va a Phase 0.2. "All" es indicador pasivo de "no filter active" por ahora.
- **Supersede**:
  - **ADR-008** "Product vocabulary": la línea "Plus **Desk** = the primary UI lens" queda obsoleta. Las cuatro lenses Phase 0 son `Rooms` · `Calendar` · `Contacts` · `Money`. House/Room/Run/Gig mantienen significado.
  - **ADR-009** "UI architecture": el dual-mode sidebar mantiene el espíritu (Plaza + RoomStructure son el dual mode) pero la lens nav YA NO vive en sidebar — vive en top. Texto del ADR-009 "Lenses (sidebar top)" queda obsoleto; el resto (Rooms lens + Room sidebar selected = destination; otras lenses = filter) sigue válido.
  - **Roadmap Phase 0.1**: trabajo #2 (`<Desk>` componente) se reemplaza por `<RoomStructure>`. Trabajos #6 (endpoints runs/gigs) y siguientes mantienen su orden pero se construyen sobre el shell nuevo.
- **Mantiene firme**:
  - **ADR-022** path-prefix URL `/h/[workspace]/...`. El URL sigue siendo per workspace; solo el sidebar transciende.
  - **ADR-027** "Phase 0 transversal MVP". Este cambio refuerza la tesis: la estructura completa (Houses, Rooms, lenses) se ve desde el primer momento.
  - **ADR-024** slug naming. Sin cambios en slugs.
  - **Person GLOBAL** (decisión 2026-05-01). Multi-workspace sidebar refuerza la utilidad de Person global: una persona puede aparecer en engagements de Houses distintas sin duplicarse.
- **Alternatives considered (rejected)**:
  - **Subdomain per workspace** (`mamemi.hour.zerosense.studio` + `marco-rubiol.hour.zerosense.studio`): rechazado por ahora, mismas razones que en `build/archive/2026-05-url-architecture-dossier.md` (infra cost desproporcionado para 2 workspaces). Migration path queda documentado para Phase 1 si llegan vanity domains.
  - **Mantener single-workspace per URL Y per sidebar** (status quo Phase 0.0 que construí): rechazado. Contradice `99-patterns §5` directamente. Para Marco mismo (case 05+08 del perfil research) Hour sería peor que su tooling actual.
  - **Renombrar workspace `marco-rubiol` a `mamemi` + crear nuevo `marco-rubiol-personal`**: rechazado por ser destructivo sin beneficio. La opción aplicada (mantener `marco-rubiol`, crear `mamemi` separado, mover project) es menos invasiva y refleja mejor la realidad: el workspace `marco-rubiol` siempre fue Marco personal por slug, solo tenía el proyecto MaMeMi dentro por inercia.
  - **Mantener `Desk` como nombre de la lens primaria + renombrar el componente sidebar lower**: rechazado. El strategy review §3 advierte que `Desk` sin task entity es navegación vacía. Aprovechamos el momento (sin clients externos) para alinear nombre con realidad de lo que entrega.
- **Re-evaluate when**:
  - Si en checkpoint 1 (final Phase 0.1) Anouk u otros confunden alguna parte del vocabulario nuevo, especialmente "House"/"Room"/"Rooms lens".
  - Si llegamos a Phase 0.5+ con task entity (D3) y emerge utilidad para una "Desk" lens con next actions reales — re-evaluar si vuelve, y bajo qué nombre.
  - Si Phase 1 multi-workspace con N>5 workspaces hace que el sidebar plano (todas las Houses + Rooms simultáneas) sea inmanejable — entonces evaluar colapsado por defecto, búsqueda, o vanity subdomains.
- **Status**: Firm. Migration aplicada en producción 2026-05-18.

## [2026-05-18] — ADR-033 · Vocabulario UI: revertir a industria-standard + design system v0.5
- **Decisión**: UI usa vocabulario industria-standard — sidebar items se etiquetan **Projects**, primera lens se renombra **Today** (era `Plaza`, antes `Rooms`, antes `Desk`). Sections se llaman **Lines** en copy. Shows mantiene **Shows**. Schema **no** cambia (sigue con `account`/`workspace`/`project`/`section`/`show` técnicos). Componentes internos mantienen `Plaza.svelte` (sidebar upper) y el sistema de pills se llama `Desk` conceptualmente — son nombres de implementación, no aparecen en copy visible al user.
- **En paralelo**: paleta plum (`oklch(0.50 0.14 335)`) se retira como primary brand color; `--primary` se reasigna a `var(--text-color)` (cool ink). El visual editorial-sobrio del design system v0.5 (Newsreader + Inter + JetBrains Mono, surfaces warm-cream, ink cool, state colors para lifecycle, tag tones pastel, 8 accents abstractos por hash de slug) reemplaza el visual plum-anchored.
- **Context**: Marco compartió un design system completo (HTML de referencia) + captura de la vista Today. El design no usa plum en ningún sitio visible y trata el vocabulario interno como industria-standard. El timing coincide con dos gates ya planificados:
  - **Checkpoint visual 1** (2026-05-14): "1 día con datos productivos para evaluar plum trial, densidad, jerarquía". Este refresh ES ese checkpoint.
  - **Naming gate** (2026-05-14): testear vocabulario House/Room/Run/Gig vs alternativas. El design system fuerza la decisión.
- **Trade-offs**: el vocabulario nuevo pierde diferenciación de marca (cualquier SaaS dice "Projects"), pero gana cero fricción cognitiva — Marco y Anouk no tienen que traducir cuando hablan con técnicos/programadores/colaboradores. El estudio de 8 perfiles en `research/` confirmó que el vocabulario propio sólo paga cuando hay un mental model distinto que defender; House/Room/Run/Gig no lo defendía, sólo redecoraba.
- **Cambios concretos en este sprint**:
  1. `apps/web/src/styles/tokens.css` — reescrito. Mantiene 3 categorías (philosophy.md). Surfaces+ink+state+accents+tag-tones del design system. Plum eliminado. Fuentes Newsreader/Inter/JetBrains Mono.
  2. `apps/web/src/app.html` — Google Fonts (Newsreader+Inter+JetBrains Mono) con preconnect+display=swap. Theme-color a `#f7f5ef`.
  3. `apps/web/src/lib/utils/accent.ts` — helper `accentIndex/accentVar/accentStyle` para mapping `slug → --accent-N` por hash FNV-1a determinístico.
  4. `apps/web/src/lib/stores/lens.svelte.ts` — `Lens` enum: `plaza` → `today`. Default `today`.
  5. `apps/web/src/routes/h/[workspace]/+layout.svelte` — `lensOptions` label `Plaza` → `Today`. Sidebar `label="Houses and rooms"` → `label="Projects"`.
  6. `apps/web/src/lib/components/Plaza.svelte` — copy: aria-label, empty/error states migran a "projects".
  7. Pendientes en Phase C-E del plan: nuevos primitivos (Pill/FilterChip/TagChip/RoleChip/StateBadge/Kbd), repaint shell (Phase D), vista Today (Phase E).
- **Supersede**:
  - **ADR-008** "Product vocabulary": House/Room/Run/Gig/Desk como vocabulario de UI queda obsoleto. Schema technical names sobreviven internamente.
  - **ADR-030** "Plaza lens": el rename `Rooms` → `Plaza` queda obsoleto. La lens ahora es `Today`. El componente `Plaza.svelte` mantiene su nombre interno por continuidad — coincidencia conceptual: la plaza es tu mapa de trabajo, today es el modo de trabajarlo.
  - **Paleta plum** (decisión 2026-05-01): retirada. Marcada en su momento como "provisional, re-evaluar checkpoint visual 1". Re-evaluación negativa.
- **Mantiene firme**:
  - **ADR-022** path-prefix URL. Las rutas `/h/[workspace]/room/[slug]/` se mantienen sin rename inmediato — coste 30 min con 301 redirect, se ejecuta cuando un user externo lo note (Phase 0.9+).
  - **ADR-029** shell user-scoped + lens nav top. Estructura intacta.
  - **ADR-031** schema rename `line` → `section` con kind enum 10 valores. Sin cambios.
  - **ADR-032** account layer above workspace. Sin cambios.
- **Asunción Phase 0**: la sidebar lista WORKSPACES (no schema `project`s). Hoy renderiza 2 reales (`marco-rubiol`, `mamemi`); los 5 items que muestra el design HTML son mockup conceptual para cuando el usuario crezca. La decisión "project schema como agrupación visible separada" se difiere hasta que Marco cree el primer schema `project` distinto del workspace homónimo.
- **Re-evaluate when**:
  - Si un cliente externo (Phase 1) pide vocabulario propio del sector — re-evaluar branding (no schema).
  - Si la vista Today con datos productivos resulta plana o sobre-densa tras 1 día de uso — ajustar typescale o density mode (cozy → spacious).
  - Si Marco crea primer schema `project` distinto del workspace homónimo y necesita representación visual separada — decidir entonces shape de sidebar (aplanar cross-workspace vs anidar).
- **Status**: Firm. Phase A+B aplicadas 2026-05-18. Phase C-E pendientes (~2-3 días).

## [2026-05-19] — ADR-039 · Keep `/h/` URL prefix (re-evaluated decision)
- **Decisión**: Mantener el prefix `/h/` en todas las URLs autenticadas del app (`/h/`, `/h/[ws]/`, `/h/[ws]/project/[slug]/`, etc.). Decisión revisitada al refactorizar el shell upstairs (ADR-038 sidebar filter system requería mover shell de `/h/[workspace]/+layout` a `/h/+layout`).
- **Context**: Durante la sesión 2026-05-19 mañana, surgió el problema de ambigüedad: `/h/[ws]/` significaba a la vez "browsing context" y "1 workspace selected". El refactor shell-up resolvía esa ambigüedad (`/h/` = empty selection, `/h/[ws]/` = workspace selected). Surgió la pregunta lateral: ¿aprovechamos para dropear el prefix `/h/` entero, ya que es vestigial desde que ADR-033 mató "House" como vocab?
- **Alternatives considered (rejected)**:
  - **Drop prefix entero** (URLs `/[ws]/`, `/[ws]/project/[slug]/`): rechazado. La subdomain `hour.zerosense.studio` ya namespacea el app, pero el dominio es provisional (brand decision deferred to Phase 1). Mantener `/h/` deja `/` libre para Phase 1 marketing/landing/docs/billing sin colisión.
  - **Rename prefix** (`/app/`, `/me/`, `/now/`): rechazado. `/app/` es SaaS-generic sin Hour-identity. `/me/` poético pero English-only (no traduce limpio a "mí" en URL). `/now/` ambiguo. Cambiar la letra sin cambiar el concept es churn cosmético.
- **Trade-offs**:
  - **Pro keep**: opcionalidad Phase 1 (`/` libre para marketing/docs/admin), separación cognitiva app/público/API, reserved-slug list queda contenida a app-level concerns en lugar de cubrir cada top-level route imaginable.
  - **Pro drop**: URLs 2 chars más cortas, subdomain ya namespacea (double-namespace), `h` es vestigial sin significado semántico.
  - Marco pushback: "no lo mantengamos por el coste del refactor, mantengámoslo si es realmente la mejor opción". Re-evaluación honesta confirma keep por opcionalidad, no por inercia.
- **Re-evaluate when**:
  - Phase 1 cierra dominio brand-pure (`hour.app`, etc.) con marketing pages reales. Con datos sobre qué rutas viven en `/`, evaluar si keep sigue siendo el mejor balance o si drop emerge como mejor opción.
  - Si el reserved-slug list (`apps/web/src/lib/reserved-slugs.ts`) empieza a explotar con cada nueva top-level route imaginable, replantear el modelo de namespacing.
- **Status**: Firm para Phase 0. Re-evaluate at Phase 1 brand+domain decision.

## [2026-05-19] — ADR-038 · Sidebar como filtro multi-select (Plaza = filter, LineList = always visible)
- **Decisión**: Plaza pasa de navegación jerárquica con un proyecto activo a **filtro multi-select** sobre workspaces × projects. LineList pasa de "lines del project activo o vacío" a **siempre visible**, filtrada por la selección activa. Selección persiste en URL (canonical paths cuando colapsa a un solo entity; query params `?ws=&project=` cuando es multi) + localStorage como fallback al aterrizar en `/h/` vacío.
- **Context**: Marco pidió 2026-05-19 mañana que la sidebar refleje el modelo mental "compañía → producción → fase de trabajo" como filter chain en vez de navegación exclusiva. El detail de project sigue existiendo pero emerge como CONSECUENCIA de tener un solo project en filter, no como ruta primaria. La idea de fondo: cuando hay nada filtrado, ves TODAS las lines de trabajo accesibles ordenadas por last-used. Cuando filtras workspace A + project B (de workspace C), ves la unión de sus lines.
- **Behavior matrix LineList**:
  | Filter state | Lines mostradas |
  |---|---|
  | Vacío | Todas accesibles por RLS, sort by last_navigated_at desc |
  | 1 workspace | Lines de proyectos de ese workspace |
  | 1 project | Lines de ese project |
  | N workspaces | Union de sus proyectos |
  | N projects | Union directa |
  | Mix workspace + project orthogonal | Union (proyectos del workspace + project explícito) |
- **URL design** (vote 3A 2026-05-19):
  - Canonical cuando la selección colapsa a un entity: `/h/[ws]/`, `/h/[ws]/project/[slug]/`, `/h/[ws]/project/[slug]/line/[line]/`.
  - Query params para multi: `/h/[ctx-ws]/?ws=a,b&project=c,d` (anchored en la workspace de browsing context — `/h/?...` no existe porque el shell vive en `[workspace]/+layout`).
  - Query params toman precedencia sobre canonical path al parsear (intent explícito gana).
- **Trade-offs**:
  - **Path workspace ≠ selected workspace**. El path `/h/[ws]/` es "browsing context" (qué workspace shell renderiza), no implica que ese workspace esté seleccionado. Marco confirmó 2026-05-19 que `/h/[ws]/` sin query params = "nothing selected" (no auto-selecciona workspace).
  - **Project slug ambiguity en URL multi**: si dos workspaces tienen un project con el mismo slug, `?project=mamemi` es ambiguo. Phase 0 no tiene colisiones; namespace tipo `?project=muk-cia:mamemi` se evalúa Phase 1 si ocurre.
  - **`last_navigated_at` global, no per-user**. Phase 0 con 1-5 users del mismo workspace es suficiente. Junction table `line_visit` si Phase 1 lo pide.
- **Schema entregado** (1 column + 1 RPC + 1 index nuevo):
  - `line.last_navigated_at timestamptz` nullable, backfilled con `updated_at` para baseline order.
  - Index `line_last_navigated_idx` partial WHERE deleted_at IS NULL.
  - RPC `touch_line_visit(p_line_id uuid)` SECURITY DEFINER, valida `is_workspace_member(workspace_id)` antes de tocar.
- **App-layer entregado**:
  - `selection.svelte.ts` rewrite a multi-select (workspaces Set, projects Set, projectWorkspaceMap, contextWorkspace, hydrateFromUrl, previewUrlAfterToggle*).
  - `Plaza.svelte` workspace + project rows como `<a>` con href computado por preview. Visual `--selected` (filled + primary tint). Chevron expand/collapse independiente. `--on-path` retirado (no semantic clear en multi-select).
  - `LineList.svelte` lee SelectionStore, resuelve slugs a IDs via cached projects/workspaces queries, fetch /api/lines con project_ids + workspace_ids. Render flat list con "in <project>" subtitle cuando hay >1 project en scope. Active line highlight por URL match.
  - `/api/lines` endpoint: project_id opcional, añadidos project_ids/workspace_ids/sort by last_navigated_at desc.
  - `/api/lines/visit` endpoint (POST): proxy a RPC touch_line_visit.
  - Line detail page: `$effect` que llama al endpoint visit cuando activeLine.id cambia.
  - `/h/+page.svelte` fallback: redirect a user's primer workspace preservando query params (cobertura de direct-hits y bookmarks que aterricen en /h/).
- **Migration SQL**: `build/migrations/2026-05-19_add_line_last_navigated_at.sql`.
- **Re-evaluate when**:
  - Si emerge friction en multi-select projects con slug colisiones cross-workspace (Phase 1) → namespace `?project=ws:slug`.
  - Si tracking global de last_navigated_at genera confusión con múltiples users del mismo workspace (Phase 0.5+) → junction `line_visit (line_id, user_id, at)`.
  - Si "current_workspace_id" claim del JWT diverge de la `contextWorkspace` (browsing path) → decidir cuál wins para API queries que dependen del claim.
- **Status**: Firm. Producción 2026-05-19.

## [2026-05-19] — ADR-034 · Tabla `cast_member` a nivel project (cast canónico + override por show)
- **Decisión**: Añadir tabla `cast_member` con scope `(workspace_id, project_id, person_id, role)`. El cast canónico de una producción vive aquí. Las sustituciones puntuales por show continúan en `cast_override` (`replaces_person_id` apunta al `person.id` previamente listado en `cast_member`). Crew sigue exclusivamente en `crew_assignment` (per-show, sin equivalente canónico a nivel project — el dominio lo trata como decisión per-gig).
- **Context**: Phase 0.2 arranca con road sheet. Marco aclara el dominio operativo: en cada producción se asigna un cast base que después puede reasignarse a nivel de show concreto. Mi lectura anterior (option B = todo dentro de `crew_assignment` con `role='performer'`) ignoraba ese modelo — colapsaba cast en una entidad show-scoped cuando la planificación real es project-scoped.
- **Alternatives considered (rejected)**:
  - **B: reusar `crew_assignment role='performer'`**: rechazado. Vivir show-scoped contradice el flujo real (planificar cast una vez, no 20 veces). Reusar la tabla ahorra schema pero obliga a inferir el cast canónico a partir de N rows duplicadas — operativa y conceptualmente sucio.
  - **Unificar `cast_override` dentro de `crew_assignment`** (añadir `replaces_person_id` + `reason` a crew, dropear `cast_override`): rechazado para Phase 0. Mezcla dos modelos (canónico project-scoped + override show-scoped) en una sola tabla. Si emerge la necesidad, se evalúa en Phase 0.5.
  - **Defer cast_member a Phase 0.5**: rechazado. El roadmap arranca road sheet AHORA con datos demo; sin tabla canónica la UI tendría que decidir entre falsear con `workspace_membership` o con N filas duplicadas en `crew_assignment`. Construirlo después de cargar datos cuesta migración; construirlo ahora con producción casi vacía cuesta una tabla.
- **Trade-offs**:
  - **Asimetría intencional cast (project-scoped) vs crew (show-scoped)**. El dominio la pide: cast se planifica una vez con sustituciones puntuales (los actores de la obra cambian raramente), crew se decide por show porque cambia con frecuencia (técnicos freelance distintos por ciudad). Documentado en COMMENT de tabla.
  - **`cast_override` queda como su propia tabla**. La duplicación parcial con `crew_assignment` (estructuralmente similares) se acepta por claridad semántica. Re-evaluar Phase 0.5 si emerge fricción.
  - **`role` freetext**, no enum. Mismo criterio que `crew_assignment.role`. Vocabulario evoluciona por producción (performer/dancer/musician/narrator/co-director); cerrar enum prematuro contradice la philosophy.md "una técnica para todo el dominio".
- **Schema entregado** (1 tabla nueva, 25 tablas totales):
  - `cast_member (id, workspace_id, project_id, person_id, role, joined_at?, left_at?, notes?, created_by, created/updated/deleted_at)`.
  - 4 índices (workspace/project/person + UNIQUE `(project_id, person_id, role)` WHERE deleted_at IS NULL).
  - 3 triggers (`set_updated_at`, `guard_immutable_workspace_id`, `write_audit`) mirroring `crew_assignment`.
  - RLS FORCE + 4 policies (SELECT/INSERT/UPDATE/DELETE) usando `has_permission(project_id, 'edit:show')` — misma gate que crew/show/date. Cast es parte de la data de producción, gobernada por la misma autoridad. Si Phase 0.5 introduce `edit:cast` granular, se actualiza.
- **Migration SQL**: `build/migrations/2026-05-19_add_cast_member.sql`. Aplicada vía Supabase MCP `apply_migration` 2026-05-19. Producción: 25 tablas, 78 RLS policies.
- **Re-evaluate when**:
  - Si Phase 0.5+ con E28 emerge necesidad de `cast_member` history (mismo person actor del 2025-26 al 2026-27 con cambio de rol) — añadir columna `role_history` o segunda tabla.
  - Si `cast_override + cast_member + crew_assignment` empieza a ser difícil de razonar al renderizar road sheet — evaluar unificación parcial.
  - Si `role` freetext genera fricción cross-workspace (Phase 1) por inconsistencias entre clientes — evaluar enum por workspace o vocabulario controlado.
- **Status**: Firm. Producción 2026-05-19.

## [2026-05-19] — ADR-036 · Rename `show` → `performance` + data reorg MüK Cia/MaMeMi (naming gate sesión 2026-05-19)
- **Decisión**: Dos cambios atómicos durante la pausa de naming de 2026-05-19:
  1. **Data reorg**: workspace `mamemi` renombrado a `muk-cia` (display "MüK Cia") + project display "Difusión 2026-27" revertido a "MaMeMi" (slug `mamemi` se queda) + nueva line `difusion-2026-27` (kind=campaign) dentro de MaMeMi. Razón: "MüK Cia" es la COMPAÑÍA, "MaMeMi" es UNA producción dentro de ella. El project anterior con name "Difusión 2026-27" conflataba la campaña operativa con la pieza artística.
  2. **Schema rename**: table `show` → `performance` (afecta crew_assignment.performance_id, cast_override.performance_id, asset_version.performance_id, date.performance_id, expense.performance_id, invoice_line.performance_id, enum `performance_status`, view `performance_redacted`, helper function `project_id_of_performance`, índices, triggers, FK constraints, collab_snapshot CHECK). Adicional: column `show.show_start_at` → `performance.start_at` (las otras 4 timeslots ya son específicas, prefijo redundante).
- **Context**: durante validación visual con datos productivos (sesión 2026-05-19), Marco usa "espectáculo/show" en castellano para referirse a la pieza artística (= producción = `project` en schema), no al gig atómico (= `show` en schema). Hour schema lo llamaba `show` por convención industria-touring (música/festival). Para una herramienta cross-arts (teatro/danza/música/performance art), `performance` es universal: traduce limpio a "actuación"/"función"/"performance" en ES, "performance" en EN sin escora de género.
- **Alternatives considered (rejected)**:
  - **`gig`**: rechazado por escora música/touring. Una compañía de teatro pura sentiría que la herramienta no es para ellos.
  - **Mantener `show` schema + UI label otra cosa**: rechazado. La ambigüedad reaparece cada vez que alguien lea código, db-types, logs, audit_log. Vale el coste de migración (~2h) para limpiar.
  - **Renombrar también el permiso `'edit:show'` a `'edit:performance'`**: rechazado para Phase 0. Es un código de permiso en el closed RBAC vocab (ADR-006), almacenado como string en workspace_role.permissions + project_membership.permission_grants/revokes. Renombrar requiere UPDATE masivo + lógica de migración. Se difiere a Phase 0.9 admin UI cuando exista la pantalla para visualizar/editar permisos.
- **Trade-offs**:
  - **Doble naming overhead en esta sesión** (line→section→line + show→performance). Costo aceptable porque ambos venían del mismo naming gate vivido con UI productiva. Phase 0 es el momento de hacerlo; Phase 0.9 con clientes externos sería 10× más caro.
  - **Permission code `'edit:show'` queda inconsistente** con el nombre de la tabla. Aceptado como deuda hasta Phase 0.9 admin UI. Documentado.
- **Schema entregado**:
  - 25 tablas totales (sin cambio de conteo). Tabla `show` → `performance` (3 demo performances + esquema vacío para muk-cia preservado).
  - 78 RLS policies (sin cambio de conteo — 18 policies recreadas con references a `performance` / `performance_id` / `project_id_of_performance`).
  - 6 FK columns renombrados: crew_assignment.performance_id, cast_override.performance_id, asset_version.performance_id, date.performance_id, expense.performance_id, invoice_line.performance_id.
  - Enum `performance_status` (era `show_status`) con sus 10 valores intactos (proposed/hold/hold_1/2/3/confirmed/done/invoiced/paid/cancelled).
  - View `performance_redacted` con la misma estructura (money-gating intacto).
  - Helper functions con parámetros renombrados (`p_performance_id`).
- **Migration SQL**: `build/migrations/2026-05-19_rename_show_to_performance.sql` (schema) + `build/migrations/2026-05-19_data_rename_muk_cia.sql` (data). Ambos aplicados vía Supabase MCP. Mirror inverso disponible si necesario.
- **Código aplicación**:
  - `apps/web/src/lib/db-types.ts` — sed targeted (`show_start_at` → `start_at` first, luego `show` → `performance` global). 0 refs show, 76 refs performance.
  - `apps/web/src/routes/api/shows/` → `apps/web/src/routes/api/performances/`. Endpoint internal types `ShowItem` → `PerformanceItem`, table name string `'show'` → `'performance'`, column `show_start_at` → `start_at` en select.
  - Plaza.svelte / RoomStructure.svelte / engagements/+server.ts intactos (no referencian show schema).
- **Supersede / mantiene**:
  - ADR-008 "Product vocabulary": el item House/Room/Run/Gig sigue obsoleto desde ADR-033. Performance se añade al vocabulario interno (no UI-facing aún).
- **Re-evaluate when**:
  - Si Phase 0.9 admin UI lo pide, renombrar permission code `'edit:show'` a `'edit:performance'` para consistencia visual.
  - Si emerge un cliente Phase 1 con vocabulario propio (ej. "función" en lugar de "performance"), evaluar UI label customizable por workspace (no schema).
- **Status**: Firm. Producción 2026-05-19.

## [2026-05-19] — ADR-037 · Cleanup ADR-008 vocab holdovers (room/gig/house) — align UI/URL/code with schema
- **Decisión**: Eliminar las últimas referencias al vocabulario ADR-008 (House/Room/Run/Gig) en UI, URL, endpoints y componentes internos. Schema ya no usa esos nombres desde hace tiempo; quedaba inconsistencia visible cada vez que alguien leía URLs, código, o nombres de componentes.
- **Cambios concretos**:
  - **URL**: `/h/[workspace]/room/[slug]/` → `/h/[workspace]/project/[slug]/`; `/h/[workspace]/gig/[slug]/` → `/h/[workspace]/performance/[slug]/`. 301 redirects en `hooks.server.ts` para bookmarks/links viejos (eliminable en Phase 0.2 cuando todas las refs hayan migrado).
  - **Endpoints**: `/api/rooms` → `/api/projects`; `/api/houses` → `/api/workspaces`. 301 redirects en `hooks.server.ts` (fetch los sigue transparentemente).
  - **Componente**: `RoomStructure.svelte` → `LineList.svelte` (nombre refleja qué hace: lista lines del project activo).
  - **Tipos internos**: `type House` → `type Workspace`, `type Room` → `type Project`, `HouseLite` → `WorkspaceLite`, `RoomItem` → `ProjectItem`, `HouseItem` → `WorkspaceItem`.
  - **Variables**: `houses` → `workspaces`, `rooms` → `projects`, `fetchRooms` → `fetchProjects`, `fetchHouses` → `fetchWorkspaces`, `housesQuery` → `workspacesQuery`, `roomsQuery` → `projectsQuery`, `activeRoomSlug` → `activeProjectSlug`, `firstRoomSlug` → `firstProjectSlug`, `activeRooms` → `activeProjects` field, `plaza__house-*` CSS classes → `plaza__workspace-*`.
  - **Smoke test**: URL `/h/mamemi/room/mamemi` → `/h/muk-cia/project/mamemi`.
- **Context**: Marco solicitó audit de naming durante sesión 2026-05-19 ("RoomStructure ahora mismo me está causando problemas de comprensión"). 5 desfases identificados en la tabla schema ↔ UI ↔ URL ↔ código: URL legacy room/gig, endpoint legacy houses/rooms, componente legacy RoomStructure, tipos internos House/Room. Phase 0 sin usuarios externos = momento ideal para limpiar antes que escale a semanas.
- **Trade-offs**:
  - **Settings page de Marco (uncommitted) usa los nombres viejos**. 301 redirects en hooks.server.ts hacen que siga funcionando sin tocar su archivo. Cuando Marco actualice settings, podemos eliminar los redirects.
  - **Historial git pierde la trazabilidad directa de "este archivo era RoomStructure"**. `git mv` preserva el rename como evento, pero `git log --follow` puede tener heuristics imprecisas con renames grandes. Aceptado.
- **No tocado en este pase** (deferido):
  - Permission code string `'edit:show'` (ADR-006 closed vocab) — deferido a Phase 0.9 admin UI.
  - Route segments `/engagement/`, `/person/` — ya consistentes con schema, no necesitan rename.
- **Migration**: solo código + URL hooks. Sin schema migration (cero cambios DB).
- **Verificación**: `pnpm check` 1276 files, 0 errors, 0 warnings.
- **Re-evaluate when**: si Phase 0.9 admin UI lo pide, eliminar los 301 redirects en hooks.server.ts (todas las refs migradas para entonces).
- **Status**: Firm. Producción 2026-05-19.

## [2026-05-19] — ADR-035 · Revert `section` → `line` (naming gate vivido con UI productiva supersede ADR-031)
- **Decisión**: Revertir el rename `line → section` aplicado el 2026-05-18 (ADR-031). El nivel intermedio entre Project y Show vuelve a llamarse `line` en schema (`line`, `line_id`, `line_kind`, `line_status`) y en UI ("Lines"). Los 4 enum values añadidos por ADR-031 (creation, campaign, comms, misc) se conservan dentro de `line_kind` — siguen siendo válidos para Hour cross-arts. El enum queda con 10 valores: tour, season, phase, circuit, residency, other, creation, campaign, comms, misc.
- **Context**: ADR-031 razonaba que "line" era industry slang exclusivo de touring y que kinds no-touring (creation/campaign/comms/misc) chirreaban semánticamente. 2026-05-19, con la demo data viva en la UI ("LINES" header en sidebar lower) y el contexto castellano de Marco, el chequeo real produjo la lectura inversa: **"línea de trabajo" funciona perfectamente para los 10 kinds** — tour 2026, residencia, nueva creación, campaña de difusión, comms. `line` es polisémico en castellano (línea de trabajo, línea de producción) y en inglés (line of work, production line, comms line), no exclusivo del touring. El naming gate del live-UI gana sobre el razonamiento abstracto de hace 24 horas.
- **Alternatives considered (rejected)**:
  - **Mantener `section` schema + revertir solo UI label** (separation ADR-008 style): rechazado por inconsistencia permanente. La UI lleva `line`, dev tools y db-types llevan `section` — fricción para cualquiera leyendo el código + Marco cuando vuelva a tocar schema. Coste de revertir ambos (~1h) menor que coste de vivir con la inconsistencia durante meses.
  - **Mantener `section` schema y aceptar que "Lines" UI fue un atajo**: rechazado por la misma razón. Si vamos con `line` en UI, schema debe seguir.
  - **Quitar los 4 enum values nuevos** (creation, campaign, comms, misc): rechazado. La cobertura cross-arts es buena y compatible con el rename. Los 4 valores entran en `line_kind` sin problema.
- **Trade-offs**:
  - **Doble migración registrada en historial** (ADR-031 add + ADR-035 revert). Costo cosmético; gana claridad: el naming gate funcionó como esperado (planificar, probar live, decidir). El historial muestra el proceso de validación, no un error a esconder.
  - **`line` polisémico en castellano** puede confundir si Marco trabaja con clientes anglo (UK, IE) donde "line" tiene mayor carga touring. Re-evaluable en Phase 1 si emergen clientes anglófonos.
- **Schema entregado**:
  - 25 tablas totales (sin cambio de conteo). Tabla `section` → `line` (data intacta, demo line "Gira otoño 2026" preservada).
  - 78 RLS policies (sin cambio de conteo — 10 policies recreadas con nombres line_*).
  - Enum `line_kind` con 10 valores (heredados del rename + 4 nuevos preservados).
- **Migration SQL**: `build/migrations/2026-05-19_revert_section_to_line.sql`. Aplicada vía Supabase MCP `apply_migration` 2026-05-19 (name: `revert_section_to_line`). Mirror inverso de `2026-05-18_rename_line_to_section.sql`.
- **Código aplicación**:
  - `apps/web/src/lib/db-types.ts` — `sed 's/section/line/g'` (36 → 0 refs section). Verificado con `pnpm check` 0/0 post-cambio.
  - `apps/web/src/routes/api/sections/` renombrado a `apps/web/src/routes/api/lines/`. Endpoint, type `SectionItem` → `LineItem`, query a tabla `'line'`.
  - `apps/web/src/lib/components/RoomStructure.svelte` — queryKey `['sections', ...]` → `['lines', ...]`, `fetchSections` → `fetchLines`, type `Section` → `Line`, URL `/api/sections` → `/api/lines`, comentarios actualizados.
- **Supersede**: ADR-031 marcado como superseded por este ADR. ADR-005 (definición original de line) vuelve a aplicar plenamente.
- **Re-evaluate when**: Si Phase 1 trae clientes anglófonos donde "line" tiene mayor carga touring específica y los kinds no-touring (creation/campaign) generan confusión real. Probable resolución entonces: mantener `line` schema + UI label per-workspace customizable.
- **Status**: Firm. Producción 2026-05-19.


## [2026-07-01] — ADR-040 · Adelantar el write path mínimo de engagement (status + next action) de Phase 0.5 a ahora
- **Decisión**: Construir ya el primer write path de la app — edición inline de `engagement.status` (menú sobre el badge) y de `next_action_at` + `next_action_note` (dialog) en `/booking`, con `PATCH /api/engagements/:id` detrás. Optimistic update con rollback + toast de error (el error→recovery loop que el roadmap exigía antes de cualquier PATCH, riesgo #5). El roadmap tenía "inline status change + PATCH" en Phase 0.5 item 3; se adelanta como excepción puntual, no como reordenación de fases.
- **Context**: Check-in estratégico 2026-07-01 tras ~6 semanas de pausa (última sesión de código 2026-05-19). Diagnóstico: Hour estaba construido pero no usado — la app era read-only y la difusión 2026-27 real (154 engagements cargados, su caso piloto) avanzaba fuera de Hour (email/notas). El pago de todo el trabajo transversal llegaba en Phase 0.2, pero sin escritura Hour no podía absorber ni una sola respuesta de programador. Riesgo identificado: herramienta interna construida para una temporada que le pasa por delante. El propio `_flux.md` (2026-05-18, TAM levers) dejaba la puerta abierta: "el roadmap difiere tasks a Phase 0.5+, Marco no está cerrado a adelantarlas si emerge fricción real".
- **Alternatives considered (rejected)**:
  - **Seguir el roadmap y arrancar Phase 0.2 (Calendar + road sheet colaborativo)**: rechazado como primer paso. ~45h focused antes de que Hour acepte una sola escritura; la difusión sigue fuera de la app todo ese tiempo.
  - **Full task entity (D3) adelantada**: rechazado — mucho más scope (entidad nueva, protocolos), y lo que la difusión necesita hoy es actualizar la conversación, no gestionar tareas.
  - **Write queue offline completo (roadmap 0.1 #9) en el mismo pase**: rechazado — los primitivos IndexedDB existen (`$lib/offline/db.ts`) pero el replay engine + conflict UI es Phase 0.2+ scope. El write path es online-only con rollback claro; deuda explícita.
- **Entregado**:
  - `pgPatch` en `$lib/supabase.ts` (mismo patrón que `pgGet`, `Prefer: return=representation`, 0 filas = not-found/RLS-denied indistinguible).
  - `$lib/engagement.ts` — vocabulario de status (labels + badge classes, antes duplicado en booking + RelationshipStub) + `EngagementPatchSchema` (Valibot whitelist: status/next_action_at/next_action_note; columnas RLS-sensibles no pueden colarse) + `EngagementItem`/`ENGAGEMENT_SELECT` compartidos por GET y PATCH.
  - `PATCH /api/engagements/[id]` — Bearer JWT, uuid check, whitelist, `deleted_at=is.null`, RLS (`has_permission(project_id,'edit:engagement')`) decide; respuesta = row + embeds (misma forma que la lista).
  - `/booking`: badge de status → trigger de `Menu` con los 7 estados; celda next action → dialog (Input date + textarea nota); `createMutation` con onMutate/onError/onSuccess/onSettled (snapshot + rollback + `addToast` danger + invalidate). **Eliminado el TEMP VISUAL MOCK que llevaba en producción desde Phase 0.1** — las primeras 7 filas de la lista real mostraban estados falsos ("Remove before deploy" nunca ejecutado).
  - `<Toast />` montado app-global en el layout raíz (antes solo existía en Playground). `Input` acepta `type="date"`.
  - Tests: 10 unit (schema whitelist + vocabulario), suite RLS `engagement-write.test.ts` (anon deny, unknown-id, no-op write real, soft-delete), e2e `engagement-write.spec.ts` (status round-trip + next action con restore exacto vía API). Las suites autenticadas skip sin `.env.test` (perdido en el recovery 2026-06-04 — recrear per runbook).
- **Verificación**: `pnpm check` 1290 files 0/0 · 24 unit tests verdes · build limpio · superficie de validación ejercida en dev (401/400 invalid_id/400 invalid_body/400 empty_patch/whitelist/401 PostgREST mapping) · sonda de sintaxis PATCH+embed contra PostgREST prod con anon key (200, 0 filas — forma válida, RLS deny correcto).
- **Trade-offs**: escrituras online-only (sin queue offline — deuda explícita a Phase 0.2+); `/booking` sigue siendo la superficie legacy fuera del shell `/h/` (la Contacts lens de Phase 0.3 la sustituirá y hereda este write path); un write test real bumpea `updated_at` + añade filas de audit_log (coste aceptado de testear escrituras de verdad).
- **Re-evaluate when**: al construir la Contacts lens (Phase 0.3) — el editor inline migra allí; y al llegar el write queue offline (Phase 0.2+) — la mutación ya está centralizada en un solo `createMutation`, el enqueue se inserta en `mutationFn`.
- **Status**: Firm. Producción 2026-07-01.

## [2026-07-02] — ADR-041 · Phase 0.2 read surface: Calendar lens + Performance detail + Road sheet read-only con matriz de roles provisional
- **Decisión**: Construir la superficie de LECTURA de Phase 0.2 completa — Calendar lens (`/h/[ws]/calendar`), Performance detail real (cierra #3+#5 de Phase 0.1: ProductionStub + schedule dual-timezone + team/dates/programmer/assets), y el road sheet como proyección role-filtered en `/h/[ws]/performance/[slug]/roadsheet` — dejando explícitamente FUERA la capa colaborativa (CRDT y-partyserver, Realtime, presence, chip bar/multi-select, link público firmado, e2e collab). Razón del corte: la capa colaborativa exige dos clientes autenticados vivos para verificarse honestamente y no hay credenciales de test en esta máquina (deuda `.env.test`); shippear CRDT sin verificar viola "verify before declaring done".
- **Matriz de roles del road sheet (la parte decisión-de-producto, PROVISIONAL hasta vivirla)**: ADR-023 dejó el mapping "finalized at implementation". Primera implementación en `$lib/roadsheet.ts § ROLE_SECTIONS`, filtrado SERVER-SIDE (las secciones ocultas nunca salen del servidor; un futuro link público D6 reutiliza el endpoint con rol fijado):
  - **full** (operador): todo.
  - **venue**: schedule, venue, technical, cast, crew (nombres+roles, sin contactos personales). SIN logistics — mezcla datos venue-facing (parking, freight) con internos de compañía (hotel, viajes) en un solo jsonb; hasta que las shapes se separen, conservador: no se le da.
  - **performer**: schedule, venue, logistics, hospitality, cast, crew (sin contactos personales).
  - **tech_manager**: schedule, venue, logistics, technical, cast, crew CON contactos, assets (solo metadata — las URLs son R2 keys sin serving público en Phase 0).
  - **Money NUNCA en un road sheet**, ningún rol — el dinero vive en la Money lens tras `read:money`. El bundle de detalle tampoco lleva fee: select explícito sin `fee_amount/fee_currency` (la puerta de dinero del read path es la view `performance_redacted`, no la saltamos por la tabla base).
- **Calendar lens**: dos fuentes (`performance.performed_at` día-nivel + `date.starts_at` timestamptz bucketed al día del viewer; all-day conserva su fecha). Filtro = selección del sidebar (ADR-038, mismo contrato que LineList: vacío = todo lo RLS-accesible; el segmento [ws] de la URL es browsing context, NO filtro — ADR-039; revisado y ratificado en review 2026-07-02). Selección sin resolver (proyecto parked, caches cargando) → feed deshabilitado, nunca fetch unfiltered silencioso. Ventana de dates ±1 día por el desfase UTC/viewer-tz en los bordes del grid. Pills del shell navegan (Today/Calendar); contacts/money siguen state-only hasta Phase 0.3; sync URL→lens con `untrack` para no matar las pills state-only.
- **Infra arreglada por el camino**:
  - **Leak de seguridad en producción encontrado y con fix preparado**: `performance_redacted` perdió `security_invoker=true` al recrearse en los renames del 2026-05-19 — anon leía TODAS las filas de la view (verificado live 2026-07-02; expuesto: solo datos demo, MaMeMi no tiene performances aún). Migración lista en `build/migrations/2026-07-02_fix_performance_redacted_security_invoker.sql` (ALTER VIEW + REVOKE anon) — **pendiente de aplicar en el SQL editor** (sin credenciales DB en esta máquina). Test canario `tests/rls/redacted-view.test.ts` la fija para siempre.
  - **Drift del rename en la infra collab**: `apps/collab` + `do/auth.ts` seguían hardcodeados a la tabla `show` (muerta desde ADR-036) — el DO no habría podido ni autorizar ni persistir snapshots de performances. Renombrado a `performance` (mecánico, typechecked; verificación live cuando el CRDT se wire en la siguiente sesión de 0.2).
  - Compartidos nuevos por filosofía (revisión adversarial 22 hallazgos confirmados, todos aplicados): `$lib/api.ts` (fetchJSON+clearAuthAndBounce — el anti-patrón nombrado; las 4 copias pre-existentes migran al tocarlas), `ScheduleTable.svelte`, `hasJsonContent` en JsonKV, `dayLabel` en datetime, contrato `:where([data-tone])` generalizado en base.css (era exclusivo de .state-badge; el comentario ya decía "used in calendar dots"), `toStore()` de Svelte en vez del puente writable+$effect artesanal.
- **Limitación conocida (no bug, decisión pendiente)**: `can_see_person` solo muestra persons con engagement compartido o creadas por el caller — un member sin esas condiciones ve '—' en cast/crew del road sheet. Probable evolución: "person visible si aparece en cast/crew de una performance que puedes leer". Anotado en `_notes/_flux.md`; decisión para cuando Anouk entre.
- **Re-evaluate when**: (1) la matriz de roles, tras la primera gira real con road sheets compartidos; (2) el corte CRDT, en cuanto exista `.env.test` (los 7 smoke checks de 2026-05-09 siguen siendo el plan, con DO names `performance:<id>`); (3) logistics/hospitality/technical jsonb shapes cuando se separen venue-facing vs internal.
- **Status**: Firm. Producción 2026-07-02.

## [2026-07-02] — ADR-042 · Notas colaborativas en vivo (CRDT) — Phase 0.2 completada
- **Decisión**: `performance.notes` y `project.notes` son campos colaborativos en vivo vía Yjs (ADR-025/D-PRE-07), editables desde las páginas de detalle con el componente `YNotes.svelte`. Verificado en producción con dos clientes reales (e2e `tests/collab.spec.ts` contra `hour.zerosense.studio`): convergencia bidireccional, presencia ("N here" + marco resaltado cuando otro edita, P10 simplificada), restore tras reload, snapshot persistido en `collab_snapshot` y **write-back de la columna `notes`** para que las superficies no-colaborativas (road sheet, endpoint de detalle) lean contenido actual. Con esto los 7 smoke checks del plan 2026-05-09 quedan verificados y **Phase 0.2 completa** (diferidos explícitos: link público firmado D6, cursor posicional 0.5, Realtime para campos estructurados cuando haya writes estructurados que sincronizar).
- **Arquitectura**:
  - Cliente: `YNotes.svelte` — Y.Doc + `YProvider` de y-partyserver (gotcha: con `prefix`, el path debe llevar el id; la room solo nombra el BroadcastChannel) + espejo `y-indexeddb` + binding textarea por diff prefijo/sufijo común. Params como función → el JWT se refresca en cada reconexión.
  - Gate de escritura en el upgrade: `authorizeCollab` ahora exige `has_permission(project_id, 'edit:show')` (performance) / `'edit:project_meta'` (project) además de membership — una conexión Yjs es un canal de ESCRITURA.
  - DO: seed desde la columna `notes` en el primer load (migración de texto pre-collab, sin pérdida), write-back best-effort tras cada snapshot, y self-heal del `workspace_id` en onSave.
- **Dos bugs de raíz encontrados y arreglados** (la razón de que el scaffold del 2026-05-09 nunca sincronizara de verdad — su "verificación" solo vio el handshake):
  1. **workerd entrega frames binarios como `Blob`** (default WHATWG en compatibility dates recientes) y y-partyserver 2.2.0 solo entiende ArrayBuffer/TypedArray → decodificaba un buffer vacío ("Unexpected end of array") y descartaba TODOS los mensajes. Fix: normalización Blob→ArrayBuffer en `onMessage` del DO. Candidato a upstream issue en y-partyserver.
  2. **El `SUPABASE_SECRET_KEY` almacenado no era una service key válida** (configurado 09-05, jamás validado — 200 + cero filas en una fila existente = rol degradado a anon). Marco lo re-emitió desde el dashboard (`sb_secret_...`). Además: `Authorization: Bearer sb_secret_` degrada el rol en el gateway — la persistencia autentica solo con `apikey`.
- **Re-evaluate when**: (1) upstream fix del Blob en y-partyserver → quitar el override; (2) al construir el road sheet editable completo (los jsonb siguen siendo last-write-wins vía PATCH, no CRDT — correcto per ADR-025 scope); (3) D6 link público reutiliza el endpoint roadsheet con rol fijado.
- **Status**: Firm. Producción 2026-07-02, verificado con e2e en vivo.

## [2026-07-02] — ADR-043 · Write path de performances: crear desde el calendario, editar status + schedule en el detalle
- **Decisión**: Adelantar el write path de performances (Phase 0.5 "cuando Marco confirme la primera fecha" — la difusión 2026-27 lo acerca): crear gigs desde la Calendar lens (botón "New performance" + "+" por día → dialog: project, fecha, venue, city, status) y editar en el detalle (status vía menú; performed_at + 5 timeslots + trío venue vía dialog "Edit details"). Fee y notes quedan fuera a propósito (edit:money/Money lens y el doc colaborativo ADR-042 son sus dueños).
- **RPC `create_performance`** (SECURITY DEFINER, patrón create_project/create_line): los INSERT directos son claim-bound (`workspace_id = current_workspace_id()`) y denegarían crear gigs en cualquier workspace que no sea la primera membership del caller — el RPC deriva el workspace del project, gatea con `has_permission(project_id, 'edit:show')`, valida que engagement/line pertenecen al project, y genera slug `slugify(venue|city|'gig')-YYYY-MM-DD` con sufijo numérico en colisión (ADR-002 permite holds coexistentes en el mismo slot). Migración `2026-07-02_create_performance_rpc.sql`, aplicada vía MCP.
- **Endpoints**: `POST /api/performances` (Valibot whitelist → RPC) y `PATCH /api/performances/:key` (status/performed_at/timeslots/venue-trío/links; los slug keys resuelven a id primero — las mutaciones PostgREST no filtran a través de joins). El CHECK de orden de timeslots es de pares ADYACENTES null-safe (schedules parciales legales) — violación mapeada a 400 con hint.
- **Semántica de tiempos**: datetime-local en la zona del VIEWER (helpers isoToLocalInput/localInputToIso), display dual-timezone D-PRE-10. Caveat documentado en el dialog; la zona del venue llegará con la entidad venue enlazada.
- **Review adversarial (parcial — un finder colgó y se paró el workflow; hallazgos del completado verificados a mano)**: (1) **[major] el PATCH permitía relinkear engagement_id/line_id cross-project/workspace** — el invariante del RPC no se re-aplicaba en update y las FKs no llevan scope; guard añadido en el handler (EXISTS del project). (2) **[vivo] `REVOKE FROM anon` era inefectivo** — el grant EXECUTE de PUBLIC por defecto seguía (verificado en proacl); corregido en vivo con el patrón de los hermanos (`REVOKE ALL FROM PUBLIC, anon, service_role; GRANT TO authenticated`, migración `fix_create_performance_grants`). (3) El mapeo de errores por substring del body podía false-positive con texto influido por el usuario — ahora `PostgrestError.code` parsea el JSON.
- **Verificación**: typecheck 0/0 · unit (schemas: whitelist, fechas imposibles, fee/notes nunca pasan) · e2e 2/2 local (crear desde calendario → detalle → status → schedule → persistencia + violación adyacente → 400) · 5/5 suite completa local.
- **Re-evaluate when**: entidad venue enlazable (el trío denormalizado pasa a ser fallback), delete/cancel flow (hoy `cancelled` es un status, no hay soft-delete desde UI), y el composite FK `(id, project_id)` como guard DB-side del relink si aparece otro caller.
- **Status**: Firm. Producción 2026-07-02.

## [2026-07-02] — ADR-044 · Contacts lens v1 — la difusión entra al shell
- **Decisión**: Primera pieza de Phase 0.3: la Contacts lens en `/h/[ws]/contacts` sustituye a `/booking` como superficie canónica de difusión. Lista de engagements filtrada por la selección del sidebar (ADR-038, unión; vacío = todo lo RLS-accesible), búsqueda free-text sobre persona/organización (debounced 300ms), filtro de status, y los editores inline de ADR-040 (status + next action) — todo dentro del shell con Plaza/LineList como filtro vivo. `/booking` queda como wrapper thin del mismo componente (bookmarks + memoria muscular), marcado legacy.
- **Cómo**: `GET /api/engagements` generalizado (project_slug ahora opcional sin default `mamemi`; + `project_ids`/`workspace_ids` unión OR + `q` con `person!inner` y `person.or=(full_name.ilike,organization_name.ilike)` — sintaxis sondada contra PostgREST antes de escribirla; el input de búsqueda se sanea de metacaracteres de patrón/lógica). Tabla + editores extraídos a `EngagementTable.svelte` (una implementación, dos consumidores). Tercera aparición del resolver selección→ids → extraído a `$lib/selection-filter.ts` (puro) y el calendario refactorizado sobre él. Shell: lenses routed generalizadas (`ROUTED_LENSES` calendar+contacts; Money sigue state-only hasta su página), sync URL→lens con untrack, `contacts` en el neutralMatch del parser de selección.
- **Alcance consciente v1**: sin detail panel de persona (la página person/[slug] sigue placeholder), sin filtros House/Room dedicados (el sidebar ES ese filtro), mobile = scroll horizontal de tabla (el mobile-first real de Contacts va con el pase 0.3/0.4). ILIKE directo Phase 0 (FT search a ~1000 entidades, roadmap).
- **Verificación**: typecheck 0/0/0 · build limpio · smoke ampliado (lens carga los 154 dentro del shell, búsqueda sin resultados → "No results" → clear → filas de nuevo, pills Contacts/Today navegan) · 5/5 e2e local.
- **Re-evaluate when**: Phase 0.3 completa (Money lens + person detail + tabs) — y si `/booking` ya no se usa tras unas semanas, eliminar el wrapper.
- **Status**: Firm. Producción 2026-07-02.

## [2026-07-02] — ADR-045 · Person detail — la ficha de contacto con notas
- **Decisión**: La página `/h/[ws]/person/[slug]` deja de ser placeholder: ficha completa del contacto — datos (mailto/tel/web), engagements cross-project con status y next action, **notas workspace-scoped con composer** (visibilidad workspace/private), y apariciones en cast/crew. Los nombres en la tabla de engagements (Contacts lens + /booking) enlazan a la ficha. Person es GLOBAL (sin workspace, vocabulario anti-CRM "person (global, shared)"); la nota se crea en el workspace del contexto de navegación.
- **RPCs**: `create_person_note` (el INSERT directo es claim-bound — cuarto caso del patrón; membership check explícito, visibility default workspace) y `delete_person_note` (author-scoped soft-delete). Endpoints: `GET /api/persons/:key` (uuid o slug global; person + engagements + notes + crew + cast en paralelo, RLS decide todo) y `POST /api/persons/:key/notes`.
- **Hallazgo RLS anotado para ojos frescos** (`_flux.md`): con el mismo autor y la misma policy UPDATE, `SET body=body` pasa pero `SET deleted_at=now()` viola RLS (reproducido en SQL puro con impersonación). El soft-delete cliente-directo está minado en toda la DB — los write paths actuales no lo usan, pero cualquier futuro delete vía PATCH lo pisará. Mientras: soft-deletes por RPC.
- **Verificación**: typecheck 0/0/0 · build · e2e nuevo (contacts → ficha → añadir nota → persiste → cleanup por RPC, self-cleaning) · suite completa 6/6 local + RLS 17/17.
- **Re-evaluate when**: botón de borrar nota en UI (el RPC ya existe), edición de datos de contacto (person es compartida cross-workspace — decisión de ownership pendiente), y el detalle de engagement enlazado desde la ficha.
- **Status**: Firm. Producción 2026-07-02.

## [2026-07-02] — ADR-046 · Money lens — las 4 lenses vivas
- **Decisión**: Money lens en `/h/[ws]/money`, cerrando el set de 4 (Today · Calendar · Contacts · Money — el system-completeness gate de Phase 0.3 ya tiene qué evaluar). Dos secciones: **Fees** (performances vía `performance_redacted` — LA puerta de dinero: fees NULL sin `read:money`, invoker semantics — con totales por bucket pipeline/invoiced/paid sobre lo listado y **editor de fee** por fila) e **Invoices** (read-only, RLS `read:money`; creación en Phase 0.5 — hoy 0 filas, empty state honesto). Filtro = selección del sidebar, como toda lens.
- **El fee se edita AQUÍ y solo aquí**: ADR-043 excluyó el fee del write path de performance a propósito; sin esto la lens nacía muerta (no había NINGÚN camino para poner un fee). `PATCH /api/money/performances/:id` toca solo `fee_amount/fee_currency`; el trigger `guard_show_fee_columns` exige `edit:money` (42501→403) encima del RLS `edit:show`.
- **View ampliada**: `performance_redacted` + columna `slug` (para enlazar al detalle; las views solo aceptan columnas al final) — recreada CON `security_invoker` + revoke anon reafirmados (lección del incidente del 19-05: nunca recrear esta view sin ellos; verificado anon → 401 tras aplicar).
- **Gotcha Svelte cazado por el e2e**: `Input type=number` con bind entrega number, no string — `.trim()` directo revienta y el save muere en silencio. Normalizar con `String(x ?? '')`.
- **Verificación**: typecheck 0/0/0 · build · e2e fee round-trip self-cleaning (set 1.234,56 → persiste → clear) · smoke con las 4 lenses navegadas · suite 7/7 local.
- **Re-evaluate when**: invoice creation (Phase 0.5) — la lens ya tiene el esqueleto; multi-currency real en los totales (hoy suma cruda — con una sola divisa en uso es honesto, con mezcla habría que agrupar por currency); fee editing masivo si la difusión lo pide.
- **Status**: Firm. Producción 2026-07-02.

## [2026-07-02] — ADR-047 · Road sheet público por link firmado (D6 parcial)
- **Decisión**: Activar el D6 parcial de ADR-022/023: links públicos revocables al road sheet, sin cuenta. Un share = tabla `roadsheet_share` (token 64 hex = 2×gen_random_uuid, performance, **rol público fijado** venue|performer|tech_manager, revoked_at) → URL `/public/roadsheet/:token`. La tabla es **deny-all vía PostgREST para TODOS los roles** (FORCE RLS sin policies, REVOKE a anon+authenticated): los tokens jamás son legibles por acceso a tabla; toda la gestión va por RPCs SECURITY DEFINER gateados con `edit:show` (`create/list/revoke_roadsheet_share`).
- **Cadena de saneado en dos capas**: (1) `get_public_roadsheet(token)` — el único RPC ejecutable por anon — devuelve el bundle SIN fee, SIN notes, SIN engagement/person internals (jamás entran al JSON, ni siquiera al Worker); (2) el endpoint `GET /api/public/roadsheet/:token` aplica el `buildRoadsheet` existente con el rol fijado del share — la matriz de ADR-041 filtra secciones y contactos server-side (contactos solo sobreviven para tech_manager). `cache-control: no-store`: la revocación muerde en el request siguiente. Token bogus → null, no error (sin oráculo).
- **UI**: sección "Public links" en el road sheet del operador (crear por rol, copiar URL, revocar) + página pública standalone (sin shell, noindex, print-friendly). El cuerpo del documento se extrajo a `RoadsheetView.svelte` — una implementación, dos consumidores (preview del operador y página pública).
- **Verificación**: ciclo completo probado primero en SQL (anon lee bundle sin fee, tabla denegada a anon Y authenticated, revoke mata el token), luego RLS suite 19/19 (test nuevo de lifecycle self-cleaning) y e2e nuevo contra producción: crear → abrir en contexto anónimo → revocar → link muerto. Suite completa 10/10 contra producción.
- **Re-evaluate when**: expiración por tiempo (hoy solo revocación manual — para un link que viaja por email quizá baste, pero un `expires_at` es barato); assets con URL servible (hoy solo metadata — R2 signed URLs serían el siguiente paso del D6); rate-limit del endpoint público si aparece abuso.
- **Status**: Firm. Producción 2026-07-02.

## [2026-07-02] — ADR-048 · Soft-delete cliente-directo es imposible por construcción (misterio RLS resuelto)
- **Decisión**: El "misterio" de ADR-045 queda resuelto con experimento decisivo, y se eleva a regla de arquitectura: **todo soft-delete va por RPC SECURITY DEFINER; jamás por PATCH directo del cliente.**
- **Mecanismo (confirmado empíricamente, no especulación)**: en este Postgres, la fila ACTUALIZADA debe seguir pasando alguna policy SELECT del que la actualiza. Nuestro patrón universal de SELECT es `deleted_at IS NULL` → poner `deleted_at=now()` hace la fila nueva invisible para su propio autor → 42501 "new row violates RLS". Prueba: creando una policy SELECT extra temporal (`author_id = auth.uid()`, sin filtro deleted_at) el MISMO update pasa; al quitarla vuelve a fallar. `SET body=body` pasa porque la fila nueva sigue visible.
- **Alcance**: sistémico — afecta a TODAS las tablas del schema (todas usan el patrón `deleted_at IS NULL` en SELECT). No es un bug de person_note ni de una policy concreta.
- **Alternativa descartada**: ampliar las policies SELECT con `OR author_id = auth.uid()` (dejaría filas borradas visibles a su autor en todos los reads — rompería listados y filtros en cascada). El patrón RPC ya es la casa (create_*/delete_person_note) y mantiene la simetría claim-bound-INSERT ↔ RPC.
- **Verificación**: repro + confirmación de mecanismo en SQL con impersonación (probe note self-cleaning). Botón de borrado de nota en la ficha de persona cerrado con esta base (endpoint `DELETE /api/persons/:key/notes/:id` → RPC author-scoped; el botón solo se pinta en notas propias vía `decodeJwtSub`), e2e person actualizado: el cleanup del test ES el click del botón.
- **Re-evaluate when**: si un upgrade de Postgres cambia la semántica de visibilidad post-UPDATE (el canary sería el test RLS de person_note), o si algún flujo pide "deshacer borrado" (los RPC podrían ganar un `restore_*` simétrico).
- **Status**: Firm. Producción 2026-07-02.

## [2026-07-02] — ADR-049 · Venue enlazable — el trío denormalizado se puede promover a entidad
- **Decisión**: La entidad `venue` (que existía en schema desde el principio, con RLS workspace-scoped) gana su write path y se puede enlazar desde el dialog de edición de la performance: select "Linked venue" (venues del workspace) + botón "Save fields as venue" que **promueve el trío denormalizado** (venue_name/city/country) a fila de venue y la enlaza. El trío queda como fallback de display — no se borra al enlazar (title y road sheet ya preferían `venue.name` con fallback al trío).
- **RPC `create_venue`** (quinto caso del patrón claim-bound INSERT): claim-independiente, gate = membership aceptada del workspace target (la misma audiencia que la policy `venue_insert`). **Idempotente sobre el índice único vivo `(workspace, lower(name), lower(city))`**: promover un trío que ya existe devuelve la fila existente en vez de error — el flujo "link what I typed" no puede fallar por duplicado y los tests no acumulan fixtures.
- **Guard de relink**: `venue_id` entra al whitelist del PATCH con el mismo guard que engagement/line pero a nivel workspace (venue no es project-scoped) — un venue de otro workspace → 400 `cross_workspace_link`.
- **Qué desbloquea**: timezone real del venue (dual-time del road sheet deja de depender de un campo suelto), address/capacity/contacts en el road sheet público (el RPC de ADR-047 ya los servía si existían), y el catálogo de salas reutilizable entre gigs.
- **Gotcha Svelte 5 cazado en producción**: un `toStore(() => ...)` que lee un `$derived` declarado MÁS ABAJO en el script ejecuta su callback al crearse → TDZ ReferenceError → el componente entero muere en blanco (la página renderizaba solo el sidebar). El typecheck no lo ve (TS no modela el orden de inicialización de runes). Regla: bloques que leen derived van DESPUÉS de su declaración.
- **Verificación**: RPC probado en SQL (create + idempotencia + cleanup) · typecheck 0/0 · e2e nuevo contra producción (promote → link persiste tras reload → unlink; el venue queda como fixture estable gracias a la idempotencia — borrarlo desde cliente es imposible por ADR-048) · suite completa 11/11 contra producción (un selector del spec de performance-write actualizado a `exact` por el botón nuevo).
- **Re-evaluate when**: página/lens de venues (hoy solo picker — editar address/timezone/contacts pide UI propia), autocompletar timezone por city al promover, y merge de venues duplicados si la importación de difusión los trae.
- **Status**: Firm. Producción 2026-07-02.

## [2026-07-02] — ADR-050 · Invoice creation — el fee se convierte en factura
- **Decisión**: Adelantar invoice creation (Phase 0.5) con el flujo natural del dominio: **la factura nace del fee de un gig**. Botón "Invoice" en cada fila de Fees con fee puesto → dialog (IVA %, IRPF %, número opcional, vencimiento, notas, preview del total) → RPC `create_invoice` crea el draft con UNA línea (descripción auto "Project — Venue, City — fecha", qty 1, unit = fee). **Semántica snapshot**: los importes copian el fee en el momento de crear — editar el fee después NO reedita la factura (una factura con importes vivos no es una factura).
- **RPC `create_invoice`** (sexto caso claim-bound INSERT): gate `has_permission(project,'edit:money')`, exige fee puesto (22023 con hint accionable), payer = persona del engagement del gig, forma fiscal española `total = subtotal + IVA − IRPF` (redondeo a 2 en SQL, el preview del cliente replica la misma fórmula). Gotcha: `invoice_line.line_total` es columna GENERATED — no se inserta. Numeración: campo libre opcional (serie de MüK fuera de Hour hoy; auto-numeración cuando haya una serie que respetar).
- **Lifecycle**: draft → issued → paid, cancelled desde cualquiera (menú en la lista, PATCH directo — la policy UPDATE de invoice ya gatea por edit:money, no es claim-bound, sin RPC). **Solo drafts se descartan** (`delete_invoice`, RPC por ADR-048): lo que salió de draft queda para el audit trail y sale por cancelled.
- **Verificación**: RPC probado en SQL (1000 + 21% − 15% = 1060.00 ✓, probe limpiado) · typecheck 0/0 · e2e money ampliado contra producción (fee → Invoice → preview 1,493.82 = matemática server · draft en lista · Discard → fuera · fee clear; self-cleaning) · suite completa 11/11 + unit 53/53 + RLS 19/19.
- **Re-evaluate when**: facturas multi-línea (varios gigs de una gira en una factura — el schema ya lo soporta, falta UI), auto-numeración por serie, PDF de factura (house-style), y el acople status factura ↔ status performance (hoy son independientes a propósito — sin magia).
- **Status**: Firm. Producción 2026-07-02.

## [2026-07-04] — ADR-056 · Line detail = composición de módulos; plantillas de line (el kind se vuelve preset)

> Numeración: esta entrada se escribió como ADR-055 en la sesión de diseño de la mañana; el cierre nivel 1 tomó 051-055 (055 = "Today"), así que se renumera a **ADR-056** (ratificado 2026-07-04 tarde). La resolución de nav embebida abajo (bullet "RESUELTO") evolucionó ese mismo día a su forma final → **ADR-057**.

- **Decisión**: La pregunta abierta "las lines cambian según su kind" (reconocida en el rationale de ADR-031 — "campaign + comms + creation pueden no tener shows" — pero nunca resuelta en UI) se responde con arquitectura de composición: **el line detail deja de ser página fija y pasa a ser una pila ordenada de módulos**, donde cada módulo es una vista de una entidad/lens existente scopada a la line — nunca un silo de datos propio. El `kind` deja de ser el selector primario: **crear una line = elegir plantilla** (tarjetas), y la plantilla fija kind + set de módulos por defecto. El dropdown de 10 kinds desaparece del alta; el kind queda como metadato (eyebrow/accent).
- **Catálogo de módulos v1** (regla anti-fragmentación: lo que aparece en un módulo DEBE aparecer en su lens global — módulo = mismo dato, scope line; lens = mismo dato, scope todo):

  | Módulo | Muestra | Vive de | Estado real |
  |---|---|---|---|
  | Calendar | performances + dates de la line (mes/lista) | `performance.line_id` ✓ · `date.line_id` ✓ | lens hecha → scoparla |
  | Contacts | engagements de la line + next actions | `engagement.line_id` **← columna nueva** | `EngagementTable` reusable |
  | Road sheets | índice de hojas de ruta de los bolos de la line | proyección de performance | vista nueva trivial |
  | Notes | doc colaborativo de la line | `line.notes` ✓ (ya existe) | YNotes hecho; falta target `'line'` en collab |
  | Materials | registro versionado de assets — qué versión se envió dónde | `asset_version.line_id` ✓ | sin UI; v1 = registro/links, upload R2 después |
  | Money | fees + facturas + gastos de la line (margen) | invoice vía performance · `expense.line_id` ✓ | lens hecha; **aquí aterriza la UI de expenses que falta** |
  | People | contact sheet de la line: equipo propio (cast+crew) + gente de sala por bolo (técnico/regidor/producción) | `cast_member` + `crew_assignment` ✓ · `venue.contacts` jsonb ✓ | derivado; edición de venue.contacts llega con cierre 1c |

  Planificado: **Tasks** (cuando D3 exista — el sistema de módulos le da hogar y justificación). Descartado como módulo: stats (van en el header de la line, 2-3 números por kind), comms (D4 será timeline dentro de Contacts, no módulo aparte).
- **Contacts ≠ People** (decisión de dominio, Marco 2026-07-04): Contacts = conversaciones de venta (mundo difusión). People = operativa (tu equipo en carretera + la gente de la sala — lo que una gira necesita de verdad). People absorbe el futuro módulo "Team".
- **Plantillas shipped** (hardcoded en `$lib/line-templates.ts`; tabla `line_template` workspace-scoped solo en Phase 1 cuando clientes creen las suyas):

  | Plantilla | kind | Módulos (orden) |
  |---|---|---|
  | Gira | tour | Calendar · Road sheets · People · Money · Materials · Notes |
  | Difusión | campaign | Contacts · Calendar · Materials · Notes |
  | Creación | creation | Calendar · Notes · Materials · Money |
  | Prensa & comms | comms | Contacts · Calendar · Materials · Notes |
  | Feria | campaign | Contacts · Calendar · Materials · Notes |
  | En blanco | other | Notes |

  Feria entra al catálogo inicial (research 99-patterns §1.6: pre/post-feria son los dos picos de trabajo del año, "modos de trabajo discretos" — da a D7 un hogar incremental; la difusión 2026-27 real pasa por ferias este otoño). Header con stats por kind: Difusión → funnel + acciones vencidas; Gira → próximo bolo + confirmados + € pipeline. Módulos editables por line tras crearla ("Add module", progressive disclosure).
- **Guardarraíl Airtable (límite duro)**: las plantillas componen módulos y labels — **jamás** campos, entidades ni estados custom. El research (99-patterns §1.3) documenta el ciclo de abandono de Airtable en 6 de 8 perfiles y veta el schema configurable explícitamente: "Hour should not offer a configurable schema". Composición sí, esquema no. Coherente con la constraint del roadmap ("no custom workflow builder") y con "no resolver con custom fields una necesidad core".
- **Cambios de modelo** (los únicos): (1) `engagement.line_id uuid NULL REFERENCES line` — backfill: los 154 engagements de `custom_fields->>season='2026-27'` → line `difusion-2026-27`; `custom_fields.season` queda como metadato; RLS intacta (las policies de engagement son por project); guard cross-project tipo ADR-043 cuando entre al whitelist del PATCH. (2) `line.modules jsonb` — array ordenado de claves de módulo; NULL = defaults por kind (las lines existentes no necesitan backfill). (3) Target `'line'` en el collab (union de persistence.ts + gate de auth reutilizando `edit:project_meta` del project padre).
- **Alternatives considered (rejected)**: páginas distintas por kind (N implementaciones — contra philosophy.md); vista hardcodeada por kind sin `line.modules` (no cubre editar módulos de una line ni plantillas de cliente Phase 1); schema configurable estilo Airtable (vetado por el research); módulo Contacts único con doble fuente engagements+sala (rompe la invariante módulo = una entidad).
- **Rationale**: (1) philosophy — una implementación (shell de composición + registro de módulos), variedad por composición; (2) el boceto de Marco 2026-05-18 (el origen de los 10 kinds en ADR-031) queda cubierto 1:1 por las plantillas; (3) research 99-patterns respalda el catálogo: §1.1 materiales versionados = dolor universal #1 de los 8 perfiles → Materials sube de prioridad; §6.1 must-haves ≈ este catálogo casi literal; (4) resuelve el "sobra" del dropdown de 10 kinds detectado en `_notes/research-redesign-gaps.md`; (5) las 4 lenses transversales quedan intactas (gate 0.3): el módulo nunca es dato nuevo, es scope nuevo.
- **Implementación** (pendiente — entra con el rediseño en curso): migración + shell de composición + plantillas **Gira y Difusión** primero (las dos con datos reales; 4 de 7 módulos son reúso scoped de componentes ya extraídos — EngagementTable, calendar grid, money table; los genuinamente nuevos son pequeños: Road sheets index, Materials registry, People). El resto de plantillas = presets const que se activan cuando esas lines existan de verdad. Dependencias: cierre 1c alimenta People (venue.contacts UI); Materials upload cuando llegue R2 UI; Tasks cuando D3.
- **Re-evaluate when**: (a) project detail tabs (hoy en Shelf) — probablemente este mismo sistema a nivel project, un solo sistema, no dos; (b) `venue.contacts` jsonb → filas `person` + junction si los técnicos de sala reaparecen entre venues/años y piden historial (mismo patrón promote que ADR-049); (c) vocabulario por plantilla (holds vs carta de interés, research §7) cuando entren perfiles música; (d) tabla `line_template` cuando clientes creen plantillas (Phase 1); (e) añadir `'fair'` al enum si Feria consolida y `campaign` queda impreciso (ADR-031 ya previó ampliar enum sin rename).
- **Lenses globales ↔ módulos — PREGUNTA ABIERTA, decide Marco durante el rediseño (corregido: una versión anterior de este bullet lo daba por decidido y era solo la recomendación de .zerø)**. Las dos posiciones:
  - *.zerø (mantener)*: módulo y lens comparten implementación (scope distinto, dos puertas al mismo dato); la lens responde lo cross-line — disponibilidad ("¿estamos libres el 14 de marzo?" — un ensayo también bloquea), agregados de dinero (pipeline/cobros/aging/trimestre), vistas cross-org del research (§3.3, §5).
  - *Marco (quitar Calendar y Money como lenses)*: en el rediseño en curso cada line tiene su pantalla; las lenses globales se perciben como "repetir lo mismo sin filtro ninguno". La **home es Today**: agenda de hoy + semana, cross-company, mezclando tasks / money / waiting / events con chip de workspace por fila, y **pins** ("pin a space or a line") como filtro — sin pin se ve todo, con pin solo lo pinchado. Sin sidebar permanente: los pins son la selección de ADR-038 con otra piel. (Maqueta enseñada en sesión 2026-07-04; las pills Calendar/Money aún salen en la captura solo porque está a medias.)
  - *Queda por resolver si se quitan*: (a) dónde vive la vista mes / planificación a 3-9 meses cross-line (los ciclos de venta del sector son 9-18 meses); (b) dónde viven los agregados de dinero — la agenda saca acciones ("Chase Aarhus €1,800") pero no el estado ("¿cuánto me deben?"); (c) las filas task/waiting de la maqueta presuponen la entidad task → adelantan D3. Opción sintética sobre la mesa: las pills como **modos de la misma home que obedecen los pins** (Agenda / Mes / Money, siempre filtrados) — disolvería la objeción "sin filtro" sin perder lo agregado. Ninguna de las tres salidas está decidida.
  - **RESUELTO 2026-07-04 (implementado)**: gana la opción sintética. **Fuera la fila de pastillas** (Today/Calendar/Contacts/Money). El **logo = Home = Agenda** (no hay pastilla de Home: repetía el logo). Un **único control segmentado `Agenda · Calendar · Money`** en el shell, activo por ruta, pin-scoped — Calendar y Money siguen existiendo como vistas transversales pero como *modos de una misma home*, no destinos que compiten con el logo. **"My home" (widgets custom) eliminado** — la Agenda ES la home. Contacts sale del nav (ruta viva para deep-link). Calendar mantiene el grid mensual real (responde "¿estamos libres?"); Money añade roll-up **por línea**. Ambos filtran por pins (space→workspace, line→project + narrowing por line_id). Store `home-mode` borrado. Verificado: typecheck 0 · smoke 1/1 · capturas.
  - **⚠️ EVOLUCIONÓ ese mismo 2026-07-04 (tarde)**: el control segmentado desapareció. Estado final "Adaptive Digest" — **cero botones de nav**, Calendar/Contacts/Money **solo por ⌘K**, vista Agenda dedicada. Registro autoritativo → **ADR-057**. Este bullet queda como historia de cómo se llegó ahí.
- **Status**: la parte de **nav** de este ADR está superada por **ADR-057** (forma final). Lo propio de ADR-056 (line detail = composición de módulos) — **implementado 2026-07-12** (divergencias y estado en ADR-058).

## [2026-07-04] — ADR-051 · Write path de engagements: capturar (y borrar) un contacto desde la UI

- **Decisión**: La difusión captura persona + conversación en un paso — "Add contact" en la Contacts lens (persona inline) y "Add to project" en la ficha de persona (persona existente). Un solo RPC atómico `create_engagement` cubre ambas formas: `p_person_id` (existente, gateado por `can_see_person` — no hay linkado ciego por uuid) o campos inline con **find-or-create por email** (person.email es citext UNIQUE global). Séptimo caso del patrón claim-bound INSERT (`engagement_insert` exige `workspace_id = current_workspace_id()`): SECURITY DEFINER + checks explícitos, gate `has_permission(project, 'edit:engagement')`.
- **Find-or-create por email — ratificado como diseño**: person es GLOBAL (comentario del schema: "one real human = one person row, deduped on email"). Un email conocido enlaza la persona existente aunque la creara otro workspace; en Phase 0 (Marco+Anouk) es lo deseado. Para SaaS es superficie de exposición (el engagement nuevo da visibilidad del file vía can_see_person) — re-evaluar en el gate de cliente externo. Persona reusada/resucitada: solo se rellenan campos VACÍOS (phone/org/title), nunca se pisa.
- **Resurrect en las dos capas**: (a) email de persona soft-deleted → resucita el file (re-sufija el slug si un vivo lo tomó — índice único parcial). (b) El UNIQUE (workspace, project, person) de engagement es TOTAL (incluye soft-deleted) → un engagement borrado bloquearía el trío para siempre; `create_engagement` lo resucita con status/next-action frescos (first_contacted_at conserva la historia). Duplicado VIVO → 23505 → 409 `engagement_exists` (sin merge silencioso: pisaría el status).
- **`delete_engagement`** (RPC, regla ADR-048): un contacto mal tecleado es la misma clase "creado por error" que un gig (ADR-052). Bloquea si hay performances vivas enlazadas (23503 → 409). Sin UI de borrado — existe para la API (self-cleaning e2e) y la simetría resurrect.
- **API**: `mutateJSON` (nuevo helper en `$lib/api`, hermano de `fetchJSON`) unifica el contrato de auth/error de las mutaciones (Bearer, 401→login, hint/detail/error, 204→null, ApiError con status); las 6 mutaciones del cierre lo usan — mata la duplicación que el review adversarial marcó y cierra el hueco de 401 en el write path.
- **Verificación**: migración aplicada + grants auditados (create/delete_engagement solo authenticated) · unit EngagementCreateSchema (7 casos) · RLS engagement-lifecycle (anon sin EXECUTE, project desconocido 403, resurrect, 409 duplicado) · e2e contact-create (alta + 409 + self-clean con recuperación pre-test) · typecheck 0/0 · suite global RLS 30/30 + unit 79/79 + e2e 14/14 contra producción.
- **Status**: Firm. Producción 2026-07-04.

## [2026-07-04] — ADR-052 · Delete de performance — los gigs por error se borran, los caídos se cancelan

- **Decisión**: `delete_performance` (RPC por ADR-048) + `DELETE /api/performances/:key` + zona danger con confirm en el dialog de edición. Semántica deliberada: **delete es para errores; un bolo que se cae es status `cancelled`** (el confirm lo dice). Facturas vivas no-cancelled BLOQUEAN el borrado (23503 → 409, hint: descarta el draft o cancela la factura) — un registro de dinero nunca queda colgando. Hijos (crew/cast_override/date/asset_version) intactos: inalcanzables vía bundle, restaurables a mano.
- **Convención de error consolidada**: 23503 = "bloqueado por estado referencial" (facturas vivas en delete_performance, performances vivas en delete_engagement) — tercer miembro del contrato junto a 42501 (forbidden/not-found sin oráculo) y 22023 (input inválido). delete_invoice (22023 para su guard de status propio) queda como está.
- **Self-cleaning e2e**: performance-write borra sus gigs (uno por UI confirm, resto por sweep API **acotado a workspace fixture + prefijo de venue** — el review cazó que un sweep por fecha sin filtro podía borrar datos reales de muk-cia, el test user es admin ahí). Serial mode en el describe (fullyParallel global). La acumulación e2e-venue-* y la purga manual del runbook desaparecen.
- **UI post-delete**: goto al calendario sin invalidar ['performance'] (evita el flash refetch-404) — patrón para futuros delete-then-navigate.
- **Verificación**: migración aplicada + grants auditados · RLS engagement-lifecycle (performance create→delete→gone, unknown-id 403) · e2e delete (UI confirm + sweep scoped a workspace+prefijo) · suite global verde contra producción.
- **Status**: Firm. Producción 2026-07-04.

## [2026-07-04] — ADR-053 · Venue editable — address, timezone, contacts

- **Decisión**: `PATCH /api/venues/:id` DIRECTO (sin RPC — `venue_update` RLS cubre workspace members y la fila sigue visible tras el update; la regla ADR-048 solo muerde soft-deletes) con whitelist valibot: name/city/country/address/capacity/timezone/contacts/notes. UI: botón "Edit venue…" junto al picker del dialog de edición de performance (dialog apilado). El timezone alimenta la dual-time del road sheet que ya existía (D-PRE-10) — 1c era la superficie de edición que faltaba, no el rendering.
- **Timezone**: validación por el medio nativo — `Intl.DateTimeFormat` lanza RangeError en zona desconocida (`isValidTimezone`, corre en workerd y browser); datalist con `Intl.supportedValuesOf('timeZone')`. Cero listas IANA embebidas que driftear.
- **Contacts**: jsonb array `{name!, role?, email?, phone?}` (máx 20) con editor de filas; se muestran en el bloque Production (ProductionStub, keyed por índice — dos contactos homónimos no crashean el each) y viajan al road sheet público (ADR-047 ya los incluía — lo que guardes aquí es visible para quien tenga el link, by design).
- **409 `venue_exists`**: colisión con el índice único vivo (workspace, lower(name), lower(city)).
- **Verificación**: unit venue.test (VenuePatchSchema, isValidTimezone, contacts) · e2e venue-link ampliado (editar timezone+contact, verificar en Production, reload) serial · suite global verde contra producción.
- **Status**: Firm. Producción 2026-07-04.

## [2026-07-04] — ADR-054 · Calendar feed ICS — los bolos confirmados son suscribibles

- **Decisión**: feed ICS por workspace con capability token (patrón ADR-047): tabla `calendar_share` deny-all + RPCs create/list/revoke gateados por membership + `get_public_calendar` anon que devuelve JSON saneado — performances **confirmed y más allá** (confirmed/done/invoiced/paid) + dates no-cancelled. NUNCA fee, NUNCA notes, NUNCA datos de persona. El Worker renderiza RFC 5545 (`$lib/ics.ts`, puro y testeado: CRLF, folding 75 octetos UTF-8-safe, escaping, DTEND exclusivo en all-day, UID estable `perf-<id>@hour.zerosense.studio`). `GET /api/public/calendar/:token` con `no-store` (la revocación muerde al siguiente poll). UI: dialog "Feed" en la Calendar lens — crear/copiar (https + webcal)/revocar por workspace.
- **Por qué**: un artista vive en su Google/Apple Calendar; sin feed suscribible los bolos se copian a mano y las fuentes divergen (`_notes/research-redesign-gaps.md` § 2). Probablemente la feature con más valor diario por hora de trabajo.
- **Eventos**: gig con `start_at` → evento con hora (fin = wrap_at solo si es posterior a start_at — con loadout NULL el CHECK permite wrap<start, que daría DTEND<DTSTART; si no, +2h); sin horas → all-day en performed_at. Holds NO salen (un calendario suscrito enseña compromisos, no tentativas). Workspace soft-deleted → el feed muere.
- **Gate de publicación**: crear/revocar exige rol de escritura (owner|admin|member) — un viewer/guest no debe acuñar un link anon permanente al calendario entero (verificación adversarial lo marcó; alineado con el gate edit:show del road sheet). list es cualquier miembro aceptado.
- **Verificación**: migración aplicada + grants auditados (get_public_calendar con anon; create/list/revoke solo authenticated; tabla deny-all RLS forzado) · unit ics.test (folding UTF-8, escaping, DTEND exclusivo incl. guard wrap_at<start_at, timed/all-day, money-free) · RLS calendar-share (deny-all tabla, feed anon saneado sin fee/notes/persona, non-member 403, revoke mata token) · suite global verde contra producción.
- **Status**: Firm. Producción 2026-07-04.

## [2026-07-04] — ADR-055 · Today responde "¿qué hago ahora?" — muere la convención 1-project-per-workspace

- **Decisión**: la Today lens deja de ser dashboard editorial con placeholders "—" y lidera con **next actions vencidas** (OVERDUE primero, en danger) y las de la semana, cross-workspace (query sin project_slug — la convención Phase-0 "1 project per workspace" se elimina; el orden del API `next_action_at.asc.nullslast` garantiza que lo vencido entra en la primera página). Filas → link a la ficha de la persona. Stats reales: active projects · confirmed · on hold (de performances upcoming, derivable desde ADR-041) · overdue · this week. "What's alive" con métricas reales por workspace (open actions / confirmed / on hold). Fuera los filter pills Role/Tag que no filtraban nada (estado muerto desde ADR-033). Today migrada a `fetchJSON` de `$lib/api` (borradas sus copias locales).
- **Por qué**: el oficio de la difusión ES el follow-up; si el recordatorio no te encuentra al abrir la app, los datos mueren (`_notes/research-redesign-gaps.md` § 3a). Today era la lens más floja de las cuatro.
- **Límite honesto**: counts sobre la primera página (100). Con next_action_at ordenado primero, el truncado solo miente si >100 conversaciones tienen next action — lejos del uso real; se re-evalúa con un summary endpoint si llega.
- **Relación con la pregunta abierta de lenses (decisión de diseño 2026-07-04)**: este 1e es el paso "Today lidera" de esa dirección, NO el rediseño completo (pins como filtro, posible retirada de Calendar/Money como lenses) — eso sigue abierto y lo decide Marco durante el rediseño.
- **Verificación**: typecheck 0/0 · [checkpoint visual pendiente — lo valida Marco al usarla].
- **Status**: Firm. Producción 2026-07-04.

## [2026-07-04] — ADR-057 · Nav "Adaptive Digest": cero botones, logo=Agenda, lenses por ⌘K, scope por pins

- **Decisión**: forma final de la nav (implementa el diseño "Hour Nav - Adaptive Digest" de claude.ai; cierra el "rediseño completo" que ADR-055 dejó abierto y supera el control segmentado intermedio de ADR-056):
  - **Cero botones de nav arriba.** El logo `hour` = Home = **Agenda**. No hay pastilla "Today"/"Home" (repetiría el logo). Calendar · Contacts · Money se alcanzan **solo por ⌘K** (grupo "Views": Agenda · Calendar · Contacts · Money). La barra de búsqueda se centra en el shell (grid `1fr auto 1fr`).
  - **Scope por pins** (sustituye el sidebar-filtro de ADR-038): pins `s:<slug>` (espacio) o `l:<lineId>` (línea); sin pins = todo lo que ve el user. Componente **`ScopeStrip`** en TODAS las lenses (home, agenda, calendar, money, contacts) — pastilla "All spaces" cuando no hay nada pineado; picker con fondo `--bg` (cream), botón PIN SPACE que pinea, click en el nombre expande sus líneas (no pinea). `resolveScope`/`inScope` en `$lib/nav.ts`; `ResolvedScope.projectIds` deriva de los proyectos de las líneas pineadas (un pin de línea alcanza engagements por su project — no llevan line_id).
  - **Home = próximos 7 días, capado a 10 filas**, con botón semitransparente "+ N more · next 7 days → Agenda". Timeline compartido en **`AgendaBoard.svelte`** (raíl de puntos, buckets OVERDUE→TODAY→…→NEXT WEEK, verbos por status, tags), parametrizado por `cap` + `next7Days`. **Vista nueva `/h/[ws]/agenda`** = el mismo board sin capar (todos los rangos), a la que lleva el botón.
  - **Contact multi-espacio** (surface del modelo ADR-051): `person` es identidad global deduplicada por email; pertenecer a un espacio = un engagement en uno de sus proyectos. "Add contact" toma un **conjunto de proyectos agrupados por espacio** (checkboxes) → N engagements. Creación **secuencial**: la 1ª inserción find-or-create la persona y devuelve su id; las siguientes enlazan ese `person_id` (contacto sin email no duplica persona; sin carrera sobre el email citext-unique). Toast resume created/already-there/failed.
- **Por qué**: cada line tendrá su pantalla (ADR-056), así que las lenses globales como destinos permanentes competían con el logo y se percibían como "lo mismo sin filtro". El logo llevando a la Agenda (la pregunta real: "¿qué hago ahora?") es el destino primario; el resto son saltos de ⌘K, no navegación siempre presente. Los pins son la selección de ADR-038 con otra piel, más ligera (sin sidebar permanente).
- **Supersede**: la parte de **nav** de ADR-029 (lens nav top) + ADR-033 (pills Today·Calendar·Contacts·Money) + ADR-038 (sidebar como filtro multi-select) + el control segmentado intermedio del bullet "RESUELTO" de ADR-056. El modelo de datos de ADR-038 (selección = unión de workspace/project ids) sobrevive dentro de `resolveScope`.
- **Nota de implementación (gotcha preservado)**: al montar el `Checkbox` compartido salió a la luz un fallo de **orden de capas CSS en dev** que afectaba a toda la app — Vite inyecta `@layer components` de cada componente antes de que base.css declare el orden, y CSS lo fija en la primera mención → `components` quedaba por debajo de `defaults`. Fix: declarar el orden en el `<head>` de `app.html`. Detalle completo en `_notes/sessions-log.md § 2026-07-04 (tarde)`.
- **Re-evaluate when**: (a) si aparece la entidad task (D3), decidir si la Agenda mezcla tasks con events; (b) si el mes/planificación cross-line a 3-9 meses necesita más que el grid de Calendar; (c) cuándo/si Contacts pasa a una vista por-persona (hoy lista engagements → un contacto en N espacios = N filas); (d) móvil (Phase 0.4) — la Agenda y la ScopeStrip necesitan su pasada responsive.
- **Verificación**: typecheck 0/0 · smoke 1/1 · sin errores de consola en home/agenda/calendar/money/contacts/settings/⌘K/diálogo new-performance · multi-espacio probado en vivo (1 persona, 2 engagements, 2 workspaces) y limpiado. En local; el deploy lo lanza Marco.
- **Status**: Firm + implementado 2026-07-04 (tarde), local. Commits: rediseño nav (`d68ceae`…`c9dfebd`) + `a01878f` + `3c4f91e` + `9ef65d4` + `c05d4a9`.

## [2026-07-12] — ADR-058 · Implementación de ADR-056: divergencias decididas al construir

> Sesión autónoma .zerø (ultracode) con grill previo de Marco (alcance completo, creación restaurada en 3 niveles, layout de pila, regla de asignación line_id, limpieza, proceso). ADR-056 pasa a **implementado**; esta entrada registra solo lo que se DECIDIÓ distinto o más fino que el texto de ADR-056.

- **`date.line_id` NO existe** (el catálogo de ADR-056 lo daba por hecho — error del ADR, verificado contra las migraciones). Decisión: el módulo Calendar muestra las dates unidas a los bolos de la line (join cliente por `performance_id`); las dates a nivel project quedan en la lens global. Añadir `date.line_id` sería otra migración — se re-evalúa si el uso real lo pide.
- **Plantillas en inglés; la de difusión se llama "Booking"** (glosa inglesa del propio proyecto — la ruta histórica `/booking`; el vocabulario anti-CRM veta lead/pipeline/funnel, no booking). Feria → kind `campaign` (no hay valor `fair` en el enum; ADR-031 ya previó ampliarlo si consolida). Keys: tour/booking/creation/press/fair/blank.
- **`create_line` generaba lines sin slug** — hallazgo del critic: la nav es slug-addressed (`lineUrl`), así que toda line creada por el RPC viejo era innavegable. Fix en la migración: slug `slugify(name)` + sufijo id-6hex en colisión (esquema ADR-024), backfill defensivo de slugs NULL, y la página resuelve slug-O-id como cinturón.
- **Leak de dinero cerrado en `GET /api/performances`**: seleccionaba `fee_amount/fee_currency` de la tabla BASE (gate = edit:show), saltándose `read:money`. Nadie renderizaba esos campos (verificado); se quitan del select. La puerta de dinero es `/api/money/performances` sobre `performance_redacted`, único camino (ADR-041/046).
- **Dos pares de RPCs nuevos** que el plan de ADR-056 escondía ("aquí aterriza la UI de expenses" implicaba write paths): `create_expense`/`delete_expense` (8º caso claim-bound; expense no tenía NINGÚN delete path) y `create_asset_version`/`delete_asset_version` (9º caso; direction `inbound`/`adapted` vetadas a scope line — el CHECK de la tabla las liga a performance/source). Endpoints: `/api/expenses(+/:id)`, `/api/lines/:id/materials(+/:assetId)`, `/api/lines/:id/people` (read-only, 3 queries paralelas).
- **€ del header y masked-vs-empty**: `performance_redacted` devuelve NULL tanto sin permiso como sin fee — indistinguibles. Decisión: el stat € solo se muestra si existe ≥1 fee no-null; el módulo Money enseña "Fees hidden or unset." en vez de un 0,00 fabricado. Un capability-flag explícito queda para cuando haya roles de verdad (Phase 0.9).
- **Stats del header por kind, con counts honestos**: booking = total (exactCount) + holds/confirmed (exactCount con limit=1) + vencidas (primera página ordenada por next_action_at — exacto salvo >100 vencidas); tour = próximo bolo + confirmed/holds + € pipeline (claves de query COMPARTIDAS con los módulos — cero fetches duplicados).
- **PATCH `/api/lines/:id` whitelist = `modules` a secas** (picklist cerrado, duplicados fuera). `notes` excluido (columna del collab), name/status/dates esperan una superficie de settings de line.
- **Creación restaurada donde se decidió en el grill**: picker de plantillas + New project/New space en dialogs montados UNA vez en el layout (contexto `creation.svelte.ts`), entradas en las space cards de la home (+ ghost card "New space") y grupo "New" en ⌘K. El picker de accents de Plaza se portó (única copia de esa UI); focus mode muere sin sucesor directo (los pins son el modelo).
- **Lines no tienen delete path** (sin policy DELETE; soft-delete por PATCH imposible por ADR-048) → los tests usan una fixture line ESTABLE (find-or-create), nunca por-run. Si algún día hace falta borrar lines, será `delete_line` RPC.
- **Review adversarial (completo en re-run, 33 agentes / 5 lentes): 20 confirmados, 8 refutados.** El HIGH real: el dialog de performance extraído conservaba cProject/cLine entre navegaciones de line (la instancia sobrevive al cambio de ruta) → un gig podía nacer en la line equivocada; ahora el preset del contexto SIEMPRE gana. También: `create_line` sin recovery de reserved-slugs — nombrar una line "Booking" (¡la etiqueta de su propia plantilla!) fallaba con error crudo (v3 aplicada: sufijo id-6hex + cap 57 chars); 23505→409 en POST /api/lines (la rama amable del dialog era inalcanzable); invalidaciones de stats/fees; endpoints de materials alineados con people; specs endurecidos contra mis-targeting sobre datos reales de muk-cia. Desviaciones aceptadas a Shelf: expenses módulo-only (anti-fragmentación pospuesta a la historia de agregados), totales cross-currency, duplicaciones de filosofía.
- **Status**: **en producción 2026-07-12** — migraciones aplicadas y verificadas (backfill 154, grants limpios), deploys hour-collab → hour-web, suite completa contra prod: unit 100/100 · RLS 38/38 · e2e 17/17 · collab line smoke (snapshot + write-back verificados). El desbloqueo llegó con la frase explícita de Marco (el clasificador de auto-mode no acepta autorización genérica para producción).

## [2026-07-12] — ADR-059 · Pasada de coherencia visual: contratos que faltaban en el sistema

> Sesión autónoma .zerø (ultracode) a petición de Marco ("muchísimas inconsistencias visuales — que todo se vea coherente"). Audit de 8 lentes (screenshots reales light+dark de 17 vistas + código) → 42 hallazgos consolidados, verificación adversarial → 41 aplicados, 1 a Shelf (F33 alturas de control). Esta entrada registra las DECISIONES de sistema; el detalle mecánico está en el commit y en `_notes/sessions-log.md § 2026-07-12 (noche)`.

- **El shell opta fuera del default de `<section>`**: el default global (`--section-padding-block` ≈ 72px + gutter) es ritmo editorial de documento, no de app — inyectaba ~200px de vacío entre módulos/secciones en TODAS las páginas de detalle y desalineaba el borde izquierdo 32px. Regla única `.shell__content :where(section:not(section section)) { padding: 0 }` en base.css; `.shell__content` pasa a poseer la distancia header→contenido (antes cada ruta la heredaba distinto — lotería). Login/público conservan el default. Alternativa rechazada: parchear página a página (whack-a-mole, filosofía al revés).
- **Dark re-deriva la escalera de sombras**: los pasos `*-ultra-light`/`*-dark`/`*-ultra-dark` se mezclaban hacia blanco/negro literales → en dark toda la familia pill (badges/chips/avatars/toasts/menu active) brillaba casi blanca. En `[data-mode="dark"]` los fills se hunden hacia `--base` (receta de los tag-tones, ~27-30% L) y las tintas suben hacia blanco (~80% L). Los pasos `-light`/`-semi-light` NO se voltean a propósito (--text-faint y bordes los consumen como "más claro que la tinta", que sigue siendo cierto). `--text-light` pasa a literal oscuro en dark (ticks de checkbox y texto de tooltip sobre fills claros).
- **El contrato de tonos de StateBadge estaba muerto**: los defaults vivían a especificidad de clase y el swap por `[data-tone]` a cero — el default ganaba siempre y TODOS los badges de lifecycle salían grises. Defaults movidos a `:where(.state-badge)` antes del contrato. Con el contrato vivo, cada superficie de status comunica estado por color otra vez (la regla ADR-033 "color = estado").
- **Un solo skin de campo** (`--field-*` en tokens): quedaban dos sistemas paralelos (defaults semánticos blancos/radius-6/focus tinta vs `.field__control` crema/radius-4/focus primary+ring). Canónico = el look de `.field__control` (mejor a11y, editorial). El roster semántico gana `datetime-local`/`time` y el input de timezone gana `type="text"` — cinco campos del dialog de performance renderizaban como controles nativos sin estilo.
- **`--h1` re-afinado al masthead real** (1.8→2.4rem) y los 10 mastheads con clamp() propio pasan a consumir el default de base.css; `--heading-letter-spacing` por fin se consume en el bloque de headings. Dos registros de ancho de página (`--page-width-reading` 46rem / `--page-width-wide` 64rem) sustituyen la lotería 40/44/46/48/56/57.5/64rem+920px; lenses siguen full-bleed a propósito.
- **Micro-componentes graduados a base.css/$lib** (la deuda "dedup filosofía" del Shelf + lo que el audit encontró de más): `AccentSwatchPicker` (3 copias × ~70 líneas), `$lib/money` (fmtFee/fmtMoney/fmtMoneyCompact/invoiceTone — el lens permitía 3 decimales por un maximumFractionDigits ausente), `.eyebrow--sub` (5 copias con weight/tracking a la deriva), `.link-arrow` (4 tratamientos del patrón "X →"), `.creator` (3 tratamientos del "+ New"), `.pill--mono` (6 reimplementaciones del micro-pill mono), `.table-wrap` con `container-type` (los caps de columna pasan a cqi — la columna NEXT ACTION era invisible en el módulo Contacts), `.status-caret` compartido. `dayMonth`/`dayMonthTs`/`dayMonthYear` en $lib/datetime matan 7 formateadores locales (en-US fuera; el de project tenía off-by-one UTC latente).
- **Una gramática de status por dominio, una geometría**: el chip de engagement ES el dropdown (chip+caret); performance lo copia (StateBadge como trigger del Menu vía `triggerAttrs`, muere el botón "status ▾" separado). Empty states: una voz inline (`--text-s`, `--text-faint`, roman) + gramática "No <thing> on this line yet. — hint."; la voz serif centrada de agenda/⌘K se queda (registro de página deliberado). Copy: jerga interna fuera de la UI (fases, "(ADR-025)"), el placeholder de engagement dice la verdad y vuelve a Contacts, los stubs de project listan las lines REALES (compartiendo la query cache del shell — decían "No lines yet" con dos lines vivas).
- **Chips sticky del line detail true-by-construction**: `--header-height: 3.6rem` declarado en `.shell` con `min-block-size` en la barra; chips y scroll-margins lo consumen (los 3.4/6.5rem estimados se metían 3px bajo la barra). Cierra el checkpoint visual pendiente del Queue.
- **Verificación**: svelte-check 0/0 · unit 100/100 · e2e local 15/15 + collab 2/2 contra prod (el DO no corre en dev local — fallo ambiental, no regresión) · re-screenshot de las 17 vistas light+dark y medición: vacío intra-módulo 72px→0, chips a 57.6px = altura real de barra. En local; el deploy lo lanza Marco.
- **Re-evaluate when**: F33 (token compartido de padding de control) cuando se toque la fila de filtros de contacts; `.set-seg` de settings quedó con selected gris (el segmented grande) — alinear a ink fill si chirría en uso.
- **Status**: Firm + implementado 2026-07-12 (noche), local, pendiente deploy.

## [2026-07-12] — ADR-060 · Home projects-first: el project entra en la nav (grid + pin `p:` + ⌘K)

> Primer feedback del gate 0.3 con uso real: "todo está pensado para trabajar como espacio; me falta poder ver el project" (Marco). Propuesta con maqueta, OK explícito ("adelante con esto"), implementación en la misma sesión.

- **Contexto**: los tres niveles del modelo (espacio → project → línea) tenían solo dos en la nav — pins `s:`/`l:` (ADR-057), home = tarjetas de espacio con las líneas planas dentro (projects de un mismo espacio se mezclaban), ⌘K sin projects, y el detalle de project solo alcanzable por el back-link del line detail. El backend ya pensaba en projects (engagements a nivel project, cast canónico ADR-034, `ResolvedScope.projectIds`, todas las lenses filtrando por `project_ids ∪ workspace_ids`) — la nav no. En el dominio, el project ES el espectáculo: la unidad de pensamiento.
- **Decisión**:
  - **Home = agenda + grid de projects** (una sección; muere el par Pinned/All-spaces con sus dos tarjetas casi duplicadas `lmini`/`spin` → una `pcard`). Tarjeta: chip mono del espacio con su accent dot (**espacio = contexto, no contenedor**), pin toggle (`pill--on` de base.css), nombre → detalle, stats honestos (conversations por exactCount + confirmed/holds de performances upcoming; ceros omitidos, "no activity yet" si nada), líneas dentro (glyph + stat + chip "pinned" si su línea lo está), "+ New line" con preset workspace+project. Espacios sin projects no pintan tarjeta; creación por ghost "+ New project" y "+ New space" en la cabecera de sección.
  - **Orden del grid**: pinned primero → project con línea pineada → resto por actividad desc (conversations+confirmed+holds). `project.updated_at` (el orden del API) se queda frío porque trabajar el show toca engagements/lines, nunca la fila del project — MaMeMi salía último con 154 conversaciones.
  - **Pin de project `p:<projectId>`** — tercer kind en `pins.svelte.ts`. `resolveScope(pins, workspaces, lineIndex, projectIndex)`: `projectIds` = unión de pins directos ∪ projects de líneas pineadas (la superficie de filtro de la API — cero cambios de backend); `projects` = SOLO pins directos, para la excepción del narrowing: **pin de línea = solo esa línea (calendar/money); pin de project = todo el project**. `scopeUnresolved` de calendar/money/contacts extendido a pins de project pendientes de cache.
  - **ScopeStrip**: chip de project (nombre · espacio, click → detalle) + picker en árbol espacio → projects → líneas (click en fila = pin; "pin space" explícito se mantiene). Label: "Bring forward — space, project or line".
  - **⌘K**: grupo "Projects — the shows" entre Lines y Spaces; placeholder "Jump to a project, line or space…"; `onPickProject` → detalle. Copy de la búsqueda del shell alineado.
  - **Calendar**: con 0 líneas y exactamente 1 project pineado, "New performance" presetea ese project.
- **Fixes de camino**: (1) project detail y line detail resolvían el project por slug SIN workspace — colisión cross-workspace latente (slugs únicos por (workspace, entity), ADR-024); ahora slug+workspace, y las líneas del detalle filtran por project id, no slug. (2) El detalle de project suelta su copia local pre-`$lib/api` de fetchJSON (deuda anotada en el header de api.ts) y comparte `activeProjectsQueryOptions` (nav-queries; la MISMA key que ya usaban dialog de creación, contacts y line detail — una cache, cero fetches duplicados).
- **Alternatives rejected**: agrupar el grid por espacio con headers (ruido con espacios vacíos; el chip por tarjeta hace el trabajo); mantener tarjetas de espacio pineadas en la home (el grid ya enseña sus projects — el pin de espacio queda como scope puro en la strip); ordenar por updated_at del API (miente sobre recencia real).
- **Verificación**: svelte-check 0/0 · unit **110/110** (+10 `nav.test.ts`: parsePin 3-way, buildProjectIndex, unión/dedupe de resolveScope, inScope con pin directo) · build limpio · **e2e 15/15 local** + 2 skipped (collab, solo-prod) con smoke actualizado (aria-label nuevo del ⌘K + aserción del grid) · capturas light/dark/pinned/picker/⌘K revisadas (datos reales: MaMeMi primero, 154 conversations · 8 confirmed · 1 hold).
- **Re-evaluate when**: (a) project detail = composición de módulos (re-evaluate a de ADR-056, sigue en Shelf) — la home ya le da entradas; (b) si el pop-in del orden por actividad molesta (los counts llegan tras el primer paint), fijar orden en el primer render; (c) `engagement.line_id` ya existe — si algún día el pin de línea debe filtrar contacts por línea exacta en vez de por project, el dato está.
- **Status**: Firm + implementado 2026-07-12 (noche 2), local, **pendiente deploy junto a ADR-059**.

## [2026-07-13] — ADR-061: Phase 0.9 hardening gate — httpOnly sessions, CSP, error mapper, Sentry PII, rate limit, health, CI
- **Decision**: Implement the full Phase 0.9 external-onboarding hardening gate in one pass, so Hour can open to a curated set of external (non-MüK) workspaces in the coming weeks. Scope chosen for **curated onboarding** (Marco creates each workspace), NOT public self-serve — that keeps the session model at httpOnly cookies + CSP rather than forcing a full `@supabase/ssr` adoption now.
- **Context**: Marco decided to open Hour to external users within weeks (was: internal MüK only). That flips the "before external beta" backlog (localStorage JWT, no CSP, PostgREST error leak, public Sentry endpoint, no CI) from deferred to blocking. Threat model shifts from all-trusted to partially-untrusted users (XSS, error-leak, quota-abuse become real).
- **What shipped**:
  - **httpOnly cookie sessions** (was: access+refresh in localStorage, no refresh flow). Login/refresh/logout/session/token run server-side under `/api/auth/*`. `hour_at` (httpOnly, Secure, SameSite=Strict, TTL=token exp, Path=/) + `hour_rt` (refresh, Path=/api/auth, 60d, rotated each use). `$lib/api.ts`: 401 → single-flight refresh → retry once → bounce. Identity from `$lib/session.svelte.ts` (server `/api/auth/session`), replacing every client-side JWT decode + every `localStorage.getItem('hour_jwt')` presence gate. `$lib/auth.ts extractAccessToken` reads Authorization header first (non-browser clients) then the cookie (browser). The ONLY JWT reaching JS is the ≤1h access token via `/api/auth/token`, for the two cross-origin consumers (Supabase Realtime + `has_permission` RPC) — bounds an XSS steal to the token TTL. Collab WS auth moved from `?token=<jwt>` (leaked into every edge log) to the cookie on the same-origin upgrade.
  - **CSP + security headers**: `kit.csp` mode auto (nonce on SSR, hash on prerendered `/offline`) + `hooks.server.ts` (x-content-type-options, referrer-policy, x-frame-options DENY, permissions-policy, COOP, HSTS non-dev) + same-origin CSRF floor on mutations + per-request `x-request-id`.
  - **Central PostgREST error mapper** `$lib/server/errors.ts` — ~30 endpoints stopped reflecting `err.body` (constraint names, RAISE messages, conflicting key values) to the browser; detail now goes to the structured server log, client gets stable codes. Public/roadsheet anon surface fully opaque.
  - **Sentry PII scrub**: `sendDefaultPii:false` client+server, capability-token URL scrub (`$lib/sentry-scrub.ts`), Replay masking explicit, `/api/sentry-test` dev-only (removed the `?force=1` prod escape hatch — was a quota-burn vector), tunnel rate-limited + size-capped + DSN-checked.
  - **Rate limiting** `$lib/server/rate-limit.ts` (KV fixed-window, fail-open, no-op without binding) on login/refresh/tunnel.
  - **Health checks** `/health/live` + `/health/ready` (Supabase auth/v1/health, 3s timeout). **Structured JSON logging** with request_id.
  - **CI** `.github/workflows/ci.yml` — secretless barrier (svelte-check + unit + build + collab tsc). RLS/e2e stay local (hit prod / need creds) until a staging Supabase branch exists.
- **Alternatives rejected**: (a) Full `@supabase/ssr` + cookie-based Supabase client — more surgery than curated onboarding needs; deferred to when public signup is real. (b) Keep JWT in localStorage + rely on CSP alone — leaves the refresh token permanently exfiltrable by XSS; the hybrid (httpOnly refresh + short-lived JS access token) is the defensible middle. (c) Cloudflare zone rate-limit rule (paid) / Durable-Object limiter (can't live in hour-web — adapter owns _worker.js) → KV counters instead.
- **Rationale**: RLS was already the real security boundary (existing + tested); this pass closes the client-side and transport-side gaps that a partially-untrusted user population opens. The two genuinely cheap high-leverage items (kill sentry-test, add CI) shipped alongside. Curated-onboarding scope keeps it to ~a focused build instead of a session-model rewrite.
- **Verificación**: svelte-check **0/0** (1473 files) · unit **110/110** · collab tsc clean · production **build OK** (caught + fixed: `%sveltekit.nonce%` literal — even in a comment — is incompatible with prerendering `/offline`; removed, kit.csp auto-hashes the inline theme script instead). Adversarial review (5 lenses → verify) run. **NOT yet run: RLS suite + e2e** (need `.env.test` + the login change verified in a browser — Marco runs before deploy). **NOT yet done entonces (manual; runbook actual `build/runbooks/beta-readiness.md`)**: create the `RATE_LIMIT` KV namespace + uncomment the wrangler binding; restore drill; point RLS suite at a staging branch; add a second non-admin fixture user (unlocks RLS scenarios 3/4/5).
- **Re-evaluate when**: public self-serve signup becomes real → migrate to `@supabase/ssr` httpOnly-cookie Supabase client + drop the `/api/auth/token` hole; or if the login rate-limit (10/300s per IP) locks out a shared-office NAT → widen or key differently.
- **Status**: Firm + implemented 2026-07-13, local, **pendiente de: verificación en navegador de Marco (login/refresh/collab) + RLS/e2e + KV namespace, luego deploy** (collab primero, luego web).

## [2026-07-14] — ADR-062 · Modelo de espacio: H1 (espacio = una entidad), el roster es espacios (no un nivel), + campos universales domain/city/logo
> Sesión con Marco montando la portada de espacio (`/h/[slug]/`). Al pensar los fields "en global" (contra los 8 arquetipos del research + `uploads/99-patterns.md`), salió la bifurcación de fondo: ¿un espacio es una entidad, o un contenedor con roster? Grounding: research §2.1 (show-vs-artist), §3.1 (contact book mine/ours), §5 (multi-tenant freelance).

- **Decision**:
  1. **Un espacio = una entidad** (organización o personal), tier de igual rango (§5). Los proyectos cuelgan directos del espacio. **No existe un nivel `acto`/roster** entre espacio y proyecto.
  2. **La multiplicidad ES espacios.** Distribuidor con 5 clientes = 5 espacios (de accounts distintos, es miembro invitado). Productora con 15 artistas = 15 espacios-artista (bajo un mismo account). Mismo primitivo; la agrupación la da el `account` (ADR-029: un usuario cruza N espacios de N accounts).
  3. **La vista-roster/portfolio = el `∑` cross-espacio** (`/h/`, ya sembrado como home sin espacio en el trabajo de esta semana). No es un contenedor de datos, es una VISTA. Sirve al distribuidor (sus clientes) y a la productora (su roster, filtrado por account) con el mismo mecanismo.
  4. **Campos de espacio por capas** (principio anti-Airtable §1.3: columna solo si universal+estable; `custom_fields` jsonb para la cola larga por arquetipo; `settings` jsonb para defaults):
     - Identidad (columnas): name·slug·accent·description ✅ + **`domain`** (enum disciplina) + **`city`** (home base) + **`logo_url`** → migración `2026-07-14_workspace_domain_city_logo`.
     - Fiscal (columnas, **diferido** al módulo Money/Fase 1): razón social·NIF/VAT·dirección·moneda·régimen. Viven en el espacio (es la entidad que factura).
  5. **`domain` conduce el vocabulario y los tipos de proyecto por-arquetipo** (§7): un espacio de música enseña "holds"/"difusión"; uno de teatro "carta de interés"/"distribución". Es el campo load-bearing — por eso enum opinado, no texto libre. El kicker del mockup ("Theatre company · Barcelona") = `domain` + `city`, no campos inventados.

- **Context**: La portada necesitaba saber qué campos son reales vs fabricados. Pensarlo global sacó la bifurcación. El espacio ya se comportaba como "una entidad entre muchas" en la nav recién construida (rail + home sin espacio + portada) → ya íbamos por H1 de facto.

- **Alternatives considered (rejected)**:
  - **H2 — espacio = contenedor con roster** (espacio→acto→proyecto→línea): mete un nivel siempre-uno para la mayoría (compañía/banda/solista = peso muerto), y **rompe al distribuidor** (§3.1: los datos de cliente A y B deben estar aislados; como "actos de un roster" del distribuidor se mezclarían). Rechazado.
  - **H3 — `acto` como tag/agrupación**: infra-modela al artista (que para agencias ES el objeto primario, §2.1). Rechazado.
  - **Nivel `acto` diferido** (primera propuesta de .zerø): innecesario. Marco señaló que un artista es *space-like* (nombre, disciplina, shows, contactos, caché, EPK propios) → **es un espacio**, no un sub-nivel. Correcto y más simple: el nivel `acto` no debe existir.

- **Rationale**: H1 es la columna vertebral que el research pide (el moat = "1 personal + N organizaciones", §5/§10.2) y lo que ya construimos. `domain` en el espacio (no en un acto) queda limpio incluso para una productora multi-disciplina (espacios con `domain` distinto). La única diferencia real distribuidor↔productora es el **default de compartición** (aislado vs compartido), y lo fija la propiedad del `account` + la frontera privado/compartido que de todos modos hay que tener (§3.1) — no un nivel de datos.

- **Re-evaluate when**: aparezca un caso que "otro espacio" no cubra (p. ej. un show co-producido por dos artistas de la misma productora que deba vivir "encima" de ambos) — improbable; hasta entonces, sin nivel `acto`. La identidad fiscal se columniza al arrancar Money. El enum `workspace_domain` se amplía con `ALTER TYPE ... ADD VALUE` si falta una disciplina.

- **Status**: Firm + implementado 2026-07-14. Migración `workspace_domain_city_logo` (columnas additive, nullable) + `update_workspace_rpc` (owner/admin, jsonb patch) + PATCH `/api/workspaces/[id]` + `EditWorkspaceDialog` (name·discipline·city·color·description; el lápiz del masthead lo abre, on-save invalida `['workspaces']`). La portada muestra `domain · city`; sin disciplina cae a la ciudad sola, y si no hay ni disciplina ni ciudad oculta el kicker (nada de fallback a `kind` — ejes ortogonales). MüK poblado (theatre/Barcelona). **Pendiente**: upload de `logo` (R2 + `img-src` CSP), poblar el resto de espacios, identidad fiscal (con Money), org-accounts formales (Fase 1), y la verificación en navegador de Marco (el PATCH autenticado no se conduce headless). `svelte-check 0/0` + build OK + dry-run del patch jsonb verificado.

## [2026-07-14] — ADR-063 · Modelo de estructura: lente (lee) vs módulo (edita en línea) vs tarea (verbo); 3 niveles de edición; la lente no posee lógica de edición (opción 2)

> Sesión con Marco afinando la nomenclatura de estructura tras unos días usando la app. Cierra la deriva de nav (ADR-009 → 057) dándole por fin definición canónica a los tres términos que se usaban sin definir. **La versión viva y completa está en `build/structure-model.md`** — esta entrada es el registro de la decisión; el doc es la referencia que no se debe perder.

- **Decisión** (los términos quedan fijos):
  - **Lente** = superficie de solo lectura / agregación. Cross-contenedor, scopeable por pins. **No posee lógica de edición propia.** El home `/h/` es la lente más ancha (ADR-062: "es una VISTA, no un contenedor").
  - **Módulo** = sección compositiva **solo a nivel línea**, elegida por el `kind`. Es la superficie de edición-en-contexto de la línea. **Nada por encima de la línea compone módulos.** Catálogo: Calendar · Contacts · Money · Notes · Materials · People · Road sheets (+ Tasks con D3).
  - **Tarea** = capa-verbo, no un dominio de dato. Polimórfica (project / línea / performance / engagement). Nunca lente. Se manifiesta como módulo + next-action inline en engagement (ya vivo) + feed de la lente Agenda.
  - **Contenido editable del espacio / del project** = campos propios del contenedor. **No son módulos.**
  - **Split**: se edita en un contenedor (3 niveles: espacio → project → línea/módulos); la lente solo muestra.
  - **Opción 2 (elegida)**: la lente puede *hospedar* el editor de la entidad inline (comodidad), pero no define edición propia. Reconcilia los editores inline de hoy en Money / Calendar / Contacts (ADR-046 / 043 / 044): son el editor de la entidad hospedado, no lógica de la lente.
- **Refina / resuelve**:
  - **ADR-056**: los assets canónicos (rider técnico, dossiers) y el cast son **contenido del project**, no del módulo de línea; el módulo Materials / People de la línea es vista/adaptación que lee del canónico del project (intención original de ADR-009).
  - **Re-evaluate (a) de ADR-057** ("¿project detail = composición de módulos?") → **No.** Project detail = su contenido + sus líneas + lentes scopeadas. Los módulos se quedan en la línea.
  - **Mata la lente Archive** (nunca especificada; placeholder de ADR-009).
- **Dirección (no implementada, a validar con uso)**: reducir a 3 lentes-concern — **Time** (Agenda + Calendar en una entrada, toggle lista↔grid; **NO borrar el grid** — hace detección de conflictos que la lista no), **People** (Contacts + comms como timeline por persona), **Money**. Cuarta lente **Work/Flow** solo si aterriza D3.
- **Por qué**: los tres términos se usaban sin definición canónica → cada rediseño los resignificaba y el modelo derivaba. Con el split lectura/edición + "módulos solo en línea" + "tarea = verbo" el modelo deja de derivar. Marco: unos días de uso real bastaron para ver los puntos de conflicto que lo motivan (no hizo falta el mes entero).
- **Re-evaluate when**: el uso real diga si Agenda y el grid de Calendar son la misma superficie (→ fusionar Time) o no (→ mantenerlas separadas); D3 (decidir Work/Flow + si Agenda mezcla tasks con events); aparezca un concern que no sea ni lectura transversal ni contenido de entidad.
- **Status**: **Firm** (el modelo). La reducción de lentes es **dirección**, no implementada. Doc vivo y canónico: `build/structure-model.md`.

## [2026-07-14] — ADR-064 · `workspace.kind` (personal/team) es vestigial: solo/compartido es emergente, mío/cliente es el account
> Sale de ADR-062/063 al arreglar el kicker del masthead: `kind` se colaba como etiqueta ("Personal/Team space") mezclando ejes. Marco: "¿hace falta esta diferenciación? ¿qué diferencia real hay?"

- **Decision**: `workspace.kind` NO es un tipo de espacio con valor de producto. Las distinciones reales viven en otro sitio:
  - **mío vs cliente** → propiedad del **`account`** (mi account personal lo posee = mío; invitado en un workspace de otro account = cliente). ADR-062/029.
  - **solo vs compartido** → **emergente** de `workspace_membership` (1 miembro vs N). Invitar a alguien lo hace compartido; es un hecho de membresía, no un cambio de tipo.
  - **casa del usuario** → el home sin espacio (`∑` / `/h/`, ADR-062) + el **account personal**.
  Se deja de decidir nada de producto sobre `workspace.kind`.

- **Context**: `kind` no gatea NADA de seguridad (la RLS es por membresía; verificado). Solo tenía dos usos, ambos cosméticos: el saludo del home (heurística "busca el workspace personal para sacar el nombre") y una etiqueta en settings ("Personal/Team workspace" + role-badges fabricados por kind). Además no está bien puesto: `create_workspace` mete `kind='personal'` fijo → que MüK/Demo sean `team` viene de otro camino. Y de nombre se solapa con `account.kind` (que sí es real).

- **El workspace personal NO es vestigial**: un artista solista usa su propio espacio como su acto. Ejemplo real: **"Marco Rubiol" es un proyecto de cançó d'autor**, un espacio de pleno derecho. Confirma ADR-062 (artista = espacio). Lo que sobra es el *tipo* `kind`, no el espacio.

- **Alternatives (rejected)**: (a) mantener personal/team como tipo visible — mezcla ejes ortogonales y confunde con `account.kind`. (b) auto-flip `kind` al invitar a alguien — parche sobre un campo que no debería decidir nada.

- **What changed (fix, 2026-07-14)**: quitada la dependencia de `kind` en los dos usos —
  - `HomeView` saludo: el nombre sale solo del usuario (display name → local part del email), sin buscar "workspace personal".
  - `settings` ("Workspaces & roles"): quitada la etiqueta "Personal/Team workspace" y los role-badges fabricados por kind (los roles reales necesitan el endpoint de members, pendiente).
  La **columna `kind` se deja inerte**, marcada para borrar en una limpieza (borrarla es migración + toca el auto-workspace de signup + la sección de roles de settings).

- **Re-evaluate when**: se rehaga el signup (¿sigue auto-creándose un workspace personal, o el usuario crea su primer espacio a mano?) y la sección "Workspaces & roles" de settings (wire a membresía real) → ahí `DROP COLUMN kind` + `DROP TYPE workspace_kind`.

- **Status**: Firm + usos arreglados 2026-07-14 (`svelte-check` 0/0). Columna `kind` inerte, pendiente de borrado en limpieza.

## [2026-07-14] — ADR-065 · Nomenclatura de la capa de lectura: Desk (home/digest) · Calendar · Contacts · Money; módulo cast/crew = Team

> Sesión con Marco afinando nombres tras fijar el modelo (ADR-063). Pone nombres definitivos al sub-punto "dirección Time/People/Money" de ADR-063. Versión viva: `build/structure-model.md § Read surfaces / § Lens set`.

- **Decisión**:
  - **Capa de nav = 1 home + 3 lentes**: **Desk** (home) · **Calendar** · **Contacts** · **Money** (las 3 lentes por ⌘K).
  - **Desk NO es una lente, es un *digest* cross-concern.** Una lente corta por UN concern (Calendar = fechas, Contacts = tu red, Money = dinero) y posee ese dominio. Desk cruza TODOS filtrando por urgencia ("qué me reclama + lo siguiente + tareas") y **no posee dato propio** — se calcula sobre las lentes + tareas. Por eso es el home (orientación) y no una 4ª lente en ⌘K; meterlo como lente sería error de categoría (un filtro-de-relevancia entre filtros-de-dominio). Detalle: `structure-model.md § Read surfaces`.
  - **Desk** (antes "Agenda"; antes el pill "Today" de ADR-033): revive el nombre de ADR-008 —diseñado para exactamente esto: "what's on your plate: tasks, upcoming gigs, pending money, waiting items"— descartado en su día por no haber entidad task, recupera su razón justo cuando las tareas vuelven. "Agenda" se descarta: en ES/CA/FR significa *calendario* y se confundía con la lente Calendar. "Today" descartado: la vista no es solo de hoy (tareas planificadas o no).
  - **Contacts** = tu red de booking / difusión — **personas Y organizaciones** (teatros, ayuntamientos, festivales): un contacto puede ser un individuo o una entidad. Comms se pliega dentro como timeline por contacto (dirección ADR-056).
  - **Se descarta la fusión "Time"** (Agenda+Calendar en una lente): con Desk claramente ≠ Calendar, la redundancia que la motivaba desaparece; quedan separadas (ahora/triage vs planificar), gap que D3 solo ensancha.
  - **Módulos de línea** (siguen a las lentes): módulo de difusión de la línea = **Contacts** (= la lente Contacts scopeada a la línea); módulo cast/crew = **Team** (cross-arts: cast+crew / músicos+equipo de gira). En Settings, el acceso de usuarios-de-la-app se llama **Members/Access**, no "Team".
- **Desvío "People" revertido (mismo día):** se probó nombrar la lente **People** (más cálida/clara) y renombrar el módulo de difusión a People + el de cast/crew a Team. Se revirtió al ver en la app real que la lente contiene **organizaciones** — *un teatro no es "people"*. "Contacts" cubre individuo Y organización; "People" era falso para media lista. La propia app lo delataba (contador "157 contacts"). **Team se queda** (buen nombre de por sí, independiente del desvío).
- **Por qué**: "Agenda" mentía (suena a calendario) → Desk. "People" mentía en la otra dirección (la lente tiene orgs) → Contacts. Team para cast/crew nombra bien "quién ejecuta el show" y no colisiona con Contacts. Módulos que siguen a lentes + "Desk = digest, no lente" = cero ambigüedad.
- **Set final**: **Desk** (home) · **Calendar** · **Contacts** · **Money**. Módulos de línea: Calendar · Contacts · Money · Notes · Materials · Team · Road sheets.
- **Re-evaluate when**: D3 (tasks) → si Desk necesita separar tasks de events, o si aparece la 4ª lente Work/Flow.
- **Status**: Firm + **renombres aplicados 2026-07-14, cero legacy** (`svelte-check` 0/0 · unit 110/110). Aplicado: ruta `/agenda`→`/desk` (301 redirect), lens store `today`→`desk`, ⌘K + labels + títulos (**Desk · Calendar · Contacts · Money**), `AgendaBoard`→`DeskBoard`, y el módulo cast/crew `PeopleModule`→`TeamModule` + su key `people`→`team` (código + DB). La lente de difusión **se mantiene en Contacts** (ruta `/contacts`, key de módulo `contacts`), tras revertir el desvío People. **Pendientes RESUELTOS 2026-07-16:** (1) la migración inversa `people`→`contacts` ya no hace falta — sondeada la DB, **0 líneas** con la key muerta (de las 6 visibles al usuario de test; la de `demo` queda fuera de su RLS); (2) desplegado y verificado esta noche (301 `/agenda`→`/desk` vivo, e2e 19/19 contra prod). Texto original del pendiente, como registro: (1) **migración inversa en DB** — la migración de esta mañana dejó la key de booking en `people`; el código ya volvió a `contacts`, así que hay que correr el swap inverso `people`→`contacts` (dejando `team`) para que la DB cuadre: `UPDATE line SET modules = (SELECT jsonb_agg(CASE elem #>> '{}' WHEN 'people' THEN to_jsonb('contacts'::text) ELSE elem END) FROM jsonb_array_elements(modules) AS elem) WHERE modules @> '["people"]';` (2) deploy + verificar navegador (rutas + 301 + road sheets intactos) + e2e. Doc vivo: `build/structure-model.md`; work-list de diseño: `build/screens-inventory.md`.

## [2026-07-16] — ADR-067 · URL architecture v2: espacio = short-id de máquina + alias opcional validado; lentes sin espacio; scope en query

> Numeración: nació como "ADR-066" en paralelo con el ADR-066 de provenance de deploys (misma noche, otra sesión); renumerado a 067 al detectar la colisión. El commit `4cda574` dice "(ADR-066)" en su mensaje — historia ya empujada, léase 067.

> Sesión con Marco explorando el modelo de URLs al preparar la apertura a más de un cliente (la gente ya puede crear espacios). Reabre ADR-022 y ADR-024 en UN punto — el segmento de espacio — y ratifica el resto. Principio que gobierna todo: **ids donde hay política, nombres donde hay dueño** — el path dice *qué miras*, la query dice *cómo lo miras*, y ningún nombre bonito es portador de identidad (los nombres se muestran, los ids resuelven).

- **Context**: el slug de workspace era único global elegido por el humano (`slugify(name)` en `create_workspace` y `handle_new_user`) → el único namespace *disputado* del sistema: dos compañías reales llamadas igual (dos "MOCIA") no podían tener ambas su nombre como dirección; first-come squatting; lista `RESERVED_WORKSPACE_SLUGS` en mantenimiento eterno (cada ruta top-level nueva compite con nombres de espacio). Además las rutas de lente (`/h/:ws/desk|calendar|contacts|money`) mentían: el segmento de espacio no filtraba nada (el scope son los pins, ADR-038/057) — "no sé dónde estoy". Trilema estructural: nombre-bonito-global / nadie-pierde / nadie-arbitra — elige dos. La única salida que disuelve la categoría entera de problemas: desacoplar identidad de nombre. Dentro de un espacio NO hay política (es tu casa): la unicidad intra-espacio de proyectos/líneas es *deseable* (hard reject ADR-024 se queda).
- **Decisión** (5 partes):
  1. **Segmento de espacio = short-id de máquina.** `workspace.slug` conserva columna y unicidad global, pero deja de elegirlo el humano: 8 chars hex de `gen_random_uuid()` en `create_workspace` + `handle_new_user` (el hex nunca colisiona con palabras de ruta). El nombre visible (`workspace.name`, sin UNIQUE) queda libre del todo: N compañías "MOCIA". Los 4 espacios existentes se **grandfathean** (conservan su slug humano; regenerable a mano si algún día se quiere pureza).
  2. **Alias opcional con flujo completo** (solicitud → validación → aprobación): `workspace.alias` (nullable, unique parcial, mismo formato que slug, reservados vetados, cross-check contra slugs vivos). Owner/admin del espacio lo solicita desde el editor del espacio → `workspace_alias_request` (pending, con `workspace_name` snapshot) → **platform admin** (`user_profile.is_platform_admin`) aprueba/rechaza (`review_workspace_alias`). El alias resuelve *inbound* (redirect a la forma canónica); **nunca se emite** en links internos ni en Copy link.
  3. **Canónica = forma id** — *por ahora* (decisión provisional de Marco, re-evaluar abajo). Todos los builders internos y el Copy link emiten slug (short-id o grandfathered). Razón: los alias son reasignables por diseño → un link compartido con alias podría acabar apuntando al espacio equivocado; con id canónico ningún enlace compartido puede traicionar.
  4. **Lentes sin espacio**: `/h` = **Desk home** (digest, ADR-065 "the home IS Desk") · `/h/desk` (vista completa sin cap) · `/h/calendar` · `/h/contacts` · `/h/money`. El segmento de espacio queda SOLO donde es verdad (la entidad vive en un espacio y el slug lo necesita para resolverse, ADR-024): portada `/h/:ws/`, entidades `/h/:ws/project/...`, settings. Rutas de lente viejas → redirect.
  5. **Scope en query**: `?scope=tok,tok` sincronizado en vivo (replaceState, sin spam de historial) en home + lentes; pins vacíos = sin param. La URL de lente es honesta Y compartible (barra de direcciones o botón Copy link = nivel 3 de ADR-022 activado en vivo). **Adenda (misma noche, propuesta de Marco): la URL habla slugs cualificados, el store guarda identidad.** Los tokens en la URL son legibles — `s:muk-cia` · `p:muk-cia/mamemi` · `l:muk-cia/mamemi/gira-26-27` (la cadena de contenedores de ADR-024 garantiza unicidad; mismo modelo mental que las URLs de entidad) — mientras `hour_pins`/localStorage sigue en UUIDs (el contrato del store: un rename jamás pudre estado guardado). La frontera de la URL traduce en ambos sentidos contra las caches de nav: uuid→cualificado al escribir (self-heal real ante renames: la barra se reescribe con el slug vivo), cualificado→uuid al leer. Tokens legacy con uuid (links ya copiados) resuelven para siempre; un token cualificado que no resuelve con las caches asentadas (link viejo tras rename/revoke) se descarta con gracia. Se descartó dar short-ids a project/line: habría exigido migración+backfill para un problema que las caches ya resuelven gratis.
- **Alternatives (rejected)**: (a) unicidad global + hard reject (status quo GitHub/Slack) — suficiente Phase 0, pero clientes ya crean espacios y el squatting/segunda-clase es real; (b) slug+discriminador `mocia-x7k2` — asimetría o ruido para todos; (c) ID opaco en TODAS las URLs (Supabase) — mata clean URLs también donde el nombre sí tiene dueño; (d) scope en el path (`/h/<scope>/desk`) — al cruzar a una entidad apila prefijos o rompe canonicidad (los slugs de entidad necesitan el espacio para resolverse) y el estado edición jamás va a URL: la promesa "URL = estado completo" es intermitente por construcción; (e) namespace de propietario `/h/@anna/mocia` — mete una persona en la URL de una compañía y la colisión vuelve a nivel org; (f) resolución per-user del slug — rompe exactamente para la persona núcleo de Hour (freelance en dos espacios homónimos) y una misma URL significaría cosas distintas por viewer.
- **Qué sobrevive de ADR-022/024**: los 3 niveles de URL-ness intactos (el scope-query es el nivel 3 activado); URLs canónicas de entidad intactas; slugs de proyecto/línea limpios, únicos por contenedor, hard reject + `previous_slugs` redirect en rename. `RESERVED_WORKSPACE_SLUGS` pasa de gate-de-signup a gate-de-alias (flujo poco frecuente y supervisado).
- **Re-evaluate when**: (1) **canónica id vs alias** — tras uso real con clientes: si los links compartidos con id generan fricción visible, reconsiderar emitir alias cuando exista (Marco: "por ahora id, ya veremos"); (2) self-serve del alias (validación automática) cuando el volumen de solicitudes moleste al flujo manual; (3) ~~acortar tokens de scope~~ — resuelto la misma noche por la adenda de slugs cualificados (punto 5); queda solo: si algún día duele que un link de scope compartido muera tras un rename, cablear `previous_slugs` en las caches de nav para rescate inbound.
- **Status**: live — implementación en curso 2026-07-16 (migración `2026-07-16_workspace_shortid_alias.sql` + rutas + shell).

---

## [2026-07-16] — ADR-066 · Provenance de deploys: se despliegan commits, no working trees (guard + build stamp en /health/live)

> Sale de un fallo real de esta sesión: se pidió "ponte al día y dime en qué punto estamos" y el informe salió **mal**, con confianza, porque los docs decían una cosa y producción hacía otra. No fue descuido de nadie al escribir: es una propiedad del tooling.

- **El problema**: `wrangler deploy` sube **lo que hay en disco**, no una ref de git. Nada ata un deployment a un commit. El 2026-07-14 se desplegó el trabajo de scope-v2 **sin commitear**: durante dos días git y prod contaron historias distintas, y `_context.md` listaba ADR-059/060/061 como "pendiente de deploy" cuando llevaban vivos desde entonces. El registro mintió, y cualquiera que lo leyera (persona o agente) heredaba la mentira. Coste medido: una sesión entera de análisis sobre una premisa falsa.
- **Decisión** — dos mitades, ambas en el repo:
  1. **Prevención** — `scripts/assert-clean-tree.mjs`, encadenado con `&&` dentro del script `deploy` de web y collab. Rechaza el árbol sucio; avisa si HEAD no está pusheado (un SHA que solo existe en una máquina no lo resuelve nadie). Excepción deliberada: `ALLOW_DIRTY_DEPLOY=1`.
  2. **Verificación** — `buildStamp()` en `apps/web/vite.config.ts` graba `{sha, dirty, builtAt}` en el bundle; `/health/live` lo sirve. "¿Qué hay en producción?" pasa a ser un curl. `dirty: true` marca honestamente un build salido de un árbol sucio (ese SHA no lo reproduce).
- **Por qué las dos**: el guard solo previene (y tiene escape hatch); el stamp solo diagnostica. Juntas cierran el lazo: no se puede desplegar sin commit, y si alguien fuerza la excepción, prod lo confiesa. Ninguna de las dos sola habría evitado el 07-14.
- **Por qué encadenado y no hook `predeploy`**: pnpm 10 **no ejecuta scripts `pre*`** por defecto (no hay `.npmrc` con `enable-pre-post-scripts`). Un hook habría sido un guard decorativo que nunca corre — el peor resultado posible, porque además tranquiliza.
- **Regla operativa**: **antes de creerte cualquier doc sobre qué está desplegado, `curl /health/live`.** El doc es una afirmación; el stamp es el hecho. Escrito también en `build/runbooks/beta-readiness.md § 2b`.
- **Alternativas descartadas**: taguear cada deploy en git (disciplina manual, se olvida — el mismo fallo con otro nombre); CI-only deploys (correcto a futuro, pero necesita staging + secretos, Phase 1); no hacer nada (el fallo ya se materializó una vez y costó una sesión).
- **Re-evaluate when**: cuando el deploy pase a CI (Phase 1) — ahí el guard se vuelve redundante porque CI solo despliega refs, pero el stamp sigue valiendo (y más, con varios entornos).

## [2026-07-17] — ADR-068 · Muere el pin manual y el digest cross-space: el scope se construye en rail + ⌘K, y todo camino de scope aterriza en /h/desk

> Sesión con Marco tras estrenar el hall (`/h` saluda). Al probar el flujo real: el digest cross-space (saludo + agenda capada + grid con chips PIN) resultó una página intermedia que duplicaba a Desk, y la UI de pin manual (chips en cards, ScopeStrip "All spaces", pin del breadcrumb) era una segunda manera de construir scope compitiendo con el rail — "esta funcionalidad ya no la tenemos ni la queremos".

- **Decisión**:
  1. **El digest cross-space desaparece.** `HomeView` pasa a ser **portada-only** (`/h/[ws]/`): masthead del espacio + su agenda 7-días + sus proyectos. El saludo/greeting de HomeView, el hint "pin what you live in" y el orden pinned-first mueren con él (orden = actividad).
  2. **El hall es la única home**: `/h` saluda y su puerta "posa'm al dia" va **directa a `/h/desk`** — Desk ES la superficie de ponerse al día (ADR-065), sin página intermedia.
  3. **Todo camino de scope aterriza en Desk**: las filas del rail (Everything, guardados, recents) y el Apply del ⌘K hacen `pins.set(...)` y, si no estás ya en una lente, `goto('/h/desk')`. Desde una lente, re-filtra en sitio. Un click de scope siempre ENSEÑA la vista scopeada.
  4. **Muere la UI de pin manual, entera**: chips PIN de las cards, `ScopeStrip` (borrado, 507 líneas), pin del breadcrumb (+ su campo en el store). **El STORE de pins sigue siendo el motor de scope** — rail, ⌘K, `?scope=` de la URL, resolución en lentes: todo intacto. Lo que muere es el gesto, no el modelo.
- **Por qué**: dos maneras de construir scope (pins manuales vs rail/⌘K) confundían — la nueva (rail) ganó por uso; y el digest era un Desk capado con otro nombre — dos superficies de catch-up es una de más. Menos superficies, mismos datos.
- **Supersede parcialmente** ADR-057/060 (la parte de "pins colocados sobre el contenido" como UI; el grid projects-first sobrevive en la portada) y la adenda hall de ayer (el reveal in-place duró un día; el store `hall.svelte.ts` que lo soportaba, borrado).
- **Re-evaluate when**: si con uso real se echa de menos pinnear una entidad *desde su página* (el gesto rápido "vivo en esto"), la vuelta barata es una acción en ⌘K contextual, no resucitar chips.
- **Status**: live — aplicado 2026-07-17 (svelte-check 0/0 · unit 110/110).
- **Status**: **live** — commit `314d066`. Pendiente de que llegue a producción con el próximo deploy de árbol limpio: hasta entonces `/health/live` responde `{"ok":true}` sin `version`, que es en sí el síntoma que cura.

## [2026-07-17] — ADR-069 · Norte del producto: la capa de IA proactiva es la finalidad; la UI es la superficie manual

> Declarado por Marco en la revisión conjunta 1 de la pasada diseño+datos (2026-07-17), como fundacional: *"todo lo que estamos construyendo es para que este flow funcione"*. Pidió explícitamente que quede en los archivos.

- **Decisión**: Hour se construye para que una IA con el contexto completo del estado (bolos, contactos, conversaciones, dinero, tareas) **facilite proactivamente**: detecte oportunidades y proponga acciones concretas, siempre con consentimiento. El ejemplo canónico (de Marco, verbatim en espíritu): *"he visto que tienes un bolo dentro de un mes en París y 20 contactos que normalmente están en París — ¿quieres que les enviemos un email?"*. La UI completa (lentes, módulos, detalle de entidad) es la superficie manual sobre los mismos datos — necesaria, pero no es la finalidad; es lo que hace el flow posible y auditable.
- **Implicaciones ya presentes en el modelo**:
  - `task.origin = 'ai'` (migración 2026-07-17): las propuestas de la IA aterrizan como tareas sugeridas, nunca como acciones ejecutadas por su cuenta.
  - La frase de estado del hall (`/h`) es la **primera superficie de voz de la IA**: computada por plantillas hoy, compuesta por IA después — siempre verdad derivada de datos, nunca decoración. Si un día miente, la confianza en toda la capa muere.
  - Patrón **consentimiento primero**: la IA propone ("¿quieres que…?"), el usuario aprueba, el sistema ejecuta. Mismo contrato que .zerø con Marco.
- **Qué reordena en el roadmap de datos** (`build/screen-data-spec.md § Schema gaps`): los dos gaps que más bloquean el flow suben de "mejora" a **camino crítico** — #2 log de conversación de engagement (la IA necesita la memoria de la negociación para proponer con criterio) y #1 organizaciones (razonar "contactos que suelen estar en París" pide red consultable de personas/orgs/lugares).
- **Alternativas descartadas**: app como herramienta manual pura (esa UI ya existe en decenas de tools; el diferencial es la capa que piensa contigo); IA como bolt-on al final (el modelo de datos tiene que diseñarse legible-por-IA desde ya — este ADR es criterio de priorización, no una feature futura).
- **Re-evaluate when**: al diseñar la primera feature de IA real: runtime (Workers AI vs API externa), coste, y privacidad de datos de terceros (los engagements contienen personas reales).
- **Status**: firm — es el criterio contra el que se priorizan producto y schema.
- **Amended 2026-07-18 (ADR-078 §7)**: paridad estricta de capacidades — la IA no tiene ningún write path que la UI no tenga; toda propuesta es ella rellenando los mismos formularios/entidades que el usuario puede rellenar a mano. *Si una propuesta de IA no se puede reproducir clicando, falta UI, no falta IA.*

## [2026-07-17] — ADR-070 · Modelo de tareas: anytime / from / due+lead — la urgencia es derivada y el lead lo propone la IA

> Sale de la revisión conjunta 1 (pantalla Desk — "la menos útil del uso real estos días"). Marco trae su modelo personal de tareas — el del Zerø System: Queue sin fecha, `@from:`, `@due:`, sección Deferred que auto-aflora — y Hour lo adopta: semánticas ya validadas por años de uso real, no un modelo inventado.

- **Decisión** — tres tipos de tarea + una regla de salida:
  1. **Anytime** (sin fechas): cola tranquila al final del Desk, nunca grita.
  2. **A partir de** (`from_at`): con from futuro la tarea **duerme** — invisible para el Desk, visible solo en la lista de su entidad marcada deferred. Al llegar la fecha aflora sola y pasa a ser "tarea que hay que hacer".
  3. **Antes de** (`due_at` + `lead_days`): la compleja. `lead_days` = "como máximo, cuántos días antes se vuelve urgente". **Nunca obligatorio**: la IA lo propone (título + contexto: "enviar rider" ≈ 3, "reservar furgoneta de gira" ≈ 30), el humano corrige con un toque. **NO hay taxonomía esfuerzo/energía** — un solo número; la capa de metadatos-de-pereza de los GTD-tools se evita a propósito.
- **Regla de salida en Desk**: una tarea aparece en `max(from_at, due_at − lead_days)`; escala a urgente al acercarse el due; pasado el due → OVERDUE. **La urgencia es siempre derivada, nunca un flag almacenado** — se recalcula sola al mover due o corregir lead.
- **Transparencia del lead IA**: la fila muestra "aflora el {día}" calculado y editable — lo que la IA decidió está a la vista, no escondido. Mismo contrato de confianza que la frase del hall y las propuestas `origin='ai'` (ADR-069): si la IA decide en silencio y falla, muere la fe en el Desk entero.
- **Schema delta** (primer gap materializado de la pasada diseño+datos): `task.from_at timestamptz` + `task.lead_days smallint` (+ CHECK `from_at <= due_at` cuando ambos). Todo lo demás es comportamiento, no schema.
- **Sin backfill**: los next-actions de engagement siguen siendo engagements esta fase — tasks los subsumirá cuando el modelo se pruebe en uso, no antes.
- **Status**: firm. Build despachado en tres prompts, hoy archivados: `build/archive/2026-07-task-model-prompt.md` (schema + API — va primero), `build/archive/2026-07-desk-prompt.md` (UI, depende del anterior), `build/archive/2026-07-desk-design-prompt.md` (diseño).

## [2026-07-17] — ADR-072 · Calendario: conflictos por personas, disponibilidad con estados, viajes y días-fuera — y la simetría con el individuo

> Numeración: nació como "ADR-071" en colisión con el ADR-071 de la task entity (misma noche, sesión paralela — segundo choque tras 066/067); renumerado a 072 al detectarlo, por ser el de menos referencias.
> Revisión conjunta 1, pantalla Calendar. Todo salido del uso real de Marco — gestionando su compañía Y siendo parte de otras — no de suposiciones. Detalle operativo: `build/screen-data-spec.md § Calendar` + `§ Schema gaps #5/#6/#8`.

- **Decisiones**:
  1. **Conflicto = personas compartidas, no fechas coincidentes.** Dos eventos el mismo día chocan solo si comparten gente (roster = `cast_member` del project − sustituciones + `cast_override` + `crew_assignment`). Degradación honesta: sin datos de equipo, "posible conflicto — sin datos", nunca choque confirmado (mismo contrato de verdad que la frase del hall).
  2. **Disponibilidad/blackout como entidad, dos niveles + certeza**: `availability_block` con `person_id` nullable (null = compañía entera) y `certainty` unavailable|tentative ("el 8 no sé si puedo, en duda"). Alimenta chips del calendario, motor de conflictos y las propuestas de fechas de la IA (ADR-069).
  3. **`date` cuelga en cascada — opción C** (project* + line? + performance?), elegida sobre solo-línea (fuerza contenedores opcionales), solo-proyecto (la carencia actual) y padre polimórfico (encarece queries/RLS sin comprar nada). Es el patrón que `performance` ya usa. Regla clave: **atar específico, ver agregado** — dónde se ata es dato, dónde se ve es vista. Migración: `date.line_id` + `travel_direction`.
  4. **Viajes ida/vuelta**: `date` kind `travel_day` + dirección (outbound|return|leg), ligados a su performance. **La IA los propone** desde home base (`workspace.city`/`person.city`, ya existen) + hora del bolo + montaje: "bolo a las 22h con 5h de montaje → sales por la mañana; a las 10h → sales el día antes". Propuestas con consentimiento, como todo (ADR-069).
  5. **Días-fuera (away-days) = SIEMPRE derivados, nunca almacenados**: bolo lunes + bolo miércoles a 1000 km ⇒ el martes estás fuera aunque no haya evento. Banda calculada en el calendario. Consumidor directo: **dietas** — días-fuera × personas en carretera ⇒ propuestas de `expense` categoría `per_diem` (el enum ya lo tenía). La tarifa vivirá con la identidad fiscal (gap #3).
  6. **Simetría de persona** (requisito de Marco: la herramienta debe servir a un actor/técnico gestionando su propio calendario): el modelo 1-5 ya es simétrico — los conflictos por personas cazan SU doble-booking entre compañías, el blackout personal es su disponibilidad, `person.city` su base. La pieza que faltaba y se descubrió en esta pasada: **nada une `auth.users` con `person`** → gap #8 (`user_profile.person_id`, claim por email). Sin ese puente, "mis bolos / mis conflictos / mi blackout" no resuelven.
- **Status**: firm — dirección de producto; las migraciones (#5, #6, #8) se consolidan con el resto de la pasada.

## [2026-07-17] — ADR-073 · Contacts: último contacto en la lente, organizaciones como afiliación datada, y las reglas del libro de contactos

> Revisión conjunta 1, lente Contacts — la que Marco menos ha vivido, así que el pase se hizo contra `research/profiles/` (06 distribuidora freelance + 99-patterns). Detalle: `build/screen-data-spec.md § Contacts` + `§ Schema gaps #1/#2`.

- **Decisiones**:
  1. **La lente muestra solo el último contacto** (una columna, estilo tranquilo); el historial completo vive en la ficha del contacto (necesita el log, gap #2). Write path mínimo ya construible: sello de `last_contacted_at` al cambiar status + gesto "contactado hoy"; `first_contacted_at` una sola vez.
  2. **Tags aparcadas** — `custom_fields.tags` era herencia del seed que nadie conocía; para la IA valen más los campos estructurados (org, ciudad, temporada). Se reabre solo con necesidad real.
  3. **Organizaciones (gap #1), dirección fijada**: actor jurídico ≠ `venue` (lugar físico); **la afiliación persona↔organización es DATADA** — los programadores cambian de teatro constantemente y la relación sigue a la persona (research 99-patterns). Cubre el caso Lyon/París: `person.city` (vive) + ciudad de su org (trabaja) = "dónde lo encuentro", sin tabla extra de sitios. Forma fina en S2 (engagement detail y facturas la necesitan).
  4. **Toggle de agrupación por contacto** (una fila por persona, proyectos como chips) además de por conversación.
  5. **Del research** (aportado por el pase crítico, aceptado vía "continue"): procedencia de feria + cola post-feria (entran en el log del gap #2: kind=meeting + referencia de evento + `direction` inbound|outbound); **frialdad calibrada por temporada** (ciclos de 9-18 meses — jamás urgencias semanales de CRM SaaS; dormant es reposo, no fracaso); **frontera dura del libro de contactos para la IA** — solo contactos del scope, borradores artesanales uno a uno, nunca blast (fijada en la spec como regla del norte ADR-069); el import (`build/import/`) es crítico de adopción — el empty state de la lente apunta ahí.
- **Status**: firm. Build v1 despachado (hoy `build/conversations-prompt.md` + `build/conversations-design-prompt.md`); el model-prompt (orgs + log) espera las formas de S2.

## [2026-07-17] — ADR-074 · Money: pagos registrados, dos verdades por factura (due vs expected) y el cobro en cascada como tarea

> Revisión conjunta 1, lente Money. El dolor del cobrador lo puso Marco desde los dos sombreros: compañía cobrando de ayuntamientos y freelance cobrando de compañías ("hay compañías que te pagan cuando ellas cobran"). Research 99-patterns §1.8: los retrasos de pago son frustración top-3 universal en los 8 perfiles. Detalle: spec § Money + § gaps #3/#9.

- **Decisiones**:
  1. **Pagos con UI**: registrar `payment` (importe, fecha, método, referencia); **"cobrada" SE DERIVA de Σ pagos** — estado derivado sobre flag manual, mismo principio que la urgencia de tareas (ADR-070).
  2. **Dos verdades por factura**: `due_on` (contractual) vs **`expected_on` (realista, gap #9)**. El aging se mide contra la esperada — "47 de 60, normal" calma; "92 de 60" escala y alimenta las alertas del Desk.
  3. **Cascada de expected_on**: comportamiento observado del pagador (media emisión→cobro del historial de payments — cero mantenimiento, el sistema aprende de cada pago registrado) → plazos declarados del pagador (org, gap #1, S2) → **condición en cascada**: se modela SOLO lo que tú sabes (nota de condición + fecha esperada + tarea de seguimiento automática con `from_at` que aflora en el Desk: "pregunta si ya han cobrado"). NO se modelan los cobros del pagador — sería ficción. El loop completo lo acabará llevando la IA (ADR-069).
  4. **Facturación real/PDF: ahora no** (Marco la tiene cubierta fuera) **pero llega "relativamente rápido"** → S2 debe dejar el gap #3 **diseñado y migrable** (identidad fiscal + series de numeración), no solo apuntado. El campo pagador entra ya en el diálogo (`payer_person_id` existía sin usarse; org-capaz tras S2).
  5. Gastos a nivel lente (API unión) + neto por línea + totales por divisa + desglose VAT/IRPF. **Agrupación primaria por línea se mantiene** (la línea es la unidad operativa; proyecto = pins).
  6. **Confirmado también aquí: gap #8 (usuario↔persona) — SÍ**, con la extensión de Marco: *"trabajo con dos compañías, cada una su app — yo veo las dos en la mía, siempre que me compartan"*. Regla del research §3.3: el invitado ve SU participación en cada workspace, nunca el detalle completo de otras orgs. Migración añadida al `calendar-model-prompt.md` (Migration C).
- **Status**: firm. Despachado: `money-model-prompt.md` (migración + APIs — primero) → `money-prompt.md` (UI) · `money-design-prompt.md` (diseño).

## [2026-07-17] — ADR-071 · Task entity construida: D3 + delta ADR-070 en vivo (schema, RLS, API, módulo Tasks, feed en Desk)

> Sesión .zerø autónoma (ultracode) paralela a la de diseño: Marco pidió "construye las tareas" y la sesión ejecutó D3; a mitad de la noche la sesión de diseño escribió ADR-069/070 y despachó `build/archive/2026-07-task-model-prompt.md` — que en un ~90% ya estaba construido. Este ADR registra la implementación y sus decisiones propias; el modelo conceptual es ADR-070.

- **Decisión (qué hay en vivo)**: tabla `task` (migraciones `2026-07-17_task_entity.sql` + `2026-07-17_task_from_lead.sql`, ambas aplicadas vía MCP y verificadas con sondas): padre polimórfico ≤1 de project/line/performance/engagement (ninguno = tarea libre de workspace), `title/note/due_at/from_at/lead_days/status(open|done)/origin(manual|protocol|ai)`, soft-delete, triggers de la casa (updated_at, audit, ws/creator inmutables) **+ padres inmutables** (relink = delete+recreate; cierra el hueco PostgREST-directo sin guardas de coherencia cross-workspace). RPCs `create_task`/`delete_task` (claim-bound + ADR-048; recreada sin overloads al añadir from/lead). API `/api/tasks` (GET/POST/PATCH/DELETE, patrón expense). `$lib/task.ts` con `taskSurfaceState()` — la regla de salida de ADR-070, pura, `now` inyectado, **días-calendario, nunca instantes** (un compare por instante marca overdue un due-today para cualquier viewer al oeste de UTC). UI: módulo **Tasks** en line detail (composer + lista + pliegue done; catálogo/plantillas tour·booking·creation — `MODULES_BY_KIND` intacto: las lines pre-ADR-056 no ganan módulos retroactivos) + sección Tasks en `/h/desk` (quick-add de tarea libre con selector de espacio; dormidas nunca pintan; orden overdue→urgent→open→anytime). Tests: unit 168 · RLS 66 (anon deny, claim-bound, guards exactos 400/22023 vs 403/42501, canario ADR-048, from/lead) · e2e `tasks.spec.ts` 3/3.
- **Acceso (decisión propia)**: RLS **workspace-scoped** (`is_workspace_member`, familia venue/person_note), NO `has_permission` — las tareas son verbos cross-dominio, la tarea libre no tiene project que gatear, y en Phase 0 todos los roles son admin. Gating por rol → lote de hardening 0.9.
- **Revisión adversarial** (4 lentes → verificación, 23 agentes): 14 confirmados, todos aplicados salvo 2 aceptados a Shelf — (a) tareas huérfanas cuando su padre se soft-borra (visibles sin contexto en Desk; volumen Phase 0 ínfimo, se completan/borran a mano); (b) promoción de estilos compartidos TaskBoard/DeskBoard a base.css (no tocar base.css con la pasada visual del shell en vuelo). Entre los aplicados: toggle optimista con rollback (el checkbox no-bound no revierte solo en error), payload del toggle desde el evento (doble click rápido enviaba done dos veces), overdue por día-calendario, composer del Desk con derived-con-override en vez de `$state`+`$effect`, `realIsoDate` a un solo hogar (`$lib/datetime`), vocabulario `desk__*` (no extender el muerto `agenda`), secciones propias con aria-label, statuses exactos en la suite RLS.
- **Fuera a propósito en ese momento**: taxonomía D1 + tags (Phase 0.5), protocol chains ADR-011 (necesitan uso manual primero), escritores `origin=protocol|ai`, **Desk v2** (feed mixto 4 fuentes, money alerts, performance anchors, inbox de consentimiento IA — prompt hoy archivado en `build/archive/2026-07-desk-prompt.md`), edición de from/lead en UI y unificación con `engagement.next_action_*` (ADR-070: sin backfill).
- **Nota de proceso**: dos sesiones .zerø trabajaron el mismo árbol en paralelo esta noche; convergieron (la de diseño citó la migración aplicada en ADR-069 y commiteó la base en `3a4e5d2`). El "Do NOT apply" del prompt se entendió como guarda para agentes externos sin MCP: esta sesión aplicó ambas migraciones por el cauce MCP de la casa, aditivas puras, con sondas de verificación.
- **Re-evaluate when**: (a) Desk v2 (el build despachado) — decidir si la sección v1 se disuelve en el feed mixto; (b) primer escritor `protocol`/`ai` — revisar el gate del RPC (hoy origin siempre manual); (c) si las huérfanas de padre borrado molestan en uso real → cascada de soft-delete en los delete_* de los padres.
- **Status**: live — en el árbol de trabajo, migraciones aplicadas en la DB de producción; pendiente de deploy del Worker (gate ADR-066 + veredicto de Marco).

## [2026-07-18] — ADR-075 · Rename completo: la lente Contacts pasa a Conversations y la entidad `engagement` pasa a `conversation`

> Reabre el naming de ADR-065 con causa: el uso real. Salió en la iteración de diseño del Desk — el módulo de línea decía "conversación" y la lente decía "Contacts", y Marco pidió el análisis greenfield: *"quiero la respuesta como si esta aplicación no estuviera construida"*.

- **Decisión**: rename completo, de una vez — UI, URL, API y base de datos:
  1. **Lente**: Contacts → **Conversations** (ES Conversaciones · CA Converses · FR Conversations — traduce limpio, criterio ADR-065). Ruta `/h/contacts` → `/h/conversations` con redirect 308 (patrón ADR-067). "Contactos" sobrevive donde es verdad: el toggle "por contacto" de la lente y la ficha de persona — es un *concepto* (la libreta = personas ∪ organizaciones), nunca una entidad.
  2. **Entidad**: `engagement` → **`conversation`** (tabla, columnas FK `engagement_id`, enum `engagement_status`, RPCs, políticas RLS, `/api/engagements` → `/api/conversations`, query keys, componentes).
- **Por qué greenfield**: `engagement` suspende el mismo examen que mató a `show` (ADR-036 — opacidad en castellano) y añade el homónimo de marketing. La palabra del dominio, del Desk (sus verbos son de conversación), del log del gap #2 y de la IA es *conversación*.
- **Por qué también la DB**: el norte ADR-069 exige un schema legible-por-IA — tabla `engagement` + producto "conversación" = un diccionario de traducción permanente para cada agente y cada prompt. Y nunca será más barato: un usuario real, cero clientes, precedente de éxito en casa (show→performance, ADR-036).
- **La cicatriz considerada**: line→section→line (ADR-035) se revirtió porque "section" era una palabra peor elegida deprisa; "conversación" sale del uso vivido y del sistema entero — riesgo distinto.
- **No se toca**: `person` (una persona es una persona), los ADRs históricos (historia es historia), las migraciones viejas.
- **`person` examinado en greenfield y CONFIRMADO** (Marco preguntó "¿cómo lo llamarías si hoy fuera el día uno?" — respuesta: igual). Tres razones para no reabrirlo nunca de gratis: (1) nombra un *hecho* (un ser humano) y no una *afirmación de relación* — la misma fila es programador pitcheado, actriz del cast, técnico de crew y pagador de factura, y solo "person" cubre las cuatro sin mentir; (2) el modelo ADR-075 define "contacto" como concepto (person ∪ organization desde tu libreta) — si la entidad se llamara `contact`, el concepto no podría definirse; (3) traduce perfecto en ES/CA/EN/FR sin homónimos. La única deuda greenfield no era el nombre sino la costura user↔person, que el gap #8 ya retrofita (`user_profile.person_id`).
- **Orden operativo en ese momento**: este rename iba ANTES que los builds de UI pendientes (`desk-prompt`, hoy `conversations-prompt`, `money-prompt`) para no construir sobre vocabulario muerto.
- **Addendum 2026-07-17 (ejecución — lo que el prompt no vio)**. Migración `build/migrations/2026-07-17_rename_engagement_to_conversation.sql`, aplicada y verificada contra el catálogo:
  1. **`edit:show` → `edit:performance` entra en el scope** (Marco, 2026-07-17: "renómbralo todo en la misma migración"). Dejar `edit:show` gateando la tabla `performance` mientras nacía `edit:conversation` habría dejado el vocabulario cerrado **medio migrado — peor que viejo entero**. Esto **supersedes la postergación explícita de ADR-036** ("se difiere a Phase 0.9 admin UI"): su motivo declarado —"requiere update masivo de workspace_role.permissions + project_membership"— no existe; son **46 filas** de `workspace_role` y **0** de `project_membership`. Radio real medido: 28 políticas en 8 tablas + 15 funciones. Seguro en caliente: los permisos **no** viajan en el JWT (`custom_access_token_hook` sólo sella `current_workspace_id`), así que `has_permission()` los lee vivos y nadie necesita re-login.
  2. **Sin redirects** (Marco): pre-pública ⇒ `/h/contacts` se **borra**, no se redirige, y el stub `/h/[workspace]/contacts` de ADR-067 se elimina. Sus 3 hermanos (desk·calendar·money) siguen vivos: asimetría consciente, no olvido — limpiarlos es decisión de ADR-067, no de ésta.
  3. **`is_reserved_slug` no era opcional**: reservaba `engagement` y `contacts` y **no** reservaba `conversations`. Sin tocarlo, un alias de espacio podía reclamar `conversations` y chocar con la lente. Ahora reserva `conversation` + `conversations` y suelta las muertas. (El espejo cliente `reserved-slugs.ts` sigue con drift previo: tiene `people`/`agenda` y un `desk` duplicado que el DB no tiene. No tocado — es anterior a esto.)
  4. **La vista `performance_redacted` se renombra en sitio** (`ALTER VIEW … RENAME COLUMN`), **no** con DROP+CREATE como hizo el precedente ADR-036 §20. Verificado en schema desechable: renombrar la columna base deja la vista publicando `SELECT conversation_id AS engagement_id` — invisible al grep; y un DROP+CREATE habría dejado que los default privileges de Supabase le devolvieran `SELECT` a **`anon`** sobre una vista que lo tiene revocado a propósito, además de tirar `security_invoker=true`. Misma trampa en las 4 RPC que hubo que dropear (cambio de nombre de parámetro): `CREATE OR REPLACE` preserva ACL, `DROP`+`CREATE` lo resetea a `EXECUTE TO PUBLIC` — re-granteadas explícitas.
  5. **i18n**: los labels de las 4 lentes salen del diccionario (`lens.*`, en/es/ca), ninguno hardcodeado. **No se crea `fr.json`**: el string FR que pedía el prompt es "Conversations" — idéntico al inglés, o sea que el fallback ya lo entrega; una locale francesa esparsa habría degradado toda la UI de un navegador francés a cambio de cero.
  6. **`_flux.md` / `_notes/` / `_decisions.md` / migraciones viejas / `schema.sql` / `rls-policies.sql`: intactos.** Los dos últimos se declaran a sí mismos snapshots congelados ("This file has NOT been rewritten in-place") y ya mentían sobre `show` desde ADR-036 — reescribirlos les haría afirmar un estado que nunca existió en su fecha. Deuda documental preexistente, anotada, no tocada.
- **Status**: firm. Build ejecutado 2026-07-17 (prompt hoy archivado en `build/archive/2026-07-rename-conversation-prompt.md`): migración aplicada y verificada contra el catálogo (14 sondas: 0 objetos `engagement` vivos, 28 políticas, `anon` sigue sin SELECT sobre `performance_redacted`, 0 RPC con EXECUTE a PUBLIC, 163 conversaciones y 3 enlaces de performance intactos). `svelte-check` 0/0 · unit 178/178 · RLS 66/66 contra el schema renombrado · e2e 22/22. - **⚠️ Producción rota hasta el deploy (estado conocido y aceptado, 2026-07-17).** Aplicar la migración sin desplegar deja el Worker vivo de `hour.zerosense.studio` sirviendo el cliente viejo contra el schema nuevo: comprobado — `/api/engagements` responde 401 (la ruta existe en el build desplegado) y `/api/conversations` da 404. Toda lectura autenticada de conversaciones falla en PostgREST (`Could not find the table 'public.engagement'`). Coste asumible: un solo usuario, cero clientes, Phase 0. **El cierre es un deploy atómico** (worker+cliente juntos), que exige commitear antes — el guard de árbol limpio de ADR-066 lo bloquea si no.

## [2026-07-18] — ADR-076 · La lente de tiempo: una puerta (Calendar), dos proyecciones de primera clase (rejilla-calendario y lista-agenda)

> Salió del mock del Desk (S2 de diseño): el lateral etiquetaba las filas de `date` como AGENDA mientras el nav decía Calendar, y la dualidad calendario/agenda llevaba toda la iteración reapareciendo. Marco pidió el análisis greenfield de la palabra en sí (mismo examen que ADR-036/075) y fijó de entrada que ambas vistas son seguras.

- **Decisiones**:
  1. **Una sola lente de tiempo en el nav, pill fijo "Calendar"** (ES Calendario · CA Calendari). El pill nunca cambia de palabra — el pill camaleónico que muta según la proyección queda vetado como anti-patrón UX (veto explícito de Marco).
  2. **Dos proyecciones de primera clase dentro**: rejilla (calendario) y lista (agenda), con selector visible y NOMBRADO (`rejilla ⇄ agenda`), nunca un icono enterrado. La palabra "agenda" vive en el producto un nivel por debajo del nav, nombrando exactamente lo suyo.
  3. **Primera clase = direccionable y persistente**: la proyección viaja en la URL (`?view=agenda` o ruta alias hacia la misma lente) y el estado se recuerda — quien vive en modo agenda abre en agenda. La degradación que preocupaba ("agenda como modo escondido") se resuelve con visibilidad + direccionabilidad, no con un slot de nav.
  4. **Regla de vocabulario de dos niveles** (generaliza lo que TAREAS ya demostraba): el lateral del Desk nombra *tipos de cosa* (CONVERSACIÓN · DINERO · TAREAS · AGENDA); el nav nombra *superficies*. No se exige 1:1 — la coherencia es que las palabras no se contradigan entre niveles. La fila AGENDA apunta a la proyección-agenda de esta lente.
- **Por qué (la palabra en sí, greenfield)**: *agenda* es contenido — lo que tengo, secuencial, posesivo, y no muestra el vacío; *calendario* es contenedor — el tiempo como mapa donde el vacío es información. En una herramienta de booking, media utilidad de la superficie es ver los huecos donde cabe un bolo: esa función la nombra calendario y la desmiente agenda. Además la jerarquía ya está aprendida: todo el software de calendario (Google/Apple) y el dietario físico anidan "agenda" como vista dentro de algo llamado calendario — no se inventa nada.
- **Rechazado**:
  - **Dos pills (Calendar + Agenda)**: mismo concern (el tiempo) con dos puertas; "Agenda" adyacente a "Desk" reabre la ambigüedad "¿qué tengo? ¿dónde miro?" que ADR-065 cerró; slot de nav permanente para una proyección.
  - **"Tiempo"/"Temps" como nombre de lente**: colisiona con el clima en ES/CA y es palabra-taxonomía, no lugar — resuelve el conflicto subiendo de abstracción, que empeora ambas lecturas.
  - **Renombrar la fila del Desk a CALENDARIO**: innecesario una vez la agenda es proyección con nombre — la etiqueta AGENDA es exacta (compromisos con hora) y apunta a su proyección.
- **Re-evaluate when**: (a) se construya la proyección agenda (hoy solo existe la rejilla — MonthGrid); si el uso real vive mayoritariamente en la lista, reconsiderar jerarquía; (b) el road sheet formalice su agenda-del-día (vista intrínseca al documento, fuera de esta lente); (c) si la fila AGENDA del Desk confunde en uso real pese al puente visual.
- **Status**: firm — asentado "por ahora" (Marco, 2026-07-18). Sin build despachado: aplica al construir la vista agenda y al vocabulario de los builds pendientes (`desk-prompt.md`).

## [2026-07-17] — ADR-077 · Cerrar la deuda de ADR-036: la palabra `show` muerta seguía viva en la DB, y el espejo de slugs reservados llevaba meses roto

> Salió del sweep de ADR-075: al mapear la superficie viva para el rename de `engagement`, aparecieron restos de un rename anterior — el de `show` → `performance` (ADR-036, 2026-05-19) — que llevaban dos meses ahí sin que nadie los viera. Marco, 2026-07-17: *"arregla la deuda"*.

- **Decisión**: cerrar de una vez, migración `build/migrations/2026-07-17_close_adr036_show_debt.sql` (aplicada y verificada).
  1. **`guard_show_fee_columns()` → `guard_performance_fee_columns()`**. ADR-036 §12 renombró el *trigger* (`performance_guard_fee_columns`) pero **no la función que ejecuta**. Peor que el nombre: su `RAISE` decía *"edit:money required to modify **show** fee columns"* — texto que ve el usuario, nombrando una entidad que no existe desde mayo. El trigger sigue a la función por oid, así que `ALTER FUNCTION … RENAME` basta; `CREATE OR REPLACE` después conserva el ACL.
  2. **`asset_version_inbound_has_show` → `asset_version_inbound_has_performance`**. Sólo el nombre; su cuerpo ya decía `performance_id` — Postgres lo reescribió por attnum al renombrar la columna, y **por eso** el nombre se quedó atrás. Mismo mecanismo que dejó la vista `performance_redacted` publicando `engagement_id` en ADR-075: *el rename de columna arregla los cuerpos y abandona los nombres*.
  3. **Dos COMMENTs** que nombraban la entidad muerta en prosa (`cast_member`, `performance.start_at`).
- **Espejo de slugs reservados**: `is_reserved_slug()` (DB) y `RESERVED_WORKSPACE_SLUGS` (`apps/web/src/lib/reserved-slugs.ts`) deben ser **el mismo conjunto** — el flujo de alias consulta los dos lados — y no lo eran: el cliente tenía `agenda` y `people` de más, más un `desk` duplicado. Ahora son idénticos (64 = 64, verificado por diff de conjuntos, no a ojo). `agenda` no es cosmético: ADR-076 la hace proyección de primera clase alcanzable por *"ruta alias hacia la misma lente"*, así que sin reservarla un espacio podía reclamarla y chocar con una ruta ya decidida. `people` queda reservada-pero-rechazada (ADR-065 eligió Conversations): guardar el nombre cuesta cero y libera cero.
- **Deuda documental medida contra el catálogo, no contra los docs**: `architecture.md` decía **22 tablas** y `show` por todas partes (su última revisión, 2026-05-02, es anterior a ADR-036); `build/README.md` llamaba "Canonical" a una migración de mayo; `roadmap.md` y `director-prompt.md` afirmaban 22 tablas a un agente. Real: **29 tablas · 1 vista · 59 funciones · 82 políticas RLS · 21 enums**. Corregidas las afirmaciones vivas; las fechadas (`## Status — …`, `build/_context.md` bajo su enmienda, `reset-v2-prompt.md`) se quedan — eran ciertas en su fecha.
- **Por qué importa más de lo que parece**: es el mismo argumento de ADR-069/075. Un trigger `guard_show_fee_columns` sobre una tabla `performance`, o un doc que jura 22 tablas cuando hay 29, es un diccionario de traducción que cada agente futuro tiene que aprender — y que ninguno puede verificar sin ir al catálogo. **La lección operativa**: un rename de tabla/columna en Postgres arregla los *cuerpos* (attnum) y abandona los *nombres* (constraints, funciones, triggers, columnas de vistas, mensajes de error). Buscar por nombre no basta: hay que barrer `pg_proc.prosrc`, `pg_get_constraintdef`, `pg_get_viewdef` y `pg_description`.
- **`schema.sql` / `rls-policies.sql`: NO tocados** — se autodeclaran snapshots congelados de 2026-05-01. Reescribirlos les haría afirmar un estado que nunca existió en su fecha. En su lugar, `build/README.md` ahora avisa explícitamente de que mienten y remite a `migrations/`.
- **Re-evaluate when**: (a) el próximo rename — que corra este mismo barrido de catálogo *antes* de darse por cerrado; (b) si `schema.sql` estorba más de lo que documenta, regenerarlo con `pg_dump --schema-only` y fecharlo (hoy es deuda anotada, no resuelta).
- **Status**: live — migración aplicada y verificada (0 objetos/cuerpos/comentarios nuestros con la palabra muerta; trigger religado; ACL intacto; las dos listas de slugs idénticas).

## [2026-07-18] — ADR-078 · Calendar v2 grillado: diálogo unificado, blackout sin porqué, dia off, inferencia en dos niveles y paridad estricta IA=UI

> Grill de Marco + .zerø sobre el mock "Hour Calendar Lens.html" (ejecución del planner-design-prompt, aún en refinamiento) contra los prompts despachados en S1. Resuelve las divergencias mock↔prompts y deja el model build despachable. Aquí se fijan modelo y contratos, no píxeles — el diseño final de Marco llega después.

- **Decisiones**:
  1. **Diálogo de creación unificado — el pill de tipo manda sobre la forma.** Cae el menú de dos opciones Performance | Date (calendar-prompt §3 viejo): un solo diálogo desde el "+" (celda o toolbar) con pills de tipo. Actuació monta la forma de performance **reutilizando** la de `PerformanceCreateDialog` (extraída a componente-forma compartido, no forkeada — un solo sitio donde vive "cómo se crea una performance"); el resto crea `date`, y solo esos tipos muestran el tercer nivel del cascade (colgar de una actuación).
  2. **Lista de pills: criterio fijado, lista final de Marco en la pasada de diseño.** Un tipo se gana pill si algo ramifica sobre él (render, lógica, campos propios); si no, es Altres + etiqueta. Candidata: Actuació · Assaig · Viatge · Dia off · Residència · Premsa? · Altres.
  3. **`day_off` entra en `date_kind`** (label "Dia off") — el día libre planificado estando fuera; vocabulario del propio sector (show day / travel day / day off), mismo principio anti-CRM que hold y bolo. Distinto del día-fuera derivado (§6): este es un hecho del plan de gira, aquel una inferencia.
  4. **Blackout SIN eje `kind`**: `availability_block` = persona? (null = compañía) + rango + `certainty` (unavailable|tentative) + nota libre. Dos razones: (a) ningún consumidor ramifica por el porqué — el motor de conflictos lee certainty, el render distingue scope y certeza; (b) privacidad de producto (Marco): "no estoy" es información completa; obligar (o invitar con pills) a clasificar el porqué presiona a explicar lo que socialmente no se debe. "Malaltia" además es temporalmente incoherente — un blackout se planifica, una enfermedad ocurre. Si las notas repiten patrón en uso real, promover a enum es aditivo y barato.
  5. **Blackout multi-espacio**: write-target = UN espacio siempre (campo Espacio, preseleccionado cuando el scope colapsa a uno; sin fan-out tipo "Add contact" — un blackout es un hecho sobre la gente de una compañía, no un anuncio). Select de persona = **el equipo del espacio** (`cast_member` ∪ `crew_assignment`, dedup), no el libro de contactos (en muk-cia son 154 programadores). En lectura, el motor ve todos los blackouts que RLS deja ver — cross-espacio gratis.
  6. **Inferencia de días-fuera en dos niveles**: **v1 = banda "fora" determinista entre viajes** — anada día X + tornada día Y de la misma línea (fallback: mismo project) ⇒ los días intermedios sin evento propio reciben banda calculada (`awayBands()`, función pura en `$lib/calendar.ts`, testeable). Solo visual en v1: no alimenta el motor de conflictos ni tiene edit affordance (los hechos editables son los viajes). **Nivel 2 (capa IA, ADR-069) = rellenar datos que faltan, no calcular por encima**: propone los viatges/dia off ausentes con consentimiento, y al aceptar alimentan la misma regla. Una sola regla de inferencia en el sistema — dos sistemas de inferencia compitiendo por pintar el calendario es la complejidad que Hour no quiere.
  7. **Paridad estricta IA=UI (amendment de ADR-069, declarada por Marco)**: la IA no tiene NINGÚN write path que la UI no tenga — toda propuesta es ella rellenando los mismos formularios/entidades que el usuario puede rellenar a mano; su única ventaja es que calcula. Test de regresión conceptual: *si una propuesta de IA no se puede reproducir clicando, falta UI, no falta IA.*
  8. **Etiqueta custom en Altres**: `custom_fields.label` (jsonb existente en `date`, cero migración), texto libre + autocompletar sobre el historial del workspace (DISTINCT — `GET /api/dates/labels`). Es "para siempre" en la práctica sin ningún concepto de gestionar etiquetas; una tabla de vocabulario solo cuando curar centralmente (renombrar en N filas) sea necesidad real.
  9. **Opció en dates**: el diálogo expone un pill "Opció" (on → `date_status='tentative'`, off → `'confirmed'`; cancelled/done son ciclo de vida, no estados de creación — el enum de 4 nunca se expone). Cubre reservas de residència (3 candidatas = 3 tentative; decidir = 1 confirmed + 2 cancelled) sin migración. La gramática contorno=posibilidad se extiende a los chips de date.
  10. **Proyección (cierra el cabo de ADR-076)**: URL canónica única `/h/calendar?view=agenda` — la ruta alias `/h/agenda` **NO se construye** (Marco: "no la necesitamos"; el slug sigue reservado para que ningún espacio lo reclame, ADR-077). Persistencia en **localStorage por dispositivo** — el default correcto es por form factor (ancho→mes, estrecho→agenda) y una preferencia de servidor pelearía contra eso; precedente commit `4436af8`. Resolución: `?view=` → localStorage → form factor.
  11. **Regla de entrada de hora (cierra el BUG VIVO de timezones para todas las puertas)**: la hora se teclea en hora LOCAL DEL LUGAR del bolo, con el campo etiquetado ("hora local de Tàrrega"; fallback `workspace.timezone` visible); la zona del que mira es cortesía de display. El fix vive en la forma compartida (§1) y todas las puertas lo heredan.
  12. **Toolbar**: ICS pasa a menú overflow "⋯" (acción de configurar una vez, no de cada día); stats del masthead se quedan (verdad-solo-datos: counts del mes visible, cada cifra mapea a filas reales; sin gate `read:money` — no hay nada monetario); filtro Tot | Holds | Confirmats client-side confirmado.
  13. **Secuencia**: model build **despachable YA** (independiente del diseño y de Desk v2). UI build **bloqueado** hasta (a) aterrizaje de Desk v2 (comparte `base.css`/tokens y hereda su sistema — sin builds paralelos pisándose) y (b) diseño convergido de Marco (en refinamiento). El design-prompt gana un bloque vinculante con estas decisiones para que el mock final nazca alineado.
- **Rechazado**: menú Performance | Date con dos diálogos (obliga a decidir vocabulario interno antes de ver la forma); `kind` en blackout (`vacation/unavailable/personal` — duplicaba el eje certainty y clasificaba el porqué); ruta alias `/h/agenda`; preferencia de proyección en `user_profile` (global, pelearía con el default por dispositivo); tabla de vocabulario de etiquetas en v1; exponer el enum de 4 estados en el diálogo de date.
- **Re-evaluate when**: (a) el uso real pida "assaig provisional" más allá del pill Opció; (b) las notas de blackout repitan un patrón → promover kind; (c) haga falta curar etiquetas centralmente → tabla de vocabulario; (d) la banda derivada deba alimentar el motor de conflictos como soft-blackout — decidir con datos reales delante; (e) el uso viva mayoritariamente en agenda → reconsiderar jerarquía de proyecciones (ADR-076 ya lo prevé).
- **Status en ese momento**: firm — modelo y contratos cerrados; los tres prompts se conservan hoy en `build/archive/2026-07-calendar-model-prompt.md`, `build/archive/2026-07-calendar-ui-prompt.md` y `build/archive/2026-07-planner-design-prompt.md`.
- **Status (build en ese momento)**: ejecutado 2026-07-18 en la rama `calendar-v2` (sesión autónoma, worktree `~/Developer/hour-calendar-v2`) — modelo + APIs + UI + tests + mock, DB viva intacta, sin mergear ni desplegar. Apply/merge/deploy se ejecutó después; el runbook y contrato se conservan en `build/archive/2026-07-calendar-v2-apply-runbook.md` y `build/archive/2026-07-calendar-v2-api-contract.md`.

## [2026-07-19] — ADR-079 · La lente de tiempo pasa de Calendar a Planner (EN Planner · ES/CA Planificador); el feed ICS conserva "calendar"

> Sesión con Marco puliendo el nombre de la lente de tiempo. Reabre el sub-punto de ADR-065 (que fijó "Calendar") y actualiza las rutas de ADR-076/078 (`/h/calendar` → `/h/planner`). Decisión de nombre, no de modelo — la lente y su motor no cambian, solo cómo se llaman.

- **Decisión**: la lente **Calendar → Planner**. Token interno `planner` (inglés, ADR-008: schema/código en inglés, labels libres). Labels por idioma: **EN Planner · ES Planificador · CA Planificador · FR Planning** (FR documentado, sin implementar — no hay `fr.json` todavía).
  - **Copy con registro flexionado**: la *etiqueta* de la sección es "Planificador" (formal, inequívoco), pero la *copy de acción* usa el contenido — "Añadir al plan" / "Afegeix al pla". No es incoherencia: el plan vive dentro del planificador; forzar "Añadir al planificador" suena a software de empresa. Inglés no parte (Planner / "Add to planner") porque la palabra es corta y funciona como verbo-destino. Precedente en el propio sistema: la lente "Desk", cuya copy nunca dice "desk" ("¿Qué hay que hacer?"). El token interno garantiza la coherencia por debajo; arriba, cada lengua respira.
- **Por qué**: "Planner" nombra el **acto** (planificar), no el widget (la rejilla) ni el contenido (bolos). Es **neutro al tipo de contenido** — un bolo, un viaje, un ensayo, un blackout y un día off caben todos sin que la palabra privilegie a ninguno (la grieta de "Calendar"/"Fechas"/"Programación": nombran el gig). Y afila el eje que ya sostiene el modelo (ADR-063/065/076): **Desk (el ahora) vs Planner (planificar)** — nombra el eje que las mantiene separadas. Desde ADR-076 la lente son DOS proyecciones (rejilla + agenda); "Calendar" nombraba solo una de ellas.
- **Scope — qué NO cambia**: el subsistema **iCalendar/ICS conserva "calendar"** (`calendar_share`, `/api/calendar-shares`, `/api/public/calendar`, `ics.ts`, RPCs `*_calendar_share` + `get_public_calendar`). Es un feed `.ics` que apps externas suscriben — "calendar" es verdad de interop ahí, igual que la entidad `date` conserva su nombre. Las copies que apuntan al calendario EXTERNO también ("Calendar feed…"). Nada de eso es la lente.
- **Implementación (ejecutada + desplegada 2026-07-19, commit `d977af0`)**: 11 capas — store `Lens` + one-shot localStorage `calendar`→`planner`; rutas `h/calendar`→`h/planner` (+ stub `[ws]`) con `git mv`; 301 en `hooks.server.ts` (`/h/calendar` y `/h/[ws]/calendar` → `/h/planner`, verificados en vivo); i18n en/es/ca (`lens.calendar`→`lens.planner`, namespace `calendar.*`→`planner.*`); motor `calendar.ts`→`planner.ts` + tipos `Calendar*`→`Planner*` + 8 imports; módulo `CalendarModule`→`PlannerModule` + registro `MODULE_KEYS`/labels + mapa del line-detail; cache keys TanStack `calendar-*`→`planner-*` (sin tocar `calendar-share`); reserved-slugs (+`planner`, `calendar` reserved-but-rejected). `svelte-check` 0/0 (1538) · unit 251/251. Migración `build/migrations/2026-07-19_rename_calendar_to_planner.sql`: reserva `planner` (mirror 65=65; la def viva no tenía drift) + swap del módulo `calendar`→`planner` en las **3 líneas** reales (verificado post-apply: 0 con `calendar`, 3 con `planner`). Deploy verde (`/health/live` sha `d977af0`).
- **Rechazado**: renombrar el ICS a `planner-share` (mentiría — es un iCalendar); "Añadir al planificador" en copy (clunky, tell de software de empresa); ES "Plan" corto (Marco eligió "Planificador" — inequívoco, y en catalán "Pla" es ambiguo con "pla" = plano/llano).
- **Re-evaluate when**: aterrice `fr.json` → `lens.planner`="Planning"; si el uso real pide que la copy también unifique en "planificador" (hoy: no); si algún prompt de diseño (`calendar-*-prompt.md`) se renombra a `planner-*` (pendiente, coordinar — son docs de diseño de Marco).
- **Status**: **live** — desplegado y verificado 2026-07-19 (301s + stamp + swap DB). Doc vivo: `build/structure-model.md` (lens set actualizado).

## [2026-07-19] — ADR-080 · Planner v2: cola de decisiones derivada, aviso por antelación, tres severidades nuevas y Carrils como tercera proyección

> Mini-grill sobre el prototipo interactivo de Marco (`Hour Views - Scope v2.html` en el proyecto de diseño — lente "Planner" con banda de decisiones + Carrils con Agrupa per). Mandato de Marco: "apúntalo todo, planifica e impleméntalo" (sesión autónoma, misma tarde que ADR-078).
>
> **Reconciliación de numeración (2026-07-19)**: este ADR se redactó como "ADR-079" en una sesión paralela a la que renombró la lente Calendar→Planner (que se quedó el 079 y ya está desplegada, `d977af0`). Renumerado a **ADR-080** al integrar. La feature se construyó sobre la ruta vieja `/h/calendar` y se rebasó encima del rename: el motor vive en `$lib/planner.ts`, la lente es `/h/planner`, los componentes en `$lib/components/planner/`. Las referencias "§ ADR-079" que queden en comentarios de código de esta feature refieren a este ADR-080 (escritas antes de la colisión).

- **Criterio rector (declarado por Marco, vara de este ADR y de los que vengan)**: *la herramienta es muy potente pero tiene que parecer muy sencilla* — cero configuración obligatoria, campos opcionales solo cuando pagan su sitio, todo lo demás derivado. Misma vara que mató el `kind` del blackout (ADR-078 §4).
- **Decisiones**:
  1. **Las "decisiones" son DERIVADAS — no hay entidad `decision`.** Una decisión es la proyección de un par de conflicto del motor donde hay opciones que confrontar. Nada que almacenar, sincronizar ni caducar: la cola siempre dice la verdad del momento. (Precedente: urgencia derivada, ADR-070.)
  2. **Aviso por antelación, no fecha pactada** (corrección de Marco al `hold_expires_on` propuesto): la urgencia se deriva de `start_at − aviso`. **`performance.hold_notice_days smallint NULL`** — NULL = default estándar (30), `0` = sin aviso, `N` = avisa N días antes del bolo. Sin página de settings; el campo aparece discreto en la forma/detalle solo con status hold\*. Copy honesta: "decidir abans de {start_at − aviso}". Urgent = hoy ≥ esa fecha.
  3. **Tres niveles nuevos de lectura del mismo día** (amplían ADR-072/078; el motor gana severidades):
     - **`double`** — mismo proyecto, dos performances el mismo día, ≥1 en hold: "el mateix espectacle, dos llocs" → decisión SIEMPRE (cierra el hueco as-built "same-project pairs never clash", que se pensó para bolo+viaje+assaig y tapaba el doble-booking).
     - `people` / `possible` (existentes) → decisión cuando ambos lados tienen opciones que confrontar.
     - **`concurrence`** — cross-project mismo día, ambos en hold, sin personas compartidas y con equipos conocidos: **se VE, no grita** (Marco). Sin marca en celda; listado silencioso al abrir la banda ("el mateix dia · sense fricció de persones"). No cuenta como "per decidir".
  4. **Banda de decisiones en la lente Calendar** (encima de la proyección, las tres): colapsada = una línea (la urgente si la hay, si no el recuento); abierta = cards "A ─ o ─ B" con contexto (persona compartida / sense equip / mateix espectacle), fecha grande, motivo, hint. **Cross-month**: la cola mira holds en [hoy, +90d], no solo el mes visible. Filtrada por scope como todo.
  5. **Acciones con paridad IA=UI estricta (ADR-069/078 §7) y sin estado nuevo**: "Confirma X" = PATCH status→confirmed del que confirmas — **nunca** toca el otro en el mismo gesto. Tras confirmar, el motor re-emite el par (confirmed vs hold) y la card muta sola a follow-up: "Ja has confirmat X — alliberar Y?" con [Allibera → status cancelled] [Mantén]. Todo derivado, dos gestos explícitos, cero writes silenciosos. "Deixa-ho obert" = colapsa la banda (estado de UI en localStorage), no persiste nada en DB.
  6. **Pulse strip en el masthead** (sustituye a los stats planos): `N per decidir · M urgent` (rojo, jump a la banda) `· propera: {data} {venue} · X confirmats · Y holds · Z persones fora · W viatges` — cada cifra mapea a filas fetched (per decidir/urgent sobre la ventana +90d; el resto sobre el mes visible).
  7. **Carrils = tercera proyección de primera clase** (amendment de ADR-076 §2: de dos a tres; el criterio que lo gobierna: *una proyección se gana el slot cuando responde una pregunta que las otras no pueden* — mes = dónde hay huecos · agenda = qué viene · carrils = quién/qué espacio carga el mes y el ritmo de gira). Cinta horizontal del mes con: carril por clave, línea de "avui", weekends sombreados, pips confirmado/hold, bandas de assaigs/blackouts en el carril, viajes como texto mono, **conector vertical rojo entre carriles** para conflictos cross-carril, scroll horizontal con auto-centrado en hoy.
  8. **Agrupa per: Espai · Projecte · Persona** — Persona = el Loom (hilo por persona del equipo: compromiso engorda el hilo con el color del proyecto, hold lo puntea, blackout lo rompe con "fora", conflicto = nudo rojo; personas sin datos = hilo fantasma "sense dades"). Datos del equipo: `/api/team` + rosters existentes. URL: `?view=carrils&group=espai|projecte|persona`, mismo esquema de persistencia que ADR-078 §10.
- **Rechazado**: entidad `decision` almacenada (estado que miente); `hold_expires_on date` como única vía (fecha pactada existe poco y obliga a rellenar; si algún día hace falta fecha dura, es aditiva); auto-liberar el otro hold al confirmar (write destructivo silencioso — viola consent-first); renombrar la lente a Planner (en evaluación aparte); `concurrence` como marca en celda (alarma lo que no alarma).
- **Re-evaluate when**: (a) el default 30 moleste en uso real → knob por workspace (aditivo); (b) los venues empiecen a dar fechas duras de hold → columna `hold_expires_on` opcional que GANA sobre el aviso; (c) Carrils per Persona se use más que per Espai → jerarquía del Agrupa; (d) la banda colapsada no baste como "Deixa-ho obert" → snooze por card (localStorage, nunca DB).
- **Status**: firm — build autónomo despachado en esta misma sesión (branch `planner-decisions`).
- **Status (build)**: ejecutado 2026-07-19 en la rama `planner-decisions` (worktree `~/Developer/hour-calendar-v2`, dos etapas) — etapa 1: motor de decisiones + banda + pulse + `hold_notice_days`; etapa 2: Carrils como tercera proyección (`?view=carrils&group=espai|projecte|persona`, misma cadena de persistencia; sin cambio del default por form factor). Carrils = `$lib/carrils.ts` (puro: resolver de grouping, stacking de intervalos, runs de assaig, modelo Loom — con tests) + `CarrilsStrip.svelte` (cinta del mes: columna de etiquetas sticky, pips con flip+clamp medidos post-render, bandas en-carril apiladas, conector rojo cross-carril que salta a la card de la banda, Loom con hilos/fora/nusos/fantasmas). Los 3 bugs de render del prototipo (colisiones de labels al final de mes, pills FORA solapadas, labels recortados a la izquierda) resueltos por construcción. Sin commits/deploy; gates check+unit+build verdes.
- **Status (review fixes, 2026-07-19, misma rama)**: seis correcciones de contrato tras el review del build — (1) el bundle de detalle tolera una DB pre-migración: `hold_notice_days` se selecciona con retry-sin-columna (42703) + flag `hold_notice_absent` que oculta el campo en el diálogo, manteniendo verdadero el contrato de ausencia opt-in del §2 (antes, la página de detalle y el road sheet 5xx-eaban en TODOS los bolos); (2) la banda también se monta cuando solo hay concurrences — §3 define el tier por "se VE", y sin marca de celda la banda es su única superficie (skin quiet, siguen sin contar como per decidir); (3) **regla `possible` + confirmed — desviación deliberada de la letra del §5**: un par `possible` (sin roster) solo es decisión mientras ambos lados son opciones abiertas; al confirmarse un lado, el par SALE de la cola en vez de mutar a release — sin datos de equipo no se puede afirmar fricción, y sugerir un cancel sería un prompt destructivo sobre datos desconocidos (el follow-up del §5 queda scoped a people|double; lectura estricta del §3 "opciones que confrontar"); (4) los blackouts dejan de ser input de `decisionsFor` — solo producen severidades single-event que la cola descarta; se elimina el fetch de availability de la ventana (una query por carga cuyo resultado era provably unused) y el comentario que lo justificaba en falso; (5) la ventana [hoy,+90d] pagina sobre el cap de 200 del API (cursor por día + dedupe) para que la cola y el "N per decidir" nunca infra-reporten en silencio (§1/§6); (6) `hold_notice_days` tiene UNA regla de validación cliente (`isValidHoldNotice` en `$lib/performance`) compartida por el form de creación y el diálogo de detalle — antes un dígito malo en el diálogo 400-eaba el PATCH entero y perdía todos los edits.
- **Status (cierre de sesión)**: build ejecutado 2026-07-18, en la MISMA sesión del grill (prolongada sobre la medianoche), rama `planner-decisions` (worktree `~/Developer/hour-calendar-v2`). Pendiente: apply (1 migración — `2026-07-18_hold_notice_days.sql`) + merge + deploy, a ejecutar por .zerø en sesión (no autónomo).

## [2026-07-19] — ADR-081 · Monograma de identidad de proyecto: reemplaza el dot de color (paleta 8→12, derivación OKLCH, editor a dos profundidades)

> Marco probó en el calendario un sistema de monogramas (máx. 3 letras sobre el color del proyecto, colores suaves, edición al momento) y le convenció como identidad global: *"utilizar el pequeño dot de color por este monograma en todos lados de la app"*. Mandato: "planea e implementa en autónomo". El monograma que enseñó **no existía en el repo** (rastreado todas las ramas + historia): la feature es greenfield sobre los primitivos que sí había (8 acentos OKLCH, `ScopeGlyph`, `Avatar` de 2 letras, `AccentSwatchPicker`).

- **Criterio rector**: el monograma es el **token de identidad del `project`** (la unidad de pensamiento del structure-model). Un átomo visual editable en un sitio que se propaga a todas las superficies. Redundant encoding: color + texto, no color solo — escala donde el dot se rompe (multi-tenant, >8 proyectos, la memoria color→proyecto deja de funcionar).
- **Decisiones**:
  1. **`IdentityMark` — un componente, tres variantes**: `compact` (tinte + monograma) · `full` (+ nombre) · `bare` (tinte sin letras, misma silueta). El `bare` es el fallback anti-dot para densidad extrema; **el dot redondo se retira** (Marco: "no me gusta el dot"). No es un componente nuevo por variante — inversión de control por contrato de variables (`--c` entra, `--mk-bg/-fg` se derivan dentro).
  2. **Derivación de color en el medio nativo (CSS, no JS)**: fondo = `color-mix(in oklch, var(--c) 16%, --bg-ultra-light)` (receta del tile de `ScopeGlyph`); texto = relative-color `oklch(from var(--c) 0.42 c h)` en light / `0.9` en dark → **contraste garantizado en los 12 tonos** fijando la L, sin comprobar color por color. Es lo que el dot (sin texto) no tenía que resolver y el monograma sí. Cero JS/`$effect`. **Rechazado OKHSL-en-JS** (no es función CSS nativa; `oklch(from)` sí, y el principio 1 de la filosofía manda derivar en la cascada). Validado en harness estático (12 tonos × light/dark).
  3. **Paleta 8→12 por índice, no color libre** (el diseño son swatches fijos, no un picker hex). CHECK relajado `^[1-8]$`→`^([1-9]|1[0-2])$` en `workspace`/`project`/`line`. Hues 9-12 (lima 125 · teal 185 · azure 235 · crimson 355) **provisionales**, elegidos en los huecos más anchos de los 8 — para tunear. **Efecto conocido**: ampliar el módulo del hash re-asigna los colores "auto" (accent NULL); los explícitos no se tocan.
  4. **Iniciales libres, case-sensitive, guardadas solo en `project.initials`** (space/line las derivan del nombre — una columna, un editor). `deriveInitials` es solo la *sugerencia*; el valor guardado pisa. **Colisión = match exacto case-sensitive** dentro del workspace → **avisa, no bloquea** (`MdM` ≠ `MDM` son dos monogramas válidos; el color los separa igual).
  5. **Editor a dos profundidades, un solo `update_project` RPC** (structure-model Option 2: la superficie *hospeda* el editor de la entidad, no lógica propia): **popover anclado** (tap monograma → iniciales + 12 colores al momento + enlace "Edit project →") + **`EditProjectDialog` completo** (nombre, monograma, color, descripción) para el resto. Popover **anclado, no modal** (patrón de `Menu.svelte`: wrapper relativo + panel absoluto + light-dismiss); el diálogo pesado para lo demás. En la página de detalle, donde ya estás dentro, el monograma abre el popover con la puerta al diálogo.
  6. **Dos capas de entrega**: Capa 1 (visual — `IdentityMark` en las superficies, iniciales *derivadas del nombre*, cero DB, desplegable sola) separada de Capa 2 (migración `project.initials` + CHECK 12 + `update_project` RPC + editor). Aísla lo visible de lo gated.
- **Rechazado**: mantener el dot; color libre hoy (pre-cableado en `accent.ts` para cuando se quiera); un editor de identidad *separado* del de proyecto (dos sitios que tocan color → drift, lo que el structure-model prohíbe); modal en vez de popover anclado (mata la edición "al momento").
- **Re-evaluate when**: (a) los 12 tonos no basten o alguno vibre → tunear hues 9-12; (b) se quiera color libre → relajar CHECK + picker hex (`accentVarFor` ya deja pasar hex/oklch literal); (c) las iniciales hagan falta guardadas en space/line → añadir columna (el space ya tiene identidad propia, ADR-062); (d) el "muy parecido" (colisión case-insensitive como aviso suave) se pida; (e) haya que mostrar la inicial *guardada* (no derivada) en los chips del calendario → añadir `initials` a los selects de los feeds de perf/date.
- **Status**: build autónomo en rama `feat/identity-monogram` (commits `5711adb` Capa 1 · `a32e40c` Capa 2 backend+diálogo · `778b247` popover). **Migración APLICADA y verificada en `hour-phase0`** (checks de acento a 12, `project.initials` + check, `update_project` presente). Gates: check 0/0 · build · unit 318. `db-types` hand-patched (regen pendiente, mismo patrón que la deuda de ADR-078).
- **Status (pendiente)**: sweep del resto de superficies (`CarrilsStrip`, `AgendaList`, `DeskBoard`, `HomeView`, cabeceras line/person/performance, settings, unificar `ScopeGlyph`, leyenda del planner); `initials` en los feeds del calendario; i18n (IDENTITAT/INICIALS); playground; merge + deploy. Nº de ADR sujeto a reconciliación si la sesión paralela toma 081 (precedente: 079→080).
- **Status (cierre de sesión)**: build ejecutado 2026-07-18, en la MISMA sesión del grill (prolongada sobre la medianoche), rama `planner-decisions` (worktree `~/Developer/hour-calendar-v2`). Pendiente: apply (1 migración — `2026-07-18_hold_notice_days.sql`) + merge + deploy, a ejecutar por .zerø en sesión (no autónomo).
- **Status (reconciliación 2026-07-20)**: reconciliado sobre `main` en la rama `feat/planner-identity` por cherry-pick de los commits de código. La migración ya estaba **aplicada en producción** y quedó absorbida en `supabase/migrations/20260720105713_remote_schema_checkpoint.sql`; **no se re-aplica**. La deuda de `db-types` hand-patched se cerró sola: `main` regeneró los tipos después del checkpoint y ya traen `project.initials`, el CHECK de 12 acentos y `update_project`. Gates sobre la rama reconciliada: check 0/0 · unit 348 · build · RLS 120/120. **Nota de arqueología**: la rama `feat/identity-monogram` que cita el Status anterior ya no existe como nombre — sus commits vivían contenidos en `feat/comms-threads` y desde hoy están en `main` vía `feat/planner-identity`.

## [2026-07-19] — ADR-082 · Modelo de personas, roles y acceso — el "quién es quién" (prerrequisito de la capa de comms)

> **ENMIENDA (2026-07-20)** — resultado del grill de acceso+comms del 2026-07-19/20 (registro completo: `_notes/spec-access-comms-decisions.md`). Corrige y precisa §4 (facetas) y §6 (login) de este ADR; el resto queda como está. **Sigue sin implementar: no toca schema.**
>
> **1 · Las facetas existen POR NIVEL de contenedor.** Las dos listas que ADR-082 y ADR-083 esbozaban nunca fueron dos listas: son una sola vista a dos alturas. Este ADR gateaba lo que vive arriba (el libro, los materiales), ADR-083 hablaba de lo que vive abajo (técnica, logística); Diners salía en las dos porque es la única que cruza todos los niveles.
>
> |  | espai | projecte | línia | bolo |
> |---|:--:|:--:|:--:|:--:|
> | Converses | ● | ● | ● | — |
> | Materials | — | ● | ● | ● |
> | Tècnica | — | ● | ● | ● |
> | Logística | — | — | ● | ● |
> | Full de ruta | — | — | — | ● |
> | Diners | ● | ● | ● | ● |
>
> **`General` NO está en la tabla.** No es faceta: es la membresía en el contenedor. El hilo general siempre existe y su audiencia es exactamente los miembros del contenedor; un "permiso de General" sería falso, porque nunca puede valer `res` para un miembro.
>
> **Ausente ≠ denegado.** Una faceta que no existe en un nivel no está "puesta a `res`": no está. La UI tiene que decirlo con esas palabras, o el usuario leerá una prohibición donde solo hay una dimensión inexistente.
>
> **La unión entre niveles no cambia** (§3 de este ADR, intacto). `Diners·veure` a nivel espai sigue concediéndolo en cada bolo. La tabla dice *dónde puede existir* una faceta; no altera cómo se suma el acceso.
>
> Elegido deliberadamente frente a una lista plana, decisión de Marco. Contabilidad honesta: **la ganancia ergonómica es modesta** (espai=2 filas, projecte=5, línia=6, bolo=6; línia y bolo solo difieren en Converses↔Full de ruta). **La ganancia real es de seguridad, no de brevedad:** no puedes conceder `Full de ruta` a nivel espai ni `Converses` en un bolo, porque la fila no está ahí para concederla.
>
> **2 · Renombres del preset, forzados por colisión.** `Convidat` → **`Mínim`**: "convidat" pasa a nombrar al invitado (una persona sin login, ver la enmienda a §6), y el preset más bajo no puede compartir palabra con él. `Producció` → **`Coordinació`**: `Producció` pasa a ser *faceta* (tabla arriba) y ya era *rol*; tres significados para una palabra es exactamente el fallo que §2 de este ADR quería evitar. Escalera final: **Mínim · Equip · Coordinació · Direcció**.
>
> **3 · Delegación acotada por el delegante, en tres ejes.** Solo puedes conceder lo que tienes: **faceta** (no concedes una que no tienes), **verbo** (con `veure` no concedes `veure+editar`), **nivel** (el tuyo o más estrecho, nunca más ancho). Dividendo: **esta regla sustituye a la capacidad separada de "invitar"** de ADR-083 §4. Un admin lo tiene todo, luego puede conceder todo; una road manager delega dentro de lo suyo. Una regla en vez de dos, y el caso de las 8am sobrevive: mete al técnico de la sala en Tècnica/Logística porque las tiene, y no puede meter a nadie en Diners porque no la tiene. Lo que la regla **no** acota es la cantidad — quien tiene acceso ancho puede crear muchos invitados; con caducidad y roster visible, aceptado para una compañía de 3-15. No construir para eso.
>
> **4 · Lo que tienes es el TECHO, nunca el DEFAULT.** El default de cualquier invitación es `Mínim`; cada faceta por encima se enciende a mano. Marco se negó a firmar un modelo donde invitar a alguien "al bolo" arrastrase Diners por herencia. Alguien de fuera *puede* acabar viendo el caché — nunca por herencia, solo porque quien tiene Diners lo dio deliberadamente, con línea de confirmación explícita.
>
> **5 · `Producció` NO es una faceta (decidido 2026-07-20, después de dibujarla).** Tres cosas la tumbaron, en orden de peso: (a) al escribir un hilo de Producció realista, todos sus mensajes se iban a técnica, logística o diners — nada perdía casa sin ella; (b) su contenido ya tiene destino (contratos→Diners, acreditaciones→Logística, materiales→Materials) y el residuo es delgado, y el modelo ya tiene nombre para el residuo: `General`; (c) **decisivo — en el código desplegado `production` es el CONTENEDOR de las otras**: `ProductionStub.svelte` es el bloque del bolo con venue + horarios + los tres jsonb *logistics / hospitality / technical*. Ponerla como hermana de Logística y Tècnica era un error de categoría contra código que ya corre. Sobrevive como **rol**, que es lo que siempre fue — "es un oficio clásico de teatro" argumenta a favor de un rol, nunca de una faceta de permisos. Barato de revertir: la lista de facetas es datos, una fila.

>
> **6 · Reversibilidad como requisito, no como detalle** (Marco, explícito). La tabla de niveles tiene que ser **filas, nunca código**: mover Tècnica de projecte a línia debe ser un `UPDATE`, no una migración y no un `if`. Lista de facetas, tabla de niveles y presets son datos. Lo que nunca puede ser gratis: una faceta solo significa algo si gatea una tabla, y ese enganche vive en las políticas RLS (hoy `read:money` aparece literalmente en ~11 sitios de `rls-policies.sql`). **Mover una faceta entre niveles: gratis. Añadir una faceta nueva: cuesta su política. Borrar una que ya se usó: cuesta su historial.**
>
> **7 · Coste de construcción, al registro.** **Ya existe:** `has_permission(project_id, text)` resuelve `union(roles.permissions) + permission_grants − permission_revokes`, con roles/grants/revokes como *datos* en `project_membership`. Eso es el motor preset+overrides de §4 de este ADR, ya desplegado. **No existe nada:** ningún nivel que no sea proyecto. `has_permission` recibe un `project_id` y nada más, y no hay membresía de workspace, de línia ni de performance. **La dimensión de nivel es el coste íntegro de esta enmienda.**

> **NAMING (2026-07-19, cierra el Abierto #1):** la etiqueta = **rol** · el acceso = **permisos** (antes «rol de acceso»). En el texto de abajo, léase «oficio» → **rol** y «rol»/«rol de acceso» → **permisos**. Aplica igual a ADR-083. Motivo: el cliente no técnico parsea «rol» como *lo que hace* (no como nivel de permisos, que es jerga de dev); *oficio* y *perfil* descartados — oficio por romántico y por viajar peor (la app ya es multilingüe), perfil por genérico y por chocar con «perfil de usuario». Coste asumido: el schema sigue llamando `role` al acceso (`workspace_role`, `membership_role`) → desajuste UI («permisos») vs schema (`role`), a documentar al implementar.

> Grill largo con Marco (2026-07-19) para madurar el modelo de personas ANTES de construir comunicación de equipo/bolo. Disparador: "programador no es un concepto en Hour" (es una `person` alcanzada por una conversación; `person` no tiene tipo, la organización es texto libre) + el choque de que "Conversations" ya está ocupada (ADR-075) cuando Marco quiere hablar CON el equipo, no solo registrar difusión. Raíz del "inmaduro": el control de acceso de hoy cuelga del login (`workspace/project_membership.user_id`) y está desconectado del mundo de contactos (`person` sin login) — dos mundos sin puente.

- **Decisiones** (modelo decidido en principio, SIN implementar):
  1. **Persona única.** Un `person` por humano (ya es global, sin `workspace_id`). El login es opcional y se engancha encima; se unifican "contacto" y "usuario" sobre `person`, no dos mundos.
  2. **Tres conceptos separados, no uno** (el error a evitar es fundirlos):
     - **Oficio** (etiqueta; nombre TBD *oficio* vs *perfil*) — lo que alguien HACE (sonidista, distribución, programador). Sin poder, pura etiqueta. **Múltiple** por persona (programador Y técnico de sonido de otra compañía a la vez). Estándar + custom; el custom es seguro precisamente porque no da acceso.
     - **Membresía** — en qué contenedores está (workspace / proyecto / bolo). Decide QUÉ VE.
     - **Rol de acceso** — un paquete de capacidades. Decide CUÁNTO puede dentro de lo que ve.
  3. **Visibilidad por contenedor (Solución A), no por tipo de conversación.** Ves los contenedores donde eres miembro, a los tres niveles. El alcance lo da el NIVEL donde se asigna el rol (idea de Marco), no un atributo del rol: el mismo rol va ancho a nivel workspace y estrecho a nivel bolo. Efectivo = **unión** de tus roles por contenedor; owner/admin del workspace = todo. NO se tipa la conversación por dominio — la separación sale de en qué contenedor/faceta vive. (Caso road manager: rol en un bolo sí, en otro no → ve lo de road manager solo donde lo es.)
  4. **Roles = pocas capacidades, generales; eje ver/editar por faceta.** No 30 permisos: un puñado de facetas (conversaciones, dinero, hoja de ruta, producción, materiales…), cada una en `ver | ver+editar` (editar implica ver; NO se juntan — el caso normal es ver-sin-editar). Rol = bundle de esas parejas; **override por persona** enciende/apaga una pareja suelta (patrón rol + grants/revokes, ya presente en `project_membership`). Capacidades peligrosas (borrar, membresías, facturación) bloqueadas/ocultas, fuera de la carta del cliente. **Dinero es su propia faceta y ahí lo sensible es el VER, no el editar.** Requisito duro: vista de "**permisos efectivos y de dónde salen**" (rol + overrides) — sin ella los overrides se pudren en el misterio de WordPress.
  5. **Organización = entidad; conversación anclada en org Y/O persona (al menos una).** Cubre: solo persona (freelance sin institución) · solo org (el Grec sin nombre aún — el "vacío" que Marco señaló) · las dos (Ana del Grec). **Persona↔org es una relación** (contextual, varias, con historia), no una columna en la persona — misma lógica que el rol/oficio. La persona es la cara; la org, el fondo que persiste.
  6. **Login solo para OPERADORES** (quien entra a operar en la herramienta). Contrapartes (programadores, teatros) NUNCA hacen login — son sujetos, reciben por link/email (ficha técnica, hoja de ruta). El operador (equipo propio, técnico que coordina por la herramienta) sí. **"Dar de alta"** = acto deliberado que cruza a un contacto de sujeto a operador; no automático. Se enlaza a la persona por INVITACIÓN; un alta fría que coincida por email NO se enlaza sola (seguridad). Enforce por **FLUJO/UX** ("invitar a operar" no existe en la ficha de un contacto de difusión), no por candado de tipo (no se reintroduce el tipado de personas). Consecuencia de negocio (Phase 1): contactos = datos gratis e ilimitados; operadores = plazas (seats), el eje de expansión.

- **Rechazado**:
  - *Tipo en la persona* (`person.kind`) — una persona es varias cosas a la vez y depende del contexto; el "qué es" se deduce de las relaciones que le apuntan.
  - *Un rol que fusiona oficio + acceso* — "lo que haces" y "lo que puedes ver" no van siempre juntos (sonidista freelance con crédito en convocatoria pero sin acceso al dinero; co-director con acceso sin oficio).
  - *Alcance dentro del rol* — a favor de "el alcance lo da el nivel donde asignas" (mismo rol ancho/estrecho por persona).
  - *Tipar conversaciones por dominio (Solución B)* — descartada de salida; solo se justificaría si un mismo contenedor mezclase dominios de verdad (no es el caso hoy).
  - *Roles componibles estilo WordPress delante del cliente* — el compositor de capacidades es power-user; para una compañía de teatro no técnica = no-uso + riesgo de fuga. Cliente = presets; composición = avanzado/Phase 1.
  - *Login para cualquier contacto / automático* — el programador nunca hace login.

- **Por qué**: el target es un EQUIPO (3-15 pers.), no un operador solo. El eje que importa no es "con quién hablas" (externo/interno) sino CONTEXTO (qué contenedor) × AUDIENCIA (rol/capacidad). Separar oficio (etiqueta sin poder) de acceso (poder, presets + overrides) mata las fugas. Visibilidad por contenedor + unión cubre "jefe ve todo / técnica ve lo suyo / road manager por bolo" con lo mínimo. Org-ancla llena el "vacío" de negociar sin nombre. Login-solo-operadores deja a las contrapartes como datos (base de la expansión por seats).

- **Abierto**: (1) nombre del oficio — *oficio* vs *perfil* (Marco cierra luego). (2) La capa de comms en sí (hilos sobre contenedores) — este ADR es su prerrequisito; sigue aparcada en `_notes/_flux.md § 2026-07-19` (las 3 formas: hilo polimórfico / puente-ingest / IA-generada).
- **Status**: **provisional — decidido en grill, SIN implementar.** No toca schema todavía. Este ADR es el mapa; construirlo es trabajo aparte.
- **Re-evaluate when**: al implementar (orden: identidad+oficio+membresía → roles/capacidades → org); o si un contenedor pasa a mezclar dominios de verdad → reabrir Solución B (tipado de conversación).

## [2026-07-19] — ADR-083 · Capa de comms — hilos sobre contenedores, sub-hilos = facetas, permisos de ADR-082 (resuelve el Abierto #2 de ADR-082)

> **ENMIENDA (2026-07-20)** — segunda vuelta del mismo grill, tras dibujar la capa (`_notes/spec-access-comms-decisions.md`, `app design/*.html`). Sigue SIN implementar y sin tocar schema.

- **1 · Una sola fórmula de audiencia — cae el §5.** La audiencia de cualquier hilo es `derived(facet, container) ∪ invited`. Vale igual para los hilos de faceta y para los libres: un hilo libre no tiene faceta, así que su conjunto derivado es vacío y queda solo la lista de invitados — que es exactamente el "participantes explícitos" del §5, sin mecanismo aparte. **Supera el reparto en dos modelos de audiencia del §5**; lo que allí eran dos reglas es un caso degenerado de una. Menos superficie, no más.
- **2 · Un invitat puede entrar en hilos de faceta, incluido Diners.** Marco levanta la restricción implícita de "solo hilos libres". No rompe la derivación: el invitado entra por el término `∪ invited`, el derivado sigue resolviéndose por permiso como siempre. El `invitat` (membresía sin login, con fecha de fin) se define en la enmienda de ADR-082; aquí solo importa que es un sumando de la audiencia, no una excepción a ella.
- **3 · Un hilo libre nunca hereda los invitados concedidos a nivel de faceta.** Siempre tiene su lista explícita propia. Es la única asimetría que sobrevive, y es deliberada: la herencia por faceta es lo que arrastraría a alguien de fuera a una conversación que nadie decidió darle.
- **4 · "Una sola lista para las tres cosas" (§4) ahora es literal — pero la lista es por nivel de contenedor.** Ordenar, ver y abrir siguen colgando de la misma lista de facetas; lo que cambia es que esa lista no es plana: qué facetas existen depende del nivel (espai / projecte / línia / bolo). Ver la enmienda de ADR-082 para la tabla y su regla de reversibilidad (filas, nunca código).
- **5 · `General` no es una faceta.** Es el hilo propio del contenedor: existe siempre y su audiencia son exactamente los miembros. Un "permiso de General" sería falso — no puede ser `res` para un miembro. Queda fuera de la tabla de facetas.
- **6 · La transparencia del §5 sobrevive en un sitio concreto: la línea de audiencia por hilo.** "Ho veuen 5 — per permís de logística", pegada al hilo, **nunca plegable**. Es donde hace falta la respuesta: justo antes de escribir. El roster completo de permisos pasa detrás de una puerta — se leen hilos cincuenta veces al día y se comprueba quién los ve tres veces al mes; esa frecuencia no justifica una columna permanente. La exigencia del §5 no se rebaja, se coloca.
- **7 · `Producció` queda FUERA de las facetas** (ver la enmienda de ADR-082 §5). Sobrevive como rol.


- **Abierto (añadido)**: ¿comms aparece en el Desk como quinta preocupación? Un run `MISSATGE` encaja en la gramática, pero pasar de 4 a 5 etiquetas cuesta calma y "todo lo no leído" convierte el Desk en una bandeja de entrada. Criterio propuesto si entra: **solo un mensaje que lleve una pregunta abierta dirigida a ti**.
- **Status de la enmienda**: **provisional — decidido en grill, SIN implementar.** El portón sigue en pie: usar la app una temporada real de difusión antes de construir nada de esto.

> **NAMING:** ver la nota de ADR-082 — la etiqueta se llama **rol** y el acceso **permisos**. Donde abajo diga «rol X abre sub-hilos», léase **permiso**.

> Continuación del mismo grill (2026-07-19), ya cerrado el modelo de acceso (ADR-082). Marco arrancó todo esto queriendo comunicación de equipo y por bolo (incl. "el día del bolo, un canal donde el equipo se habla"). Con el acceso decidido, media capa de comms cae sola: quién puede estar (operadores), quién ve (capacidades), participantes del bolo (derivables). Este ADR fija la FORMA; no toca schema.

- **Decisiones** (forma de comms, decidida en principio, SIN implementar):
  1. **Un solo mecanismo polimórfico.** Un "hilo" (cadena de mensajes) que cuelga de cualquier contenedor — bolo/performance, conversación de difusión, proyecto, compañía/workspace — igual que `task` ya es polimórfica. El log de difusión diseñado (`conversation_event`) pasa a ser "hilo colgado de una conversación"; el canal del bolo es "hilo colgado de un performance". **Supera** ADR-056/065 ("comms = timeline solo dentro de Contacts"), decidido cuando comms era solo difusión.
  2. **Asíncrono, estilo Slack, hub por contenedor.** No es chat en vivo (sin realtime/presencia/"está escribiendo"): persiste, se ordena, avisa. Cada contenedor = un hub. La jerarquía de contenedores (compañía → proyecto → bolo) ES la agrupación — no hay concepto separado de "canales". Realtime queda explícitamente FUERA.
  3. **Sub-hilos dentro de un contenedor = las FACETAS** (fijas, pocas: técnica / logística / dinero / general…) **+ sub-hilos "libres" con label definido** (mismo patrón que oficios/roles custom). El libre existe porque las compañías hablan de cosas que no encajan en ninguna faceta. (El caso road manager de ADR-082 EXIGE este nivel: dentro de un bolo, hilos separados por tema para poder gatear "road manager ve logística, no dinero".)
  4. **Permisos = los de ADR-082, sin sistema nuevo.** `ver | ver+editar` por sub-hilo (mismo eje); **"abrir/crear un sub-hilo" = una capacidad más** (gateada por rol — "el rol X abre sub-hilos, el técnico no"). La faceta hace **triple servicio**: ordena la conversación (sub-hilo), decide quién lo ve y quién lo abre. Una sola lista (la de facetas) para las tres cosas.
  5. **Audiencia — dos modelos según el tipo de hilo:**
     - **Fijos (faceta) → gateados por capacidad (automático).** Quién ve = derivado de la capacidad de la faceta + membresía del contenedor. Nadie se olvida; escala con los roles.
     - **Libres (ad-hoc) → participantes explícitos.** Sin faceta que los gatee, eliges quién entra al crearlo (por defecto: los del contenedor; se estrecha si se quiere).
     - **Transparencia para TODOS:** siempre se ve la lista resuelta ("esto lo ven estos N, por su rol") — el "veo quién entra" también en los automáticos. Es la "vista de permisos efectivos" de ADR-082 aplicada a hilos.
  6. **Difusión (hacia fuera) = puente, no host.** Programadores/teatros no son operadores (sin login, ADR-082) → se habla por email; Hour archiva vía BCC (ADR-028). Lo fuerza la regla de login, no es elección.
  7. **Canal automático del bolo (la chispa original) — no se "crea", EXISTE**, porque el bolo es un contenedor y todo contenedor tiene su hub con sus sub-hilos. Lo "automático" no es crearlo: es que Hour PROPONGA abrirlo / avisar a la crew asignada unos días antes (consent-first, ADR-069), no un blast solo. Participantes derivables del bolo (sus operadores asignados).

- **Rechazado**:
  - *Mecanismos separados* (log de difusión / chat de bolo / canal de compañía como tres sistemas) — a favor de uno polimórfico (visibilidad, participantes y archivado se escriben una vez).
  - *Chat en vivo* — compite con WhatsApp y pierde; mundo de construir (websockets, push) para 5 personas; el valor (lo hablado pegado al dato como memoria) el asíncrono lo da igual.
  - *Sub-hilos libres sin estructura (Slack puro)* — a favor de fijos=facetas + libre-con-label; los libres puros son el "¿en qué hilo escribo?".
  - *Audiencia explícita para TODO* (inversión que Marco propuso y descartamos juntos) — tira el modelo de roles, devuelve a gestión manual de accesos, y el peligro real en coordinación de bolo es quedarse CORTO (olvidar a alguien → se pierde info), no pasarse. Explícito se queda solo para los libres.

- **Por qué**: con el acceso ya decidido (ADR-082), comms es más pequeño de lo que parecía — enchufa en la misma máquina. Un mecanismo + hub por contenedor + sub-hilos=facetas reusa capacidades para ordenar, ver y abrir. El reparto de audiencia (auto para fijos, explícito para libres) coge lo bueno de cada uno: los fijos no se olvidan de nadie, los libres los controlas tú.

- **Abierto / diferido**: (1) **la lista de facetas** — ahora es la espina de TRES cosas (acceso + estructura de comms + permisos de comms); acertarla importa el triple. (2) Schema de hilo/mensaje. (3) Mecánica del ingest BCC (ADR-028). (4) Notificaciones. Realtime está descartado, no diferido.
- **Status**: **provisional — decidido en grill, SIN implementar.** Compañero de ADR-082; comms se apoya en el modelo de acceso. No toca schema. Resuelve el Abierto #2 de ADR-082.
- **Re-evaluate when**: al implementar (junto con ADR-082); si el asíncrono se queda corto (improbable); si los sub-hilos libres proliferan y hacen ruido.

## [2026-07-19] — ADR-084 · Cubo 2 del rediseño del Planner: bloques multi-día por serie, readiness explícito, vencimientos aparcados

> Cierre de las cuatro preguntas de modelo que quedaron abiertas al implementar el rediseño de las cards del Mes (Scope v2, Cubo 1). Marco decide; dos migraciones aditivas, sin backfill.

- **1 · Multi-día = N filas + `series_id`, no una fila con rango.** Un bloque de ensayos es una fila **por día**, todas compartiendo `date.series_id`. Aunque `date.ends_at` ya existía, una sola fila no puede decir lo que el dominio necesita: cada día tiene sus propias horas **y su propio estado**, porque se proponen cinco semanas y se confirman dos. `ends_at` conserva su función real (hora de fin *dentro* del día). El Planner pinta las filas consecutivas de una serie como una banda: el bloque es un *render* de las filas, nunca una entidad — nada que sincronizar, nada que caduque. Creación: una acción crea la semana entera de golpe (N filas, mismo `series_id`). Migración `2026-07-19_date_series.sql`.
- **2 · Vencimientos: APARCADO.** Se propuso proyectar sobre el Planner las tareas con `task.due_at` (que ya existe, sin schema nuevo). Marco: **las tareas no salen en el calendario, por ahora no** — "al menos no las tareas como tal". No se construye nada. Si el vencimiento vuelve a hacer falta, se replantea la forma antes que la implementación.
- **3 · El `✓` de logística son flags explícitos.** `performance.readiness jsonb` (`{"hotel":true,…}`), marcado por el operador. Descartado derivarlo de si hay texto en `logistics`/`technical`: mentiría en ambos sentidos (una nota "hotel: pendent" se leería como hecho). Un jsonb y no una columna por ítem, porque la lista crecerá (visa, transporte, contrato) y añadir uno no debe costar migración; el vocabulario de claves vive en `$lib/performance.ts`, igual que el de estados. Migración `2026-07-19_performance_readiness.sql`.
- **4 · Las fechas siguen naciendo tentativas.** Se propuso invertir el default a `confirmed` dejando lo tentativo explícito. **Rechazado por Marco:** las fechas nacen tentativas. Es coherente con §1 — primero se propone, después se confirma. `date_status DEFAULT 'tentative'` sin tocar.

- **Por qué**: las cuatro eran justamente las preguntas que tocaban schema, y por eso se separaron del reskin visual (Cubo 1). Las dos que sobreviven son aditivas y no requieren backfill: `series_id` NULL = fecha suelta, que es lo que son todas las filas existentes.
- **Status**: **APLICADO en producción 2026-07-20** (Marco autorizó explícitamente; verificado contra la base viva: 0 de 21 fechas y 0 de 29 performances tocadas). Migraciones: `date_series`, `performance_readiness`, `create_date_series` (RPC atómica), `workspace_booking_mode` (CHECK) y `update_workspace_booking_mode`. Construido encima: ticks de readiness (mostrar + marcar), banda multi-día en el Mes, rango horario, `BlockForm` con la regla de días. **Sin desplegar** — todo en la rama `feat/planner-mes-cards`.
- **Añadido durante la implementación (§5) — `booking_mode` de ADR-002, que estaba decidido y nunca construido.** Al preguntar Marco por qué la card decía "1st hold", el escaneo encontró que `settings.booking_mode ∈ {simple, prioritized}` se decidió con el enum de estados y no existía en código: la UI enseñaba el rango en todos los espacios, incluidos los de teatro que no llevan cola de prioridad. Ahora el rango solo se dice donde la convención es de prioridad; el estado guardado **no se reescribe** (una workspace que pase a `prioritized` recupera sus rangos intactos), y el modo se resuelve **por card** porque el Planner muestra varias workspaces a la vez.
- **Re-evaluate when**: si aparece un vencimiento que no es tarea de nadie (§2); si la lista de readiness crece hasta pedir entidad propia (§3); si crear fechas una a una y confirmarlas se vuelve trabajo pesado (§4).
- **Abierto**: revisar si usar `custom_fields` como vía de escape (precedente `season`) está bien hecho o es deuda — encargo de Marco, cuestión de método, independiente de esta feature.

- **Correcciones de Marco al probarlo (2026-07-20, mismo día):**
  1. **Un bloque es CARDINALIDAD, no un tipo.** Se construyó como pastilla «Block» con un selector de tipo dentro — la misma pregunta dos veces, y una taxonomía donde «bloque» convivía con «ensayo» como si fueran comparables. No lo son: uno es *qué es*, el otro *cuántos días dura*. La pastilla vuelve a ser el tipo y «varios días» es una casilla dentro del formulario de fecha. `BlockForm` desapareció; quedó `BlockDays`, un panel que solo responde «qué días».
  2. **Por defecto los siete días, no de lunes a viernes.** El default salió de copiar el ejemplo del mock; una compañía de artes escénicas trabaja fines de semana y una regla que los quita en silencio empieza equivocada. Estrechar es el acto deliberado.
  3. **La unidad es la SESIÓN, no el día — guard de una-fila-por-día ELIMINADO.** Un día de ensayo tiene mañana y tarde y se confirman por separado. El guard existía para proteger la banda, pero nunca la rompía: los bordes se derivan por pertenencia del DÍA, y el día sigue perteneciendo. Migración `2026-07-20_date_series_allow_multiple_slots.sql`.
  4. **Que una card sea pequeña no decide qué existe.** Regla de visualización, de Marco: un bolo → su hora; **dos funciones distintas el mismo día → los dos nombres y las dos horas, siempre** (nunca se colapsan); varias sesiones de *lo mismo* → primera hora + contador `+N`, y el hover lleva todas. Lo que separa los dos casos no es cuántas hay, es **si son la misma cosa**.
  5. **El horario interno del bolo no es un problema**: que el mes enseñe solo la hora de función es correcto — las cinco franjas de ADR-023 existen para el road sheet. Lo que sí falta es poder **añadir tipos de franja** (ver `_tasks.md`).

- **Status (reconciliación 2026-07-20)**: el código dejó de estar sin desplegar — los 29 commits de planner+identidad se reconciliaron sobre `main` en `feat/planner-identity`, separados de la capa de comms con la que compartían rama pero **ningún fichero**. Las cinco migraciones de este ADR (`date_series`, `performance_readiness`, `create_date_series` + los dos `CREATE OR REPLACE` posteriores, `workspace_booking_mode`, `update_workspace_booking_mode`) estaban **ya vivas en producción y absorbidas en el checkpoint de `main`**: se verificó contra la base viva (`date.series_id`, `project.initials`, `performance.readiness`, `workspace.settings->>'booking_mode'`, RPC `create_date_series`). No se traen a `build/migrations/` para no dejar SQL re-aplicable en el árbol; su historia está en el checkpoint. **Nota de arqueología**: la rama `feat/planner-mes-cards` que cita el Status anterior ya no existe como nombre (era un duplicado exacto de `feat/identity-monogram`); sus commits están en `main`.

## [2026-07-20] — ADR-085 · El invitat: membresía sin login, y delegación acotada por el delegante

> Continuación del grill de ADR-082/083, reabierto 2026-07-19/20 al dibujar la página de bolo. El disparador fue un accidente de diseño: la segunda pasada inventó un contacto de la sala participando en un hilo por link firmado, y Marco lo tomó como buena idea en vez de como error. Eso obligó a mirar qué separaba realmente "dentro" de "fuera" y a cerrar quién puede meter a quién. Registro de trabajo completo: `_notes/spec-access-comms-decisions.md` §3-§4 (fichero de staging, borrable una vez plegado aquí).

- **Decisiones** (decididas en grill, SIN implementar):
  1. **El `invitat` es una membresía con permisos, menos el login, más una fecha de fin.** No es un mecanismo nuevo: mismos contenedores, mismas facetas, mismo eje `res | veure | veure+editar`. Lo único que cambia es `login = no` + `ends_at`. Cuarto término del vocabulario de ADR-082, junto a rol / permisos / operador.
  2. **No debilita ADR-082 §6, lo hace literal.** *"Login solo para operadores"* sigue siendo cierto palabra por palabra. Lo que cae es el supuesto tácito que iba pegado —que **estar dentro exigía login**—, y que nunca se decidió: se asumió. El muro nunca fue la membresía; el muro es el login y la plaza.
  3. **Se llega por link firmado. Sin cuenta. No consume seat.** El modelo de negocio de Phase 1 (contactos gratis e ilimitados, operadores = plazas) queda intacto.
  4. **Escribe y es parte del hilo**, no espectador. **Ve el historial completo** de los hilos en los que está, incluidos los mensajes anteriores a su invitación: un sub-hilo es *una* conversación, y el historial parcial fabrica referencias a cosas que no puedes ver.
  5. **Se invita a FACETAS de un contenedor, no a hilos sueltos** — así los hilos futuros de esas facetas ya lo incluyen. **Un hilo libre NO hereda los invitados de las facetas**: un hilo libre tiene siempre su lista explícita.
  6. **Puede invitarse a hilos de faceta, Diners incluido.** Marco levantó la restricción anterior ("solo hilos libres"). No rompe la derivación de audiencia: la audiencia pasa a ser `derived(faceta, contenedor) ∪ invitats`, **una sola fórmula para los dos tipos de hilo**, donde el `derived` de un hilo libre es el conjunto vacío. **Es más simple que la versión de dos mecanismos que sustituye** (ADR-083 §5, que enunciaba dos modelos de audiencia según el tipo de hilo).
  7. **Revocar no es borrar.** Lo que escribió un invitado se queda en el hilo: es el registro de la compañía.
  8. **Acaba con la cosa, no con un reloj.** La invitación lleva siempre un final: por defecto derivado del contenedor cuando el contenedor tiene fecha (pasa el bolo → se cierra el acceso, con un margen de semanas para la cola de factura/fotos), elegido explícitamente cuando no la tiene (un hilo libre de proyecto). Revocable a mano en cualquier momento. **Rompe con el precedente de la casa** — `roadsheet_share` tiene `revoked_at` y no `expires_at` — deliberadamente: un documento de una dirección que envejece hasta la irrelevancia no es el mismo riesgo que un canal de escritura vivo desde una URL sin autenticar.
  9. **Siempre visible** en el "quién entra y por qué", con quién lo invitó y cuándo.
  10. **Delegación acotada por el delegante: solo puedes dar lo que tienes**, en los tres ejes — **faceta** (no puedes dar una faceta que no tienes), **verbo** (con `veure` no puedes dar `veure+editar`), **nivel** (tu nivel o más estrecho, nunca más ancho).
  11. **Lo que tienes es el TECHO, nunca el DEFAULT.** El default de cualquier invitación es el preset mínimo; cada faceta por encima se enciende a mano. Un invitado *puede* acabar viendo el caché — nunca por herencia, solo porque alguien que tiene Diners lo dio deliberadamente, con línea de confirmación explícita ("estàs donant la conversa econòmica a algú de fora de la companyia").
  12. **"Invitar" desaparece como capacidad separada.** La regla del techo la sustituye: un admin lo tiene todo, luego puede dar todo; una road manager delega dentro de lo suyo. Una regla en vez de dos, y el caso de las 8 de la mañana sobrevive — puede meter al técnico de la sala en Tècnica/Logística porque las tiene, y no puede meter a nadie en Diners porque no la tiene.

- **Rechazado**:
  - *Que el invitado solo pudiera entrar a hilos libres* — Marco lo levantó; la fórmula unificada de audiencia (§6) sale más barata que mantener dos mecanismos para evitar un caso que de todas formas hay que poder autorizar a mano.
  - *Invitado como espectador* (solo lectura por link) — si está en el hilo, está en la conversación; media presencia obliga a explicar por qué unos mensajes no se pueden responder.
  - *Historial parcial desde la fecha de invitación* — produce referencias huérfanas dentro de una misma conversación.
  - *Borrar lo escrito al revocar* — el registro es de la compañía, no del invitado.
  - *Invitación sin caducidad, siguiendo `roadsheet_share`* — ver §8; el precedente se rompe a propósito.
  - *Herencia de facetas al invitar "al bolo"* — Marco se negó a firmar un modelo donde invitar a alguien a un bolo pudiera arrastrar Diners.
  - *Una capacidad "invitar" gateada por permisos* — redundante con §10 (§12).
  - *Acotar la CANTIDAD de invitados* — quien tiene acceso ancho puede crear muchos. Con caducidad y roster visible, se acepta para una compañía de 3-15 personas. **No construir para esto.**

- **Por qué**: el modelo de ADR-082 confundía dos cosas distintas bajo una sola frontera — quién paga plaza y quién puede estar en una conversación. Separarlas cuesta un campo (`ends_at`) y un modo de acceso (link firmado), y a cambio hace representable lo que la coordinación de un bolo hace de verdad: a las 8 de la mañana el técnico de la sala está dentro de Tècnica y de Logística, no fuera con una copia PDF. La fórmula única de audiencia es el dividendo real: el `invitat` no añade un segundo camino de resolución, colapsa los dos que había en uno. Y la delegación acotada por el delegante es la única regla que hace segura la apertura: nadie puede filtrar hacia fuera lo que no ve hacia dentro, y como el default es el mínimo, la fuga por descuido no existe — solo la fuga deliberada, que es la que se puede confirmar por pantalla.

- **Abierto**: (1) **Revocar no tiene pantalla** — un operador deja de serlo al final de una gira: el acceso se cierra, la persona vuelve a contacto, todo lo que escribió se queda. Nadie lo ha diseñado; es la otra mitad de "dar de alta", y aplica igual a operadores y a invitados. (2) **Si `roadsheet_share` debe adoptar la regla de caducidad del invitado** — abierto, no ahora. (3) Schema: ni el `ends_at`, ni el link firmado, ni el nivel de contenedor existen; recuérdese que `has_permission` solo toma `project_id` y que no hay membresía de workspace/línia/performance — **la dimensión de nivel es el coste de construcción entero**. (4) La línea de audiencia por hilo ("Ho veuen 5 — per permís de logística") es lo que sostiene la transparencia de ADR-083 §5 cuando el roster pasa a estar detrás de una puerta: **no puede plegarse nunca**.
- **Status**: **provisional — decidido en grill, SIN implementar. Cero schema tocado.** Amplía ADR-082 (§2 el invitado como cuarto término; §6 aclarado, no revocado) y supera ADR-083 §5 (dos modelos de audiencia → una fórmula). **Sigue en pie el gate duro: usar la app durante una temporada real de difusión antes de construir nada de esto.**
- **Status (2026-07-20, tarde)**: Marco decide construir **hilos CON facetas** como primera vuelta, en vez de la rebanada fina sin facetas que se le propuso. Asumido a sabiendas: la tabla de facetas se construye antes de la temporada que debía validarla, y lo que lo hace tolerable es que la lista es **datos, no código** — corregirla es un `UPDATE`. Trabajo en rama aparte de la sesión paralela.
- **Re-evaluate when**: al implementar, junto con ADR-082/083 (orden: nivel de contenedor → invitat → link firmado); si aparece un invitado que necesita volver temporada tras temporada y la caducidad se vuelve fricción en vez de garantía; si el roster de invitados de una compañía crece hasta pedir gestión propia (hoy explícitamente no se construye para ello); si al diseñar la pantalla de revocar se descubre que operador e invitado no comparten la misma salida.

---

> **ADR-082/083/085 son canon aquí, y su implementación está bloqueada.** El
> pensamiento vive en `main` desde el 2026-07-20; lo que sigue fuera es solo el
> material de construcción: la migración `2026-07-20_comms_threads_and_membership.sql`
> (604 líneas, **sin aplicar**) y los 7 prototipos de `app design/`, ambos en la rama
> `feat/comms-threads`. Se dejaron fuera a propósito — SQL re-aplicable en el árbol
> invita al error, y los prototipos no entran en el build. Los dos bloqueantes de
> arquitectura están en `_tasks.md § Bloqueado`. El siguiente ADR nuevo es **087**.

## [2026-07-21] — ADR-086 · Money v3: el dinero deja de girar alrededor de la factura

> Estructura decidida en grill con Marco 2026-07-21. **NO implementado; diseño y
> build pendientes.** Detalle estructural completo, delta de schema y sección de
> futuro en `_notes/spec-money-v3-decisions.md`. Empezó como "cerrar identidad
> fiscal" (gap #3 de contenedores) y creció a un rediseño del dinero.

- **Decisión** (seis piezas):
  1. **Factura = módulo por espacio** (`workspace.settings.invoicing_mode` ∈
     off/interno/legal). Legal = **Factura**, interno = **Proforma**.
  2. **Identidad fiscal = tabla propia `fiscal_identity`** con dueño blando
     (cuenta por defecto, workspace override), congelada como snapshot en la
     factura. Dirección estructurada, IBAN+SWIFT. **Refina ADR-062.**
  3. **El dinero es el suelo, facturar es opcional encima.** `payment` se
     desacopla de `invoice`; el fee del bolo es el ancla; "cobrado" se deriva de
     pagos contra el fee. **Invierte la derivación de cobro de money v2 (ADR-074)**
     — por eso es v3.
  4. **Tamaño A ahora, B-ready por una espina estrecha** (scope·contraparte·
     categoría nullable). No se construye B (dinero a artistas, P&L). Guardia
     anti-sobre-construcción escrita en el spec.
  5. **Numeración auto-correlativa** en los dos modos, dos series separadas
     (Factura por `fiscal_identity`+año; Proforma por workspace+año), al emitir.
  6. **El receptor reutiliza `fiscal_identity`** (workspace-owned); la factura
     enlaza y congela emisor+receptor; difiere la entidad `organization` (gap #1).

- **Frontera de producto (gate)**: money v3 reabre en parte la frontera de
  `_context.md` ("Hour no es la gestoría"). El tamaño A es libro de dinero, no
  compliance; el tamaño B (nómina/intermittents, cierre) es otro producto y no se
  construye sin señal de uso real.

- **Futuro forward-compat (no build, nada puede cerrarlo)**: enlace fiscal entre
  empresas con consentimiento (patrón `person`/`workspace_person`); lo habilitan
  el dueño-blando de `fiscal_identity` + el snapshot de la factura.

- **Abierto**: (1) el **diseño** — house-style del PDF de factura/proforma,
  formularios de identidad fiscal, cambios de UI de Money; Marco lo hace en frío.
  (2) El **build** — delta de schema en el spec; backup/preflight + RLS
  proporcionales (payment/invoice, ~11 políticas de dinero).

- **Status**: **estructura cerrada, NO implementado.** Va **primero, antes de la
  revisión de contenedores** (el campo "identidad fiscal" de la portada queda
  absorbido aquí). El PDF "casi ya" lo pone en camino crítico. Sujeto a una
  lectura en frío de Marco; si cambia una pieza estructural se añade Status
  (append-only).

- **Re-evaluate when**: aparezca señal de uso real que pida el tamaño B; el enlace
  fiscal entre empresas se vuelva demanda; o la dirección estructurada necesite
  automatización (e-invoice Facturae/EN-16931).

- **Status 2026-07-23 — diseño + build implementados (local), no desplegados.**
  El **diseño** (Parts A/B/C) es código *presentational* en rutas dev
  (`/dev/invoice`, `/dev/facturacio`, `/dev/money`). El **build** son 5
  migraciones aditivas en `feat/money-v3-build`, **no-breaking** con la Money v2
  viva (RPCs extendidos solo con params opcionales al final; la derivación
  cobrado-vs-fee se añade junto a la de v2, no la sustituye todavía). Verificado
  en Supabase local: sin drift, `svelte-check` 0/0, unit 348/348, RLS 126/126
  (120 v2 + 6 v3), y una review adversarial de las migraciones (11 hallazgos
  confirmados, todos corregidos, incl. una escalada RLS de payment). Falta,
  gateado: staging/prod con backup/preflight, y el wire de `/h/money` al modelo
  v3 (que completa la inversión de ADR-074). No cambia ninguna pieza estructural
  de este ADR.

## [2026-07-23] — ADR-087 · El bolo es la unidad de dinero: conversación → bolo → función; money v3 se re-ancla del `performance` al `bolo`

> Cerrado en grill con Marco 2026-07-23, al wire-ar la lente Money. El propio
> grill destapó que el dinero de money v3 está anclado un nivel demasiado bajo.

- **Decisión (modelo):** el **bolo** (el trato con una sala) es la unidad de
  dinero, no la función. Esqueleto:
  - **Conversación** (difusión) → 1:N **Bolo**.
  - **Bolo** (trato: **una sala · caché · documento · cobrado · pendiente**) →
    1:N **Función** (`performance`).
  - **Función** = día · hora · road sheet · agenda. **No lleva dinero.**
  - El caché se negocia **por bolo** (Marco: "por bolo"), no por función; un
    bolo puede ser 1..N funciones (dos el sábado, una el domingo).
  - El bolo nace de una conversación confirmada **o** se crea a mano (opción c).

- **Qué muestra la lente Money (deriva del modelo):** arriba, la **posición
  general** (por moneda: pipeline · cobrado · **pendiente**); cuerpo = **bolos
  agrupados por obra** (nunca por línia); cada cabecera de obra lleva
  contratado · cobrado · pendiente; el **documento vive en el bolo** (chip que
  abre el PDF), no en una sección aparte; las funciones son sub-detalle del bolo
  (o solo en Planner). Se estrecha por pins (space/project/line). El "libro"
  aparece al bajar; ancho = agregado. **`pendiente = contratado (confirmado) −
  cobrado`**, con independencia de si hay factura.

- **Vocabulario:** `performance` **deja de ser "bolo/función atómica"** — se
  parte: `performance` = **función**; el **bolo** es entidad nueva. Refina
  `structure-model.md` (lo importante en Money es el bolo, la línia no agrega
  dinero).

- **Implementación elegida — P2 (padre nuevo), no P1 (promover):** se añade una
  entidad **`bolo`** por encima de `performance`; el **dinero sube al bolo**
  (caché, pago, factura, cobrado); `performance` se queda como la función
  (`bolo_id` FK; conserva `performed_at`, slots ADR-023, road sheet, planner).
  Backfill: cada `performance` existente → un bolo de N=1 (hereda venue/caché/
  proyecto/conversación; la función conserva fecha/agenda + recibe `bolo_id`).
  - **Rationale P2 sobre P1:** el scheduling (road sheet, planner, MonthGrid,
    slots) es **maduro, testeado y desplegado** (RLS 120/120, E2E 27/27); money
    v3 es **nuevo, sin desplegar, en rama `feat/money-v3-build`, sin mergear**.
    Disrupter el dinero (controlado, fuera de prod) es más barato y seguro que
    disrupter el scheduling. P2 es además más limpio: `performance` sigue siendo
    la función atómica que ya es.

- **Supersede / refina / absorbe:** **refina ADR-086** (el ancla de money v3
  pasa de `performance` a `bolo`: `fee_amount/currency` → `bolo`; `payment` y
  `invoice_line` referencian el bolo; `collected` = pagos-vs-caché-del-bolo;
  `list_money_performances` → una lista por bolo). **Absorbe** la tarea pendiente
  "multi-día para performances" (`series_id`): las varias funciones de un bolo
  la resuelven. **Refina** la vocab de `_context.md`/`structure-model.md`.

- **Blast-radius (P2, para el build):** *sube al bolo* — `performance.fee_amount/
  fee_currency/venue_name/city/country/conversation_id`, `create_invoice`,
  `issue_invoice`, `create_payment` (ancla), `create_expense` (ancla gig),
  `list_money_performances` (+`collected`), `update_performance_fee`,
  `invoice_line.performance_id`, `payment.performance_id`, y la UI `/h/money` +
  `MoneyModule` + `MoneyInvoices` + `RecordPaymentDialog` + `money.ts`/
  `moneybook.ts`/`invoice.ts`. *No se toca* — road sheet
  (`performance-bundle.ts`, `roadsheet`, `rosters`), `dates`, `planner`,
  `MonthGrid`, la agenda de `performance`.

- **Status:** **decidido, NO construido.** Gate: re-anclar money v3 al bolo
  **antes** de desplegarlo (nunca desplegar el ancla-por-función). Se construye
  sobre la rama `feat/money-v3-build` (revisando sus 5 migraciones sin desplegar,
  no añadiendo una capa encima). Prompt de handoff en
  `_notes/build-prompt-bolo-money-v3.md`.

- **Re-evaluate when:** aparezca un caché genuinamente por-función (una sala que
  paga por show, no por trato) — el bolo podría necesitar sub-importes por
  función; o un bolo multi-sala (un promotor contrata varias salas en un trato).
  Hoy: un bolo = una sala, un caché.

- **Status 2026-07-23 — re-ancla implementada (local), no desplegada.** Sobre
  `feat/money-v3-build`, revisando las 5 migraciones de money v3 (no una capa
  encima): nueva migración `20260722102000_money_v3_bolo.sql` (entidad `bolo`,
  `performance.bolo_id`, backfill N=1, caché fuera del `performance`) + las de
  invoice/payment revisadas al bolo. **Dinero al bolo:** `fee_amount/currency`,
  `payment.bolo_id`, `invoice_line.bolo_id`, y **también `expense.bolo_id`**
  (gasto de gig → bolo, resolviendo el "o a la función — decide" del blast-radius:
  el income es del trato y el coste también cuelga del bolo/línia; ninguna
  superficie de scheduling lee gastos por-función, así que no la toca).
  `list_money_performances` → `list_money_bolos`; `create_invoice` →
  `create_invoice_from_bolo`; `update_performance_fee` → `update_bolo_fee`;
  `create_bolo`/`delete_bolo` nuevos. Se **retiran** la vista
  `performance_redacted` y el trigger `guard_performance_fee_columns` (el gate
  `edit:money` del caché ahora vive en `update_bolo_fee`). Verificado en local:
  drift limpio, `svelte-check` 0/0, unit 357, RLS 127, build verde; review
  adversarial (4 lentes + verify) con 9 hallazgos corregidos, incl. una escalada
  RLS en `create_payment` (invoice+ancla ahora rechazado). **Abierto (no
  bloquea):** una función creada en Planner nace **sin** `bolo_id` — falta la UX
  de crear/enlazar deal↔funciones (hoy: `New deal` a mano en la lente + el
  backfill). No cambia el modelo de este ADR.

## ADR-088 — Grill 2026-07-23: las 4 lentes, Books, y el impuesto como adaptador de país

- **Contexto.** Sesión `/grill-me` sobre las tres dudas de Marco: (A) ¿son 4 las
  vistas, ni más ni menos?; (B) ¿son los nombres correctos y coherentes entre sí?;
  (C) ¿mostramos lo necesario? Foco: **Money**, la lente que menos convence (es la
  parte de artes escénicas que Marco nunca ha operado; el dinero se externaliza
  pronto a una gestoría, pero la titularidad es de la compañía). Detalle y fuentes
  (terminología del gremio, Verifactu ES, factura electrónica FR) en
  `_notes/grill-2026-07-23-lentes-y-money-books.md`. Refina ADR-065 (lens set),
  ADR-085 (facetas/escaleras), ADR-086 (money v3), ADR-087 (el bolo es el dinero).

- **A — Cuatro, ni más ni menos = 1 digest + 3 lentes.** *Más no:* difusión es una
  **persona** que cruza lentes (default-landing por rol), no un concern; los assets
  son acceso rápido (⌘K) + readiness (Desk) + entrar al contenedor, no una lente
  ("es un archivo" = almacenamiento, no dominio). *Menos no:* Money sobrevive como
  **costura de extensibilidad** (una lente empieza fina y profundiza sin tocar la
  nav), no por uso diario. **Desk no es una lente-par** — es el digest cross-concern;
  gana **pill propio** y sale del segmented "view as", que queda con las 3 lentes.

- **B — Fitness, no simetría.** Un nombre no debe *mentir* sobre su contenido (por
  eso muere "Fiscal" = palabra del gestor, y "Numbers" = deja de decir dinero y se
  necesita para una futura lente de datos). Desk · Planner · Conversations se
  quedan. **Money → concepto `accounts`; etiquetas EN `Books` · ES `Cuentas` ·
  FR/CA `Comptes`** — se traduce el *idiom* ("do the books / echar cuentas / faire
  les comptes"), no la palabra. La ruta física `/h/money` se conserva (rename a
  `accounts` = pase mecánico diferido; el usuario nunca ve la ruta).

- **C — Books se organiza alrededor del bolo.** Spine = filas de bolos, no
  secciones-tipo. Cabecera por moneda: **Vendido (Σ bruto)** lidera, luego Cobrado,
  y **Pendiente/Vencido** (owed — la cifra-acción, derivada de facturas emitidas sin
  cobrar vía aging) como número de acción; pipeline (holds) demovido. Neto-tras-tasas
  por bolo como compañero del bruto. Vencido → tarea a Desk. Entidad: `bolo` = 1 sala
  + 1 contrato + 1 fee/pagador/factura, 1..N funciones; discriminador "cambia el
  dinero o la sala → otro bolo"; **gira = `line.kind`, no un nivel** (una gira exige
  ≥3 municipios; un bolo de 2 funciones no lo es).

- **Alcance de la factura (proforma, no emisión legal).** Emitir la factura es
  trabajo de la compañía, pero hacerlo *desde Hour* la convierte en "software de
  facturación" → **Verifactu (ES, 2027, multa ≤50k€) / Factur-X·Chorus Pro (FR,
  2026-2027)**. Books llega hasta **proforma + radar de cobro + handoff** y **se para
  antes** de la emisión certificada: esa última milla es por-país y diferida.

- **El impuesto como adaptador de país (la decisión estructural).** El fiscal es
  *inherentemente* por-país (España IVA/IRPF ≠ Francia TVA multi-tipo). El eje de
  variación es cierto y con nombre → costura debida, pero como **frontera de datos,
  no framework**: (1) **núcleo universal, agnóstico de impuestos** — el bolo/fee/
  cobro no saben de fiscal; (2) **impuesto genérico** = tabla `invoice_tax_line`
  con `kind ∈ {add, withhold, exempt}`, tipo con signo, `total = subtotal + Σ`;
  la factura snapshotea su `country`; (3) el **preset** (qué líneas aplican) vive en
  la capa app, **solo España relleno** (`esTaxLines`: IVA add + IRPF withhold; exento
  con motivo para intracomunitario/export). Francia = otro preset + su emisión legal,
  **cero migración del núcleo**. Se **quitan** las columnas hardcodeadas
  `vat_pct/vat_amount/irpf_pct/irpf_amount` de `invoice`.

- **Status 2026-07-23 — implementado (local, no desplegado), plegado dentro de
  money-v3.** Sobre `feat/money-v3-build`: nueva migración
  `20260722104200_money_v3_invoice_tax.sql` (invoice.country, drop vat/irpf, tabla
  `invoice_tax_line` con RLS clon de `invoice_line`); `create_invoice_from_bolo`
  reescrita a `p_tax_lines jsonb` + `p_country` (núcleo firma+suma, cero IVA/IRPF);
  `db-types.ts` regenerado (diff quirúrgico); `money.ts` (`applyTaxLines`/`esTaxLines`;
  `MoneyInvoiceItem` sin vat/irpf, con country+tax_lines); vista `/h/money`
  (cabecera Vendido→Pendiente/Vencido vía aging, neto por bolo, diálogo vía preset);
  `MoneyInvoices` (render de tax_lines); APIs `/api/invoices` (+`[id]`); i18n
  Books/Cuentas/Comptes + `books.*`; `LensSwitcher` (Desk pill + 3 lentes).
  **Verificado local:** `db:reset` OK (migración+objetos confirmados en DB local:
  `invoice_tax_line` RLS force, `invoice.country` sí / `vat_pct` no, `v_country`
  assigned); `svelte-check` **0/0** (1825 ficheros); unit **368/368** (incl. tests de
  `applyTaxLines`/`esTaxLines` + regresión de redondeo). **Review adversarial**
  (4 dim × find+verify): 4 bugs reales cazados y corregidos — `v_country` NULL,
  redondeo TS≠SQL (1 cént IRPF), doble-conteo Cobrado/owed, `docs[0]` sin orden.
  **RLS pendiente:** la suite `test:rls` apunta vía `.env.test` a la DB **hosted v2**
  (los RPC de money-v3 → 404 allí) y `db:reset` local no siembra fixtures/usuarios;
  las 5 fallas son mismatch de entorno, no del cambio (p.ej. `payment.test` peta en un
  `list` *antes* de llamar al RPC editado). La suite RLS se valida en el entorno
  hosted-v3 (baseline CI); la policy de `invoice_tax_line` es clon fiel de
  `invoice_line`. **Follow-ups deliberados:** `InvoiceDocument.svelte`/`invoice.ts`
  (PDF imprimible) siguen con IVA/IRPF local — a tax_lines cuando se cablee a datos;
  UI de preset por-país (hoy inputs IVA/IRPF = preset ES); rename físico `accounts`.

## ADR-089 — El viaje es un trayecto multi-etapa: origen → destino + tramos, con documentos por tramo

- **Contexto.** Sesión 2026-07-23. El modelo trata el viaje (`date` con
  `kind='travel_day'`) como **una sola ciudad + `travel_direction`**
  (outbound/return/leg): `travelText` solo puede decir `→ Sevilla`, nunca
  `Barcelona → Sevilla` — el origen no existe como dato. Marco: un viaje tiene
  **origen y destino** (donde empieza y donde acaba) y **etapas multimodales** en
  medio (avión → taxi → metro), y **cada tramo debe aceptar documentos** (billete
  de avión en PDF, subible y descargable). Elegido en frío entre tres formas
  (solo extremos / etapas en JSON / **tabla completa**) → gana la tabla completa,
  con los 9 modos. Refina ADR-072 (hold grammar + `travel_direction`), ADR-078
  (dates y `awayBands()`), ADR-023 (road sheet), ADR-056 (materials/R2).

- **Decisión — viaje = extremos gruesos + tabla de tramos.**
  - **Extremos en `date`** (lo que pinta el card): `origin_city`,
    `origin_country`, `destination_city`, `destination_country`. Baratos y
    siempre presentes aunque el viaje no tenga desglose; el card muestra
    `origin → destination` (fallback a `city`/dirección para filas viejas).
  - **`travel_direction` se queda**: sigue alimentando `awayBands()` (ADR-078
    §6), así no se rompen los tramos "fuera". **Deuda anotada:** reconciliar
    dirección↔extremos (derivar la dirección desde los extremos + una base de la
    compañía) queda para después; hoy coexisten, el card usa extremos y away usa
    dirección.
  - **Tramos** — tabla `travel_stage` (1:N por viaje), la logística fina del road
    sheet, **opcional** (un viaje puede ser solo `A → B` sin desglose):
    `position`, `mode`, `from_city/from_country/from_place`,
    `to_city/to_country/to_place`, `depart_at`, `arrive_at`, `reference`, `notes`.
    `*_place` = aeropuerto/estación/hotel.

- **`transport_mode`** (enum nuevo) = `plane · train · bus · car · taxi · metro ·
  walk · ferry · other` — los cuatro grupos de Marco: básicos (avión/tren/bus/
  coche), urbanos/última milla (taxi/metro/a pie), marítimos (ferry), genérico.

- **Documentos por tramo — hallazgo y diferimiento (P3).** Cada tramo lleva 1..N
  documentos. **Hallazgo:** el bucket R2 `MEDIA` (`hour-media`) está **declarado**
  (`wrangler.jsonc`, `app.d.ts`) pero **sin una sola línea de uso** — Hour no tiene
  pipeline de subida/descarga real (materials y `expense.receipt_url` solo guardan
  una URL ya formada; ADR-056 "upload arrives with R2 UI", sin construir). Por
  tanto "documentos descargables por tramo" implica construir el **primer pipeline
  de archivos** de la app: upload→R2 con key scoped por workspace, download con
  auth + **RLS** (solo miembros del workspace), límites de mime/tamaño, bucket
  nunca público. Es **fundacional y reutilizable** (riders, fichas técnicas,
  recibos de gasto). Tabla `travel_stage_document` (`travel_stage_id`,
  `object_key`, `filename`, `mime`, `size_bytes`, `uploaded_by`). **Se difiere**
  a un bloque posterior; el modelo va primero ("modelo primero", Marco).

- **Postura de seguridad — clon de `date`/`bolo` (ADR-087).** `travel_stage`:
  RLS `ENABLE` + `FORCE`; `REVOKE ALL FROM PUBLIC, anon, service_role`; SELECT
  policy `has_permission(project_id, 'read:performance')` (el tramo hereda el
  proyecto del viaje); **escritura solo por RPCs SECURITY DEFINER**
  `create_travel_stage` / `update_travel_stage` / `delete_travel_stage`
  (+ reorder), gateados `edit:performance`; triggers `set_updated_at` +
  `write_audit`; FK `date_id → date ON DELETE CASCADE`, índices en `date_id`,
  `(date_id, position)`, `workspace_id`. Los **extremos de `date`** se escriben
  **extendiendo** `create_date` / `update_date` / `create_date_series` con
  params `origin/destination` (DROP+CREATE por cambio de firma, como el resto de
  money v3).

- **Alcance y secuencia.** **P1 (este ADR):** schema del modelo — enum, columnas
  en `date`, tabla `travel_stage` con RLS/RPCs, regen de tipos, tests RLS. **P2:**
  card `Barcelona → Sevilla` (`travelText`). **P3:** editor de tramos en el
  diálogo/detalle. **Diferido:** documentos (pipeline R2 + `travel_stage_document`),
  road sheet e ICS. Rama **`feat/travel-stages`** (no money-v3); migración
  **primero a `hour-staging`** (RLS 120/120 + los nuevos) → luego `hour-phase0`
  por `prod-migrate`, nunca DDL directo a prod sin OK + backup proporcional.

- **Status 2026-07-23 — decidido, no construido.** Modelo aprobado por Marco
  (elección de tabla completa + 9 modos). Migración, tipos y tests **por escribir**;
  nada aplicado a ninguna DB. Este ADR es el punto de revisión previo a la
  migración.
