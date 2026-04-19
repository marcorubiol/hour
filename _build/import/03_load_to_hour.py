#!/usr/bin/env python3
"""Stage 3 — load staging/02_enriched.jsonl into Supabase `hour-phase0`.

Idempotent, safe to rerun. Uses the Supabase Service Role key (bypasses RLS)
and PostgREST directly over stdlib `urllib` — no third-party deps.

Config:
    Reads the repo-root `.env` (two levels up from this script). Required:
        SUPABASE_URL                = https://<project-ref>.supabase.co
        SUPABASE_SERVICE_ROLE_KEY   = eyJ...
    Optional (with defaults):
        HOUR_ORG_SLUG               = mamemi
        HOUR_ORG_NAME               = MaMeMi
        HOUR_PROJECT_SLUG           = difusion-2026-27
        HOUR_PROJECT_NAME           = MaMeMi — Difusión 2026-2027

Flags:
    --dry-run   : show counts + a sample of each operation without writing.
    --limit N   : process only the first N enriched rows (smoke test).
    --verbose   : print one line per row.

What it does:
    1. Ensure `organization` row exists (mamemi).
    2. Ensure `project` row exists (difusion-2026-27, active).
    3. Ensure tag rows exist:
         src:mostra-igualada-2026 · src:dossier-2026
         procedencia:{catalunya,estatal,internacional}
         tipologia:{programador,fira-festival}
    4. For every row in 02_enriched.jsonl:
       a. Resolve or insert a `contact` row. Lookup key cascade:
            - (organization_id, email)                         if email present
            - (organization_id, sources.mostra_igualada_2026.registre)
            - (organization_id, dossier_2026.order)            dossier-only rows
       b. Merge `custom_fields` via `existing || new` (JSONB-style),
          client-side.
       c. Ensure `tagging` rows for this contact.
       d. Upsert `contact_project (contact_id, project_id)` with default
          status='prospect'. On conflict we DO NOT touch `status` — if
          Marco has already moved someone to 'contacted' etc., we leave it.

Expected ending state (fresh DB):
    organization    : 1
    project         : 1
    tag             : 7
    contact         : 156
    tagging         : ~470
    contact_project : 156 (all 'prospect' on first run)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Optional

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent                   # 03_AGENCY/Hour/
ENRICHED_PATH = SCRIPT_DIR / "staging" / "02_enriched.jsonl"
ENV_PATH = REPO_ROOT / ".env"

# ---------------------------------------------------------------------------
# Env loader (stdlib — no python-dotenv needed)
# ---------------------------------------------------------------------------
def load_env(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    env: dict[str, str] = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$", line)
        if not m:
            continue
        key, val = m.group(1), m.group(2).strip()
        # Strip surrounding quotes if present
        if (val.startswith('"') and val.endswith('"')) or (
            val.startswith("'") and val.endswith("'")
        ):
            val = val[1:-1]
        env[key] = val
    return env


# ---------------------------------------------------------------------------
# HTTP client (stdlib urllib)
# ---------------------------------------------------------------------------
class Supabase:
    def __init__(self, url: str, service_key: str):
        self.base = url.rstrip("/") + "/rest/v1"
        self.headers = {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def _req(
        self,
        method: str,
        path: str,
        *,
        params: Optional[dict] = None,
        body: Optional[Any] = None,
        prefer: Optional[str] = None,
    ) -> Any:
        url = self.base + path
        if params:
            url += "?" + urllib.parse.urlencode(params, safe="(),.:*><=-")
        data = None
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers = dict(self.headers)
        if prefer:
            headers["Prefer"] = prefer
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                body_bytes = resp.read()
                if not body_bytes:
                    return None
                return json.loads(body_bytes.decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")
            raise RuntimeError(
                f"HTTP {e.code} on {method} {path}  params={params}  body={body}\n  → {detail}"
            ) from None

    # -- Shorthand helpers -------------------------------------------------
    def select(self, table: str, **filters) -> list[dict]:
        return self._req("GET", f"/{table}", params=filters) or []

    def insert(self, table: str, row: dict | list[dict], *, return_repr: bool = True) -> Any:
        prefer = "return=representation" if return_repr else "return=minimal"
        return self._req("POST", f"/{table}", body=row, prefer=prefer)

    def update(self, table: str, patch: dict, **filters) -> Any:
        return self._req(
            "PATCH", f"/{table}",
            params=filters, body=patch, prefer="return=representation",
        )

    def upsert(
        self,
        table: str,
        rows: dict | list[dict],
        *,
        on_conflict: str,
        return_repr: bool = True,
    ) -> Any:
        prefer_parts = ["resolution=merge-duplicates"]
        prefer_parts.append("return=representation" if return_repr else "return=minimal")
        return self._req(
            "POST", f"/{table}",
            params={"on_conflict": on_conflict},
            body=rows,
            prefer=",".join(prefer_parts),
        )


# ---------------------------------------------------------------------------
# Ensure organization / project / tags
# ---------------------------------------------------------------------------
def ensure_organization(sb: Supabase, slug: str, name: str, *, dry_run: bool) -> str:
    existing = sb.select("organization", slug=f"eq.{slug}", select="id,name,slug")
    if existing:
        return existing[0]["id"]
    if dry_run:
        print(f"  [DRY] would INSERT organization(slug={slug!r}, name={name!r})")
        return "00000000-0000-0000-0000-000000000000"
    row = sb.insert("organization", {
        "name": name, "slug": slug, "type": "collective",
        "default_locale": "es", "timezone": "Europe/Madrid",
    })
    print(f"  + organization created: {name} ({slug})")
    return row[0]["id"]


def ensure_project(
    sb: Supabase, org_id: str, slug: str, name: str, *, dry_run: bool,
) -> str:
    existing = sb.select(
        "project",
        organization_id=f"eq.{org_id}", slug=f"eq.{slug}", select="id,name,slug,status",
    )
    if existing:
        return existing[0]["id"]
    if dry_run:
        print(f"  [DRY] would INSERT project(slug={slug!r}, name={name!r})")
        return "00000000-0000-0000-0000-000000000001"
    row = sb.insert("project", {
        "organization_id": org_id,
        "name": name, "slug": slug, "status": "active",
        "description": "Imported from Mostra Igualada 2026 export + dossier PDF.",
    })
    print(f"  + project created: {name} ({slug})")
    return row[0]["id"]


TAG_PLAN = [
    ("src:mostra-igualada-2026", "#7a5fff"),
    ("src:dossier-2026",          "#ff7a5f"),
    ("procedencia:catalunya",     "#2ecc71"),
    ("procedencia:estatal",       "#f1c40f"),
    ("procedencia:internacional", "#3498db"),
    ("tipologia:programador",     "#9b59b6"),
    ("tipologia:fira-festival",   "#e74c3c"),
]


def ensure_tags(sb: Supabase, org_id: str, *, dry_run: bool) -> dict[str, str]:
    """Return {tag_name: tag_id} for the seven known tags."""
    existing = sb.select(
        "tag", organization_id=f"eq.{org_id}", select="id,name",
    )
    by_name = {t["name"]: t["id"] for t in existing}
    to_create = [(n, c) for n, c in TAG_PLAN if n not in by_name]
    if not to_create:
        return by_name
    if dry_run:
        print(f"  [DRY] would INSERT {len(to_create)} tags: "
              + ", ".join(n for n, _ in to_create))
        return {**by_name, **{n: f"dry-tag-{n}" for n, _ in to_create}}
    rows = sb.insert("tag", [
        {"organization_id": org_id, "name": n, "color": c} for n, c in to_create
    ])
    for r in rows:
        by_name[r["name"]] = r["id"]
    print(f"  + tags created: {len(to_create)} ({', '.join(n for n, _ in to_create)})")
    return by_name


# ---------------------------------------------------------------------------
# Per-row work
# ---------------------------------------------------------------------------
SLUG_TIPOLOGIA = {
    "programador":  "tipologia:programador",
    "programadora": "tipologia:programador",
    "fira/festival": "tipologia:fira-festival",
    "fira_festival": "tipologia:fira-festival",
}


def tags_for_row(row: dict) -> list[str]:
    """Derive the set of tag names to attach to a contact row."""
    cf = row.get("custom_fields") or {}
    sources = cf.get("sources") or {}
    mostra = sources.get("mostra_igualada_2026") or {}
    names: list[str] = []

    if mostra:
        names.append("src:mostra-igualada-2026")
        proc = (mostra.get("procedencia") or "").lower().strip()
        if proc in ("catalunya", "estatal", "internacional"):
            names.append(f"procedencia:{proc}")
        tipologia = (mostra.get("tipologia") or "").lower().strip()
        key = tipologia.replace("/", "_").replace(" ", "_")
        if tipologia in SLUG_TIPOLOGIA:
            names.append(SLUG_TIPOLOGIA[tipologia])
        elif key in SLUG_TIPOLOGIA:
            names.append(SLUG_TIPOLOGIA[key])

    if "dossier_2026" in cf:
        names.append("src:dossier-2026")
        # Dossier rows also know their section (internacional/estatal) even
        # without a Mostra source — surface it as a procedencia tag.
        section = ((cf["dossier_2026"] or {}).get("section") or "").lower().strip()
        if section in ("estatal", "internacional"):
            proc_tag = f"procedencia:{section}"
            if proc_tag not in names:
                names.append(proc_tag)

    return names


def find_existing_contact(sb: Supabase, org_id: str, row: dict) -> Optional[dict]:
    """Lookup cascade: email → mostra.registre → dossier.order → None."""
    email = (row.get("email") or "").strip().lower() or None
    if email:
        hit = sb.select(
            "contact",
            organization_id=f"eq.{org_id}", email=f"eq.{email}",
            select="id,custom_fields", limit="1",
        )
        if hit:
            return hit[0]

    cf = row.get("custom_fields") or {}
    sources = cf.get("sources") or {}
    mostra = sources.get("mostra_igualada_2026") or {}
    reg = mostra.get("registre")
    if reg is not None:
        hit = sb.select(
            "contact",
            organization_id=f"eq.{org_id}",
            **{"custom_fields->sources->mostra_igualada_2026->>registre": f"eq.{reg}"},
            select="id,custom_fields", limit="1",
        )
        if hit:
            return hit[0]

    dossier = cf.get("dossier_2026") or {}
    order = dossier.get("order")
    if order is not None and not mostra:  # only meaningful for dossier-only rows
        hit = sb.select(
            "contact",
            organization_id=f"eq.{org_id}",
            **{"custom_fields->dossier_2026->>order": f"eq.{order}"},
            select="id,custom_fields", limit="1",
        )
        if hit:
            return hit[0]
    return None


def merge_custom_fields(existing: dict, incoming: dict) -> dict:
    """Deep-merge existing and incoming custom_fields. Incoming wins on leaf
    conflicts but we keep existing sub-keys the incoming doesn't touch —
    equivalent to the JSONB `||` operator nested by one level for `sources`
    and `dossier_2026` blocks."""
    out = dict(existing or {})
    for k, v in (incoming or {}).items():
        if k == "sources" and isinstance(v, dict) and isinstance(out.get("sources"), dict):
            merged_sources = dict(out["sources"])
            merged_sources.update(v)
            out["sources"] = merged_sources
        else:
            out[k] = v
    return out


def upsert_contact(
    sb: Supabase, org_id: str, row: dict, *, dry_run: bool,
) -> Optional[str]:
    """Return contact.id, or None in dry-run."""
    existing = find_existing_contact(sb, org_id, row)
    incoming_cf = row.get("custom_fields") or {}
    payload: dict[str, Any] = {
        "name":       row.get("name") or row.get("company") or "(unknown)",
        "email":      row.get("email"),
        "phone":      row.get("phone"),
        "company":    row.get("company"),
        "role_title": row.get("role_title"),
        "city":       row.get("city"),
        "country":    row.get("country"),
        "website":    row.get("website"),
        "tier":       "tagged",   # all imported contacts start shared
    }
    if existing:
        # Merge custom_fields so we don't lose previously-stored provenance
        merged_cf = merge_custom_fields(existing.get("custom_fields") or {}, incoming_cf)
        payload["custom_fields"] = merged_cf
        if dry_run:
            return existing["id"]
        sb.update("contact", payload, id=f"eq.{existing['id']}")
        return existing["id"]

    # Insert
    payload["organization_id"] = org_id
    payload["custom_fields"] = incoming_cf
    # strip None-valued keys to avoid blowing up NOT NULL defaults
    payload = {k: v for k, v in payload.items() if v is not None}
    if dry_run:
        return None
    inserted = sb.insert("contact", payload)
    return inserted[0]["id"]


def ensure_taggings(
    sb: Supabase,
    org_id: str,
    contact_id: str,
    tag_ids: list[str],
    *,
    dry_run: bool,
) -> int:
    """Create missing tagging rows for this contact. Returns number added."""
    if not tag_ids or not contact_id:
        return 0
    existing_rows = sb.select(
        "tagging",
        organization_id=f"eq.{org_id}",
        entity_type="eq.contact",
        entity_id=f"eq.{contact_id}",
        select="tag_id",
    )
    existing_set = {r["tag_id"] for r in existing_rows}
    missing = [tid for tid in tag_ids if tid not in existing_set]
    if not missing:
        return 0
    if dry_run:
        return len(missing)
    sb.insert("tagging", [
        {"tag_id": tid, "organization_id": org_id,
         "entity_type": "contact", "entity_id": contact_id}
        for tid in missing
    ], return_repr=False)
    return len(missing)


def ensure_contact_project(
    sb: Supabase,
    org_id: str,
    project_id: str,
    contact_id: str,
    *,
    dry_run: bool,
) -> bool:
    """Insert (contact_id, project_id) if not present. Returns True if inserted."""
    if not contact_id:
        return False
    hit = sb.select(
        "contact_project",
        organization_id=f"eq.{org_id}",
        contact_id=f"eq.{contact_id}",
        project_id=f"eq.{project_id}",
        select="contact_id,status", limit="1",
    )
    if hit:
        return False  # leave Marco's funnel state untouched
    if dry_run:
        return True
    sb.insert("contact_project", {
        "contact_id":      contact_id,
        "project_id":      project_id,
        "organization_id": org_id,
        "status":          "prospect",
    }, return_repr=False)
    return True


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    ap = argparse.ArgumentParser(description="Stage 3 loader for Hour import pipeline")
    ap.add_argument("--dry-run", action="store_true",
                    help="Show what would happen without writing to the DB.")
    ap.add_argument("--limit", type=int, default=None,
                    help="Only process the first N enriched rows.")
    ap.add_argument("--verbose", action="store_true",
                    help="Print one line per row processed.")
    args = ap.parse_args()

    if not ENRICHED_PATH.exists():
        sys.exit(f"ERROR: {ENRICHED_PATH} not found. Run Stage 2 first.")

    env = {**load_env(ENV_PATH), **os.environ}
    url = env.get("SUPABASE_URL")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit(
            "ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n"
            f"       Drop them into {ENV_PATH} (gitignored) or export them."
        )
    org_slug = env.get("HOUR_ORG_SLUG") or "mamemi"
    org_name = env.get("HOUR_ORG_NAME") or "MaMeMi"
    project_slug = env.get("HOUR_PROJECT_SLUG") or "difusion-2026-27"
    project_name = env.get("HOUR_PROJECT_NAME") or "MaMeMi — Difusión 2026-2027"

    sb = Supabase(url, key)
    mode = "DRY-RUN" if args.dry_run else "LIVE"
    print(f"== Stage 3 loader ({mode}) ==")
    print(f"  target : {url}")
    print(f"  org    : {org_name} ({org_slug})")
    print(f"  project: {project_name} ({project_slug})")
    print()

    org_id = ensure_organization(sb, org_slug, org_name, dry_run=args.dry_run)
    project_id = ensure_project(sb, org_id, project_slug, project_name, dry_run=args.dry_run)
    tag_ids_by_name = ensure_tags(sb, org_id, dry_run=args.dry_run)

    # Load enriched rows
    rows = [
        json.loads(l) for l in ENRICHED_PATH.read_text().splitlines() if l.strip()
    ]
    if args.limit is not None:
        rows = rows[: args.limit]
    print()
    print(f"Processing {len(rows)} enriched rows...")
    stats = {
        "contacts_upserted": 0, "contacts_skipped": 0,
        "taggings_created":  0,
        "contact_projects_created": 0,
        "contact_projects_preserved": 0,
        "errors": 0,
    }

    for i, row in enumerate(rows, 1):
        try:
            contact_id = upsert_contact(sb, org_id, row, dry_run=args.dry_run)
            stats["contacts_upserted"] += 1

            wanted = tags_for_row(row)
            wanted_ids = [tag_ids_by_name[n] for n in wanted if n in tag_ids_by_name]
            if contact_id:
                stats["taggings_created"] += ensure_taggings(
                    sb, org_id, contact_id, wanted_ids, dry_run=args.dry_run,
                )
                if ensure_contact_project(
                    sb, org_id, project_id, contact_id, dry_run=args.dry_run,
                ):
                    stats["contact_projects_created"] += 1
                else:
                    stats["contact_projects_preserved"] += 1
            if args.verbose:
                name = row.get("name") or row.get("company") or "(unknown)"
                mark = "✓" if contact_id else "·"
                print(f"  {mark} [{i:3d}/{len(rows)}] {name[:40]:40s} "
                      f"tags={len(wanted_ids):1d}")
        except Exception as e:
            stats["errors"] += 1
            name = row.get("name") or row.get("company") or "(unknown)"
            print(f"  ! [{i:3d}/{len(rows)}] {name[:40]:40s} FAILED: {e}")

    print()
    print("=" * 60)
    print("Stage 3 summary")
    print("=" * 60)
    for k, v in stats.items():
        print(f"  {k:28s}: {v}")
    if args.dry_run:
        print()
        print("Dry-run — no writes were made. Re-run without --dry-run to apply.")


if __name__ == "__main__":
    main()
