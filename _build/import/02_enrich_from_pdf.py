#!/usr/bin/env python3
"""
Stage 2 — enrich canonical rows with PDF dossier content.

Input:
    _build/import/sources/mostra-2026/dossier-programadors-2026.pdf
    _build/import/staging/01_canonical.jsonl

Output:
    _build/import/staging/02_enriched.jsonl   (151 rows, some with dossier_2026.* merged)
    _build/import/staging/02_dossier.json     (30 parsed profiles — debug/audit artefact)

What it does:
 1. Extract layout text from the PDF (via `pdftotext -layout`, falling back to pypdf).
 2. Split into 30 profile blocks using "INTERÈS ARTÍSTIC:" + "DESCRIPCIÓ:" as anchors.
 3. Parse each block into {name, entitat_raw, role_title, location_raw, websites, interest, description}.
 4. Fuzzy-match each profile to the canonical rows:
        a. token_set_ratio(profile.entitat_raw, row.company) >= 85
        b. fallback: any profile website host appears in row.website
        c. fallback: manual-matches.yaml (entity_key -> registre)
 5. Merge PDF data into matched rows under custom_fields.dossier_2026.*; fill blank
    name / role_title / website when helpful.
 6. Emit enriched JSONL + print a reconciliation report.

Dependencies: pypdf (fallback), rapidfuzz. Expected in a local venv at
`_build/import/.venv/`.

Idempotent: rerun overwrites staging outputs. Source files are read-only.
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import re
import shutil
import subprocess
import sys
import unicodedata
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

try:
    from rapidfuzz import fuzz
except ImportError:  # pragma: no cover
    sys.exit("ERROR: rapidfuzz not installed. See _build/import/README.md for venv setup.")


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
PDF_PATH = SCRIPT_DIR / "sources" / "mostra-2026" / "dossier-programadors-2026.pdf"
CANONICAL_PATH = SCRIPT_DIR / "staging" / "01_canonical.jsonl"
ENRICHED_PATH = SCRIPT_DIR / "staging" / "02_enriched.jsonl"
DOSSIER_JSON_PATH = SCRIPT_DIR / "staging" / "02_dossier.json"
MANUAL_MATCHES_PATH = SCRIPT_DIR / "manual-matches.yaml"


# ---------------------------------------------------------------------------
# PDF → text
# ---------------------------------------------------------------------------
def pdf_to_text(pdf_path: Path) -> str:
    """Prefer pdftotext -layout (poppler) — it preserves the multi-column layout
    much better than pypdf for this particular PDF. Fall back to pypdf only if
    pdftotext is unavailable."""
    if shutil.which("pdftotext"):
        res = subprocess.run(
            ["pdftotext", "-layout", str(pdf_path), "-"],
            check=True,
            capture_output=True,
            text=True,
        )
        return res.stdout
    # Fallback: pypdf
    try:
        from pypdf import PdfReader
    except ImportError:
        sys.exit("ERROR: neither pdftotext nor pypdf is available.")
    reader = PdfReader(str(pdf_path))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


# ---------------------------------------------------------------------------
# Dossier parser
# ---------------------------------------------------------------------------
INTEREST_MARKER = "INTERÈS ARTÍSTIC:"
DESC_MARKER = "DESCRIPCIÓ:"
SECTION_MARKERS = {"INTERNACIONALS", "ESTATALS", "INTERNACIONALS I ESTATALS"}
# Cover-page lines to skip at the very top of the document (before profile 1).
COVER_SKIP = {"2026", "DOSSIER DE", "PROGRAMADORS"}
ROLE_KEYWORDS_RE = re.compile(
    r"\b(DIRECTOR|DIRECTORA|DIRECCIÓ|SUBDIRECTOR|SUBDIRECTORA|PROGRAMADOR|"
    r"PROGRAMADORA|COORDINADOR|COORDINADORA|COORDINACIÓ|CAP\s+DE|PRODUCTORA|"
    r"PRODUCTOR|RESPONSABLE|CURADOR|CURADORA|EQUIP|ADJUNT|ADJUNTA|SECRETARIO|"
    r"SECRETARIA|TECNICA|TÈCNIC|TÈCNICA|DRAMATURG|DRAMATURGO|MIEMBRO)\b",
    re.IGNORECASE,
)
URL_RE = re.compile(r"(https?://\S+|www\.\S+|\S+\.(com|org|net|cat|es|ad|cz|eu|fi|be|ie|it|fr|pt|uk|mx|cn|cymru|nu)(?:/\S*)?)")


@dataclass
class DossierProfile:
    order: int
    section: str  # "internacional" | "estatal"
    name: str
    entitat_raw: str
    role_title: Optional[str]
    location_raw: Optional[str]
    websites: list[str] = field(default_factory=list)
    interest: str = ""
    description: str = ""
    header_raw: str = ""


def _is_uppercase_name_line(line: str) -> bool:
    """Is this a line of ALL-UPPERCASE name/org fragment?
    Uses Python's Unicode-aware str.isupper() so Š, Ė, Ý, Č etc. all work."""
    s = line.strip()
    if not s:
        return False
    # No digits allowed in name/org header lines
    if any(c.isdigit() for c in s):
        return False
    # Only letters + a small allowed punctuation set
    if not all(c.isalpha() or c in " '.-·/’·" or c.isspace() for c in s):
        return False
    # str.isupper() → True iff all cased chars are uppercase and ≥1 is cased
    return s.isupper()


