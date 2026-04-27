# Reset v2 prompt — for Windsurf

Paste this prompt into a fresh Windsurf chat inside the Hour repo. It is self-contained.

---

# Task: Hour Phase 0 schema reset v2

You are working on **Hour**, a multi-tenant B2B SaaS operating system for Spanish performing arts professionals. Phase 0 is internal (Marco + Anouk + ≤5 users, one workspace `marco-rubiol`, one project `mamemi`). Multi-tenant-ready from day one for a possible Phase 1 SaaS flip at month 6.

Stack: Supabase Cloud (eu-central-1 Frankfurt) · Cloudflare Workers · R2 · pgmq · Resend · Sentry · Astro 5 · Svelte 5 · `@astrojs/cloudflare` v12 · pnpm monorepo.

## Required reading (read in parallel before any work)

- `/Users/marcorubiol/Zerø System/.zerø/_system-context.md` — system rules (Spanish spoken / English in files, never fabricate, take a stance, no groveling).
- `/Users/marcorubiol/Zerø System/_methød/markdown.md` — file conventions.
- `/Users/marcorubiol/Zerø System/_methød/tone.md` — voice (no hype, no superlatives).
- `/Users/marcorubiol/Zerø System/03_AGENCY/Hour/CLAUDE.md`
- `/Users/marcorubiol/Zerø System/03_AGENCY/Hour/_context.md`
- `/Users/marcorubiol/Zerø System/03_AGENCY/Hour/build/_context.md`
- `/Users/marcorubiol/Zerø System/03_AGENCY/Hour/build/architecture.md`
- `/Users/marcorubiol/Zerø System/03_AGENCY/Hour/_decisions.md`
- `/Users/marcorubiol/Zerø System/03_AGENCY/Hour/build/schema.sql` (current v2, to be destroyed and rewritten)
- `/Users/marcorubiol/Zerø System/03_AGENCY/Hour/build/rls-policies.sql` (current v2, to be destroyed and rewritten)
- `/Users/marcorubiol/Zerø System/03_AGENCY/Hour/build/bootstrap.md`
- `/Users/marcorubiol/Zerø System/03_AGENCY/Hour/build/import-plan.md`

## Decisions closed (director chat, 2026-04-19)

Seven decisions. Each needs one ADR appended to `_decisions.md` in English, ADR-lite format (Context / Decision / Consequences), dated 2026-04-19.

### D1 — Engagement is a distinct entity from Show

Engagement persists and is bound to *person × project × workspace*. A show is atomic (has a date and a venue). An engagement can produce 0, 1 or N shows over its lifetime. Holds without a confirmed date live in engagement; holds with a date live in show. Engagement carries the anti-CRM status: `contacted, in_conversation, hold, confirmed, dormant, closed_lost, recurring`.

### D2 — Show.status enum with simple + prioritized hold variants

`show.status` enum values in order: `proposed, hold, hold_1, hold_2, hold_3, confirmed, done, invoiced, paid, cancelled`. `hold` is the default blocked-slot (theatre/dance) without priority assignment. `hold_1/2/3` covers music-industry bookings with explicit priority. No unique constraint on `(project_id, date, venue_id)` — two simple holds on the same slot are valid and coexist until one resolves.

### D3 — Money lives in three separate tables

Three first-class tables: `invoice`, `payment`, `expense`. Not columns on show. Supports partial payments (advance + rest), multi-show invoices (tour billed as one invoice), tax retentions (IVA, IRPF — separate columns on invoice). `expense` has FK to `show_id` OR `line_id` via CHECK constraint (exactly one, never both, never neither).

### D4 — Reset v2 executes before any real data

The current `schema.sql` and `rls-policies.sql` are destroyed and regenerated from scratch. Zero data loss because the import has not been run yet. After reset, Marco signs up, the custom_access_token_hook is enabled manually in Supabase dashboard, and only then the 156-contact loader runs.

### D5 — Line is its own table

Intermediate optional layer between project and show. Covers tour, season, phase, circuit, residency, festival_edition, other.

Fields: `id uuidv7 PK, workspace_id FK, project_id FK, name text, kind enum(tour, season, phase, circuit, residency, other), territory text null, status enum(open, closed, archived), start_date date null, end_date date null, dossier_url text null, notes text null, created_at, updated_at, created_by`.

Show has `line_id uuid null` FK. Expense has `line_id uuid null` FK exclusive with `show_id`.

### D6 — Roles editable via `workspace_role` catalog + granular RBAC with overrides

