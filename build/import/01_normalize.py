#!/usr/bin/env python3
"""
Hour — Import Pipeline · Stage 1 · Normalize
=============================================

Reads the 4 Mostra Igualada 2026 CSV exports, dedupes by `Número Registre`,
filters `Tipologia ∈ {Programador, Fira/Festival}`, and emits a canonical
JSONL file shaped for the Hour `contact` table.

Pure stdlib (Python >= 3.10). Idempotent — overwrites the staging file.

See ../import-plan.md §3–§4 for the full spec.
"""

from __future__ import annotations

import csv
import datetime as dt
import json
import re
import sys
from collections import Counter
from pathlib import Path

# ---------------------------------------------------------------------------- #
# Paths                                                                        #
# ---------------------------------------------------------------------------- #

SCRIPT_DIR = Path(__file__).resolve().parent
SOURCES_DIR = SCRIPT_DIR / "sources" / "mostra-2026"
STAGING_DIR = SCRIPT_DIR / "staging"
OUT_FILE = STAGING_DIR / "01_canonical.jsonl"

CSV_FILES = [
    SOURCES_DIR / "page-1_registre-1-105.csv",
    SOURCES_DIR / "page-2_registre-106-205.csv",
    SOURCES_DIR / "page-3_registre-206-305.csv",
    SOURCES_DIR / "page-4_registre-306-392.csv",
]

SOURCE_SLUG = "mostra_igualada_2026"
TIPOLOGIA_KEEP = {"Programador", "Fira/Festival"}

# ---------------------------------------------------------------------------- #
# Country map (raw `Província` value from CSV → ISO 3166-1 alpha-2)            #
# Only populated for the values actually observed in this dataset.             #
# Unmapped non-ES provinces log a warning and produce country=None.            #
# ---------------------------------------------------------------------------- #

SPANISH_PROVINCES = {
    "álava", "albacete", "alacant", "alicante", "almería", "asturias",
    "ávila", "avila", "badajoz", "barcelona", "bizkaia", "vizcaya",
    "burgos", "cáceres", "caceres", "cádiz", "cadiz", "cantabria",
    "castelló", "castellón", "castellon", "ciudad real", "córdoba", "cordoba",
    "a coruña", "la coruña", "coruña", "cuenca", "girona", "granada",
    "guadalajara", "gipuzkoa", "guipúzcoa", "guipuzcoa", "huelva", "huesca",
    "illes balears", "islas baleares", "baleares", "jaén", "jaen",
    "león", "leon", "lleida", "lugo", "madrid", "málaga", "malaga",
    "murcia", "navarra", "nafarroa", "ourense", "palencia", "las palmas",
    "pontevedra", "la rioja", "rioja", "salamanca",
    "santa cruz de tenerife", "tenerife", "segovia", "sevilla", "soria",
    "tarragona", "teruel", "toledo", "valència", "valencia",
    "valladolid", "zamora", "zaragoza", "ceuta", "melilla",
}