def _dehyphenate_name_lines(lines: list[str]) -> str:
    """Join consecutive name lines, removing trailing '-' (word continuation)."""
    out = []
    for i, ln in enumerate(lines):
        ln = ln.strip()
        if ln.endswith("-") and i + 1 < len(lines):
            out.append(ln[:-1])  # strip dash, no space
        else:
            out.append(ln + " ")
    return "".join(out).strip()


def split_into_profiles(text: str) -> list[tuple[str, str, str, str]]:
    """Return list of (header_block, interest_block, desc_block, section).
    section = 'internacional' or 'estatal', determined by most recent section marker."""
    lines = text.splitlines()

    # Find anchor line indices
    interest_idx = [i for i, ln in enumerate(lines) if ln.strip().startswith(INTEREST_MARKER)]
    desc_idx = [i for i, ln in enumerate(lines) if ln.strip() == DESC_MARKER or ln.strip().startswith(DESC_MARKER)]

    if len(interest_idx) != len(desc_idx):
        print(f"WARN: {len(interest_idx)} interest markers vs {len(desc_idx)} desc markers")

    # Find ESTATALS marker (boundary between sections)
    estatal_line = None
    for i, ln in enumerate(lines):
        if ln.strip() == "ESTATALS":
            estatal_line = i
            break

    # Locate the FIRST real name line in the document — everything above it
    # is cover-page cruft (2026 / DOSSIER DE / PROGRAMADORS / INTERNACIONALS I ESTATALS).
    doc_header_start = 0
    for j, ln in enumerate(lines):
        s = ln.strip()
        if _is_uppercase_name_line(s) and s not in SECTION_MARKERS and s not in COVER_SKIP:
            doc_header_start = j
            break

    profiles = []
    for n, i_idx in enumerate(interest_idx):
        # Header = from previous header-start (end of previous description, or top of doc) to line before i_idx
        # We define "previous header start" as: after previous desc's text, the first uppercase name line.
        if n == 0:
            header_start = doc_header_start
        else:
            # Walk back from i_idx until we find the start of this profile's header block.
            # Previous profile's description ends where this profile's header begins.
            # Strategy: find the last uppercase name line before i_idx that's preceded by
            # non-uppercase text (or is in the "gap" between profiles).
            prev_i = interest_idx[n - 1]
            # Start search just after previous profile's desc had some content
            search_start = prev_i
            # Find next section of uppercase lines after prev_i
            header_start = None
            in_blank = False
            for j in range(prev_i + 1, i_idx):
                line = lines[j].strip()
                if _is_uppercase_name_line(line) and line not in SECTION_MARKERS:
                    # This is candidate start of new profile's header — but only if preceded
                    # by either blank or section marker or lowercase text
                    # Walk back one non-blank line
                    k = j - 1
                    while k > prev_i and not lines[k].strip():
                        k -= 1
                    prev_text = lines[k].strip() if k > prev_i else ""
                    # Accept if:
                    #  - previous non-blank is section marker, OR
                    #  - previous non-blank has lowercase letters (i.e., description prose), OR
                    #  - previous non-blank is blank (j-1 blank or j is after gap)
                    if (prev_text in SECTION_MARKERS
                        or any(c.islower() for c in prev_text)
                        or not prev_text):
                        header_start = j
                        break
            if header_start is None:
                # Fallback: use desc of previous profile + 1 blank line
                header_start = desc_idx[n - 1] + 1

        # Find corresponding desc_idx (>= i_idx)
        d_idx = next((d for d in desc_idx if d > i_idx), None)
        if d_idx is None:
            continue

        # Find next profile start to bound description
        if n + 1 < len(interest_idx):
            next_i = interest_idx[n + 1]
            # Walk back from next_i to find where that profile's header starts;
            # our description ends just before it.
            desc_end = None
            for j in range(next_i - 1, d_idx, -1):
                line = lines[j].strip()
                if _is_uppercase_name_line(line) and line not in SECTION_MARKERS:
                    # Check that the line above this is either blank, lowercase, or section
                    k = j - 1
                    while k > d_idx and not lines[k].strip():
                        k -= 1
                    prev_text = lines[k].strip() if k > d_idx else ""
                    if (prev_text in SECTION_MARKERS
                        or any(c.islower() for c in prev_text)
                        or not prev_text):
                        desc_end = j
                        # walk up to include contiguous uppercase name lines
                        # (handled by outer loop next iteration's header_start)
                        break
            if desc_end is None:
                desc_end = next_i
        else:
            desc_end = len(lines)

        header = "\n".join(lines[header_start:i_idx])
        interest = "\n".join(lines[i_idx + 1:d_idx])
        # Strip "INTERÈS ARTÍSTIC:" suffix content on same line
        first_interest_line = lines[i_idx].strip()
        if first_interest_line != INTEREST_MARKER:
            # There's text after INTERÈS ARTÍSTIC: on same line
            interest = first_interest_line[len(INTEREST_MARKER):].strip() + "\n" + interest
        desc = "\n".join(lines[d_idx + 1:desc_end])

        # Determine section based on line numbers
        section = "estatal" if (estatal_line is not None and i_idx > estatal_line) else "internacional"
        profiles.append((header, interest, desc, section))
    return profiles


