-- Directorio global de salas, fase 1 (Marco, 2026-10-10;
-- research/product/21-venue-directory-sources.md, _tasks.md «Directorio global
-- de salas»).
--
-- Today every space types its venues by hand. This adds ONE global directory,
-- read-only for users, filled from public sources by an import that runs with
-- the service role (scripts/venue-directory/). A company «adopts» a directory
-- entry: it is COPIED into a `venue` of its space, which then belongs to the
-- space and is edited freely. The directory is never edited from the app.
--
-- WHAT THIS DOES:
--   1. `venue_directory_source`: one row per public source, with its licence,
--      its attribution text and the date of the data. The credits page reads
--      it. Every directory row points at one (its licence is per row).
--   2. `venue_directory`: the entries. Only data OF THE ENTITY: name, kind,
--      address, municipality, country, coordinates, IANA zone, capacity,
--      website, and at most a generic email/phone of the venue. NO PERSONAL
--      DATA (Marco, 2026-10-10: names, nominative emails and people's phones
--      wait for a legal consultation). Stable origin id per row
--      (`source`, `source_id`), plus the Wikidata QID as a bridge between
--      sources. A field that came from another source than the row's says so
--      in `field_sources`; every record folded into the row on dedup is kept
--      in `sources`, so no merge happens without a trace.
--   3. An entry is never deleted: when a source stops listing it, the import
--      sets `status = 'missing'` and `last_seen_at` stays at the last time it
--      was seen («no vista desde <fecha>»). A company may have adopted it.
--   4. `venue.directory_id`: the directory entry a venue was adopted from.
--      Optional, ON DELETE SET NULL, one per space.
--   5. `adopt_directory_venue(workspace, entry)`: copies the entry into the
--      space (idempotent: adopting twice returns the same venue; a venue of
--      the space with the same name and city is linked, not duplicated, and
--      its fields are NOT overwritten).
--
-- RLS: any authenticated user reads the directory; nobody writes it through
-- the API (no INSERT/UPDATE/DELETE grant to anon or authenticated, and no
-- write policy). The import writes with the service role.
--
-- Leaves room for the later phase (corrections validated by two companies,
-- Marco 10-10): an entry has a stable id and per-field provenance, so a
-- correction can point at (entry, field) and be applied with history. Not
-- built here.
--
-- ADDITIVE according to § 34: two new tables, one nullable column, one new
-- function. The deployed Worker never reads any of it.
-- Rollback: build/runbooks/rollback-20261010-venue-directory.sql.

-- ── 1 · sources ───────────────────────────────────────────────────────────
CREATE TABLE public.venue_directory_source (
  key          text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,31}$'),
  name         text NOT NULL CHECK (length(btrim(name)) > 0),
  publisher    text NOT NULL,
  license      text NOT NULL,
  license_url  text NOT NULL,
  source_url   text NOT NULL,
  attribution  text NOT NULL,
  data_date    date,
  imported_at  timestamptz
);

COMMENT ON TABLE public.venue_directory_source IS
  'Directorio global de salas: one row per public source (licence, attribution, date of the data). Read by the credits page.';

ALTER TABLE public.venue_directory_source ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_directory_source FORCE ROW LEVEL SECURITY;

CREATE POLICY venue_directory_source_select ON public.venue_directory_source
  FOR SELECT TO authenticated USING (true);

REVOKE ALL ON TABLE public.venue_directory_source FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.venue_directory_source TO authenticated;
GRANT ALL ON TABLE public.venue_directory_source TO service_role;

