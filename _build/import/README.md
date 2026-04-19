# Hour — Import Pipeline

Three-stage ingest from heterogeneous sources (CSV exports, PDF dossiers) into
the Hour schema in Supabase. See `../import-plan.md` for the full spec.

## Layout

```
_build/import/
├── README.md                    this file (committed)
├── 01_normalize.py              stage 1: CSV → canonical JSONL (committed)
├── 02_enrich_from_pdf.py        stage 2: PDF merge (to be written)
├── 03_load_to_hour.py           stage 3: upsert to Supabase (to be written)
├── manual-matches.yaml          PDF↔CSV manual overrides (gitignored)
├── sources/                     raw inputs (gitignored — PII-adjacent)
│   └── mostra-2026/
│       ├── page-1_registre-1-105.csv
│       ├── page-2_registre-106-205.csv
│       ├── page-3_registre-206-305.csv
│       ├── page-4_registre-306-392.csv
│       └── dossier-programadors-2026.pdf
└── staging/                     intermediate outputs (gitignored)
    ├── 01_canonical.jsonl       produced by stage 1
    └── 02_enriched.jsonl        produced by stage 2
```

## Running

Scripts use the system Python 3 (>= 3.10) with only stdlib. Stage 2 will add
`rapidfuzz` + `pypdf`; stage 3 will add `supabase` + `python-dotenv`.

```sh
# From repo root
python3 _build/import/01_normalize.py
# → writes _build/import/staging/01_canonical.jsonl
# → prints a summary (rows in/out, drops, distribution)
```

All stages are idempotent — rerunning overwrites the staging file in place.
Source files are read-only; none of the scripts mutate them.

## Provenance

Every record emitted by stage 1 carries a `custom_fields.sources.<slug>` block
with the raw source identifiers and ingestion timestamp, so later loads into
Supabase preserve the audit trail.