COUNTRY_MAP = {
    # Observed in the Mostra 2026 dataset — extend as new sources land.
    # Keys are lowercased provincia_raw values; values are ISO 3166-1 alpha-2.
    # UK regions → GB, UK-specific countries can be distinguished later.
    "lituània": "LT", "lituania": "LT",
    "gal·les": "GB", "gales": "GB", "wales": "GB",
    "anglaterra": "GB", "england": "GB",
    "escòcia": "GB", "escocia": "GB", "scotland": "GB",
    "regne unit": "GB", "reino unido": "GB", "united kingdom": "GB", "uk": "GB",
    "antrim and newtownabbey": "GB",  # Northern Ireland admin district
    "irlanda del nord": "GB", "northern ireland": "GB",
    "irlanda": "IE",
    "connacht": "IE",  # Irish province
    "itàlia": "IT", "italia": "IT", "italy": "IT",
    "brescia": "IT",  # Italian province (Lombardy)
    "frança": "FR", "francia": "FR", "france": "FR",
    "alemanya": "DE", "alemania": "DE", "germany": "DE",
    "portugal": "PT",
    "bèlgica": "BE", "belgica": "BE", "belgium": "BE",
    "holanda": "NL", "països baixos": "NL", "netherlands": "NL",
    "suïssa": "CH", "suiza": "CH", "switzerland": "CH",
    "àustria": "AT", "austria": "AT",
    "dinamarca": "DK", "denmark": "DK",
    "suècia": "SE", "suecia": "SE", "sweden": "SE",
    "finlàndia": "FI", "finlandia": "FI", "finland": "FI",
    "noruega": "NO", "norway": "NO",
    "polònia": "PL", "polonia": "PL", "poland": "PL",
    "grècia": "GR", "grecia": "GR", "greece": "GR",
    "hongria": "HU", "hungary": "HU",
    "república txeca": "CZ", "chequia": "CZ", "czech republic": "CZ",
    "estònia": "EE", "estonia": "EE",
    "letònia": "LV", "letonia": "LV", "latvia": "LV",
    "romania": "RO",
    "bulgària": "BG", "bulgaria": "BG",
    "eslovènia": "SI", "eslovenia": "SI", "slovenia": "SI",
    "eslovàquia": "SK", "eslovaquia": "SK", "slovakia": "SK",
    "croàcia": "HR", "croacia": "HR", "croatia": "HR",
    "dalmatia": "HR",  # Croatian coastal region
    "andorra": "AD",
    "zacatecas": "MX",  # Mexican state
}

# Fallback when provincia_raw is empty: infer from city name.
# Kept conservative — only unambiguous, well-known cities.
CITY_COUNTRY_MAP = {
    "rome": "IT", "roma": "IT", "milan": "IT", "milano": "IT", "napoli": "IT",
    "paris": "FR", "lyon": "FR", "marseille": "FR",
    "berlin": "DE", "munich": "DE", "münchen": "DE", "hamburg": "DE", "köln": "DE",
    "london": "GB", "manchester": "GB", "edinburgh": "GB", "glasgow": "GB",
    "cardiff": "GB", "belfast": "GB",
    "dublin": "IE", "galway": "IE",
    "amsterdam": "NL", "rotterdam": "NL", "utrecht": "NL",
    "brussels": "BE", "brussel": "BE", "bruxelles": "BE",
    "antwerpen": "BE", "antwerp": "BE", "gent": "BE", "ghent": "BE",
    "kortrijk": "BE", "ieper": "BE", "ypres": "BE", "leuven": "BE",
    "vienna": "AT", "wien": "AT", "salzburg": "AT",
    "zurich": "CH", "zürich": "CH", "geneva": "CH", "bern": "CH",
    "lisbon": "PT", "lisboa": "PT", "porto": "PT", "santarém": "PT", "santarem": "PT",
    "copenhagen": "DK", "københavn": "DK", "aarhus": "DK",
    "stockholm": "SE", "göteborg": "SE", "gothenburg": "SE", "malmö": "SE",
    "oslo": "NO", "bergen": "NO",
    "helsinki": "FI", "turku": "FI", "tampere": "FI",
    "warsaw": "PL", "warszawa": "PL", "krakow": "PL", "kraków": "PL",
    "prague": "CZ", "praha": "CZ", "brno": "CZ", "hradec králové": "CZ",
    "budapest": "HU",
    "vilnius": "LT", "kaunas": "LT",
    "riga": "LV",
    "tallinn": "EE",
    "athens": "GR", "atenas": "GR",
    "bucharest": "RO", "bucurești": "RO",
    "sofia": "BG",
    "ljubljana": "SI",
    "zagreb": "HR", "split": "HR",
    "bratislava": "SK",
    "shanghai": "CN", "beijing": "CN",
    "tokyo": "JP", "kyoto": "JP",
    "new york": "US", "los angeles": "US", "chicago": "US", "boston": "US",
    "mexico city": "MX", "zacatecas": "MX",
    "sant julià de lòria": "AD", "andorra la vella": "AD",
}