def parse_header(header: str) -> tuple[str, str, Optional[str], Optional[str], list[str]]:
    """Parse a header block into (name, entitat_raw, role_title, location_raw, websites)."""
    # Remove section markers and strip leading whitespace per line
    raw_lines = [ln.rstrip() for ln in header.splitlines()]
    lines = [ln.strip() for ln in raw_lines if ln.strip() and ln.strip() not in SECTION_MARKERS]

    if not lines:
        return ("", "", None, None, [])

    # Extract websites
    websites = []
    remaining_lines = []
    for ln in lines:
        matches = URL_RE.findall(ln)
        if matches:
            for m in matches:
                url = m[0] if isinstance(m, tuple) else m
                # Normalize — strip trailing punctuation
                url = url.rstrip(".,;:")
                if not url.startswith("http"):
                    url = "https://" + url
                websites.append(url)
        else:
            remaining_lines.append(ln)

    # Extract uppercase_head: all consecutive uppercase lines at top (name + possibly
    # single-word org header). We keep the full list for matching, then derive `name`
    # by taking only the first 2 lines (covers 27/30 profiles correctly).
    # The 3 three-part names (MARCO ANTONIO SAUCEDO, ADDJIMA NA PATALUNG,
    # JOANA MARIA ROSSELLÓ) end up with their third surname token in entitat_raw,
    # which is harmless for fuzzy matching and can be corrected post-import.
    uppercase_head = []
    rest_start = 0
    for i, ln in enumerate(remaining_lines):
        if _is_uppercase_name_line(ln) and len(ln.split()) <= 3:
            uppercase_head.append(ln)
        else:
            rest_start = i
            break
    else:
        rest_start = len(remaining_lines)

    # Name = first 2 uppercase-head lines (with dehyphenation for wrapped surnames
    # like "VAN-/DECANDE-/LAERE"). If a dash-joined first line already spans the
    # whole name (rare), the 2nd line is the next fragment.
    name_lines = uppercase_head[:2]
    name = _dehyphenate_name_lines(name_lines).strip()
    # Everything uppercase beyond line 2 becomes entitat header (for org acronyms
    # like FITIJ, IMAGINATE, ASSITEJ, FESTAC that sit below the name).
    rest = uppercase_head[2:] + remaining_lines[rest_start:]

    # Role: scan rest lines; role line is ALL CAPS (no lowercase) and matches role keywords
    role = None
    role_idx = None
    for i, ln in enumerate(rest):
        if not any(c.islower() for c in ln) and ROLE_KEYWORDS_RE.search(ln):
            role = ln
            role_idx = i
            break
    # Some roles span 2 lines (e.g. "COORDINACIÓ DE PRODUCCIÓ ARTÍSTICA\nCURADOR/A KIDS+FAMILY")
    if role_idx is not None and role_idx + 1 < len(rest):
        nxt = rest[role_idx + 1]
        if not any(c.islower() for c in nxt) and ROLE_KEYWORDS_RE.search(nxt):
            role = role + " / " + nxt
            # drop that line from entitat
            rest = rest[:role_idx + 1] + rest[role_idx + 2:]

    # Remaining = entitat + location
    if role_idx is not None:
        entitat_location = rest[:role_idx] + rest[role_idx + 1:]
    else:
        entitat_location = rest

    # Location: last line with a comma AND lowercase chars (city names are not all-caps)
    location = None
    entitat_lines = entitat_location[:]
    for i in range(len(entitat_location) - 1, -1, -1):
        ln = entitat_location[i]
        if "," in ln and any(c.islower() for c in ln):
            location = ln
            entitat_lines.pop(i)
            break
        # Or a single location word like "Helsinki", "Turquia", "Andorra", "Francia"
        if len(ln.split()) == 1 and any(c.islower() for c in ln):
            location = ln
            entitat_lines.pop(i)
            break

    entitat_raw = " ".join(entitat_lines).strip()
    return (name, entitat_raw, role, location, websites)


