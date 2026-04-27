# Import Plan — Phase 0 seed data

> Status: **implemented** (pipeline lives in `build/import/`); **needs code
> adjustment after reset v2** — see §3.4 (drop tag/tagging steps) and §3.5
> (engagement status default `contacted`). · Author: Marco + .zerø · Date: 2026-04-19
> Scope: bootstrap MaMeMi's `person` + `engagement` rows from the Mostra Igualada 2026 export dataset (+ dossier PDF enrichment).
> Related ADRs: `DECISIONS.md` → ADR-001 (engagement distinct from show), ADR-007 (no `project.type`), plus the earlier `Activate custom_fields jsonb` and `Polymorphic core` entries. The 2026-04-19 **reset v2** dropped tag/tagging, dropped `project.type`, renamed `membership → workspace_membership`, and shifted `engagement.status` to the anti-CRM enum (default `contacted`); sections below reflect the new schema.

---

## 1. Why we need a plan (and not just a `COPY`)

The Difusión CRM in `01_STAGE/ZS_MaMeMi/Difusión/` is empty on disk — the "168 leads" referenced in `context.md` were an aspirational target, not an existing dataset. The real starting dataset is a **Mostra Igualada 2026 backoffice export**: four paginated CSVs + one PDF of internationally-focused programmers. These will be the first of many heterogeneous sources (other festivals, agendas, mailing lists), so the pipeline needs to be source-agnostic, idempotent, and auditable.

---

## 2. Inventory of sources

### 2.1 CSV set — Mostra Igualada backoffice export (primary)

Four files, paginated (100 rows each, last page 87). 387 **unique records** by `Número Registre`, range 1..392.

| File | Rows | `Número Registre` range |
|---|---|---|
| `tableExport-1d284dfa.csv`     | 100 | 1..105 |
| `tableExport(1)-cdc0d4dc.csv`  | 100 | 106..205 |
| `tableExport(2)-601c0b1d.csv`  | 100 | 206..305 |
| `tableExport(3)-d3a7fe13.csv`  |  87 | 306..392 |

Schema (10 columns, Catalan labels, UTF-8 BOM, RFC 4180):

```
Número Registre, Entitat o companyia, Tipologia, Categoria procedència,
Email, Carrer d'enviament, Ciutat d'enviament, Província,
Telèfon principal, Web
```

Quirks observed:

- Phone prefix stored as a literal `'+` (apostrophe + plus) — an Excel artefact to force text. Strip on ingest.
- Some `Província` values are upper-case (`BARCELONA`), some title-case (`Barcelona`). Normalize.
- Country is encoded into `Província` for non-Spanish records (e.g. `Lituània`, `Gal·les`). Infer `country` from that when `Categoria procedència != catalunya`.
- `Web` is sometimes `http://…`, sometimes `https://…`, sometimes bare `domain.com`, sometimes empty. Normalize to a canonical URL (force https, add protocol when missing).
- `Email` missing for exactly 1 of 387 records — that record will be imported but skipped from later email-based dedupe.

### 2.2 PDF — `Mostra Igualada 2026_Dossier Programadors.pdf` (enrichment)

33 A4 pages, InDesign export, 17 MB. Structured as a dossier with **30 profiles** of international + estatal programmers, each with:

- `NOM COGNOM` (uppercase, two lines)
- `ENTITAT` (venue / festival / organization)
- `Ciutat, País` (Catalan spelling)
- Role (e.g. `SUBDIRECTORA ARTÍSTICA`, `COORDINACIÓ DE PRODUCCIÓ ARTÍSTICA`)
- Web URL
- `INTERÈS ARTÍSTIC:` — one-sentence interest descriptor (★ unique to this source)
- `DESCRIPCIÓ:` — free-form paragraph about the festival/venue (★ unique)

These 30 profiles mostly enrich ~23 international + ~7 estatal records already present in the CSV set. Match is by `Entitat` ≈ PDF `ENTITAT`, with a manual fallback list for ambiguous cases. Dossier-only profiles (no CSV match) are appended as net-new `person` rows — Stage 2 reports both unmatched directions so Marco can audit.

### 2.3 Out of scope for this batch

- `Tipologia = Companyia/Productor` (188 records) — these are peers/competitors, not distribution targets.
- `Tipologia = Distribuïdor` (17) — defer; import later with a different `role_label` when we wire that pipeline.
- `Tipologia = Altres` (30) — defer; requires manual triage.

