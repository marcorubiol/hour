#!/usr/bin/env python3
"""Stage 3 — load staging/02_enriched.jsonl into Supabase `hour-phase0`.

Adapted 2026-04-19 to **reset v2**: no `project.type` column (ADR-007),
no `tag` / `tagging` tables (deferred to Phase 0.5), `engagement.status`
defaults to `contacted` (anti-CRM enum, ADR-001). Provenance that used to
be encoded as tags now lives in `person.custom_fields.sources.*`.

Idempotent, safe to rerun. Uses the Supabase Service Role key (bypasses RLS)
and PostgREST directly over stdlib `urllib` — no third-party deps.

Config:
    Reads the repo-root `.env` (two levels up from this script). Required:
        SUPABASE_URL               = https://<project-ref>.supabase.co
        SUPABASE_SERVICE_ROLE_KEY  = eyJ...
    Optional (with defaults):
        HOUR_WORKSPACE_SLUG = marco-rubiol
        HOUR_WORKSPACE_NAME = Marco Rubiol
        HOUR_PROJECT_SLUG   = mamemi
        HOUR_PROJECT_NAME   = MaMeMi
        HOUR_SEASON         = 2026-27
        HOUR_OWNER_EMAIL    = marcorubiol@gmail.com  (resolves engagement.created_by)

Flags:
    --dry-run          : show counts + a sample of each operation without writing.
    --limit N          : process only the first N enriched rows (smoke test).
    --verbose          : print one line per row.
    --skip-engagements : load only persons (use before the owner has signed up).

What it does:
    1. Ensure `workspace` row exists (marco-rubiol, kind=personal).
       The INSERT fires `workspace_seed_roles` in cascade, seeding 15 rows
       in `workspace_role`.
    2. Ensure `project` row exists (mamemi, status=active). No `type` column.
    3. Resolve the owner user from HOUR_OWNER_EMAIL. If absent:
         - Load persons only (person.created_by is nullable).
         - Skip engagements.
         - Exit with a clear warning.
    4. For every row in 02_enriched.jsonl:
       a. Upsert a `person` row (deduped on email; lookup cascade below).
          `custom_fields` merge preserves `sources.*` across reruns.
       b. Unless --skip-engagements: upsert `engagement`
          (workspace_id × project_id × person_id) with status='contacted'
          (anti-CRM default). Respects Marco's status changes — ON CONFLICT
          DO NOTHING. `season` goes into engagement.custom_fields.

Expected ending state (fresh DB, owner signed in):
    workspace      : 1   (marco-rubiol)
    workspace_role : 15  (seeded by trigger)
    project        : 1   (mamemi, no type column)
    person         : 156
    engagement     : 156 (all status='contacted' on first run)
    tag / tagging  : 0   (dropped in reset v2 — deferred to Phase 0.5)
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
        self.rest_base = url.rstrip("/") + "/rest/v1"
        self.auth_base = url.rstrip("/") + "/auth/v1"
        self.headers = {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def _req(
        self,
        method: str,
        url: str,
        *,
        params: Optional[dict] = None,
        body: Optional[Any] = None,
        prefer: Optional[str] = None,
    ) -> Any:
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
                f"HTTP {e.code} on {method} {url}  params={params}\n  → {detail}"
            ) from None

    # -- Shorthand helpers -------------------------------------------------
    def select(self, table: str, **filters) -> list[dict]:
        return self._req("GET", f"{self.rest_base}/{table}", params=filters) or []

    def insert(self, table: str, row: dict | list[dict], *, return_repr: bool = True) -> Any:
        prefer = "return=representation" if return_repr else "return=minimal"
        return self._req("POST", f"{self.rest_base}/{table}", body=row, prefer=prefer)

    def update(self, table: str, patch: dict, **filters) -> Any:
        return self._req(
            "PATCH", f"{self.rest_base}/{table}",
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
            "POST", f"{self.rest_base}/{table}",
            params={"on_conflict": on_conflict},
            body=rows,
            prefer=",".join(prefer_parts),
        )

    # -- Auth Admin --------------------------------------------------------
    def find_user_by_email(self, email: str) -> Optional[dict]:
        """Return the auth.users row for `email` via the Auth Admin API, or None."""
        url = f"{self.auth_base}/admin/users"
        resp = self._req("GET", url, params={"email": email})
        if not resp:
            return None
        users = resp.get("users") if isinstance(resp, dict) else resp
        if not users:
            return None
        for u in users:
            if u.get("email", "").lower() == email.lower():
                return u
        return None


# ---------------------------------------------------------------------------
# Ensure workspace / project
# ---------------------------------------------------------------------------
def ensure_workspace(sb: Supabase, slug: str, name: str, *, dry_run: bool) -> str:
    existing = sb.select("workspace", slug=f"eq.{slug}", select="id,name,slug,kind")
    if existing:
        return existing[0]["id"]
    if dry_run:
        print(f"  [DRY] would INSERT workspace(slug={slug!r}, name={name!r}, kind=personal)")
        return "00000000-0000-0000-0000-000000000000"
    row = sb.insert("workspace", {
        "name": name, "slug": slug, "kind": "personal",
        "country": "ES", "timezone": "Europe/Madrid",
    })
    print(f"  + workspace created: {name} ({slug})  (15 system roles seeded by trigger)")
    return row[0]["id"]


def ensure_project(
    sb: Supabase, workspace_id: str, slug: str, name: str, *, dry_run: bool,
) -> str:
    existing = sb.select(
        "project",
        workspace_id=f"eq.{workspace_id}", slug=f"eq.{slug}",
        select="id,name,slug,status",
    )
    if existing:
        return existing[0]["id"]
    if dry_run:
        print(f"  [DRY] would INSERT project(slug={slug!r}, name={name!r}, status=active)")
        return "00000000-0000-0000-0000-000000000001"
    row = sb.insert("project", {
        "workspace_id": workspace_id,
        "name": name, "slug": slug, "status": "active",
        "description": "Imported from Mostra Igualada 2026 export + dossier PDF.",
    })
    print(f"  + project created: {name} ({slug})")
    return row[0]["id"]


# ---------------------------------------------------------------------------
# Per-row work
# ---------------------------------------------------------------------------
def find_existing_person(sb: Supabase, row: dict) -> Optional[dict]:
    """Lookup cascade: email → mostra.registre → dossier.order → None.

    Persons are GLOBAL — no workspace_id filter. Email uniqueness is enforced
    by a UNIQUE constraint on person.email (citext, case-insensitive).
    """
    email = (row.get("email") or "").strip().lower() or None
    if email:
        hit = sb.select(
            "person",
            email=f"eq.{email}",
            select="id,custom_fields,full_name", limit="1",
        )
        if hit:
            return hit[0]

    cf = row.get("custom_fields") or {}
    sources = cf.get("sources") or {}
    mostra = sources.get("mostra_igualada_2026") or {}
    reg = mostra.get("registre")
    if reg is not None:
        hit = sb.select(
            "person",
            **{"custom_fields->sources->mostra_igualada_2026->>registre": f"eq.{reg}"},
            select="id,custom_fields", limit="1",
        )
        if hit:
            return hit[0]

    dossier = cf.get("dossier_2026") or {}
    order = dossier.get("order")
    if order is not None and not mostra:
        hit = sb.select(
            "person",
            **{"custom_fields->dossier_2026->>order": f"eq.{order}"},
            select="id,custom_fields", limit="1",
        )
        if hit:
            return hit[0]
    return None


def merge_custom_fields(existing: dict, incoming: dict) -> dict:
    """Deep-merge. Incoming wins on leaf conflicts, but sub-keys under
    `sources` that incoming doesn't touch are preserved (equivalent to the
    JSONB `||` operator nested by one level for `sources` / `dossier_2026`)."""
    out = dict(existing or {})
    for k, v in (incoming or {}).items():
        if k == "sources" and isinstance(v, dict) and isinstance(out.get("sources"), dict):
            merged_sources = dict(out["sources"])
            merged_sources.update(v)
            out["sources"] = merged_sources
        else:
            out[k] = v
    return out


def upsert_person(
    sb: Supabase, owner_user_id: Optional[str], row: dict, *, dry_run: bool,
) -> Optional[str]:
    """Return person.id, or None in dry-run."""
    existing = find_existing_person(sb, row)
    incoming_cf = row.get("custom_fields") or {}
    payload: dict[str, Any] = {
        "full_name":         row.get("name") or row.get("company") or "(unknown)",
        "email":             (row.get("email") or "").strip().lower() or None,
        "phone":             row.get("phone"),
        "city":              row.get("city"),
        "country":           row.get("country"),
        "website":           row.get("website"),
        "organization_name": row.get("company"),
        "title":             row.get("role_title"),
    }
    if existing:
        merged_cf = merge_custom_fields(existing.get("custom_fields") or {}, incoming_cf)
        payload["custom_fields"] = merged_cf
        if dry_run:
            return existing["id"]
        sb.update("person", payload, id=f"eq.{existing['id']}")
        return existing["id"]

    payload["custom_fields"] = incoming_cf
    if owner_user_id:
        payload["created_by"] = owner_user_id
    payload = {k: v for k, v in payload.items() if v is not None}
    if dry_run:
        return None
    inserted = sb.insert("person", payload)
    return inserted[0]["id"]


def ensure_engagement(
    sb: Supabase,
    workspace_id: str,
    project_id: str,
    person_id: str,
    owner_user_id: str,
    season: Optional[str],
    *,
    dry_run: bool,
) -> bool:
    """Insert engagement if (workspace, project, person) tuple not present.
    Returns True if inserted. Leaves existing engagement.status untouched on reruns.
    """
    if not person_id:
        return False
    hit = sb.select(
        "engagement",
        workspace_id=f"eq.{workspace_id}",
        project_id=f"eq.{project_id}",
        person_id=f"eq.{person_id}",
        select="id,status", limit="1",
    )
    if hit:
        return False
    if dry_run:
        return True
    custom_fields = {"season": season} if season else {}
    sb.insert("engagement", {
        "workspace_id": workspace_id,
        "project_id":   project_id,
        "person_id":    person_id,
        "status":       "contacted",   # anti-CRM default (reset v2 enum)
        "created_by":   owner_user_id,
        "custom_fields": custom_fields,
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
    ap.add_argument("--skip-engagements", action="store_true",
                    help="Load persons only. Use before the owner has signed up.")
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
    workspace_slug = env.get("HOUR_WORKSPACE_SLUG") or "marco-rubiol"
    workspace_name = env.get("HOUR_WORKSPACE_NAME") or "Marco Rubiol"
    project_slug   = env.get("HOUR_PROJECT_SLUG")   or "mamemi"
    project_name   = env.get("HOUR_PROJECT_NAME")   or "MaMeMi"
    season         = env.get("HOUR_SEASON")         or "2026-27"
    owner_email    = env.get("HOUR_OWNER_EMAIL")    or "marcorubiol@gmail.com"

    sb = Supabase(url, key)
    mode = "DRY-RUN" if args.dry_run else "LIVE"
    print(f"== Stage 3 loader ({mode}) — reset v2 ==")
    print(f"  target   : {url}")
    print(f"  workspace: {workspace_name} ({workspace_slug})")
    print(f"  project  : {project_name} ({project_slug})")
    print(f"  season   : {season}")
    print(f"  owner    : {owner_email}")
    print()

    workspace_id = ensure_workspace(sb, workspace_slug, workspace_name, dry_run=args.dry_run)
    project_id   = ensure_project(sb, workspace_id, project_slug, project_name, dry_run=args.dry_run)

    # Resolve the owner user.
    owner_user = sb.find_user_by_email(owner_email)
    owner_user_id = owner_user["id"] if owner_user else None

    if args.skip_engagements or not owner_user_id:
        if not owner_user_id:
            print(f"  ! No auth.users row for {owner_email} — engagements will be skipped.")
            print(f"    (sign up first, then rerun without --skip-engagements)")
        args.skip_engagements = True
    else:
        print(f"  owner user resolved: {owner_user_id}")

    # Load enriched rows
    rows = [
        json.loads(l) for l in ENRICHED_PATH.read_text().splitlines() if l.strip()
    ]
    if args.limit is not None:
        rows = rows[: args.limit]
    print()
    print(f"Processing {len(rows)} enriched rows...")
    stats = {
        "persons_upserted":      0,
        "engagements_created":   0,
        "engagements_preserved": 0,
        "engagements_skipped":   0,
        "errors":                0,
    }

    for i, row in enumerate(rows, 1):
        try:
            person_id = upsert_person(sb, owner_user_id, row, dry_run=args.dry_run)
            stats["persons_upserted"] += 1

            if person_id:
                if args.skip_engagements:
                    stats["engagements_skipped"] += 1
                else:
                    if ensure_engagement(
                        sb, workspace_id, project_id, person_id, owner_user_id,
                        season, dry_run=args.dry_run,
                    ):
                        stats["engagements_created"] += 1
                    else:
                        stats["engagements_preserved"] += 1

            if args.verbose:
                name = row.get("name") or row.get("company") or "(unknown)"
                mark = "✓" if person_id else "·"
                print(f"  {mark} [{i:3d}/{len(rows)}] {name[:50]:50s}")
        except Exception as e:
            stats["errors"] += 1
            name = row.get("name") or row.get("company") or "(unknown)"
            print(f"  ! [{i:3d}/{len(rows)}] {name[:50]:50s} FAILED: {e}")

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