# Last-resort: country-code TLD on the email domain.
# Only unambiguous ccTLDs — NOT .es (Catalan orgs often use .cat/.com),
# NOT .com/.org/.net (generic).
EMAIL_TLD_COUNTRY = {
    "dk": "DK", "it": "IT", "cn": "CN", "fr": "FR", "de": "DE",
    "uk": "GB", "be": "BE", "nl": "NL", "pt": "PT", "ie": "IE",
    "fi": "FI", "se": "SE", "no": "NO", "at": "AT", "ch": "CH",
    "cz": "CZ", "pl": "PL", "gr": "GR", "hu": "HU", "ro": "RO",
    "bg": "BG", "si": "SI", "sk": "SK", "hr": "HR",
    "lt": "LT", "lv": "LV", "ee": "EE", "ad": "AD", "mx": "MX",
    "jp": "JP", "kr": "KR",
}

# ---------------------------------------------------------------------------- #
# Normalizers                                                                  #
# ---------------------------------------------------------------------------- #

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
ES_MOBILE_RE = re.compile(r"^[6789]\d{8}$")  # 9 digits, starts 6/7/8/9

_SMALL_WORDS = {"de", "del", "d'", "i", "la", "el", "les", "els", "les", "y"}


def normalize_email(raw: str | None) -> str | None:
    if not raw:
        return None
    e = raw.strip().lower()
    return e if EMAIL_RE.match(e) else None


def normalize_phone(raw: str | None) -> tuple[str | None, str | None]:
    """Return (e164_or_none, raw_kept_for_audit_when_unnormalized)."""
    if not raw:
        return None, None
    s = raw.strip()
    # Excel force-text prefix: leading apostrophe
    if s.startswith("'"):
        s = s[1:]
    # Strip whitespace, dots, dashes, parens
    cleaned = re.sub(r"[\s.\-()]", "", s)
    if not cleaned:
        return None, None
    if cleaned.startswith("+") and cleaned[1:].isdigit() and 8 <= len(cleaned) - 1 <= 15:
        return cleaned, None
    if cleaned.startswith("00") and cleaned[2:].isdigit():
        return "+" + cleaned[2:], None
    if ES_MOBILE_RE.match(cleaned):
        return "+34" + cleaned, None
    # Otherwise keep raw for audit; leave phone NULL
    return None, s


def normalize_website(raw: str | None) -> str | None:
    if not raw:
        return None
    s = raw.strip()
    if not s:
        return None
    if not re.match(r"^https?://", s, re.I):
        s = "https://" + s
    # Lowercase scheme + host only, keep path case-sensitive
    m = re.match(r"^(https?)://([^/]+)(.*)$", s, re.I)
    if not m:
        return s
    scheme, host, rest = m.group(1).lower(), m.group(2).lower(), m.group(3)
    # Strip single trailing slash when path is empty/just /
    if rest in ("", "/"):
        rest = ""
    return f"{scheme}://{host}{rest}"


def title_case_preserve_small(s: str) -> str:
    """Title-case while preserving small connecting words in lowercase."""
    words = re.split(r"(\s+)", s.strip())
    out = []
    for i, w in enumerate(words):
        if w.isspace() or not w:
            out.append(w)
            continue
        lower = w.lower()
        if i > 0 and lower in _SMALL_WORDS:
            out.append(lower)
        else:
            # Preserve separators (-, ', /): capitalize each sub-part around them
            parts = re.split(r"([\-'/])", w)
            parts = [p.capitalize() if p and p not in ("-", "'", "/") else p for p in parts]
            out.append("".join(parts))
    return "".join(out)


def normalize_city(raw: str | None) -> str | None:
    if not raw:
        return None
    s = raw.strip()
    return title_case_preserve_small(s) if s else None


def normalize_provincia(raw: str | None) -> str | None:
    if not raw:
        return None
    return title_case_preserve_small(raw.strip())