**First batch target**: `Tipologia ∈ { Programador, Fira/Festival }` → **151 records** from the CSV. After PDF enrichment adds dossier-only profiles not present in the CSV, the loader lands **156 `person` rows** (see §7).

---

## 3. Target schema mapping

> Reflects the polymorphic schema (workspace + project + person + engagement) as of the 2026-04-19 reset. No more `organization`, `contact`, or `contact_project`.

### 3.1 `workspace`

One row, written by either `build/seed.sql` (CLAIM block, after Marco signs up) or by the loader on first run if absent. The `handle_new_user` trigger also creates a personal workspace automatically on signup — the CLAIM block renames it so the slug settles on `marco-rubiol`:

```
name = 'Marco Rubiol', slug = 'marco-rubiol', kind = 'personal'
```

### 3.2 `project`

One row, upserted by Stage 3 (idempotent on `(workspace_id, slug)`):

```
workspace_id = <marco-rubiol>, slug = 'mamemi', name = 'MaMeMi',
status = 'active'
```

`project.type` no longer exists (ADR-007 dropped the discriminator). The loader must **not** set `type` — polymorphism emerges from which subentities the project ends up with (engagement, show, line, date…). `build/import/03_load_to_hour.py` drops the `type='show'` upsert field as part of the reset-v2 code adjustment.

Difusión-2026-27 is **not** a project — it's a filtered view over `engagement` rows where `project.slug = 'mamemi'` and `custom_fields->>'season' = '2026-27'` (see ADR *Polymorphic core* in `DECISIONS.md`).

### 3.3 `person`  (per record — global, workspace-less)

`person` lives outside any workspace: the same human can be reused across tenants. Privacy is enforced via `person_note.visibility` (workspace|private) and via RLS (you can see a person only if you share an engagement or note with them).

| Source column | Target column | Notes |
|---|---|---|
| `Entitat o companyia` | `organization_name` | Always populated. |
| (derived) | `full_name` | Defaults to `organization_name` pre-enrichment; Stage 2 overwrites when the PDF supplies a real person name. |
| `Email` (lowercased) | `email` | `NULL` for the 1 empty record. |
| `Telèfon principal` | `phone` | Strip leading `'+` Excel prefix; normalize E.164 where possible. |
| `Web` | `website` | Force scheme, prefer `https://`. |
| `Ciutat d'enviament` | `city` | Title-case. |
| inferred | `country` | `'ES'` if `Categoria procedència = catalunya` or `Província ∈ {Catalan/Spanish provinces}`, else ISO-2 from `Província`. |
| (see §3.6) | `custom_fields` | Source-of-origin metadata (jsonb). |
| (runtime) | `created_by` | `auth.users.id` of the HOUR_OWNER_EMAIL account. Nullable — `--skip-engagements` mode lands persons with `created_by = NULL`. |

Dedupe key: `email` where present (unique globally on `person(email)` — the column is `extensions.citext`, which is case-insensitive, so the `UNIQUE` constraint is equivalent to a `lower(email)` index); otherwise fall back to `custom_fields->'sources'->'mostra_igualada_2026'->>'registre'` as a deterministic shadow key.

### 3.4 `tag` + `tagging` — **deferred, not part of this import**

The `tag` and `tagging` tables were dropped in reset v2 (2026-04-19). Tag infrastructure is deferred to Phase 0.5 (see DECISIONS.md "Deferred" section). During the Mostra 2026 import, **no tag rows are created**. The provenance that tags used to encode now lives inside `person.custom_fields.sources.mostra_igualada_2026` (see §3.6) — source, tipologia, procedencia, ingested_at are all preserved there as structured JSON.

`build/import/03_load_to_hour.py` drops the tag-creation step (previously step 3 of the Stage 3 workflow) as part of the reset-v2 code adjustment. The seven tag names enumerated in the pre-v2 version of this doc (`src:mostra-igualada-2026`, `procedencia:*`, `tipologia:*`) remain discoverable as `custom_fields` keys — any Phase 0.5 migration that brings tagging back can backfill from there without re-reading the CSVs.

### 3.5 `engagement` (per person × project)

One row per (person, project) in MaMeMi's workspace. Status defaults to **`contacted`** — the first value in the new anti-CRM enum (`contacted, in_conversation, hold, confirmed, declined, dormant, recurring`). Marco progresses them manually: `contacted → in_conversation → hold → confirmed` (with `declined | dormant | recurring` as steady states). Note: `engagement` no longer carries `date_id` — that linkage now lives on `show.engagement_id` (ADR-001), so the loader does not try to attach dates to engagements.