def title_case_name(upper_name: str) -> str:
    """Convert 'FFION BOWEN' -> 'Ffion Bowen', preserving apostrophes and accents."""
    parts = upper_name.split()
    out = []
    for p in parts:
        if len(p) <= 2 and p.upper() in {"J.", "J", "DE", "LA", "VAN", "NA"}:
            # Keep initials uppercased, small words capitalized
            if p.endswith("."):
                out.append(p.upper())
            else:
                out.append(p.capitalize())
        else:
            out.append(p.capitalize())
    return " ".join(out)


def parse_dossier(pdf_text: str) -> list[DossierProfile]:
    blocks = split_into_profiles(pdf_text)
    profiles: list[DossierProfile] = []
    for n, (header, interest, desc, section) in enumerate(blocks, start=1):
        name, entitat_raw, role, location, websites = parse_header(header)
        # Collapse multiple blank lines in interest/description, strip
        interest_clean = re.sub(r"\n\s*\n+", "\n\n", interest.strip())
        desc_clean = re.sub(r"\n\s*\n+", "\n\n", desc.strip())
        profiles.append(DossierProfile(
            order=n,
            section=section,
            name=title_case_name(name) if name else "",
            entitat_raw=entitat_raw,
            role_title=role,
            location_raw=location,
            websites=websites,
            interest=interest_clean,
            description=desc_clean,
            header_raw=header.strip(),
        ))
    return profiles


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------
# Generic industry words that mustn't carry a match on their own —
# otherwise "Festival Z" or "Teatre X" would ride any profile with "festival"
# or "teatre" in the entitat block.
GENERIC_TOKENS = {
    "festival", "festivals", "teatre", "teatro", "theatre", "theater",
    "arts", "art", "companyia", "company", "cia", "associacio", "association",
    "fundacio", "fundacion", "foundation", "sala", "casa", "ciutat", "city",
    "escola", "school", "centre", "center", "circuit", "circuito",
    "internacional", "international", "festival", "fira", "feria", "mostra",
}


