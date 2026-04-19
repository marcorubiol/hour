# Hour — Import Pipeline

Three-stage ingest from heterogeneous sources (CSV exports, PDF dossiers) into
the Hour schema in Supabase. See `../import-plan.md` for the full spec.

## Layout

```
_build/import/
├── README.md                    this file (committed)
├── 01_normalize.py              stage 1: CSV → canonical JSONL (committed)
├── 02_enrich_from_pdf.py        stage 2: PDF merge (committed)
├── 03_load_to_hour.py           stage 3: upsert to Supabase (to be written)
├── manual-matches.yaml          PDF↔CSV manual overrides (committed; 5 entries)
├── sources/                     raw inputs (gitignored — PII-adjacent)
│   └── mostra-2026/
│       ├── page-1_registre-1-105.csv
│       ├── page-2_registre-106-205.csv
│       ├── page-3_registre-206-305.csv
│       ├── page-4_registre-306-392.csv
│       └── dossier-programadors-2026.pdf
└── staging/                     intermediate outputs (gitignored)
    ├── 01_canonical.jsonl       produced by stage 1 (151 rows)
    ├── 02_dossier.json          produced by stage 2 (30 parsed PDF profiles, audit)
    └── 02_enriched.jsonl        produced by stage 2 (156 rows: 151 canonical + 5 dossier-only)
```

## Running

Stage 1 uses only stdlib. Stage 2 needs `rapidfuzz` + `pypdf` + the `pdftotext`
binary from `poppler` (falls back to pypdf if `pdftotext` isn't on PATH).
Stage 3 will need `supabase` + `python-dotenv`.

```sh
# Set up a venv and install Stage 2 deps
python3 -m venv .venv
./.venv/bin/pip install rapidfuzz pypdf

# Stage 1 — CSV → canonical
python3 _build/import/01_normalize.py
# → writes _build/import/staging/01_canonical.jsonl (151 rows)

# Stage 2 — PDF dossier merge
./.venv/bin/python _build/import/02_enrich_from_pdf.py
# → writes staging/02_dossier.json  (30 parsed profiles, for audit)
# → writes staging/02_enriched.jsonl (156 rows: 151 canonical + 5 dossier-only)
```

All stages are idempotent — rerunning overwrites the staging file in place.
Source files are read-only; none of the scripts mutate them.

## Stage 2 matching model

Each PDF profile runs through a three-tier cascade against the 151 canonical rows:

1. **Manual override** (`manual-matches.yaml`) — hard map from entitat slug to
   canonical `registre`. Keys are `_norm_for_match`ed and hyphenated. Only used
   for acronyms (`fitij`), local-chapter URL mismatches, or host collisions
   where two Mostra rows live at the same org.
2. **Fuzzy on `entitat_raw + location_raw`** vs canonical `company`, with guards
   to stop drive-by matches on generic industry words (`festival`, `teatre`,
   `arts` alone don't qualify — at least one distinctive shared token is
   required, and long strings demand a proper-noun-length token). Score is
   `max(token_set_ratio, token_sort_ratio, partial_ratio)`, threshold 85.
3. **Website host** — final fallback if the URL hosts agree.

Profiles that match a canonical row **already claimed** by another profile
(two people at the same org) are routed to a *dossier-sibling* row with
`custom_fields.dossier_2026._sibling_of_registre` set — never overwriting the
first match. Profiles with no match at all become *dossier-only* rows. Both
carry `custom_fields.sources = {}` so Stage 3 can distinguish them from
canonical rows.

Current numbers (2026-04-19 run):

- 30 PDF profiles parsed from the dossier
- 25 merged into existing canonical rows (16 fuzzy · 4 host · 5 manual)
- 5 dossier-only rows (1 sibling of reg 220, 4 genuinely new)
- 8 canonical rows still without a 2026 dossier counterpart (Mostra-only contacts who didn't make this year's dossier — expected)

## Provenance

Every record emitted by stage 1 carries a `custom_fields.sources.<slug>` block
with the raw source identifiers and ingestion timestamp, so later loads into
Supabase preserve the audit trail.