| Target column | Value at import |
|---|---|
| `workspace_id` | Marco's `marco-rubiol` workspace |
| `project_id` | MaMeMi `mamemi` project |
| `person_id` | the person upserted in §3.3 |
| `status` | `'contacted'` on insert; `ON CONFLICT DO NOTHING` so Marco's later edits survive reruns |
| `custom_fields` | `{"season": "2026-27"}` — this is the handle the `difusión-2026-27` filtered view uses |
| `created_by` | `auth.users.id` of HOUR_OWNER_EMAIL. Nullable on the current schema — `--skip-engagements` remains the safer path when Marco hasn't signed up; otherwise use his uid |

Uniqueness: `UNIQUE (workspace_id, project_id, person_id)` on the `engagement` table.

### 3.6 `custom_fields` — JSONB schema

`custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb` exists on `person`, `project`, `engagement`, and `date` since the polymorphic reset (no separate migration needed — see §5).

Shape on `person.custom_fields` after import:

```jsonc
{
  "sources": {
    "mostra_igualada_2026": {
      "registre": 206,                         // Número Registre (int)
      "tipologia": "Fira/Festival",           // raw, as exported
      "procedencia": "catalunya",             // raw
      "address": "Prats, 14",                 // raw Carrer d'enviament
      "provincia_raw": "Barcelona",           // pre-normalization snapshot
      "ingested_at": "2026-04-19T14:00:00Z"
    }
  },
  "dossier_2026": {                            // only for the ~30 enriched
    "role_title": "SUBDIRECTORA ARTÍSTICA",
    "interest": "Espectacles per a infants i joves, sense massa text.",
    "description": "La companyia de teatre Arad Goch té la seva seu a…"
  }
}
```

Shape on `engagement.custom_fields` after import:

```jsonc
{ "season": "2026-27" }
```

