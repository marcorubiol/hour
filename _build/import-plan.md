# Import Plan — Phase 0 seed data

> Status: **draft** · Author: Marco + .Zerø · Date: 2026-04-19
> Scope: bootstrap MaMeMi's `contact` + `contact_project` tables from the existing Mostra Igualada 2026 export dataset.
> Related ADR: `DECISIONS.md` → "Activate `custom_fields jsonb` on tenant tables" (to be written, driven by this plan).

---

## 1. Why we need a plan (and not just a `COPY`)

The Difusión CRM in `01_STAGE/ZS_MaMeMi/Difusión/` is empty on disk — the "168 leads" referenced in `CLAUDE.md` were an aspirational target, not an existing dataset. The real starting dataset is a **Mostra Igualada 2026 backoffice export**: four paginated CSVs + one PDF of internationally-focused programmers. These will be the first of many heterogeneous sources (other festivals, agendas, mailing lists), so the pipeline needs to be source-agnostic, idempotent, and auditable.

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

These 30 profiles do **not add new contacts** — they enrich ~23 international + ~7 estatal records already present in the CSV set. Match is by `Entitat` ≈ PDF `ENTITAT`, with a manual fallback list for ambiguous cases.

### 2.3 Out of scope for this batch

- `Tipologia = Companyia/Productor` (188 records) — these are peers/competitors, not distribution targets.
- `Tipologia = Distribuïdor` (17) — defer; import later with a different `role_label` when we wire that pipeline.
- `Tipologia = Altres` (30) — defer; requires manual triage.

**First batch target**: `Tipologia ∈ { Programador, Fira/Festival }` → **151 contacts**.

---

## 3. Target schema mapping

### 3.1 `organization`

One row only, written during bootstrap (not by this pipeline):

```
name = 'MaMeMi', slug = 'mamemi', type = 'collective', default_locale = 'es'
```

### 3.2 `contact`  (per record)

| Source column | Target column | Notes |
|---|---|---|
| `Entitat o companyia` | `company` | Always populated. |
| `Entitat o companyia` | `name` | Temporary — overwritten in Enrich stage when PDF supplies a person name. |
| `Email` (lowercased) | `email` | `NULL` for the 1 empty record. |
| `Telèfon principal` | `phone` | Strip `'+` prefix; normalize E.164 where possible. |
| `Web` | `website` | Force scheme, prefer `https://`. |
| `Ciutat d'enviament` | `city` | Title-case. |
| inferred | `country` | `'ES'` if `Categoria procedència = catalunya` or `Província ∈ {Catalan/Spanish provinces}`, else ISO-2 from `Província`. |
| — | `tier` | `'tagged'` (enter the shared pool by default). |
| — | `organization_id` | MaMeMi's `organization.id`. |
| (see §3.5) | `custom_fields` | Source-of-origin metadata (jsonb). |

### 3.3 `tag` + `tagging`

Create per-org tags and link them:

- `src:mostra-igualada-2026` — provenance tag, all 151 records
- `procedencia:catalunya` / `procedencia:estatal` / `procedencia:internacional`
- `tipologia:programador` / `tipologia:festival`

These are cheap and unlock filtering in the future UI without touching `custom_fields`. Idempotent via `UNIQUE (organization_id, name)`.

### 3.4 `project` + `contact_project`

Create one project row: `name = 'MaMeMi — Difusión 2026-2027'`, `slug = 'difusion-2026-27'`, `status = 'active'`.

Then, for every imported contact, insert a `contact_project` row with `status = 'prospect'`. This is the pipeline entry point; Marco will move them through the funnel (`contacted` → `proposal_sent` → …) manually.

### 3.5 `custom_fields` — JSONB schema

> **Blocks on** migration `0005_custom_fields.sql` (see §5).