-- ── 2 · entries ───────────────────────────────────────────────────────────
CREATE TABLE public.venue_directory (
  id             uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  source         text NOT NULL REFERENCES public.venue_directory_source (key),
  source_id      text NOT NULL CHECK (length(btrim(source_id)) > 0),
  wikidata_qid   text CHECK (wikidata_qid ~ '^Q[1-9][0-9]*$'),
  name           text NOT NULL CHECK (length(btrim(name)) > 0),
  kind           text NOT NULL CHECK (kind IN (
                   'theatre', 'opera', 'concert_hall', 'auditorium', 'arena',
                   'creation_centre', 'multipurpose', 'cultural_centre', 'other_stage')),
  designation    text,
  address        text,
  postal_code    text,
  city           text,
  region         text,
  country        character(2) NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  latitude       double precision CHECK (latitude BETWEEN -90 AND 90),
  longitude      double precision CHECK (longitude BETWEEN -180 AND 180),
  timezone       text CHECK (timezone IS NULL OR (length(timezone) BETWEEN 1 AND 64
                   AND timezone ~ '^[A-Za-z][A-Za-z0-9_+/-]*$')),
  capacity       integer CHECK (capacity > 0),
  website        text,
  email          text,
  phone          text,
  search_key     text NOT NULL,
  field_sources  jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(field_sources) = 'object'),
  sources        jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sources) = 'array'),
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'missing')),
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_directory_coords_pair CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CONSTRAINT venue_directory_source_uid UNIQUE (source, source_id)
);

COMMENT ON TABLE public.venue_directory IS
  'Directorio global de salas (fase 1): read-only for users, filled by scripts/venue-directory with the service role. Entity data only, never personal data. Never deleted: status missing + last_seen_at.';
COMMENT ON COLUMN public.venue_directory.source IS
  'The source the row comes from; its licence is venue_directory_source.license.';
COMMENT ON COLUMN public.venue_directory.source_id IS
  'Stable id in the source: Identifiant_deps (Basilic), ID PECCat (Gencat), QID (Wikidata), a name+municipality key for sources without one (jcyl).';
COMMENT ON COLUMN public.venue_directory.wikidata_qid IS
  'Bridge between sources: the Wikidata item for this venue, when known.';
COMMENT ON COLUMN public.venue_directory.designation IS
  'The official label or type in the source wording (Scène nationale, Ateneu, Teatro Cine...).';
COMMENT ON COLUMN public.venue_directory.timezone IS
  'IANA zone derived from the coordinates (nearest GeoNames populated place), never guessed. NULL when it could not be derived.';
COMMENT ON COLUMN public.venue_directory.email IS
  'Only a GENERIC email of the venue (info@, taquilla@...), kept when it is recognisably not a person. Otherwise NULL.';
COMMENT ON COLUMN public.venue_directory.phone IS
  'Only a landline of the venue from its own record. Mobiles are dropped (they are usually a person).';
COMMENT ON COLUMN public.venue_directory.search_key IS
  'normName(name + city), the same normalisation the search uses ($lib/venue-directory).';
COMMENT ON COLUMN public.venue_directory.field_sources IS
  'Field -> source key, for every field that came from another source than the row''s (e.g. {"capacity":"wikidata"}).';
COMMENT ON COLUMN public.venue_directory.sources IS
  'Every source record folded into this row: [{source, source_id, matched_by, distance_m}]. The first is the row''s own.';
COMMENT ON COLUMN public.venue_directory.status IS
  'active = listed by its source in the last import; missing = not listed since last_seen_at. Never deleted.';

CREATE UNIQUE INDEX venue_directory_qid_uidx ON public.venue_directory (wikidata_qid)
  WHERE wikidata_qid IS NOT NULL;
CREATE INDEX venue_directory_search_trgm_idx ON public.venue_directory
  USING gin (search_key extensions.gin_trgm_ops);
CREATE INDEX venue_directory_country_idx ON public.venue_directory (country, status);

CREATE TRIGGER venue_directory_set_updated_at BEFORE UPDATE ON public.venue_directory
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.venue_directory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_directory FORCE ROW LEVEL SECURITY;

CREATE POLICY venue_directory_select ON public.venue_directory
  FOR SELECT TO authenticated USING (true);

REVOKE ALL ON TABLE public.venue_directory FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.venue_directory TO authenticated;
GRANT ALL ON TABLE public.venue_directory TO service_role;