Replace the flat role enum with a catalog table per workspace, plus a granular permission vocabulary, plus overrides per project membership.

**Table `workspace_role`:**
- `id uuidv7 PK, workspace_id FK, code text, label text, is_system bool default false, archived_at timestamptz null, access_level enum(owner, admin, producer, member, viewer), permissions text[] not null default '{}', created_at, updated_at`.
- UNIQUE `(workspace_id, code)`.

**Granular permission vocabulary (constant in app code, validated in trigger against a seeded list):**
- Read: `read:money, read:engagement, read:person_note_private, read:internal_notes`
- Edit: `edit:show, edit:engagement, edit:money, edit:project_meta, edit:membership`
- Admin: `admin:project`

**Seed 15 system roles on workspace creation** (via trigger `seed_system_roles_on_workspace`):

| code | access_level | permissions |
|------|--------------|-------------|
| `owner` | owner | all |
| `admin` | admin | all except `admin:project` |
| `producer` | producer | read:money, read:engagement, read:person_note_private, read:internal_notes, edit:show, edit:engagement, edit:money, edit:project_meta |
| `production_manager` | producer | same as producer |
| `tour_manager` | producer | same as producer |
| `distribution` | producer | read:money, read:engagement, read:person_note_private, read:internal_notes, edit:show, edit:engagement, edit:project_meta — **no** `edit:money` |
| `director` | member | read:engagement, read:internal_notes, edit:show |
| `author` | member | read:internal_notes, edit:show |
| `technical_director` | member | read:internal_notes, edit:show |
| `performer` | member | read:internal_notes (no money, no private notes) |
| `light_design` | member | read:internal_notes |
| `sound_design` | member | read:internal_notes |
| `stage_design` | member | read:internal_notes |
| `costume_design` | member | read:internal_notes |
| `press` | member | read:internal_notes |

All 15 seeded as `is_system=true`. User can add custom roles, archive unused, edit labels and permissions (even on system roles).

**Table `project_membership` gains:**
- `roles text[] not null default '{}'` — codes from `workspace_role` for this workspace. Trigger validates each code exists and is not archived.
- `permission_grants text[] not null default '{}'` — extra permissions on top of what the roles give.
- `permission_revokes text[] not null default '{}'` — permissions removed from what the roles give.

Effective permissions = `union(role.permissions for role in roles) + permission_grants - permission_revokes`.

### D7 — No `project.type` field

Eliminate the `project.type` enum. The polymorphism lives in which subentities a project has (show, line, track, residency, programmed_show — as they come to exist), not in a type tag on project. One adaptive UI that shows what's there.

**Table `project` final fields:**
- `id uuidv7 PK, workspace_id FK, name text, description text null, status enum(active, archived, draft) default 'active', owner_id FK to workspace_member null, dossier_url text null, notes text null, created_at, updated_at, created_by FK to auth.users`.
- No `type` column.

## Work to produce

### Step 1 — Append seven ADRs to `_decisions.md`

One ADR per decision above. ADR-lite format:

```markdown
## ADR-NNN — Title (2026-04-19)

**Context.** Short paragraph: what was the problem, what was the existing state.

**Decision.** What was decided, concretely.

**Consequences.** What this unlocks, what it forecloses, what to watch for.
```

Number the ADRs following the existing sequence in _decisions.md. Cross-reference where relevant (e.g. D6 relates to D1 via engagement permissions).

### Step 2 — Full rewrite of `build/schema.sql`

Complete replacement file. Requirements:

- Destructive header: `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` plus re-grant to postgres and anon/authenticated.
- Extensions: `CREATE EXTENSION citext; CREATE EXTENSION pg_trgm;`. Do **not** use `pg_uuidv7` — not on Supabase Cloud whitelist. Define UUID v7 in PL/pgSQL (keep the implementation already in v1 if correct).
- Trigger function `set_updated_at()` (v1 version OK).
- Trigger function `handle_new_user()` on `auth.users` — creates default personal workspace and membership on signup.
- Trigger function `seed_system_roles_on_workspace()` — seeds the 15 system roles on new workspace row.
- Trigger function `validate_project_membership_roles()` — validates codes in `project_membership.roles` exist in `workspace_role` for same workspace and are not archived.
- Tables in dependency order: `workspace, workspace_member, workspace_role, person, project, project_membership, line, show, date, engagement, person_note, invoice, payment, expense`.
- All enums needed: `workspace.kind (personal, team), project.status, line.kind, line.status, show.status (with hold variants), date.kind, engagement.status, person_note.visibility, workspace_role.access_level, invoice.status, payment.method, expense.category`.
- Check constraints: `expense` exclusive show_id/line_id, `person_note.visibility IN ('workspace','private')`, non-empty name where appropriate.
- Comments above each table explaining purpose.
- Preserve v1 style and formatting conventions.