Shape on `contact.custom_fields` after import:

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
  "dossier_2026": {                            // only for the 30 enriched
    "role_title": "SUBDIRECTORA ARTÍSTICA",
    "interest": "Espectacles per a infants i joves, sense massa text.",
    "description": "La companyia de teatre Arad Goch té la seva seu a…"
  }
}
```

Rationale: heterogeneous source-level metadata (each festival's dossier will have its own fields) doesn't deserve dedicated columns. JSONB keeps the raw signal while still allowing GIN indexing if we ever need to query by it.

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

Before running the loader, land migration **`0005_custom_fields.sql`**:

```sql
ALTER TABLE contact ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE project ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE event   ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX idx_contact_custom_fields_gin ON contact USING GIN (custom_fields jsonb_path_ops);
```

Apply via Supabase MCP, then reconcile `_build/schema.sql` (add to sections 5, 6, 8). Updates the open ADR in `DECISIONS.md` to **Accepted**.

---

## 6. Pipeline

Three Python scripts in `_build/import/`. Each is idempotent, reads from disk, writes to disk (except Stage 3 which writes to Supabase). No step is destructive.

### Stage 1 — `01_normalize.py`

Input:  `_build/import/sources/mostra-2026/*.csv` (copy the 4 files here).
Output: `_build/import/staging/01_canonical.jsonl` (one JSON object per contact, post-normalization).

Steps:
1. Load all 4 CSVs, dedupe by `Número Registre`.
2. Filter `Tipologia ∈ {Programador, Fira/Festival}`.
3. Apply normalization rules from §4.
4. Emit JSONL with the Hour-shape (pre-`id`, pre-`organization_id`).
5. Print a report: rows in / rows out / rows dropped and why.

### Stage 2 — `02_enrich_from_pdf.py`

Input:  `_build/import/staging/01_canonical.jsonl` + `_build/import/sources/mostra-2026/Mostra Igualada 2026_Dossier Programadors.pdf`.
Output: `_build/import/staging/02_enriched.jsonl`.

Steps:
1. `pdftotext -layout` → segment into 30 profile blocks using header regex (`^[A-Z]+$` on two consecutive lines + ENTITAT line).
2. Extract `{name, entitat, city, country, role_title, web, interest, description}` per profile.
3. Fuzzy-match each profile to canonical rows by `entitat` (RapidFuzz `token_set_ratio ≥ 85`), fallback to `web` host match, fallback to manual override file (`_build/import/manual-matches.yaml` — empty at start, populated by Marco on mismatches).
4. Merge into canonical: set `name`, `role_title`, and `custom_fields.dossier_2026.*`.
5. Emit JSONL. Print `(matched, unmatched_dossier_profiles, unmatched_canonical_rows)` report.

### Stage 3 — `03_load_to_hour.py`

Input:  `_build/import/staging/02_enriched.jsonl`.
Output: rows in Supabase `hour-phase0`.

Env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ORG_SLUG=mamemi`, `PROJECT_SLUG=difusion-2026-27`.

Steps:
1. Resolve `organization.id` by `slug = 'mamemi'`; fail loudly if missing.
2. Upsert `project (slug = 'difusion-2026-27')` → get `project.id`.
3. Upsert tags (`src:mostra-igualada-2026`, `procedencia:*`, `tipologia:*`).
4. For each canonical row:
   - Upsert `contact` on `(organization_id, email)` when email present, else on `(organization_id, custom_fields -> 'sources' -> 'mostra_igualada_2026' ->> 'registre')` via a deterministic shadow key. Merge `custom_fields` with `jsonb ||` semantics (don't clobber).
   - Link tags via `tagging`.
   - Upsert `contact_project (contact_id, project_id)` with `status = 'prospect'` (no-op on conflict — preserve whatever status Marco has already moved them to).
5. Wrap everything in a single transaction per batch of 25 rows. Safe to re-run.
6. Print: inserted / updated / skipped / failed with row-level reasons.

---

## 7. Expected outcome after first successful run

```
organization        : 1   (MaMeMi, pre-existing)
project             : 1   (difusion-2026-27)
contact             : 151 (Programador + Fira/Festival)
  ├─ with dossier   :  ~30 (enriched from PDF)
  └─ without        : ~121
tag                 : 6   (src + 3 procedencia + 2 tipologia)
tagging             : ~453 (151 × ~3 tags each)
contact_project     : 151 (all in 'prospect' status)
```

All 151 contacts visible in Hour once the first UI screen lands, already segmented by `procedencia` and `tipologia` tags.

---

## 8. Risks & open questions

- **Fuzzy match false positives between CSV and PDF.** Mitigation: `token_set_ratio ≥ 85` + web host tiebreaker + manual override file. Stage 2 prints unmatched in both directions so they can be resolved before Stage 3.
- **Country mapping for `internacional` rows.** Only ~18 rows. Easier to hand-curate a `COUNTRY_MAP` than to parse loose Catalan country names. List will be short.
- **Email dedupe across future sources.** `(organization_id, email)` works when email exists. For the 1 email-less row we use the `Número Registre` shadow key; when other festivals export without stable IDs, we'll likely need a composite `(organization_id, lower(company), lower(city))` — defer that decision until second source lands.
- **GDPR.** These are professional contacts from a public industry dossier, not personal. Still: document the source in `custom_fields.sources` so provenance is auditable, and plan for a future soft-delete cascade on contact deletion.

---

## 9. Order of operations

1. ☐ Write this file (DONE by reading it).
2. ☐ Apply migration `0005_custom_fields.sql` via MCP → update `schema.sql` → commit.
3. ☐ Write ADR "Activate `custom_fields jsonb` on tenant tables — accepted" in `DECISIONS.md`.
4. ☐ Copy sources into `_build/import/sources/mostra-2026/` (4 CSVs + 1 PDF) — **.gitignored**; they're PII-adjacent and don't belong in the public repo.
5. ☐ Implement `01_normalize.py` → run → inspect `01_canonical.jsonl`.
6. ☐ Implement `02_enrich_from_pdf.py` → run → inspect `02_enriched.jsonl` + unmatched report.
7. ☐ Marco fills `manual-matches.yaml` for any unmatched profiles he can identify.
8. ☐ Create MaMeMi `organization` row (via MCP or a one-off seed migration).
9. ☐ Implement `03_load_to_hour.py` → dry-run mode first (`--dry-run` flag prints the SQL it would emit) → live run.
10. ☐ Verify counts with a read-only SQL (`SELECT count(*) FROM contact WHERE organization_id = …`) and spot-check 3 random rows.

Each step leaves disk artefacts — safe to rerun from any point.