-- ── 3 · the adopted venue ────────────────────────────────────────────────
ALTER TABLE public.venue
  ADD COLUMN directory_id uuid REFERENCES public.venue_directory (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.venue.directory_id IS
  'The directory entry this venue was adopted from (copied, then edited freely). NULL for a venue typed by hand.';

CREATE UNIQUE INDEX venue_workspace_directory_uidx ON public.venue (workspace_id, directory_id)
  WHERE deleted_at IS NULL AND directory_id IS NOT NULL;

-- ── 4 · adopt ─────────────────────────────────────────────────────────────
-- Copies a directory entry into a venue of the space and returns it.
--   · Same membership gate as create_venue.
--   · Already adopted in this space → that venue, untouched.
--   · A live venue of the space with the same name and city (the unique
--     index create_venue relies on) → it is linked (directory_id set when it
--     had none) and returned; its fields are NOT overwritten.
--   · Otherwise a new venue with name, city, country, address, capacity,
--     timezone, and the generic email/phone as one contact named after the
--     venue.
-- An entry that does not exist gives 22023.
CREATE FUNCTION public.adopt_directory_venue(p_workspace_id uuid, p_directory_id uuid)
RETURNS public.venue
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_entry public.venue_directory;
  v_venue public.venue;
  v_base text;
  v_slug text;
  v_n int := 1;
  v_contacts jsonb := '[]'::jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_membership m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id = v_caller
      AND m.accepted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'not a member of this workspace' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_entry FROM public.venue_directory WHERE id = p_directory_id;
  IF v_entry.id IS NULL THEN
    RAISE EXCEPTION 'directory entry not found' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_venue FROM public.venue
  WHERE workspace_id = p_workspace_id AND directory_id = p_directory_id AND deleted_at IS NULL;
  IF v_venue.id IS NOT NULL THEN
    RETURN v_venue;
  END IF;

  SELECT * INTO v_venue FROM public.venue
  WHERE workspace_id = p_workspace_id
    AND deleted_at IS NULL
    AND lower(name) = lower(btrim(v_entry.name))
    AND coalesce(lower(city), '') = coalesce(lower(btrim(v_entry.city)), '');
  IF v_venue.id IS NOT NULL THEN
    IF v_venue.directory_id IS NULL THEN
      UPDATE public.venue SET directory_id = p_directory_id
      WHERE id = v_venue.id
      RETURNING * INTO v_venue;
    END IF;
    RETURN v_venue;
  END IF;

  IF v_entry.email IS NOT NULL OR v_entry.phone IS NOT NULL THEN
    v_contacts := jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'name', btrim(v_entry.name), 'email', v_entry.email, 'phone', v_entry.phone)));
  END IF;

  v_base := coalesce(nullif(public.slugify(v_entry.name), ''), 'venue');
  v_slug := v_base;
  WHILE EXISTS (
    SELECT 1 FROM public.venue
    WHERE workspace_id = p_workspace_id AND slug = v_slug AND deleted_at IS NULL
  ) LOOP
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  END LOOP;

  INSERT INTO public.venue (
    workspace_id, name, city, country, address, capacity, timezone, contacts,
    slug, directory_id, created_by
  ) VALUES (
    p_workspace_id, btrim(v_entry.name), nullif(btrim(coalesce(v_entry.city, '')), ''),
    v_entry.country, v_entry.address, v_entry.capacity, v_entry.timezone, v_contacts,
    v_slug, p_directory_id, v_caller
  )
  RETURNING * INTO v_venue;
  RETURN v_venue;
END;
$$;

COMMENT ON FUNCTION public.adopt_directory_venue(uuid, uuid) IS
  'Directorio global de salas: copy an entry into a venue of the space (membership-gated, idempotent, links a same-name+city venue without overwriting it).';

REVOKE ALL ON FUNCTION public.adopt_directory_venue(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.adopt_directory_venue(uuid, uuid) TO authenticated;
