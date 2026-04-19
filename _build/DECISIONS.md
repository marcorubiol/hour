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
- **Decision**: Claude Code (CLI, per Marco's preference — Desktop is equivalent, same engine) is the primary coding environment. Cowork is for strategy, research, briefings, and cross-app tasks. Memory lives in repo files (`_build/*.md`), never in chat history.
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
  4. **Separate `.Zerø` Cowork integration** for daily briefings, tasks, Ørbit — kept distinct from Hour work.
  5. Standard opening instruction for any new chat: *"Read `CLAUDE.md` + `_build/ARCHITECTURE.md` + `_build/DECISIONS.md` + `_build/COMPETITION.md` before responding."*
- **Context**: Avoid fragmenting knowledge across dozens of chats. Avoid losing context on long threads.
- **Rationale**: Fewer chats, each with clear purpose. Memory persists in files, not in Claude's memory of any single chat. Any new session can catch up in seconds by reading four markdown files.
- **Status**: Firm.

## [2026-04-18] — Project location (physical folder) — initial
- **Decision**: Phase 0 lives at `/Users/marcorubiol/Zerø System/01_STAGE/ZS_MaMeMi/_build/`. When promoted to its own git repo, move to `02_STUDIO/Hour/` or `04_BACKSTAGE/Hour/` and update `.Zerø` dashboard accordingly.
- **Context**: Hour was conceived inside the MaMeMi Difusión problem. By Marco's rule "a project lives where it's born", Hour inherits from STAGE for now.
- **Alternatives**: Start a fresh folder immediately — rejected, premature separation before we know if Hour outgrows the MaMeMi context.
- **Rationale**: Keep it simple. One folder for now. Move later if/when Phase 1 activates.
- **Status**: Superseded on 2026-04-18 by the next entry.

## [2026-04-18] — Project location (updated — supersedes previous)
- **Decision**: Hour lives at `03_AGENCY/Hour/` with build artifacts under `03_AGENCY/Hour/_build/`. Separated from `ZS_MaMeMi/` the same day it was first scaffolded.
- **Context**: Marco reflected that bundling Hour inside MaMeMi didn't fit. He created `03_AGENCY/Hour/` and asked to relocate all `_build/` files there.
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

## [2026-04-19] — Auth flow: magic-link only for Phase 0
- **Decision**: Supabase Auth with email magic-link as the only sign-in method. Email+password disabled. OAuth providers (Google, Apple) deferred to Phase 1.
- **Context**: Phase 0 has ≤5 users (Marco, Anouk, up to 3 collaborators). First-time setup of `hour.zerosense.studio` required an auth choice.
- **Alternatives considered**:
  - Email + password — rejected, passwords to remember/rotate for 5 internal users is pure friction.
  - Magic-link + Google OAuth from day one — rejected, OAuth adds callback URLs, token rotation, and a larger auth surface with no Phase 0 benefit (all 5 users have email).
  - Passkey/WebAuthn — rejected, Supabase support is still preview-level and it's overkill for an internal tool.
- **Rationale**: Magic link is zero-friction for trusted small teams. Resend's free tier (3k/month, 100/day) is ~100× what 5 users need. Adding OAuth when external users appear in Phase 1 is a dashboard toggle + config change, not a migration. Session length will be set to 30 days so mobile users don't re-auth daily.
- **How to apply**: Bootstrap §2.1 enables Magic Link and disables Password in the Supabase dashboard. Site URL = `hour.zerosense.studio`, redirect = `http://localhost:4321/*` for dev.
- **Status**: Firm for Phase 0. Revisit at Phase 1 kickoff when external users appear.

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

## [2026-04-18] — Deferred to kickoff session
Items NOT yet decided, to address when starting schema work:

- ~~Frontend framework confirmation~~ — resolved 2026-04-19 (Astro + Svelte). See ADR above.
- ~~Auth flow: magic link only (Phase 0) vs + Google OAuth (Phase 1)~~ — resolved 2026-04-19 (magic-link only). See ADR above.
- ~~Repo under Marco's GitHub user vs new `zerosense` org~~ — resolved 2026-04-19, see entry above.
- Staging deploy frequency: per-PR vs on-merge-only
- Ableton/Qlab integration depth (read-only metadata vs two-way sync) — Phase 1+ feature