def infer_country(
    provincia_raw: str | None,
    procedencia: str | None,
    city_raw: str | None = None,
    email: str | None = None,
) -> str | None:
    """ES for catalunya/estatal, else mapped from Província, city, or email TLD."""
    if procedencia in ("catalunya", "estatal"):
        return "ES"
    if provincia_raw:
        key = provincia_raw.strip().lower()
        if key in SPANISH_PROVINCES:
            return "ES"
        if key in COUNTRY_MAP:
            return COUNTRY_MAP[key]
    if city_raw:
        city_key = city_raw.strip().lower()
        if city_key in CITY_COUNTRY_MAP:
            return CITY_COUNTRY_MAP[city_key]
    if email and "@" in email:
        tld = email.rsplit(".", 1)[-1].lower()
        if tld in EMAIL_TLD_COUNTRY:
            return EMAIL_TLD_COUNTRY[tld]
    return None


# ---------------------------------------------------------------------------- #
# Main                                                                         #
# ---------------------------------------------------------------------------- #


def load_all_rows() -> list[dict]:
    rows: list[dict] = []
    for path in CSV_FILES:
        if not path.exists():
            sys.exit(f"Missing CSV: {path}")
        with path.open(encoding="utf-8-sig") as fh:
            reader = csv.DictReader(fh)
            for r in reader:
                rows.append({**r, "_source_file": path.name})
    return rows


def canonicalize(row: dict, ingested_at: str) -> dict | None:
    registre_raw = (row.get("Número Registre") or "").strip()
    if not registre_raw.isdigit():
        return None
    registre = int(registre_raw)

    tipologia = (row.get("Tipologia") or "").strip()
    procedencia = (row.get("Categoria procedència") or "").strip().lower()
    entitat = (row.get("Entitat o companyia") or "").strip()
    email = normalize_email(row.get("Email"))
    phone, phone_raw = normalize_phone(row.get("Telèfon principal"))
    website = normalize_website(row.get("Web"))
    address = (row.get("Carrer d'enviament") or "").strip() or None
    city_raw = (row.get("Ciutat d'enviament") or "").strip()
    city = normalize_city(city_raw)
    provincia_raw = (row.get("Província") or "").strip()
    provincia = normalize_provincia(provincia_raw)
    country = infer_country(provincia_raw, procedencia, city_raw, email)

    # Tags used by stage 3 to create taggings. Include underscore prefix
    # so stage 3 knows to pop them before inserting into contact.
    tipologia_slug = {
        "Programador": "programador",
        "Fira/Festival": "festival",
    }.get(tipologia, tipologia.lower().replace("/", "-").replace(" ", "-"))

    source_tags = [
        f"src:{SOURCE_SLUG.replace('_','-')}",
        f"procedencia:{procedencia}" if procedencia else None,
        f"tipologia:{tipologia_slug}" if tipologia_slug else None,
    ]
    source_tags = [t for t in source_tags if t]

    source_block = {
        "registre": registre,
        "tipologia": tipologia or None,
        "procedencia": procedencia or None,
        "address": address,
        "provincia_raw": provincia_raw or None,
        "ingested_at": ingested_at,
    }
    if phone_raw:
        source_block["phone_raw"] = phone_raw

    return {
        "name": entitat or None,       # fallback; enrich stage overrides when dossier matches
        "email": email,
        "phone": phone,
        "company": entitat or None,
        "role_title": None,
        "tier": "tagged",
        "city": city,
        "country": country,
        "website": website,
        "notes": None,
        "custom_fields": {
            "sources": {
                SOURCE_SLUG: source_block,
            },
        },
        "_source_tags": source_tags,
        "_drop_reason": None,
    }