def _norm_for_match(s: str) -> str:
    """Lowercase, strip accents, normalize curly quotes, collapse punctuation/whitespace,
    drop connector stop-words. We intentionally KEEP distinguishing nouns like
    'festival', 'teatre', 'arts' — dropping them produces false positives against
    rows whose entire company name is e.g. 'Festival Z'."""
    if not s:
        return ""
    # Fold curly quotes/apostrophes to ASCII before NFKD (NFKD leaves them intact)
    s = s.replace("\u2019", "'").replace("\u2018", "'").replace("\u02BC", "'")
    s = s.replace("\u201C", '"').replace("\u201D", '"')
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    s = re.sub(r"[/,\-\.&()'\"]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    # Only drop tiny connector words (articles + conjunctions)
    s = re.sub(r"\b(de|del|la|el|els|les|i|y|per|a|al|en|els|les|des|dels|d)\b", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _host_from_url(url: str) -> Optional[str]:
    try:
        p = urlparse(url if url.startswith("http") else "https://" + url)
        host = (p.netloc or p.path).lower()
        if host.startswith("www."):
            host = host[4:]
        # Strip port/query
        host = host.split("/")[0].split(":")[0].strip()
        return host or None
    except Exception:
        return None


def match_profile(
    profile: DossierProfile,
    canonical: list[dict],
    manual_map: dict[str, int],
) -> tuple[Optional[int], Optional[str], Optional[int]]:
    """Return (canonical_index, match_method, match_score) or (None, None, None)."""
    # 1) Manual override (keyed by a stable slug)
    slug = _norm_for_match(profile.entitat_raw or profile.name).replace(" ", "-")
    if slug in manual_map:
        reg = manual_map[slug]
        for i, row in enumerate(canonical):
            r = row["custom_fields"]["sources"]["mostra_igualada_2026"].get("registre")
            if r == reg:
                return (i, "manual", 100)

    # 2) Fuzzy on company field.
    # Build a focused profile key: entitat_raw dominates, location_raw adds city signal.
    # We deliberately exclude `profile.name` — person names bloat the token bag
    # and don't help match company identity.
    prof_bag = " ".join(filter(None, [profile.entitat_raw, profile.location_raw]))
    prof_key = _norm_for_match(prof_bag)
    prof_tokens = {t for t in prof_key.split() if len(t) >= 3}
    best_idx = None
    best_score = 0
    for i, row in enumerate(canonical):
        comp_key = _norm_for_match(row.get("company") or "")
        if not comp_key:
            continue
        comp_tokens = {t for t in comp_key.split() if len(t) >= 3}
        if not comp_tokens:
            continue
        shared = prof_tokens & comp_tokens
        if not shared:
            continue
        # --- Guards to prevent token_set_ratio inflation (the "Festival Z" problem) ---
        # Distinctive evidence: at least one shared token must be non-generic
        # (e.g. not "festival"/"teatre"/"arts" alone). These tokens are so common
        # they match dozens of unrelated orgs.
        distinctive_shared = {t for t in shared if t not in GENERIC_TOKENS}
        if not distinctive_shared:
            continue
        # Short-company guard: if company has ≤ 2 significant tokens, require ALL
        # to be shared (e.g. profile must contain both "passage" and "festival"
        # to match company "Passage Festival").
        if len(comp_tokens) <= 2 and len(shared) < len(comp_tokens):
            continue
        # Weak-overlap guard: if the company side has ≥ 3 tokens but only 1 is
        # shared, require that single token to be distinctive AND long enough
        # to be a likely proper noun (len ≥ 6). Catches acronyms "FITIJ" (5 chars
        # won't qualify — we'll route those through manual-matches.yaml).
        if len(shared) < 2 and len(comp_tokens) >= 3:
            if not any(len(t) >= 6 for t in distinctive_shared):
                continue
        # --- Score: max of complementary fuzzy strategies ---
        # - token_set_ratio handles "one side has extra words" (profile has name +
        #   location; company is just the org).
        # - token_sort_ratio catches reorderings without the subset-inflation quirk.
        # - partial_ratio rescues long/short strings with one common substring.
        score = max(
            fuzz.token_set_ratio(prof_key, comp_key),
            fuzz.token_sort_ratio(prof_key, comp_key),
            fuzz.partial_ratio(prof_key, comp_key),
        )
        if score > best_score:
            best_score = score
            best_idx = i
    if best_score >= 85:
        return (best_idx, "fuzzy", int(best_score))

    # 3) Website host fallback
    prof_hosts = {_host_from_url(u) for u in profile.websites}
    prof_hosts.discard(None)
    for i, row in enumerate(canonical):
        web = row.get("website") or ""
        # Canonical website may be "a.com - b.com" or "a.com, b.com"
        for token in re.split(r"[\s,;&]+", web):
            host = _host_from_url(token)
            if host and host in prof_hosts:
                return (i, "host", 100)
            # Partial host match (claps.lombardia.it vs www.claps.lombardia.it after strip)
            for ph in prof_hosts:
                if ph and host and (ph.endswith(host) or host.endswith(ph)):
                    return (i, "host-partial", 95)

    # 4) Return best fuzzy score for reporting even if below threshold
    return (None, None, int(best_score) if best_score else None)


# ---------------------------------------------------------------------------
# Manual matches loader
# ---------------------------------------------------------------------------
def load_manual_matches(path: Path) -> dict[str, int]:
    """Load minimal YAML without a yaml dependency. Supports `slug: 123` lines only."""
    if not path.exists():
        return {}
    out: dict[str, int] = {}
    for ln in path.read_text().splitlines():
        ln = ln.strip()
        if not ln or ln.startswith("#"):
            continue
        m = re.match(r"^([a-z0-9\-]+)\s*:\s*(\d+)\s*(?:#.*)?$", ln)
        if m:
            out[m.group(1)] = int(m.group(2))
    return out


# ---------------------------------------------------------------------------
# Merge
# ---------------------------------------------------------------------------
def merge_dossier_into_row(row: dict, profile: DossierProfile) -> None:
    """Mutate row in place — add dossier_2026 block under custom_fields, fill blanks."""
    cf = row.setdefault("custom_fields", {})
    dossier = cf.setdefault("dossier_2026", {})
    dossier.update({
        "order": profile.order,
        "section": profile.section,
        "name": profile.name,
        "entitat_raw": profile.entitat_raw,
        "role_title": profile.role_title,
        "location_raw": profile.location_raw,
        "websites": profile.websites,
        "interest": profile.interest,
        "description": profile.description,
    })
    # Fill blanks at top level if empty
    if profile.name and (not row.get("name") or row["name"] == row.get("company")):
        row["name"] = profile.name
    if profile.role_title and not row.get("role_title"):
        row["role_title"] = profile.role_title
    if profile.websites and not row.get("website"):
        row["website"] = profile.websites[0]


def row_from_profile(profile: DossierProfile) -> dict:
    """Build a canonical-shaped row for a PDF profile with NO Mostra counterpart.
    These enter the dataset via the dossier alone — no `mostra_igualada_2026`
    source block, only `dossier_2026`. Stage 3 upserts on (organization_id, email|name).
    """
    # Split location_raw back into city/country if possible — fall back to raw
    city = None
    country = None
    if profile.location_raw:
        # Typical forms: "Porto, Portugal" / "Istanbul, Turkey" / "Buenos Aires, Argentina"
        parts = [x.strip() for x in profile.location_raw.split(",") if x.strip()]
        if len(parts) >= 2:
            city, country = parts[0], parts[-1]
        elif len(parts) == 1:
            city = parts[0]

    return {
        "name": profile.name or None,
        "company": profile.entitat_raw or None,
        "role_title": profile.role_title or None,
        "email": None,
        "phone": None,
        "website": (profile.websites[0] if profile.websites else None),
        "city": city,
        "country": country,
        "procedencia": profile.section,   # "internacional" | "estatal"
        "custom_fields": {
            "sources": {},
            "dossier_2026": {
                "order": profile.order,
                "section": profile.section,
                "name": profile.name,
                "entitat_raw": profile.entitat_raw,
                "role_title": profile.role_title,
                "location_raw": profile.location_raw,
                "websites": profile.websites,
                "interest": profile.interest,
                "description": profile.description,
                "_match_method": "new",
                "_match_score": None,
                "_origin": "dossier-only",
            },
        },
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    if not PDF_PATH.exists():
        sys.exit(f"ERROR: PDF not found at {PDF_PATH}")
    if not CANONICAL_PATH.exists():
        sys.exit(f"ERROR: canonical not found at {CANONICAL_PATH}. Run 01_normalize.py first.")

    print(f"Reading PDF: {PDF_PATH.name}", file=sys.stderr)
    pdf_text = pdf_to_text(PDF_PATH)

    print(f"Parsing dossier into profiles...", file=sys.stderr)
    profiles = parse_dossier(pdf_text)
    print(f"  parsed {len(profiles)} profiles", file=sys.stderr)

    # Dump parsed profiles for audit
    DOSSIER_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
    DOSSIER_JSON_PATH.write_text(
        json.dumps([asdict(p) for p in profiles], indent=2, ensure_ascii=False)
    )
    print(f"  wrote {DOSSIER_JSON_PATH.relative_to(SCRIPT_DIR.parent.parent)}", file=sys.stderr)

    print(f"Loading canonical: {CANONICAL_PATH.name}", file=sys.stderr)
    canonical = [json.loads(l) for l in CANONICAL_PATH.read_text().splitlines() if l.strip()]
    print(f"  loaded {len(canonical)} rows", file=sys.stderr)

    manual_map = load_manual_matches(MANUAL_MATCHES_PATH)
    if manual_map:
        print(f"  manual overrides: {len(manual_map)}", file=sys.stderr)

    # Match
    matched: list[tuple[DossierProfile, int, str, int]] = []
    unmatched_profiles: list[tuple[DossierProfile, Optional[int]]] = []
    used_canonical_idx: set[int] = set()
    for p in profiles:
        idx, method, score = match_profile(p, canonical, manual_map)
        if idx is None:
            unmatched_profiles.append((p, score))
        elif idx in used_canonical_idx:
            # Collision: a previous profile already claimed this canonical row
            # (e.g. two people at the same org). Don't overwrite — promote the
            # second profile to a dossier-only sibling row and remember which
            # company it belongs to so Stage 3 can group them.
            collided_with_reg = canonical[idx]["custom_fields"]["sources"][
                "mostra_igualada_2026"
            ].get("registre")
            unmatched_profiles.append((p, score))
            # Mark for the row_from_profile call below
            p.__dict__["_collided_with_reg"] = collided_with_reg
        else:
            matched.append((p, idx, method, score))
            used_canonical_idx.add(idx)

    # Merge
    for p, idx, method, score in matched:
        merge_dossier_into_row(canonical[idx], p)
        # Also stash match metadata in the dossier block for audit
        canonical[idx]["custom_fields"]["dossier_2026"]["_match_method"] = method
        canonical[idx]["custom_fields"]["dossier_2026"]["_match_score"] = score

    # Append dossier-only rows for unmatched PDF profiles (genuine new contacts
    # not in the Mostra CSV) AND for profiles that collided on a canonical row
    # already claimed by a colleague. These have `sources: {}` — Stage 3
    # recognises them as "dossier-origin" and upserts by (organization_id, name).
    new_rows: list[dict] = []
    for p, _ in unmatched_profiles:
        row = row_from_profile(p)
        collided = getattr(p, "_collided_with_reg", None)
        if collided is not None:
            row["custom_fields"]["dossier_2026"]["_sibling_of_registre"] = collided
            row["custom_fields"]["dossier_2026"]["_origin"] = "dossier-sibling"
        new_rows.append(row)

    # Write enriched
    ENRICHED_PATH.parent.mkdir(parents=True, exist_ok=True)
    with ENRICHED_PATH.open("w") as out:
        for row in canonical:
            out.write(json.dumps(row, ensure_ascii=False) + "\n")
        for row in new_rows:
            out.write(json.dumps(row, ensure_ascii=False) + "\n")

    # -------- Report --------
    print()
    print("=" * 64)
    print(f"Stage 2 — enrich from PDF dossier")
    print("=" * 64)
    print(f"PDF profiles parsed : {len(profiles)}")
    print(f"Matched to canonical: {len(matched)}")
    for m in sorted(matched, key=lambda x: x[0].order):
        p, idx, method, score = m
        row = canonical[idx]
        reg = row["custom_fields"]["sources"]["mostra_igualada_2026"].get("registre")
        print(f"  #{p.order:2d} {p.name[:25]:25s} [{p.section[:4]}] → reg {reg:3d}  {(row.get('company') or '')[:32]:32s}  via {method} ({score})")

    if unmatched_profiles:
        print()
        print(f"Unmatched PDF profiles: {len(unmatched_profiles)}")
        for p, score in unmatched_profiles:
            hint = f"best fuzzy score: {score}" if score is not None else "no fuzzy candidate"
            print(f"  #{p.order:2d} {p.name}  [{p.section}]  entitat={p.entitat_raw!r}  hosts={[_host_from_url(u) for u in p.websites]}  ({hint})")

    # Canonical internacional/estatal rows NOT touched by dossier
    internacional_estatal = [
        (i, r) for i, r in enumerate(canonical)
        if r["custom_fields"]["sources"]["mostra_igualada_2026"].get("procedencia") in ("internacional", "estatal")
    ]
    untouched = [r for i, r in internacional_estatal if i not in used_canonical_idx]
    if untouched:
        print()
        print(f"Canonical internacional/estatal rows with NO dossier match: {len(untouched)}")
        for r in untouched:
            src = r["custom_fields"]["sources"]["mostra_igualada_2026"]
            print(f"  reg {src.get('registre'):3d} [{src.get('procedencia')}]  {(r.get('company') or '')[:40]:40s}  web={r.get('website')}")

    print()
    print(f"Dossier-only new rows appended: {len(new_rows)} "
          f"(PDF profiles without a Mostra counterpart — will be inserted fresh)")
    total_out = len(canonical) + len(new_rows)
    print(f"Wrote: {ENRICHED_PATH.relative_to(SCRIPT_DIR.parent.parent)}  "
          f"({total_out} rows = {len(canonical)} canonical + {len(new_rows)} dossier-only)")
    print(f"Wrote: {DOSSIER_JSON_PATH.relative_to(SCRIPT_DIR.parent.parent)}  ({len(profiles)} profiles)")


if __name__ == "__main__":
    main()