### Step 3 — Full rewrite of `build/rls-policies.sql`

Complete replacement file. Requirements:

- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` on all 14 tables (workspace, workspace_member, workspace_role, person, project, project_membership, line, show, date, engagement, person_note, invoice, payment, expense).
- Helper functions:
  - `current_workspace_id()` — reads JWT claim.
  - `current_user_id()` — returns `auth.uid()`.
  - `current_workspace_role()` — returns caller's `workspace_member.role` for current workspace.
  - `is_workspace_member(ws_id uuid)` — bool.
  - `has_project_access(p_id uuid)` — bool, checks project_membership or workspace_member.role.
  - `can_edit_project(p_id uuid)` — bool.
  - `can_see_person(p_id uuid)` — bool, respects "mine vs ours".
  - `has_permission(p_id uuid, perm text)` — **new**. Computes effective permissions for caller in project: `union(workspace_role.permissions where code IN membership.roles) + membership.permission_grants - membership.permission_revokes`. Returns bool.
  - Immutable column guards: `guard_immutable_workspace_id`, `guard_immutable_created_by`, `guard_immutable_author_id`.
- Policies per table using `has_permission(...)` where appropriate. Separate SELECT/INSERT/UPDATE/DELETE policies.
- Sensitive column gating — two options:
  1. Column-level USING clause that returns NULL when `has_permission('read:money')` is false.
  2. Dedicated views for money-gated reads.
  Pick the simpler idiomatic approach (option 1 via views if needed).
- `custom_access_token_hook(event jsonb)` — injects `current_workspace_id` claim. Preserve v1 logic.
- Audit triggers where present in v1 (created_by, updated_at) — keep.

### Step 4 — Update `build/bootstrap.md` if affected

Review every step. Update any reference to the old schema (project.type, flat roles, fee on show columns). Keep the two manual items flagged: enable `custom_access_token_hook` in Supabase dashboard, attach custom domain `hour.zerosense.studio`.

### Step 5 — Update `build/import-plan.md` if affected

Review the 3-stage pipeline (normalize → enrich → load) in `build/import/`. Confirm it still targets 156 persons + taggings + engagements on project `mamemi` with season=2026-27. Document any field rename or table split that affects the loader.

### Step 6 — Do NOT execute

- Do not run SQL against Supabase.
- Do not deploy to Cloudflare Workers.
- Do not touch the live DB.
- Do not commit or push to remote.
- Do not run the import loader.

Marco will review and run the reset manually when ready.

## Constraints

- Supabase Cloud eu-central-1 (Frankfurt). No extensions outside the whitelist.
- English in all SQL and markdown files. Spanish only in spoken conversation with Marco.
- Follow `_methød/tone.md`: no hype, no superlatives, no self-aggrandizing comments in code.
- Follow `_methød/markdown.md`: file conventions, naming classes (A/B/C/D).
- Every schema change must have a downstream-impact note: which import stage, endpoint, RLS policy, UI view, and doc is affected. Document in the ADR's Consequences section.

## Deliverables

Files updated or regenerated in `/Users/marcorubiol/Zerø System/03_AGENCY/Hour/build/`:

1. `_decisions.md` — seven ADRs appended.
2. `schema.sql` — full rewrite.
3. `rls-policies.sql` — full rewrite.
4. `bootstrap.md` — updated if affected.
5. `import-plan.md` — updated if affected.

No git commits. No remote pushes. Leave the working tree dirty for Marco's review.

## Open decisions explicitly left for later

Not part of this reset. Capture as TODOs in `_decisions.md` under a "Deferred" section if not already there:

- **Tasks + Tags (Phase 0.5).** Define `task` entity. Tag vocabulary split in three groups (event kinds already in `date.kind`; work categories like `#creative/#admin/#logistics`; cross-cutting behavior triggers like `#billable/#contract`). Tag schema (per-workspace catalog, polymorphic tagging table, taggeable entities).
- **UI for permission overrides per person.** Schema supports `permission_grants`/`permission_revokes` in `project_membership` from day 1 but UI in Phase 0 only edits role presets. Full override UI lands in Phase 0.5 or Phase 1 when external collaborators join.