def main() -> None:
    STAGING_DIR.mkdir(parents=True, exist_ok=True)

    ingested_at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    raw = load_all_rows()
    total_in = len(raw)

    # Dedupe by Número Registre — keep first occurrence
    seen: dict[str, dict] = {}
    dup = 0
    for r in raw:
        k = (r.get("Número Registre") or "").strip()
        if not k:
            continue
        if k in seen:
            dup += 1
        else:
            seen[k] = r

    dropped_tipologia: list[tuple[int, str]] = []
    dropped_invalid: list[str] = []
    kept: list[dict] = []
    unmapped_countries: Counter = Counter()

    for r in seen.values():
        canon = canonicalize(r, ingested_at)
        if canon is None:
            dropped_invalid.append(r.get("Número Registre") or "?")
            continue
        tip = (r.get("Tipologia") or "").strip()
        if tip not in TIPOLOGIA_KEEP:
            dropped_tipologia.append((canon["custom_fields"]["sources"][SOURCE_SLUG]["registre"], tip))
            continue
        # Track any non-ES records that still came out as None country.
        # Key by "provincia_raw || city" so we can see which inference failed.
        proc = canon["custom_fields"]["sources"][SOURCE_SLUG].get("procedencia")
        if proc == "internacional" and canon["country"] is None:
            prov_raw = canon["custom_fields"]["sources"][SOURCE_SLUG].get("provincia_raw")
            key = prov_raw or canon["city"] or "(no provincia, no city)"
            unmapped_countries[key] += 1
        kept.append(canon)

    # Sort by registre for stable output
    kept.sort(key=lambda x: x["custom_fields"]["sources"][SOURCE_SLUG]["registre"])

    with OUT_FILE.open("w", encoding="utf-8") as fh:
        for c in kept:
            fh.write(json.dumps(c, ensure_ascii=False) + "\n")

    # -------------------------------------------------------------------- #
    # Report                                                               #
    # -------------------------------------------------------------------- #
    tip_dist = Counter(r.get("Tipologia", "").strip() for r in seen.values())
    proc_dist = Counter(r.get("Categoria procedència", "").strip() for r in seen.values())
    kept_proc = Counter(k["custom_fields"]["sources"][SOURCE_SLUG]["procedencia"] for k in kept)
    kept_country_unknown = sum(1 for k in kept if k["country"] is None)
    without_email = sum(1 for k in kept if not k["email"])
    phone_normalized = sum(1 for k in kept if k["phone"])
    phone_kept_raw = sum(
        1 for k in kept
        if "phone_raw" in k["custom_fields"]["sources"][SOURCE_SLUG]
    )

    print("=" * 72)
    print("Stage 1 · Normalize — Mostra Igualada 2026")
    print("=" * 72)
    print(f"Ingested at      : {ingested_at}")
    print(f"Source files     : {len(CSV_FILES)}")
    print(f"Raw rows         : {total_in}")
    print(f"Unique by reg#   : {len(seen)}   (duplicates collapsed: {dup})")
    print(f"Invalid dropped  : {len(dropped_invalid)}")
    print()
    print("Tipologia distribution (input universe):")
    for k, v in tip_dist.most_common():
        print(f"  {k or '(blank)':30s} {v:>4d}")
    print()
    print("Procedència distribution (input universe):")
    for k, v in proc_dist.most_common():
        print(f"  {k or '(blank)':30s} {v:>4d}")
    print()
    print(f"Kept after filter (Programador + Fira/Festival): {len(kept)}")
    for k, v in kept_proc.most_common():
        print(f"  procedencia:{k or '(blank)':20s} {v:>4d}")
    print()
    print(f"Emails present      : {len(kept) - without_email} / {len(kept)} "
          f"({without_email} missing)")
    print(f"Phones normalized   : {phone_normalized} (E.164)")
    print(f"Phones kept raw     : {phone_kept_raw} (in custom_fields.sources.*.phone_raw)")
    print(f"Country unresolved  : {kept_country_unknown}")
    if unmapped_countries:
        print("  Unmapped Província (internacional) → needs COUNTRY_MAP entry:")
        for k, v in unmapped_countries.most_common():
            print(f"    {k!r}: {v}")
    print()
    print(f"Output → {OUT_FILE.relative_to(SCRIPT_DIR.parent.parent)}")
    print(f"  {len(kept)} rows written")


if __name__ == "__main__":
    main()