Rationale: heterogeneous source-level metadata (each festival's dossier has its own fields) doesn't deserve dedicated columns. JSONB keeps the raw signal while still allowing GIN indexing if we ever need to query by it. The `season` handle on `engagement` is what lets Difusión 2026-27 stay a filter rather than a real project row.

---

## 4. Normalization rules (applied in Stage 1)

| Field | Rule |
|---|---|
| `email` | `trim().lower()`; discard if not a valid RFC-5322 shape. |
| `phone` | strip leading `'`, then strip spaces; if starts with `+`, keep; if starts with `6/7/8/9` and 9 digits, prefix `+34`; otherwise leave raw in `custom_fields.phone_raw`. |
| `website` | add `https://` if missing; strip trailing `/`; lowercase host. |
| `city` | `title()` with small stopwords preserved (`de`, `d'`, `i`, `la`, `el`). |
| `provincia` | title-case; if matches Spanish province list → keep; else move to `custom_fields.region`. |
| `country` | default `ES` for `catalunya`/`estatal`; for `internacional` map `Província` through a `COUNTRY_MAP` dict (`Lituània→LT`, `Gal·les→GB-WLS`, `Itàlia→IT`, `França→FR`, …). Missing maps → log and set `NULL`. |
| `name` | fallback to `company` if no person name known yet. |

---

## 5. Pre-flight migration: `custom_fields jsonb`

**Already applied.** The polymorphic reset (`polymorphic_schema` migration, 2026-04-19) ships `custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb` on `person`, `project`, `engagement`, and `date`, plus a GIN index on `person.custom_fields` (`jsonb_path_ops`). No separate `0005_custom_fields.sql` step exists — the column is part of the canonical schema in `build/schema.sql`. The ADR *Activate `custom_fields jsonb` on tenant tables* is marked **Accepted** in `DECISIONS.md`.

---

## 6. Pipeline

Three Python scripts in `build/import/`. Each is idempotent, reads from disk, writes to disk (except Stage 3 which writes to Supabase). No step is destructive.

### Stage 1 — `01_normalize.py`

Input:  `build/import/sources/mostra-2026/*.csv` (copy the 4 files here).
Output: `build/import/staging/01_canonical.jsonl` (one JSON object per record, post-normalization).

Steps:
1. Load all 4 CSVs, dedupe by `Número Registre`.
2. Filter `Tipologia ∈ {Programador, Fira/Festival}`.
3. Apply normalization rules from §4.
4. Emit JSONL with the Hour-shape — `person`-flavoured fields (`organization_name`, `full_name`, `email`, `phone`, `website`, `city`, `country`, `custom_fields.sources.mostra_igualada_2026.*`).
5. Print a report: rows in / rows out / rows dropped and why.

### Stage 2 — `02_enrich_from_pdf.py`

Input:  `build/import/staging/01_canonical.jsonl` + `build/import/sources/mostra-2026/Mostra Igualada 2026_Dossier Programadors.pdf`.
Output: `build/import/staging/02_enriched.jsonl`.

Steps:
1. `pdftotext -layout` → segment into 30 profile blocks using header regex (`^[A-Z]+$` on two consecutive lines + ENTITAT line).
2. Extract `{full_name, entitat, city, country, role_title, web, interest, description}` per profile.
3. Fuzzy-match each profile to canonical rows by `entitat` ≈ `organization_name` (RapidFuzz `token_set_ratio ≥ 85`), fallback to `website` host match, fallback to manual override file (`build/import/manual-matches.yaml` — empty at start, populated by Marco on mismatches).
4. Merge into canonical: set `full_name`, add `custom_fields.dossier_2026.*`, tag the row for `src:dossier-2026`.
5. Dossier-only profiles (not matched to any CSV row) are appended as new canonical rows so they land as `person`s too.
6. Emit JSONL. Print `(matched, unmatched_dossier_profiles, unmatched_canonical_rows, dossier_only_added)` report.

### Stage 3 — `03_load_to_hour.py`

Input:  `build/import/staging/02_enriched.jsonl`.
Output: rows in Supabase `hour-phase0` via PostgREST (service-role key, bypasses RLS).

Env (read from repo-root `.env`):
- Required: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- Optional: `HOUR_WORKSPACE_SLUG=marco-rubiol`, `HOUR_WORKSPACE_NAME="Marco Rubiol"`, `HOUR_PROJECT_SLUG=mamemi`, `HOUR_PROJECT_NAME=MaMeMi`, `HOUR_SEASON=2026-27`, `HOUR_OWNER_EMAIL=marcorubiol@gmail.com`.

Flags: `--dry-run`, `--limit N`, `--verbose`, `--skip-engagements` (load only persons — use before Marco has signed up, so the engagement rows have a real `created_by`).

Steps (post reset-v2):
1. Ensure the `workspace` row (`slug=marco-rubiol`, `kind=personal`) — upsert, idempotent. The INSERT path triggers `workspace_seed_roles` in cascade, which seeds 15 rows into `workspace_role`.
2. Ensure the `project` row (`slug=mamemi`, `status=active`, `workspace_id=<marco-rubiol>`) — upsert on `(workspace_id, slug)`. **Do not set `type`** — the column and `project_type` enum were removed by ADR-007.
3. *(removed — tag/tagging tables were dropped in reset v2; provenance lives in `person.custom_fields` only. See §3.4.)*
4. Resolve `HOUR_OWNER_EMAIL` → `auth.users.id`. If absent: warn, force `--skip-engagements` semantics, continue with `person.created_by = NULL`.
5. For each canonical row:
   - Upsert `person` on `lower(email)` when email is present, else on `custom_fields->'sources'->'mostra_igualada_2026'->>'registre'` via a deterministic shadow key. Merge `custom_fields` with PostgREST JSON-merge semantics (don't clobber prior sources on rerun).
   - Unless `--skip-engagements`: upsert `engagement (workspace_id, project_id, person_id)` with `status='contacted'` (anti-CRM default), `custom_fields={"season":"2026-27"}`, `created_by=<owner.id>`. `ON CONFLICT (workspace_id, project_id, person_id) DO NOTHING` — preserves Marco's later status changes across reruns.
6. Wrap each batch of 25 rows in a single PostgREST call. Safe to re-run any number of times.
7. Print: inserted / updated / skipped / failed with row-level reasons.

Optional (not yet implemented): Stage 3 could also upsert `venue` rows from `custom_fields.sources.*.address / city / country` when the record represents a performance space. Deferred — Phase 0 imports programmer persons, not venues; `venue` seeding waits until the first real `show` needs one.

---

## 7. Expected outcome after first successful run

```
workspace           : 1    (marco-rubiol, kind=personal)
workspace_role      : 15   (system roles, seeded in cascade by the workspace INSERT)
project             : 1    (mamemi, status=active, no type column)
person              : 156  (Programador + Fira/Festival, deduped on email)
  ├─ with dossier   :  ~30 (enriched from PDF)
  └─ without        : ~126
tag / tagging       : 0    (dropped in reset v2; provenance lives in person.custom_fields)
venue               : 0    (loader does not seed venues in Phase 0)
engagement          : 156  (all status='contacted', custom_fields.season='2026-27')
show / date / line  : 0    (Marco creates shows manually as dates confirm)
invoice* / payment  : 0    (out of scope for this load)
expense             : 0    (out of scope)
```

All 156 persons visible in Hour once the first UI screen lands, already filterable down to the "Difusión 2026-27" view via `project.slug=mamemi` + `engagement.custom_fields->>season='2026-27'`. Under `--skip-engagements` (owner not signed up yet), the engagement row count is 0 and `person.created_by` is NULL. Segmentation by procedencia/tipologia works off `person.custom_fields.sources.mostra_igualada_2026.*` until tag infrastructure lands in Phase 0.5.

---

## 8. Risks & open questions

- **Fuzzy match false positives between CSV and PDF.** Mitigation: `token_set_ratio ≥ 85` + web host tiebreaker + manual override file. Stage 2 prints unmatched in both directions so they can be resolved before Stage 3.
- **Country mapping for `internacional` rows.** Only ~18 rows. Easier to hand-curate a `COUNTRY_MAP` than to parse loose Catalan country names. List will be short.
- **Email dedupe across future sources.** `person` uses a global `lower(email)` unique index, which works when email is present. For the 1 email-less row we use the `Número Registre` shadow key; when other festivals export without stable IDs, we'll likely need a composite `(lower(organization_name), lower(city))` fallback — defer that decision until the second source lands. Note: `person` is workspace-less, so email collisions with other tenants' persons are real — that's the intended behaviour (shared pool), but it means dedupe logic must never clobber another workspace's `custom_fields` on upsert.
- **GDPR.** These are professional records from a public industry dossier, not personal. Still: document the source in `custom_fields.sources` so provenance is auditable; privacy for Marco's own annotations is enforced via `person_note.visibility` (workspace|private); and plan for a future soft-delete cascade via `person.deleted_at`.

---

## 9. Order of operations

1. ☑ Write this file.
2. ☑ `custom_fields jsonb` landed as part of the 2026-04-19 polymorphic reset (and preserved in reset v2) — no separate migration step.
3. ☑ ADR *Activate `custom_fields jsonb` on tenant tables* → Accepted in `DECISIONS.md`.
4. ☑ Copy sources into `build/import/sources/mostra-2026/` (4 CSVs + 1 PDF) — **.gitignored**; they're PII-adjacent and don't belong in the public repo.
5. ☑ Implement `01_normalize.py` → run → inspect `01_canonical.jsonl`.
6. ☑ Implement `02_enrich_from_pdf.py` → run → inspect `02_enriched.jsonl` + unmatched report.
7. ☑ Marco fills `manual-matches.yaml` for any unmatched profiles he can identify.
8. ☐ **Reset v2 migration applied** (18 tables: workspace/workspace_role/workspace_membership/person/venue/project/project_membership/line/engagement/show/date/person_note/invoice/invoice_line/payment/expense/user_profile/audit_log). `build/seed.sql` CLAIM block renames Marco's auto-created workspace to `marco-rubiol` and upserts the `mamemi` project (no `type` column).
9. ☐ **Adjust `03_load_to_hour.py`** for reset v2: drop the tag/tagging step, drop `type='show'` from project upsert, switch engagement status default to `contacted`. (Windsurf task — out of scope for this plan.)
10. ☐ **Marco signs up** at `hour.zerosense.studio` (or the workers.dev URL) with `marcorubiol@gmail.com` → run `build/seed.sql` CLAIM block → enable `custom_access_token_hook` in the Supabase Dashboard (Auth → Hooks).
11. ☐ Live run: `python3 build/import/03_load_to_hour.py` (no flags) → lands 156 persons + 156 engagements (status=`contacted`) on the `mamemi` project with `season=2026-27` in `custom_fields`. No tag/tagging rows.
12. ☐ Verify with `GET /api/engagements?project_slug=mamemi&season=2026-27` using a real JWT; cross-check counts against §7.

Each step leaves disk artefacts — safe to rerun from any point.
