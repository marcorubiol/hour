-- Reconstructive baseline generated from the production public schema on
-- 2026-07-20T15:18:07Z via the audited backup workflow (run 29754532658).
-- It intentionally contains schema only: no production rows, Auth users,
-- secrets, or Storage objects. The five later 20260720 migrations are folded
-- into this final state but remain as marker files so the local versions keep
-- matching the migration history already recorded in production.
-- Their original SQL is preserved under build/migrations/squashed-20260720/.


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "extensions";

CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "citext" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "unaccent" WITH SCHEMA "extensions";


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "postgres";


CREATE TYPE "public"."account_kind" AS ENUM (
    'personal',
    'team'
);


ALTER TYPE "public"."account_kind" OWNER TO "postgres";


CREATE TYPE "public"."account_role" AS ENUM (
    'owner',
    'admin'
);


ALTER TYPE "public"."account_role" OWNER TO "postgres";


CREATE TYPE "public"."asset_direction" AS ENUM (
    'outbound',
    'inbound',
    'adapted'
);


ALTER TYPE "public"."asset_direction" OWNER TO "postgres";


COMMENT ON TYPE "public"."asset_direction" IS 'ADR-023: bidirectional asset flow. inbound captures venue returns; adapted captures per-venue variants.';



CREATE TYPE "public"."asset_kind" AS ENUM (
    'rider',
    'stage_plot',
    'tech_sheet',
    'bar_plot',
    'dossier',
    'roadsheet_snapshot',
    'photo',
    'video',
    'other'
);


ALTER TYPE "public"."asset_kind" OWNER TO "postgres";


CREATE TYPE "public"."conversation_status" AS ENUM (
    'contacted',
    'in_conversation',
    'hold',
    'confirmed',
    'declined',
    'dormant',
    'recurring'
);


ALTER TYPE "public"."conversation_status" OWNER TO "postgres";


CREATE TYPE "public"."date_kind" AS ENUM (
    'rehearsal',
    'residency',
    'travel_day',
    'press',
    'other',
    'day_off'
);


ALTER TYPE "public"."date_kind" OWNER TO "postgres";


CREATE TYPE "public"."date_status" AS ENUM (
    'tentative',
    'confirmed',
    'cancelled',
    'done'
);


ALTER TYPE "public"."date_status" OWNER TO "postgres";


CREATE TYPE "public"."expense_category" AS ENUM (
    'travel',
    'lodging',
    'per_diem',
    'freight',
    'production',
    'fees',
    'other'
);


ALTER TYPE "public"."expense_category" OWNER TO "postgres";


CREATE TYPE "public"."invoice_status" AS ENUM (
    'draft',
    'issued',
    'paid',
    'cancelled'
);


ALTER TYPE "public"."invoice_status" OWNER TO "postgres";


CREATE TYPE "public"."line_kind" AS ENUM (
    'tour',
    'season',
    'phase',
    'circuit',
    'residency',
    'other',
    'creation',
    'campaign',
    'comms',
    'misc'
);


ALTER TYPE "public"."line_kind" OWNER TO "postgres";


CREATE TYPE "public"."line_status" AS ENUM (
    'open',
    'closed',
    'archived'
);


ALTER TYPE "public"."line_status" OWNER TO "postgres";


CREATE TYPE "public"."membership_role" AS ENUM (
    'owner',
    'admin',
    'member',
    'viewer',
    'guest'
);


ALTER TYPE "public"."membership_role" OWNER TO "postgres";


CREATE TYPE "public"."payment_method" AS ENUM (
    'transfer',
    'card',
    'cash',
    'other'
);


ALTER TYPE "public"."payment_method" OWNER TO "postgres";


CREATE TYPE "public"."performance_status" AS ENUM (
    'proposed',
    'hold',
    'hold_1',
    'hold_2',
    'hold_3',
    'confirmed',
    'done',
    'invoiced',
    'paid',
    'cancelled'
);


ALTER TYPE "public"."performance_status" OWNER TO "postgres";


CREATE TYPE "public"."person_note_visibility" AS ENUM (
    'workspace',
    'private'
);


ALTER TYPE "public"."person_note_visibility" OWNER TO "postgres";


CREATE TYPE "public"."project_status" AS ENUM (
    'draft',
    'active',
    'archived'
);


ALTER TYPE "public"."project_status" OWNER TO "postgres";


CREATE TYPE "public"."task_origin" AS ENUM (
    'manual',
    'protocol',
    'ai'
);


ALTER TYPE "public"."task_origin" OWNER TO "postgres";


CREATE TYPE "public"."task_status" AS ENUM (
    'open',
    'done'
);


ALTER TYPE "public"."task_status" OWNER TO "postgres";


CREATE TYPE "public"."workspace_domain" AS ENUM (
    'theatre',
    'dance',
    'circus',
    'music',
    'mixed',
    'other'
);


ALTER TYPE "public"."workspace_domain" OWNER TO "postgres";


CREATE TYPE "public"."workspace_kind" AS ENUM (
    'personal',
    'team'
);


ALTER TYPE "public"."workspace_kind" OWNER TO "postgres";


CREATE TYPE "public"."workspace_role_access_level" AS ENUM (
    'owner',
    'admin',
    'producer',
    'member',
    'viewer'
);


ALTER TYPE "public"."workspace_role_access_level" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_edit_project"("p_project_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
  SELECT has_permission(p_project_id, 'edit:project_meta');
$$;


ALTER FUNCTION "public"."can_edit_project"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_see_person"("p_person_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select exists (
    select 1
    from public.workspace_person wp
    join public.workspace_membership m on m.workspace_id = wp.workspace_id
    where wp.person_id = p_person_id and wp.deleted_at is null
      and m.user_id = auth.uid() and m.accepted_at is not null
  ) or exists (
    select 1 from public.user_profile up
    where up.user_id = auth.uid() and up.person_id = p_person_id
  );
$$;


ALTER FUNCTION "public"."can_see_person"("p_person_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."uuid_generate_v7"() RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'extensions', 'public', 'pg_temp'
    AS $$
DECLARE
  unix_ts_ms bytea;
  uuid_bytes bytea;
BEGIN
  unix_ts_ms := substring(
    int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint)
    FROM 3
  );
  uuid_bytes := unix_ts_ms || gen_random_bytes(10);
  uuid_bytes := set_byte(uuid_bytes, 6, (b'0111' || get_byte(uuid_bytes, 6)::bit(4))::bit(8)::integer);
  uuid_bytes := set_byte(uuid_bytes, 8, (b'10' || get_byte(uuid_bytes, 8)::bit(6))::bit(8)::integer);
  RETURN encode(uuid_bytes, 'hex')::uuid;
END;
$$;


ALTER FUNCTION "public"."uuid_generate_v7"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."uuid_generate_v7"() IS 'RFC 9562 UUID v7 — time-ordered.';


SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."asset_version" (
    "id" "uuid" DEFAULT "public"."uuid_generate_v7"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "project_id" "uuid",
    "line_id" "uuid",
    "performance_id" "uuid",
    "kind" "public"."asset_kind" NOT NULL,
    "direction" "public"."asset_direction" DEFAULT 'outbound'::"public"."asset_direction" NOT NULL,
    "adapted_from_id" "uuid",
    "url" "text" NOT NULL,
    "slug" "text",
    "previous_slugs" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "notes" "text",
    "uploaded_by" "uuid",
    "uploaded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "asset_version_adapted_has_source" CHECK ((("direction" <> 'adapted'::"public"."asset_direction") OR ("adapted_from_id" IS NOT NULL))),
    CONSTRAINT "asset_version_inbound_has_performance" CHECK ((("direction" <> 'inbound'::"public"."asset_direction") OR ("performance_id" IS NOT NULL))),
    CONSTRAINT "asset_version_scope_chk" CHECK (("num_nonnulls"("project_id", "line_id", "performance_id") = 1)),
    CONSTRAINT "asset_version_url_nonempty" CHECK (("length"(TRIM(BOTH FROM "url")) > 0))
);

ALTER TABLE ONLY "public"."asset_version" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."asset_version" OWNER TO "postgres";


COMMENT ON TABLE "public"."asset_version" IS 'ADR-023: one row per asset variant. direction enum captures bidirectional flow (outbound/inbound/adapted).';



COMMENT ON COLUMN "public"."asset_version"."adapted_from_id" IS 'Self-reference: an adapted variant points back to its canonical source.';



COMMENT ON COLUMN "public"."asset_version"."url" IS 'R2 key or public URL for the asset payload. Phase 0: R2 key under MEDIA bucket.';



CREATE OR REPLACE FUNCTION "public"."create_asset_version"("p_line_id" "uuid", "p_kind" "public"."asset_kind", "p_url" "text", "p_direction" "public"."asset_direction" DEFAULT 'outbound'::"public"."asset_direction", "p_notes" "text" DEFAULT NULL::"text") RETURNS "public"."asset_version"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_caller       uuid := auth.uid();
  v_workspace_id uuid;
  v_project_id   uuid;
  v_url          text := nullif(btrim(coalesce(p_url, '')), '');
  v_asset        public.asset_version;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF v_url IS NULL THEN
    RAISE EXCEPTION 'url cannot be empty' USING ERRCODE = '22023';
  END IF;

  IF p_direction = 'inbound' THEN
    RAISE EXCEPTION 'inbound versions attach to a performance, not a line'
      USING ERRCODE = '22023';
  END IF;

  IF p_direction = 'adapted' THEN
    RAISE EXCEPTION 'adapted versions need a source — not supported at line scope yet'
      USING ERRCODE = '22023';
  END IF;

  SELECT workspace_id, project_id INTO v_workspace_id, v_project_id
  FROM public.line
  WHERE id = p_line_id AND deleted_at IS NULL;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'line not found' USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_permission(v_project_id, 'edit:performance') THEN
    RAISE EXCEPTION 'edit:performance required to register a material'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.asset_version (
    workspace_id, line_id, kind, direction, url, notes, uploaded_by
  ) VALUES (
    v_workspace_id, p_line_id, p_kind, p_direction, v_url,
    nullif(btrim(coalesce(p_notes, '')), ''),
    v_caller
  )
  RETURNING * INTO v_asset;

  RETURN v_asset;
END;
$$;


ALTER FUNCTION "public"."create_asset_version"("p_line_id" "uuid", "p_kind" "public"."asset_kind", "p_url" "text", "p_direction" "public"."asset_direction", "p_notes" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."availability_block" (
    "id" "uuid" DEFAULT "public"."uuid_generate_v7"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "person_id" "uuid",
    "starts_on" "date" NOT NULL,
    "ends_on" "date" NOT NULL,
    "certainty" "text" DEFAULT 'unavailable'::"text" NOT NULL,
    "note" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "availability_block_certainty" CHECK (("certainty" = ANY (ARRAY['unavailable'::"text", 'tentative'::"text"]))),
    CONSTRAINT "availability_block_range" CHECK (("ends_on" >= "starts_on"))
);

ALTER TABLE ONLY "public"."availability_block" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."availability_block" OWNER TO "postgres";


COMMENT ON TABLE "public"."availability_block" IS 'Blackout (ADR-072 §2 / ADR-078 §4): person or whole-company unavailability, day-precision. NO kind/reason axis — the why is free prose in note. Feeds calendar chips, the conflict engine and AI date proposals (ADR-069).';



COMMENT ON COLUMN "public"."availability_block"."person_id" IS 'NULL = whole company. The dialog''s person select is the workspace TEAM (cast_member ∪ crew_assignment), not the contact book (ADR-078 §5).';



COMMENT ON COLUMN "public"."availability_block"."certainty" IS 'unavailable | tentative ("el 8 no sé si puedo"). TEXT + CHECK, not an enum — promoting is additive if a third state ever earns its place.';



CREATE OR REPLACE FUNCTION "public"."create_availability_block"("p_workspace_id" "uuid", "p_starts_on" "date", "p_ends_on" "date", "p_person_id" "uuid" DEFAULT NULL::"uuid", "p_certainty" "text" DEFAULT 'unavailable'::"text", "p_note" "text" DEFAULT NULL::"text") RETURNS "public"."availability_block"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_block  public.availability_block;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_starts_on IS NULL OR p_ends_on IS NULL THEN
    RAISE EXCEPTION 'starts_on and ends_on are required' USING ERRCODE = '22023';
  END IF;

  IF p_ends_on < p_starts_on THEN
    RAISE EXCEPTION 'ends_on must be on or after starts_on' USING ERRCODE = '22023';
  END IF;

  IF p_certainty IS NULL OR p_certainty NOT IN ('unavailable', 'tentative') THEN
    RAISE EXCEPTION 'certainty must be unavailable or tentative' USING ERRCODE = '22023';
  END IF;

  IF p_workspace_id IS NULL OR NOT public.is_workspace_member(p_workspace_id) THEN
    -- Not-found and no-membership collapse (no existence oracle).
    RAISE EXCEPTION 'workspace not found' USING ERRCODE = '42501';
  END IF;

  -- Person is a GLOBAL entity — visibility gate is can_see_person.
  IF p_person_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.person
      WHERE id = p_person_id AND deleted_at IS NULL
    ) OR NOT public.can_see_person(p_person_id) THEN
      RAISE EXCEPTION 'person not found' USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO public.availability_block (
    workspace_id, person_id, starts_on, ends_on, certainty, note, created_by
  ) VALUES (
    p_workspace_id, p_person_id, p_starts_on, p_ends_on, p_certainty,
    nullif(btrim(coalesce(p_note, '')), ''), v_caller
  )
  RETURNING * INTO v_block;

  RETURN v_block;
END;
$$;


ALTER FUNCTION "public"."create_availability_block"("p_workspace_id" "uuid", "p_starts_on" "date", "p_ends_on" "date", "p_person_id" "uuid", "p_certainty" "text", "p_note" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_availability_block"("p_workspace_id" "uuid", "p_starts_on" "date", "p_ends_on" "date", "p_person_id" "uuid", "p_certainty" "text", "p_note" "text") IS 'Create a blackout (ADR-078 §4/§5). Workspace verbatim, member-gated; person optional (NULL = whole company), can_see_person-gated. No kind axis by design.';



CREATE TABLE IF NOT EXISTS "public"."calendar_share" (
    "id" "uuid" DEFAULT "public"."uuid_generate_v7"() NOT NULL,
    "token" "text" NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "revoked_at" timestamp with time zone
);

ALTER TABLE ONLY "public"."calendar_share" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."calendar_share" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_calendar_share"("p_workspace_id" "uuid") RETURNS "public"."calendar_share"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_share public.calendar_share;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_membership m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id = v_caller
      AND m.accepted_at IS NOT NULL
      AND m.role IN ('owner', 'admin', 'member')
  ) THEN
    RAISE EXCEPTION 'a write role is required to publish a calendar feed'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.calendar_share (token, workspace_id, created_by)
  VALUES (
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
    p_workspace_id, v_caller
  )
  RETURNING * INTO v_share;
  RETURN v_share;
END;
$$;


ALTER FUNCTION "public"."create_calendar_share"("p_workspace_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversation" (
    "id" "uuid" DEFAULT "public"."uuid_generate_v7"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "person_id" "uuid" NOT NULL,
    "status" "public"."conversation_status" DEFAULT 'contacted'::"public"."conversation_status" NOT NULL,
    "role" "text",
    "first_contacted_at" timestamp with time zone,
    "last_contacted_at" timestamp with time zone,
    "next_action_at" timestamp with time zone,
    "next_action_note" "text",
    "custom_fields" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "slug" "text" NOT NULL,
    "previous_slugs" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "line_id" "uuid"
);

ALTER TABLE ONLY "public"."conversation" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."conversation" OWNER TO "postgres";


COMMENT ON TABLE "public"."conversation" IS 'Conversation state for (person × project × workspace). Distinct from performance (ADR-001). Renamed from `engagement` — ADR-075.';



COMMENT ON COLUMN "public"."conversation"."status" IS 'Anti-CRM. contacted | in_conversation | hold | confirmed | declined | dormant | recurring.';



COMMENT ON COLUMN "public"."conversation"."line_id" IS 'ADR-056: optional operational frame — the line this conversation belongs to (e.g. a difusión campaign). Must belong to the same project; enforced by create_engagement and the PATCH cross-project guard, like performance.line_id.';



CREATE OR REPLACE FUNCTION "public"."create_conversation"("p_project_id" "uuid", "p_person_id" "uuid" DEFAULT NULL::"uuid", "p_full_name" "text" DEFAULT NULL::"text", "p_email" "text" DEFAULT NULL::"text", "p_phone" "text" DEFAULT NULL::"text", "p_organization_name" "text" DEFAULT NULL::"text", "p_title" "text" DEFAULT NULL::"text", "p_status" "public"."conversation_status" DEFAULT 'contacted'::"public"."conversation_status", "p_role" "text" DEFAULT NULL::"text", "p_next_action_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_next_action_note" "text" DEFAULT NULL::"text", "p_line_id" "uuid" DEFAULT NULL::"uuid") RETURNS "public"."conversation"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $_$
declare
  v_caller uuid := auth.uid();
  v_workspace_id uuid;
  v_full_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_email extensions.citext := nullif(btrim(coalesce(p_email, '')), '')::extensions.citext;
  v_person_id uuid;
  v_person_slug text;
  v_organization_id uuid;
  v_organization_slug text;
  v_conversation_id uuid;
  v_conversation_slug text;
  v_conversation public.conversation;
begin
  if v_caller is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select workspace_id into v_workspace_id
  from public.project where id = p_project_id and deleted_at is null;
  if v_workspace_id is null or not public.has_permission(p_project_id, 'edit:conversation') then
    raise exception 'project not found' using errcode = '42501';
  end if;
  if p_line_id is not null and not exists (
    select 1 from public.line
    where id = p_line_id and project_id = p_project_id and deleted_at is null
  ) then
    raise exception 'line does not belong to project' using errcode = '22023';
  end if;

  if p_person_id is not null then
    select wp.person_id, wp.slug into v_person_id, v_person_slug
    from public.workspace_person wp
    where wp.workspace_id = v_workspace_id and wp.person_id = p_person_id
      and wp.deleted_at is null;
    if v_person_id is null then
      raise exception 'person not found in target workspace' using errcode = '42501';
    end if;
  else
    if v_full_name is null then
      raise exception 'full_name is required when person_id is not given' using errcode = '22023';
    end if;
    if v_email is not null and v_email::text !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'email is not valid' using errcode = '22023';
    end if;

    if v_email is not null then
      select wp.person_id, wp.slug into v_person_id, v_person_slug
      from public.workspace_person wp
      where wp.workspace_id = v_workspace_id and wp.email = v_email
        and wp.deleted_at is null
      limit 1;
    end if;

    if v_person_id is null then
      v_person_id := public.uuid_generate_v7();
      insert into public.person (id, slug, full_name, email, created_by)
      values (
        v_person_id,
        'person-' || substring(replace(v_person_id::text, '-', '') from 1 for 12),
        'Person ' || substring(replace(v_person_id::text, '-', '') from 1 for 8),
        null,
        v_caller
      );
    end if;

    v_person_slug := coalesce(
      nullif(rtrim(left(public.slugify(v_full_name), 63), '-'), ''),
      'person'
    );
    if exists (
      select 1 from public.workspace_person wp
      where wp.workspace_id = v_workspace_id and wp.slug = v_person_slug
        and wp.person_id <> v_person_id and wp.deleted_at is null
    ) then
      v_person_slug := rtrim(left(v_person_slug, 56), '-') || '-' || substring(replace(v_person_id::text, '-', '') from 1 for 6);
    end if;

    if nullif(btrim(coalesce(p_organization_name, '')), '') is not null then
      select id into v_organization_id
      from public.workspace_organization
      where workspace_id = v_workspace_id
        and lower(btrim(name)) = lower(btrim(p_organization_name))
        and deleted_at is null
      limit 1;

      if v_organization_id is null then
        v_organization_id := public.uuid_generate_v7();
        v_organization_slug := coalesce(
          nullif(rtrim(left(public.slugify(p_organization_name), 63), '-'), ''),
          'organization'
        );
        if exists (
          select 1 from public.workspace_organization
          where workspace_id = v_workspace_id and slug = v_organization_slug and deleted_at is null
        ) then
          v_organization_slug := rtrim(left(v_organization_slug, 56), '-') || '-' || substring(replace(v_organization_id::text, '-', '') from 1 for 6);
        end if;
        insert into public.workspace_organization (id, workspace_id, slug, name, created_by)
        values (v_organization_id, v_workspace_id, v_organization_slug, btrim(p_organization_name), v_caller);
      end if;
    end if;

    insert into public.workspace_person (
      workspace_id, person_id, slug, full_name, email, phone,
      organization_id, title, created_by
    ) values (
      v_workspace_id, v_person_id, v_person_slug, v_full_name, v_email,
      nullif(btrim(coalesce(p_phone, '')), ''), v_organization_id,
      nullif(btrim(coalesce(p_title, '')), ''), v_caller
    )
    on conflict (workspace_id, person_id) do update set
      deleted_at = null,
      full_name = excluded.full_name,
      email = coalesce(workspace_person.email, excluded.email),
      phone = coalesce(workspace_person.phone, excluded.phone),
      organization_id = coalesce(workspace_person.organization_id, excluded.organization_id),
      title = coalesce(workspace_person.title, excluded.title);
  end if;

  select * into v_conversation from public.conversation
  where workspace_id = v_workspace_id and project_id = p_project_id
    and person_id = v_person_id and deleted_at is not null;
  if v_conversation.id is not null then
    v_conversation_slug := v_conversation.slug;
    if exists (
      select 1 from public.conversation
      where workspace_id = v_workspace_id and slug = v_conversation_slug
        and deleted_at is null and id <> v_conversation.id
    ) then
      v_conversation_slug := rtrim(left(v_conversation_slug, 56), '-') || '-' || substring(replace(v_conversation.id::text, '-', '') from 1 for 6);
    end if;
    update public.conversation set
      deleted_at = null, slug = v_conversation_slug, status = p_status,
      role = nullif(btrim(coalesce(p_role, '')), ''), last_contacted_at = now(),
      next_action_at = p_next_action_at,
      next_action_note = nullif(btrim(coalesce(p_next_action_note, '')), ''),
      line_id = p_line_id
    where id = v_conversation.id returning * into v_conversation;
    return v_conversation;
  end if;

  v_conversation_id := public.uuid_generate_v7();
  v_conversation_slug := v_person_slug;
  if exists (
    select 1 from public.conversation
    where workspace_id = v_workspace_id and slug = v_conversation_slug and deleted_at is null
  ) then
    v_conversation_slug := rtrim(left(v_conversation_slug, 56), '-') || '-' || substring(replace(v_conversation_id::text, '-', '') from 1 for 6);
  end if;

  insert into public.conversation (
    id, slug, workspace_id, project_id, person_id, line_id, status, role,
    first_contacted_at, last_contacted_at, next_action_at, next_action_note, created_by
  ) values (
    v_conversation_id, v_conversation_slug, v_workspace_id, p_project_id,
    v_person_id, p_line_id, p_status, nullif(btrim(coalesce(p_role, '')), ''),
    now(), now(), p_next_action_at,
    nullif(btrim(coalesce(p_next_action_note, '')), ''), v_caller
  ) returning * into v_conversation;

  return v_conversation;
end;
$_$;


ALTER FUNCTION "public"."create_conversation"("p_project_id" "uuid", "p_person_id" "uuid", "p_full_name" "text", "p_email" "text", "p_phone" "text", "p_organization_name" "text", "p_title" "text", "p_status" "public"."conversation_status", "p_role" "text", "p_next_action_at" timestamp with time zone, "p_next_action_note" "text", "p_line_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."date" (
    "id" "uuid" DEFAULT "public"."uuid_generate_v7"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "performance_id" "uuid",
    "venue_id" "uuid",
    "kind" "public"."date_kind" DEFAULT 'other'::"public"."date_kind" NOT NULL,
    "status" "public"."date_status" DEFAULT 'tentative'::"public"."date_status" NOT NULL,
    "title" "text",
    "starts_at" timestamp with time zone NOT NULL,
    "ends_at" timestamp with time zone,
    "all_day" boolean DEFAULT false NOT NULL,
    "season" "text",
    "venue_name" "text",
    "city" "text",
    "country" character(2),
    "notes" "text",
    "custom_fields" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "line_id" "uuid",
    "travel_direction" "text",
    "series_id" "uuid",
    CONSTRAINT "date_country_format" CHECK ((("country" IS NULL) OR ("country" ~ '^[A-Z]{2}$'::"text"))),
    CONSTRAINT "date_time_range" CHECK ((("ends_at" IS NULL) OR ("ends_at" >= "starts_at"))),
    CONSTRAINT "date_travel_direction" CHECK ((("travel_direction" IS NULL) OR (("kind" = 'travel_day'::"public"."date_kind") AND ("travel_direction" = ANY (ARRAY['outbound'::"text", 'return'::"text", 'leg'::"text"])))))
);

ALTER TABLE ONLY "public"."date" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."date" OWNER TO "postgres";


COMMENT ON COLUMN "public"."date"."line_id" IS 'ADR-072 §3: optional operational frame — the line this date hangs from (cascade option C, like performance.line_id). Must belong to the same project; enforced by the /api/dates writers and the PATCH cross-project guard, not by composite FK (ADR-043 pattern).';



COMMENT ON COLUMN "public"."date"."travel_direction" IS 'ADR-072 §4 / ADR-078 §6: outbound | return | leg, only on kind=travel_day (CHECK). An outbound paired with the NEXT return of the same line (fallback: same project) brackets the derived away band. TEXT + CHECK, not an enum — same promotion rule as availability_block.certainty.';



COMMENT ON COLUMN "public"."date"."series_id" IS 'Groups the per-day rows of one multi-day block (e.g. a week of rehearsals). NULL = standalone date. Deliberately not an FK: the series has no row of its own, the shared key is the concept.';



CREATE OR REPLACE FUNCTION "public"."create_date"("p_project_id" "uuid", "p_kind" "public"."date_kind", "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_all_day" boolean DEFAULT false, "p_title" "text" DEFAULT NULL::"text", "p_venue_name" "text" DEFAULT NULL::"text", "p_city" "text" DEFAULT NULL::"text", "p_country" "text" DEFAULT NULL::"text", "p_status" "public"."date_status" DEFAULT 'tentative'::"public"."date_status", "p_performance_id" "uuid" DEFAULT NULL::"uuid", "p_line_id" "uuid" DEFAULT NULL::"uuid", "p_travel_direction" "text" DEFAULT NULL::"text", "p_label" "text" DEFAULT NULL::"text") RETURNS "public"."date"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_caller       uuid := auth.uid();
  v_workspace_id uuid;
  v_label        text := nullif(btrim(coalesce(p_label, '')), '');
  v_row          public.date;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null — RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  IF p_starts_at IS NULL THEN
    RAISE EXCEPTION 'starts_at cannot be null' USING ERRCODE = '22023';
  END IF;

  -- §9: the enum of 4 is never exposed at creation.
  IF p_status IS NULL OR p_status NOT IN ('tentative', 'confirmed') THEN
    RAISE EXCEPTION 'status must be tentative or confirmed on create'
      USING ERRCODE = '22023';
  END IF;

  SELECT workspace_id INTO v_workspace_id
  FROM public.project
  WHERE id = p_project_id AND deleted_at IS NULL;

  IF v_workspace_id IS NULL THEN
    -- Not-found and no-membership collapse (no existence oracle).
    RAISE EXCEPTION 'project % not found', p_project_id
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_permission(p_project_id, 'edit:performance') THEN
    RAISE EXCEPTION 'edit:performance required to create a date'
      USING ERRCODE = '42501';
  END IF;

  -- Cascade coherence (ADR-043 pattern).
  IF p_line_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.line
    WHERE id = p_line_id AND project_id = p_project_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'line does not belong to project' USING ERRCODE = '22023';
  END IF;

  IF p_performance_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.performance
    WHERE id = p_performance_id AND project_id = p_project_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'performance does not belong to project' USING ERRCODE = '22023';
  END IF;

  -- Travel axis: only travel days carry a direction.
  IF p_travel_direction IS NOT NULL THEN
    IF p_kind <> 'travel_day'
      OR p_travel_direction NOT IN ('outbound', 'return', 'leg') THEN
      RAISE EXCEPTION 'travel_direction requires kind=travel_day and one of outbound/return/leg'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- §8: label is the Altres axis — only kind='other' rows carry one.
  IF v_label IS NOT NULL AND p_kind <> 'other' THEN
    RAISE EXCEPTION 'label is only accepted for kind=other' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.date (
    workspace_id, project_id, line_id, performance_id,
    kind, status, title, starts_at, ends_at, all_day,
    venue_name, city, country, travel_direction, custom_fields, created_by
  ) VALUES (
    v_workspace_id, p_project_id, p_line_id, p_performance_id,
    p_kind, p_status,
    nullif(btrim(coalesce(p_title, '')), ''),
    p_starts_at, p_ends_at, coalesce(p_all_day, false),
    nullif(btrim(coalesce(p_venue_name, '')), ''),
    nullif(btrim(coalesce(p_city, '')), ''),
    nullif(upper(btrim(coalesce(p_country, ''))), ''),
    p_travel_direction,
    CASE WHEN v_label IS NULL THEN '{}'::jsonb
         ELSE jsonb_build_object('label', v_label) END,
    v_caller
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;


ALTER FUNCTION "public"."create_date"("p_project_id" "uuid", "p_kind" "public"."date_kind", "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone, "p_all_day" boolean, "p_title" "text", "p_venue_name" "text", "p_city" "text", "p_country" "text", "p_status" "public"."date_status", "p_performance_id" "uuid", "p_line_id" "uuid", "p_travel_direction" "text", "p_label" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_date"("p_project_id" "uuid", "p_kind" "public"."date_kind", "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone, "p_all_day" boolean, "p_title" "text", "p_venue_name" "text", "p_city" "text", "p_country" "text", "p_status" "public"."date_status", "p_performance_id" "uuid", "p_line_id" "uuid", "p_travel_direction" "text", "p_label" "text") IS 'Create a date row (ADR-078). Claim-independent, has_permission(project, edit:performance)-gated; enforces line/performance ∈ project, create status whitelist (tentative|confirmed), travel_direction only on travel_day, label only on kind=other (sole custom_fields writer).';



CREATE OR REPLACE FUNCTION "public"."create_date_series"("p_project_id" "uuid", "p_kind" "public"."date_kind", "p_starts" timestamp with time zone[], "p_ends" timestamp with time zone[] DEFAULT NULL::timestamp with time zone[], "p_all_day" boolean DEFAULT false, "p_title" "text" DEFAULT NULL::"text", "p_venue_name" "text" DEFAULT NULL::"text", "p_city" "text" DEFAULT NULL::"text", "p_country" "text" DEFAULT NULL::"text", "p_status" "public"."date_status" DEFAULT 'tentative'::"public"."date_status", "p_line_id" "uuid" DEFAULT NULL::"uuid", "p_label" "text" DEFAULT NULL::"text") RETURNS SETOF "public"."date"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_caller       uuid := auth.uid();
  v_workspace_id uuid;
  v_label        text := nullif(btrim(coalesce(p_label, '')), '');
  v_series       uuid := uuid_generate_v7();
  v_n            int;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null - RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  v_n := coalesce(array_length(p_starts, 1), 0);

  IF v_n < 2 THEN
    RAISE EXCEPTION 'a series needs at least 2 rows - use create_date for one'
      USING ERRCODE = '22023';
  END IF;

  IF v_n > 92 THEN
    RAISE EXCEPTION 'a series is capped at 92 rows' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(p_starts) s WHERE s IS NULL) THEN
    RAISE EXCEPTION 'starts_at cannot be null' USING ERRCODE = '22023';
  END IF;

  IF p_ends IS NOT NULL AND coalesce(array_length(p_ends, 1), 0) <> v_n THEN
    RAISE EXCEPTION 'p_ends must be null or the same length as p_starts'
      USING ERRCODE = '22023';
  END IF;

  IF p_status IS NULL OR p_status NOT IN ('tentative', 'confirmed') THEN
    RAISE EXCEPTION 'status must be tentative or confirmed on create'
      USING ERRCODE = '22023';
  END IF;

  IF p_kind = 'travel_day' THEN
    RAISE EXCEPTION 'travel_day cannot be created as a series'
      USING ERRCODE = '22023';
  END IF;

  SELECT workspace_id INTO v_workspace_id
  FROM public.project
  WHERE id = p_project_id AND deleted_at IS NULL;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'project % not found', p_project_id
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_permission(p_project_id, 'edit:performance') THEN
    RAISE EXCEPTION 'edit:performance required to create a date'
      USING ERRCODE = '42501';
  END IF;

  IF p_line_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.line
    WHERE id = p_line_id AND project_id = p_project_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'line does not belong to project' USING ERRCODE = '22023';
  END IF;

  IF v_label IS NOT NULL AND p_kind <> 'other' THEN
    RAISE EXCEPTION 'label is only accepted for kind=other' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  INSERT INTO public.date (
    workspace_id, project_id, line_id,
    kind, status, title, starts_at, ends_at, all_day,
    venue_name, city, country, series_id, custom_fields, created_by
  )
  SELECT
    v_workspace_id, p_project_id, p_line_id,
    p_kind, p_status,
    nullif(btrim(coalesce(p_title, '')), ''),
    s.starts_at,
    CASE WHEN p_ends IS NULL THEN NULL ELSE p_ends[s.ord] END,
    coalesce(p_all_day, false),
    nullif(btrim(coalesce(p_venue_name, '')), ''),
    nullif(btrim(coalesce(p_city, '')), ''),
    nullif(upper(btrim(coalesce(p_country, ''))), ''),
    v_series,
    CASE WHEN v_label IS NULL THEN '{}'::jsonb
         ELSE jsonb_build_object('label', v_label) END,
    v_caller
  FROM unnest(p_starts) WITH ORDINALITY AS s(starts_at, ord)
  ORDER BY s.starts_at
  RETURNING *;
END;
$$;


ALTER FUNCTION "public"."create_date_series"("p_project_id" "uuid", "p_kind" "public"."date_kind", "p_starts" timestamp with time zone[], "p_ends" timestamp with time zone[], "p_all_day" boolean, "p_title" "text", "p_venue_name" "text", "p_city" "text", "p_country" "text", "p_status" "public"."date_status", "p_line_id" "uuid", "p_label" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_date_series"("p_project_id" "uuid", "p_kind" "public"."date_kind", "p_starts" timestamp with time zone[], "p_ends" timestamp with time zone[], "p_all_day" boolean, "p_title" "text", "p_venue_name" "text", "p_city" "text", "p_country" "text", "p_status" "public"."date_status", "p_line_id" "uuid", "p_label" "text") IS 'Create a multi-day block as N date rows sharing one series_id, atomically (ADR-084 1). Several rows MAY share a day: a rehearsal day can hold a morning and an afternoon session, each with its own status. Same gate and guards as create_date.';



CREATE TABLE IF NOT EXISTS "public"."expense" (
    "id" "uuid" DEFAULT "public"."uuid_generate_v7"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "performance_id" "uuid",
    "line_id" "uuid",
    "category" "public"."expense_category" DEFAULT 'other'::"public"."expense_category" NOT NULL,
    "description" "text" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "currency" character(3) DEFAULT 'EUR'::"bpchar" NOT NULL,
    "incurred_on" "date" DEFAULT CURRENT_DATE NOT NULL,
    "receipt_url" "text",
    "paid_by_user_id" "uuid",
    "reimbursed" boolean DEFAULT false NOT NULL,
    "notes" "text",
    "custom_fields" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "expense_amount_positive" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "expense_currency_format" CHECK (("currency" ~ '^[A-Z]{3}$'::"text")),
    CONSTRAINT "expense_description_nonempty" CHECK (("length"("btrim"("description")) > 0)),
    CONSTRAINT "expense_exactly_one_parent" CHECK ((((("performance_id" IS NOT NULL))::integer + (("line_id" IS NOT NULL))::integer) = 1))
);

ALTER TABLE ONLY "public"."expense" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."expense" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_expense"("p_performance_id" "uuid" DEFAULT NULL::"uuid", "p_line_id" "uuid" DEFAULT NULL::"uuid", "p_category" "public"."expense_category" DEFAULT 'other'::"public"."expense_category", "p_description" "text" DEFAULT NULL::"text", "p_amount" numeric DEFAULT NULL::numeric, "p_currency" "text" DEFAULT 'EUR'::"text", "p_incurred_on" "date" DEFAULT NULL::"date", "p_notes" "text" DEFAULT NULL::"text") RETURNS "public"."expense"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_caller       uuid := auth.uid();
  v_workspace_id uuid;
  v_project_id   uuid;
  v_description  text := nullif(btrim(coalesce(p_description, '')), '');
  v_currency     text := upper(nullif(btrim(coalesce(p_currency, '')), ''));
  v_expense      public.expense;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF num_nonnulls(p_performance_id, p_line_id) <> 1 THEN
    RAISE EXCEPTION 'exactly one of performance_id or line_id is required'
      USING ERRCODE = '22023';
  END IF;

  IF v_description IS NULL THEN
    RAISE EXCEPTION 'description cannot be empty' USING ERRCODE = '22023';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be greater than zero' USING ERRCODE = '22023';
  END IF;

  IF v_currency IS NULL OR v_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'currency must be a 3-letter code' USING ERRCODE = '22023';
  END IF;

  IF p_performance_id IS NOT NULL THEN
    SELECT workspace_id, project_id INTO v_workspace_id, v_project_id
    FROM public.performance
    WHERE id = p_performance_id AND deleted_at IS NULL;
  ELSE
    SELECT workspace_id, project_id INTO v_workspace_id, v_project_id
    FROM public.line
    WHERE id = p_line_id AND deleted_at IS NULL;
  END IF;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'parent not found' USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_permission(v_project_id, 'edit:money') THEN
    RAISE EXCEPTION 'edit:money required to record an expense'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.expense (
    workspace_id, performance_id, line_id, category, description, amount,
    currency, incurred_on, notes, created_by
  ) VALUES (
    v_workspace_id, p_performance_id, p_line_id, p_category, v_description,
    round(p_amount, 2), v_currency,
    coalesce(p_incurred_on, CURRENT_DATE),
    nullif(btrim(coalesce(p_notes, '')), ''),
    v_caller
  )
  RETURNING * INTO v_expense;

  RETURN v_expense;
END;
$_$;


ALTER FUNCTION "public"."create_expense"("p_performance_id" "uuid", "p_line_id" "uuid", "p_category" "public"."expense_category", "p_description" "text", "p_amount" numeric, "p_currency" "text", "p_incurred_on" "date", "p_notes" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoice" (
    "id" "uuid" DEFAULT "public"."uuid_generate_v7"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "project_id" "uuid",
    "number" "text",
    "issued_on" "date" DEFAULT CURRENT_DATE NOT NULL,
    "due_on" "date",
    "status" "public"."invoice_status" DEFAULT 'draft'::"public"."invoice_status" NOT NULL,
    "subtotal" numeric(12,2) DEFAULT 0 NOT NULL,
    "vat_pct" numeric(5,2),
    "vat_amount" numeric(12,2),
    "irpf_pct" numeric(5,2),
    "irpf_amount" numeric(12,2),
    "total" numeric(12,2) DEFAULT 0 NOT NULL,
    "currency" character(3) DEFAULT 'EUR'::"bpchar" NOT NULL,
    "payer_person_id" "uuid",
    "notes" "text",
    "custom_fields" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "invoice_currency_format" CHECK (("currency" ~ '^[A-Z]{3}$'::"text")),
    CONSTRAINT "invoice_date_range" CHECK ((("due_on" IS NULL) OR ("due_on" >= "issued_on")))
);

ALTER TABLE ONLY "public"."invoice" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoice" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_invoice"("p_performance_id" "uuid", "p_vat_pct" numeric DEFAULT NULL::numeric, "p_irpf_pct" numeric DEFAULT NULL::numeric, "p_number" "text" DEFAULT NULL::"text", "p_due_on" "date" DEFAULT NULL::"date", "p_notes" "text" DEFAULT NULL::"text") RETURNS "public"."invoice"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_perf public.performance;
  v_project_name text;
  v_payer uuid;
  v_subtotal numeric;
  v_vat numeric;
  v_irpf numeric;
  v_total numeric;
  v_desc text;
  v_invoice public.invoice;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_vat_pct IS NOT NULL AND (p_vat_pct < 0 OR p_vat_pct > 100) THEN
    RAISE EXCEPTION 'vat_pct must be between 0 and 100' USING ERRCODE = '22023';
  END IF;
  IF p_irpf_pct IS NOT NULL AND (p_irpf_pct < 0 OR p_irpf_pct > 100) THEN
    RAISE EXCEPTION 'irpf_pct must be between 0 and 100' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_perf FROM public.performance
  WHERE id = p_performance_id AND deleted_at IS NULL;
  IF v_perf.id IS NULL THEN
    RAISE EXCEPTION 'performance not found' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_permission(v_perf.project_id, 'edit:money') THEN
    RAISE EXCEPTION 'edit:money required' USING ERRCODE = '42501';
  END IF;
  IF v_perf.fee_amount IS NULL THEN
    RAISE EXCEPTION 'performance has no fee — set the fee first' USING ERRCODE = '22023';
  END IF;

  SELECT name INTO v_project_name FROM public.project WHERE id = v_perf.project_id;
  SELECT person_id INTO v_payer FROM public.conversation
  WHERE id = v_perf.conversation_id AND deleted_at IS NULL;

  v_subtotal := v_perf.fee_amount;
  v_vat := CASE WHEN p_vat_pct IS NULL THEN NULL ELSE round(v_subtotal * p_vat_pct / 100, 2) END;
  v_irpf := CASE WHEN p_irpf_pct IS NULL THEN NULL ELSE round(v_subtotal * p_irpf_pct / 100, 2) END;
  v_total := v_subtotal + coalesce(v_vat, 0) - coalesce(v_irpf, 0);

  v_desc := concat_ws(' — ',
    coalesce(v_project_name, 'Performance'),
    nullif(concat_ws(', ', v_perf.venue_name, v_perf.city), ''),
    to_char(v_perf.performed_at::date, 'YYYY-MM-DD')
  );

  INSERT INTO public.invoice (
    workspace_id, project_id, number, due_on, status,
    subtotal, vat_pct, vat_amount, irpf_pct, irpf_amount, total,
    currency, payer_person_id, notes, created_by
  ) VALUES (
    v_perf.workspace_id, v_perf.project_id, nullif(btrim(coalesce(p_number, '')), ''), p_due_on, 'draft',
    v_subtotal, p_vat_pct, v_vat, p_irpf_pct, v_irpf, v_total,
    coalesce(v_perf.fee_currency, 'EUR'), v_payer, nullif(btrim(coalesce(p_notes, '')), ''), v_caller
  )
  RETURNING * INTO v_invoice;

  INSERT INTO public.invoice_line (workspace_id, invoice_id, performance_id, description, quantity, unit_amount)
  VALUES (v_perf.workspace_id, v_invoice.id, v_perf.id, v_desc, 1, v_subtotal);

  RETURN v_invoice;
END;
$$;


ALTER FUNCTION "public"."create_invoice"("p_performance_id" "uuid", "p_vat_pct" numeric, "p_irpf_pct" numeric, "p_number" "text", "p_due_on" "date", "p_notes" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."line" (
    "id" "uuid" DEFAULT "public"."uuid_generate_v7"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "kind" "public"."line_kind" DEFAULT 'other'::"public"."line_kind" NOT NULL,
    "territory" "text",
    "status" "public"."line_status" DEFAULT 'open'::"public"."line_status" NOT NULL,
    "start_date" "date",
    "end_date" "date",
    "dossier_url" "text",
    "notes" "text",
    "custom_fields" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "slug" "text",
    "previous_slugs" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "last_navigated_at" timestamp with time zone,
    "accent" "text",
    "description" "text",
    "modules" "jsonb",
    CONSTRAINT "line_accent_check" CHECK ((("accent" IS NULL) OR ("accent" ~ '^([1-9]|1[0-2])$'::"text"))),
    CONSTRAINT "line_date_range" CHECK ((("end_date" IS NULL) OR ("start_date" IS NULL) OR ("end_date" >= "start_date"))),
    CONSTRAINT "line_description_check" CHECK ((("description" IS NULL) OR ("length"("description") <= 280))),
    CONSTRAINT "line_modules_check" CHECK ((("modules" IS NULL) OR ("jsonb_typeof"("modules") = 'array'::"text"))),
    CONSTRAINT "line_name_nonempty" CHECK (("length"("btrim"("name")) > 0))
);

ALTER TABLE ONLY "public"."line" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."line" OWNER TO "postgres";


COMMENT ON COLUMN "public"."line"."last_navigated_at" IS 'Set by touch_line_visit() RPC when an authenticated workspace member opens this line detail page. Used by LineList to sort by recency (Phase 0.2 sidebar filter system).';



COMMENT ON COLUMN "public"."line"."accent" IS 'Color identity. ''1''..''8'' = palette index into --accent-N tokens. NULL = derive via hash. Stored as text to allow future free-form colors by relaxing the CHECK.';



COMMENT ON COLUMN "public"."line"."description" IS 'Short blurb (≤280 chars). Distinct from notes (long-form). Surfaced in sidebar tooltip / settings card.';



COMMENT ON COLUMN "public"."line"."modules" IS 'ADR-056: ordered array of module keys (calendar, contacts, roadsheets, notes, materials, money, people). NULL = defaults by kind. Modules are line-scoped views of existing entities, never their own data.';



CREATE OR REPLACE FUNCTION "public"."create_line"("p_project_id" "uuid", "p_name" "text", "p_accent" "text" DEFAULT NULL::"text", "p_description" "text" DEFAULT NULL::"text", "p_kind" "public"."line_kind" DEFAULT 'other'::"public"."line_kind", "p_modules" "jsonb" DEFAULT NULL::"jsonb") RETURNS "public"."line"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_caller       uuid := auth.uid();
  v_workspace_id uuid;
  v_accent       text;
  v_description  text;
  v_line_id      uuid;
  v_slug         text;
  v_line         public.line;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null — RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'name cannot be empty' USING ERRCODE = '22023';
  END IF;

  IF p_modules IS NOT NULL AND jsonb_typeof(p_modules) <> 'array' THEN
    RAISE EXCEPTION 'modules must be a json array' USING ERRCODE = '22023';
  END IF;

  SELECT workspace_id INTO v_workspace_id
  FROM public.project
  WHERE id = p_project_id AND deleted_at IS NULL;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'project % not found', p_project_id
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_membership m
    WHERE m.workspace_id = v_workspace_id
      AND m.user_id      = v_caller
      AND m.accepted_at  IS NOT NULL
      AND m.role         IN ('owner', 'admin', 'member')
  ) THEN
    RAISE EXCEPTION 'caller is not a member of workspace % with sufficient role', v_workspace_id
      USING ERRCODE = '42501';
  END IF;

  v_accent      := NULLIF(trim(p_accent), '');
  v_description := NULLIF(trim(p_description), '');

  v_line_id := public.uuid_generate_v7();
  v_slug := coalesce(nullif(left(public.slugify(trim(p_name)), 57), ''), 'line');
  v_slug := rtrim(v_slug, '-');
  IF public.is_reserved_slug(v_slug) OR EXISTS (
    SELECT 1 FROM public.line
    WHERE workspace_id = v_workspace_id AND slug = v_slug AND deleted_at IS NULL
  ) THEN
    v_slug := v_slug || '-' ||
      substring(replace(v_line_id::text, '-', '') FROM 1 FOR 6);
  END IF;

  INSERT INTO public.line (
    id, slug, workspace_id, project_id, name, kind, accent, description,
    modules, created_by
  )
  VALUES (
    v_line_id, v_slug, v_workspace_id, p_project_id, trim(p_name), p_kind,
    v_accent, v_description, p_modules, v_caller
  )
  RETURNING * INTO v_line;

  RETURN v_line;
END;
$$;


ALTER FUNCTION "public"."create_line"("p_project_id" "uuid", "p_name" "text", "p_accent" "text", "p_description" "text", "p_kind" "public"."line_kind", "p_modules" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_line"("p_project_id" "uuid", "p_name" "text", "p_accent" "text", "p_description" "text", "p_kind" "public"."line_kind", "p_modules" "jsonb") IS 'Creates a line in p_project_id with caller as created_by. SECURITY DEFINER bypasses RLS; validates membership ≥ member of the project''s workspace. Generates slug (slugify + id-suffix on collision). p_modules = ordered module keys from the chosen template (ADR-056); NULL = kind defaults.';



CREATE TABLE IF NOT EXISTS "public"."performance" (
    "id" "uuid" DEFAULT "public"."uuid_generate_v7"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "line_id" "uuid",
    "conversation_id" "uuid",
    "performed_at" "date" NOT NULL,
    "venue_id" "uuid",
    "venue_name" "text",
    "city" "text",
    "country" character(2),
    "status" "public"."performance_status" DEFAULT 'proposed'::"public"."performance_status" NOT NULL,
    "fee_amount" numeric(12,2),
    "fee_currency" character(3) DEFAULT 'EUR'::"bpchar",
    "notes" "text",
    "custom_fields" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "load_in_at" timestamp with time zone,
    "soundcheck_at" timestamp with time zone,
    "start_at" timestamp with time zone,
    "loadout_at" timestamp with time zone,
    "wrap_at" timestamp with time zone,
    "logistics" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "hospitality" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "technical" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "slug" "text",
    "previous_slugs" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "hold_notice_days" smallint,
    "readiness" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "performance_country_format" CHECK ((("country" IS NULL) OR ("country" ~ '^[A-Z]{2}$'::"text"))),
    CONSTRAINT "performance_currency_format" CHECK ((("fee_currency" IS NULL) OR ("fee_currency" ~ '^[A-Z]{3}$'::"text"))),
    CONSTRAINT "performance_hold_notice_days_check" CHECK ((("hold_notice_days" IS NULL) OR (("hold_notice_days" >= 0) AND ("hold_notice_days" <= 365)))),
    CONSTRAINT "performance_readiness_is_object" CHECK (("jsonb_typeof"("readiness") = 'object'::"text")),
    CONSTRAINT "performance_timeslots_ordered" CHECK (((("load_in_at" IS NULL) OR ("soundcheck_at" IS NULL) OR ("load_in_at" <= "soundcheck_at")) AND (("soundcheck_at" IS NULL) OR ("start_at" IS NULL) OR ("soundcheck_at" <= "start_at")) AND (("start_at" IS NULL) OR ("loadout_at" IS NULL) OR ("start_at" <= "loadout_at")) AND (("loadout_at" IS NULL) OR ("wrap_at" IS NULL) OR ("loadout_at" <= "wrap_at"))))
);

ALTER TABLE ONLY "public"."performance" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."performance" OWNER TO "postgres";


COMMENT ON COLUMN "public"."performance"."load_in_at" IS 'ADR-023: crew arrival / venue access begins.';



COMMENT ON COLUMN "public"."performance"."soundcheck_at" IS 'ADR-023: soundcheck start.';



COMMENT ON COLUMN "public"."performance"."start_at" IS 'ADR-023: doors-open / actual performance start. May differ from performed_at (which is just a date).';



COMMENT ON COLUMN "public"."performance"."loadout_at" IS 'ADR-023: load-out start.';



COMMENT ON COLUMN "public"."performance"."wrap_at" IS 'ADR-023: crew leaves venue.';



COMMENT ON COLUMN "public"."performance"."logistics" IS 'ADR-023: venue access codes, parking, freight, travel notes, accommodation, visa flags.';



COMMENT ON COLUMN "public"."performance"."hospitality" IS 'ADR-023: dressing rooms, showers, per-diem, catering, dietary requirements, emergency info.';



COMMENT ON COLUMN "public"."performance"."technical" IS 'ADR-023: stage dimensions, in-house gear, power, comms, special needs.';



COMMENT ON COLUMN "public"."performance"."hold_notice_days" IS 'ADR-079 §2: hold decision notice as lead time. NULL = standard default (30) · 0 = no notice · N = notify N days before start_at. Urgency is derived (start_at − notice), never stored.';



COMMENT ON COLUMN "public"."performance"."readiness" IS 'Operator-ticked readiness checklist shown on the gig card (hotel, technical, ...). Key vocabulary lives app-side; absent key = not ticked. Holds the answer, not the content — the content stays in logistics/hospitality/technical.';



CREATE OR REPLACE FUNCTION "public"."create_performance"("p_project_id" "uuid", "p_performed_at" "date", "p_venue_name" "text" DEFAULT NULL::"text", "p_city" "text" DEFAULT NULL::"text", "p_country" "text" DEFAULT NULL::"text", "p_status" "public"."performance_status" DEFAULT 'proposed'::"public"."performance_status", "p_conversation_id" "uuid" DEFAULT NULL::"uuid", "p_line_id" "uuid" DEFAULT NULL::"uuid") RETURNS "public"."performance"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_caller       uuid := auth.uid();
  v_workspace_id uuid;
  v_base_slug    text;
  v_slug         text;
  v_perf         public.performance;
  v_try          int := 0;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null — RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  IF p_performed_at IS NULL THEN
    RAISE EXCEPTION 'performed_at cannot be null' USING ERRCODE = '22023';
  END IF;

  SELECT workspace_id INTO v_workspace_id
  FROM public.project
  WHERE id = p_project_id AND deleted_at IS NULL;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'project % not found', p_project_id
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_permission(p_project_id, 'edit:performance') THEN
    RAISE EXCEPTION 'edit:performance required to create a performance'
      USING ERRCODE = '42501';
  END IF;

  IF p_conversation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.conversation
    WHERE id = p_conversation_id AND project_id = p_project_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'conversation does not belong to project' USING ERRCODE = '22023';
  END IF;

  IF p_line_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.line
    WHERE id = p_line_id AND project_id = p_project_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'line does not belong to project' USING ERRCODE = '22023';
  END IF;

  v_base_slug := public.slugify(
    coalesce(NULLIF(trim(p_venue_name), ''), NULLIF(trim(p_city), ''), 'gig')
  ) || '-' || to_char(p_performed_at, 'YYYY-MM-DD');
  v_slug := v_base_slug;

  LOOP
    BEGIN
      INSERT INTO public.performance (
        workspace_id, project_id, line_id, conversation_id,
        performed_at, status, venue_name, city, country, slug, created_by
      ) VALUES (
        v_workspace_id, p_project_id, p_line_id, p_conversation_id,
        p_performed_at, p_status,
        NULLIF(trim(p_venue_name), ''),
        NULLIF(trim(p_city), ''),
        NULLIF(upper(trim(p_country)), ''),
        v_slug, v_caller
      )
      RETURNING * INTO v_perf;
      RETURN v_perf;
    EXCEPTION WHEN unique_violation THEN
      v_try := v_try + 1;
      IF v_try > 20 THEN RAISE; END IF;
      v_slug := v_base_slug || '-' || (v_try + 1)::text;
    END;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."create_performance"("p_project_id" "uuid", "p_performed_at" "date", "p_venue_name" "text", "p_city" "text", "p_country" "text", "p_status" "public"."performance_status", "p_conversation_id" "uuid", "p_line_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."person_note" (
    "id" "uuid" DEFAULT "public"."uuid_generate_v7"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "person_id" "uuid" NOT NULL,
    "author_id" "uuid" NOT NULL,
    "visibility" "public"."person_note_visibility" DEFAULT 'workspace'::"public"."person_note_visibility" NOT NULL,
    "body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "person_note_body_nonempty" CHECK (("length"("btrim"("body")) > 0))
);

ALTER TABLE ONLY "public"."person_note" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."person_note" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_person_note"("p_person_id" "uuid", "p_workspace_id" "uuid", "p_body" "text", "p_visibility" "public"."person_note_visibility" DEFAULT 'workspace'::"public"."person_note_visibility") RETURNS "public"."person_note"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_note   public.person_note;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null — RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  IF p_body IS NULL OR length(trim(p_body)) = 0 THEN
    RAISE EXCEPTION 'note body cannot be empty' USING ERRCODE = '22023';
  END IF;
  IF length(p_body) > 4000 THEN
    RAISE EXCEPTION 'note body too long (max 4000)' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.person
    WHERE id = p_person_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'person % not found', p_person_id USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_membership m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id      = v_caller
      AND m.accepted_at  IS NOT NULL
      AND m.role         IN ('owner', 'admin', 'member')
  ) THEN
    RAISE EXCEPTION 'caller is not a member of workspace % with sufficient role', p_workspace_id
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.person_note (person_id, workspace_id, author_id, body, visibility)
  VALUES (p_person_id, p_workspace_id, v_caller, trim(p_body), p_visibility)
  RETURNING * INTO v_note;

  RETURN v_note;
END;
$$;


ALTER FUNCTION "public"."create_person_note"("p_person_id" "uuid", "p_workspace_id" "uuid", "p_body" "text", "p_visibility" "public"."person_note_visibility") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project" (
    "id" "uuid" DEFAULT "public"."uuid_generate_v7"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "status" "public"."project_status" DEFAULT 'draft'::"public"."project_status" NOT NULL,
    "owner_id" "uuid",
    "starts_on" "date",
    "ends_on" "date",
    "dossier_url" "text",
    "poster_url" "text",
    "notes" "text",
    "custom_fields" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "previous_slugs" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "accent" "text",
    "initials" "text",
    CONSTRAINT "project_accent_check" CHECK ((("accent" IS NULL) OR ("accent" ~ '^([1-9]|1[0-2])$'::"text"))),
    CONSTRAINT "project_date_range" CHECK ((("ends_on" IS NULL) OR ("starts_on" IS NULL) OR ("ends_on" >= "starts_on"))),
    CONSTRAINT "project_description_length" CHECK ((("description" IS NULL) OR ("length"("description") <= 280))),
    CONSTRAINT "project_initials_check" CHECK ((("initials" IS NULL) OR ((("length"("initials") >= 1) AND ("length"("initials") <= 3)) AND ("initials" !~ '\s'::"text")))),
    CONSTRAINT "project_slug_format" CHECK (("slug" ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'::"text"))
);

ALTER TABLE ONLY "public"."project" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."project" OWNER TO "postgres";


COMMENT ON COLUMN "public"."project"."previous_slugs" IS 'ADR-024: rename history. Old slugs resolve to current entity for >=12 months via GIN lookup. Same shape on every entity that has a slug.';



COMMENT ON COLUMN "public"."project"."accent" IS 'Color identity. ''1''..''8'' = palette index into --accent-N tokens. NULL = derive via hash(slug). Stored as text to allow future free-form colors (hex/oklch) by relaxing the CHECK constraint without a schema migration.';



COMMENT ON COLUMN "public"."project"."initials" IS 'Identity monogram (ADR-081). Free-form 1..3 chars, mixed case, no internal whitespace. NULL = derive from name at render. Collision handled in the editor UI (case-sensitive exact match), not the DB.';



CREATE OR REPLACE FUNCTION "public"."create_project"("p_workspace_id" "uuid", "p_name" "text", "p_accent" "text" DEFAULT NULL::"text", "p_description" "text" DEFAULT NULL::"text", "p_slug" "text" DEFAULT NULL::"text") RETURNS "public"."project"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_caller      uuid := auth.uid();
  v_slug        text;
  v_accent      text;
  v_description text;
  v_project     public.project;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null — RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'name cannot be empty' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_membership m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id      = v_caller
      AND m.accepted_at  IS NOT NULL
      AND m.role         IN ('owner', 'admin', 'member')
  ) THEN
    RAISE EXCEPTION 'caller is not a member of workspace % with sufficient role', p_workspace_id
      USING ERRCODE = '42501';
  END IF;

  v_slug := COALESCE(NULLIF(trim(p_slug), ''), public.slugify(p_name));
  IF v_slug IS NULL OR v_slug = '' THEN
    v_slug := 'project-' || substr(gen_random_uuid()::text, 1, 8);
  END IF;

  IF public.is_reserved_slug(v_slug) THEN
    v_slug := v_slug || '-' || substr(gen_random_uuid()::text, 1, 4);
  END IF;

  WHILE EXISTS (
    SELECT 1 FROM public.project
    WHERE workspace_id = p_workspace_id
      AND slug = v_slug
      AND deleted_at IS NULL
  ) LOOP
    v_slug := v_slug || '-' || substr(gen_random_uuid()::text, 1, 4);
  END LOOP;

  v_accent      := NULLIF(trim(p_accent), '');
  v_description := NULLIF(trim(p_description), '');

  INSERT INTO public.project (
    workspace_id, slug, name, status, accent, description, created_by
  )
  VALUES (
    p_workspace_id, v_slug, trim(p_name), 'active', v_accent, v_description, v_caller
  )
  RETURNING * INTO v_project;

  RETURN v_project;
END;
$$;


ALTER FUNCTION "public"."create_project"("p_workspace_id" "uuid", "p_name" "text", "p_accent" "text", "p_description" "text", "p_slug" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_project"("p_workspace_id" "uuid", "p_name" "text", "p_accent" "text", "p_description" "text", "p_slug" "text") IS 'Creates a project in p_workspace_id with caller as created_by. SECURITY DEFINER bypasses the RLS check (workspace_id = current_workspace_id() in JWT); validates membership ≥ member explicitly. status defaults to ''active'' on UI-driven creation. p_accent: ''1''..''8'' or NULL (= hash fallback). p_description: ≤280 chars (DB CHECK lives on column).';



CREATE TABLE IF NOT EXISTS "public"."roadsheet_share" (
    "id" "uuid" DEFAULT "public"."uuid_generate_v7"() NOT NULL,
    "token" "text" NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "performance_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "revoked_at" timestamp with time zone,
    CONSTRAINT "roadsheet_share_role_check" CHECK (("role" = ANY (ARRAY['venue'::"text", 'performer'::"text", 'tech_manager'::"text"])))
);

ALTER TABLE ONLY "public"."roadsheet_share" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."roadsheet_share" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_roadsheet_share"("p_performance_id" "uuid", "p_role" "text") RETURNS "public"."roadsheet_share"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_project uuid;
  v_ws uuid;
  v_share public.roadsheet_share;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('venue', 'performer', 'tech_manager') THEN
    RAISE EXCEPTION 'role must be venue|performer|tech_manager' USING ERRCODE = '22023';
  END IF;

  SELECT project_id, workspace_id INTO v_project, v_ws
  FROM public.performance WHERE id = p_performance_id AND deleted_at IS NULL;
  IF v_project IS NULL THEN
    RAISE EXCEPTION 'performance not found' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_permission(v_project, 'edit:performance') THEN
    RAISE EXCEPTION 'edit:performance required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.roadsheet_share (token, workspace_id, performance_id, role, created_by)
  VALUES (
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
    v_ws, p_performance_id, p_role, v_caller
  )
  RETURNING * INTO v_share;
  RETURN v_share;
END;
$$;


ALTER FUNCTION "public"."create_roadsheet_share"("p_performance_id" "uuid", "p_role" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task" (
    "id" "uuid" DEFAULT "public"."uuid_generate_v7"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "project_id" "uuid",
    "line_id" "uuid",
    "performance_id" "uuid",
    "conversation_id" "uuid",
    "title" "text" NOT NULL,
    "note" "text",
    "due_at" timestamp with time zone,
    "status" "public"."task_status" DEFAULT 'open'::"public"."task_status" NOT NULL,
    "origin" "public"."task_origin" DEFAULT 'manual'::"public"."task_origin" NOT NULL,
    "custom_fields" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "from_at" timestamp with time zone,
    "lead_days" smallint,
    CONSTRAINT "task_at_most_one_parent" CHECK ((((((("project_id" IS NOT NULL))::integer + (("line_id" IS NOT NULL))::integer) + (("performance_id" IS NOT NULL))::integer) + (("conversation_id" IS NOT NULL))::integer) <= 1)),
    CONSTRAINT "task_from_before_due" CHECK ((("from_at" IS NULL) OR ("due_at" IS NULL) OR ("from_at" <= "due_at"))),
    CONSTRAINT "task_lead_days_gte_zero" CHECK ((("lead_days" IS NULL) OR ("lead_days" >= 0)))
);

ALTER TABLE ONLY "public"."task" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."task" OWNER TO "postgres";


COMMENT ON TABLE "public"."task" IS 'The verb layer (ADR-068, D3). At most one parent of project/line/performance/engagement — none = free workspace task. origin=manual only in v1 (protocol → ADR-011 Phase 0.5, ai → Phase 1+).';



COMMENT ON COLUMN "public"."task"."due_at" IS 'Date-only contract at the API (YYYY-MM-DD, Postgres casts) — same as engagement.next_action_at.';



COMMENT ON COLUMN "public"."task"."origin" IS 'manual | protocol | ai (D3). Only manual is written in v1; the enum exists so protocol tasks (ADR-011) land without DDL.';



COMMENT ON COLUMN "public"."task"."from_at" IS 'Date-only contract at the API (YYYY-MM-DD). Dormant until this day — the Desk never renders it before (ADR-070).';



COMMENT ON COLUMN "public"."task"."lead_days" IS 'How many days before due_at the task turns urgent. AI-proposed, human-corrected, never required (ADR-069/070). Urgency is derived at read time, never stored.';



CREATE OR REPLACE FUNCTION "public"."create_task"("p_title" "text", "p_note" "text" DEFAULT NULL::"text", "p_due_at" "date" DEFAULT NULL::"date", "p_from_at" "date" DEFAULT NULL::"date", "p_lead_days" integer DEFAULT NULL::integer, "p_workspace_id" "uuid" DEFAULT NULL::"uuid", "p_project_id" "uuid" DEFAULT NULL::"uuid", "p_line_id" "uuid" DEFAULT NULL::"uuid", "p_performance_id" "uuid" DEFAULT NULL::"uuid", "p_conversation_id" "uuid" DEFAULT NULL::"uuid") RETURNS "public"."task"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_caller       uuid := auth.uid();
  v_title        text := nullif(btrim(coalesce(p_title, '')), '');
  v_workspace_id uuid;
  v_parents      int  := num_nonnulls(p_project_id, p_line_id, p_performance_id, p_conversation_id);
  v_task         public.task;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF v_parents > 1 THEN
    RAISE EXCEPTION 'at most one of project_id / line_id / performance_id / conversation_id'
      USING ERRCODE = '22023';
  END IF;

  IF v_parents = 1 AND p_workspace_id IS NOT NULL THEN
    RAISE EXCEPTION 'workspace_id only applies to a task with no parent'
      USING ERRCODE = '22023';
  END IF;

  IF v_parents = 0 AND p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_id is required for a task with no parent'
      USING ERRCODE = '22023';
  END IF;

  IF v_title IS NULL THEN
    RAISE EXCEPTION 'title cannot be empty' USING ERRCODE = '22023';
  END IF;

  IF p_lead_days IS NOT NULL AND (p_lead_days < 0 OR p_lead_days > 365) THEN
    RAISE EXCEPTION 'lead_days must be between 0 and 365' USING ERRCODE = '22023';
  END IF;

  IF p_from_at IS NOT NULL AND p_due_at IS NOT NULL AND p_from_at > p_due_at THEN
    RAISE EXCEPTION 'from_at cannot be after due_at' USING ERRCODE = '22023';
  END IF;

  IF p_project_id IS NOT NULL THEN
    SELECT workspace_id INTO v_workspace_id
    FROM public.project WHERE id = p_project_id AND deleted_at IS NULL;
  ELSIF p_line_id IS NOT NULL THEN
    SELECT workspace_id INTO v_workspace_id
    FROM public.line WHERE id = p_line_id AND deleted_at IS NULL;
  ELSIF p_performance_id IS NOT NULL THEN
    SELECT workspace_id INTO v_workspace_id
    FROM public.performance WHERE id = p_performance_id AND deleted_at IS NULL;
  ELSIF p_conversation_id IS NOT NULL THEN
    SELECT workspace_id INTO v_workspace_id
    FROM public.conversation WHERE id = p_conversation_id AND deleted_at IS NULL;
  ELSE
    v_workspace_id := p_workspace_id;
  END IF;

  IF v_workspace_id IS NULL OR NOT public.is_workspace_member(v_workspace_id) THEN
    -- Not-found and no-membership collapse (no existence oracle).
    RAISE EXCEPTION 'parent not found' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.task (
    workspace_id, project_id, line_id, performance_id, conversation_id,
    title, note, due_at, from_at, lead_days, created_by
  ) VALUES (
    v_workspace_id, p_project_id, p_line_id, p_performance_id, p_conversation_id,
    v_title, nullif(btrim(coalesce(p_note, '')), ''), p_due_at, p_from_at,
    p_lead_days, v_caller
  )
  RETURNING * INTO v_task;

  RETURN v_task;
END;
$$;


ALTER FUNCTION "public"."create_task"("p_title" "text", "p_note" "text", "p_due_at" "date", "p_from_at" "date", "p_lead_days" integer, "p_workspace_id" "uuid", "p_project_id" "uuid", "p_line_id" "uuid", "p_performance_id" "uuid", "p_conversation_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."venue" (
    "id" "uuid" DEFAULT "public"."uuid_generate_v7"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "city" "text",
    "country" character(2),
    "address" "text",
    "capacity" integer,
    "contacts" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "notes" "text",
    "custom_fields" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "timezone" "text",
    "slug" "text",
    "previous_slugs" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    CONSTRAINT "venue_country_format" CHECK ((("country" IS NULL) OR ("country" ~ '^[A-Z]{2}$'::"text"))),
    CONSTRAINT "venue_name_nonempty" CHECK (("length"("btrim"("name")) > 0))
);

ALTER TABLE ONLY "public"."venue" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."venue" OWNER TO "postgres";


COMMENT ON COLUMN "public"."venue"."timezone" IS 'D-PRE-10: IANA timezone id (e.g. Europe/Madrid). Drives dual-timezone display in road sheet.';



CREATE OR REPLACE FUNCTION "public"."create_venue"("p_workspace_id" "uuid", "p_name" "text", "p_city" "text" DEFAULT NULL::"text", "p_country" "text" DEFAULT NULL::"text", "p_address" "text" DEFAULT NULL::"text", "p_capacity" integer DEFAULT NULL::integer, "p_timezone" "text" DEFAULT NULL::"text") RETURNS "public"."venue"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_caller uuid := auth.uid();
  v_name text := nullif(btrim(p_name), '');
  v_city text := nullif(btrim(coalesce(p_city, '')), '');
  v_slug text;
  v_base text;
  v_n int := 1;
  v_venue public.venue;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'name is required' USING ERRCODE = '22023';
  END IF;
  IF p_country IS NOT NULL AND p_country !~ '^[A-Za-z]{2}$' THEN
    RAISE EXCEPTION 'country must be ISO 3166 alpha-2' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_membership m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id = v_caller
      AND m.accepted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'not a member of this workspace' USING ERRCODE = '42501';
  END IF;

  -- Idempotent promote: same name+city in the workspace → return it.
  SELECT * INTO v_venue FROM public.venue
  WHERE workspace_id = p_workspace_id
    AND deleted_at IS NULL
    AND lower(name) = lower(v_name)
    AND coalesce(lower(city), '') = coalesce(lower(v_city), '');
  IF v_venue.id IS NOT NULL THEN
    RETURN v_venue;
  END IF;

  v_base := coalesce(nullif(public.slugify(v_name), ''), 'venue');
  v_slug := v_base;
  WHILE EXISTS (
    SELECT 1 FROM public.venue
    WHERE workspace_id = p_workspace_id AND slug = v_slug AND deleted_at IS NULL
  ) LOOP
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  END LOOP;

  INSERT INTO public.venue (workspace_id, name, city, country, address, capacity, timezone, slug, created_by)
  VALUES (p_workspace_id, v_name, v_city, upper(p_country), nullif(btrim(coalesce(p_address, '')), ''), p_capacity, p_timezone, v_slug, v_caller)
  RETURNING * INTO v_venue;
  RETURN v_venue;
END;
$_$;


ALTER FUNCTION "public"."create_venue"("p_workspace_id" "uuid", "p_name" "text", "p_city" "text", "p_country" "text", "p_address" "text", "p_capacity" integer, "p_timezone" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workspace" (
    "id" "uuid" DEFAULT "public"."uuid_generate_v7"() NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "kind" "public"."workspace_kind" DEFAULT 'personal'::"public"."workspace_kind" NOT NULL,
    "country" character(2),
    "timezone" "text" DEFAULT 'Europe/Madrid'::"text" NOT NULL,
    "settings" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "custom_fields" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "previous_slugs" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "account_id" "uuid" NOT NULL,
    "accent" "text",
    "description" "text",
    "domain" "public"."workspace_domain",
    "city" "text",
    "logo_url" "text",
    "alias" "text",
    CONSTRAINT "workspace_accent_check" CHECK ((("accent" IS NULL) OR ("accent" ~ '^([1-9]|1[0-2])$'::"text"))),
    CONSTRAINT "workspace_alias_check" CHECK ((("alias" IS NULL) OR ("alias" ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'::"text"))),
    CONSTRAINT "workspace_booking_mode_valid" CHECK (((("settings" ->> 'booking_mode'::"text") IS NULL) OR (("settings" ->> 'booking_mode'::"text") = ANY (ARRAY['simple'::"text", 'prioritized'::"text"])))),
    CONSTRAINT "workspace_city_check" CHECK ((("city" IS NULL) OR ("length"("city") <= 120))),
    CONSTRAINT "workspace_country_format" CHECK ((("country" IS NULL) OR ("country" ~ '^[A-Z]{2}$'::"text"))),
    CONSTRAINT "workspace_description_check" CHECK ((("description" IS NULL) OR ("length"("description") <= 280))),
    CONSTRAINT "workspace_logo_url_check" CHECK ((("logo_url" IS NULL) OR ("length"("logo_url") <= 2048))),
    CONSTRAINT "workspace_slug_format" CHECK (("slug" ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'::"text"))
);

ALTER TABLE ONLY "public"."workspace" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."workspace" OWNER TO "postgres";


COMMENT ON COLUMN "public"."workspace"."settings" IS 'Workspace knobs the app reads. Known keys: booking_mode (simple|prioritized, ADR-002 - which hold convention the UI speaks; absent = simple).';



COMMENT ON COLUMN "public"."workspace"."accent" IS 'Color identity. ''1''..''8'' = palette index into --accent-N tokens. NULL = derive via hash(slug). Stored as text to allow future free-form colors (hex/oklch) by relaxing the CHECK constraint without a schema migration.';



COMMENT ON COLUMN "public"."workspace"."description" IS 'Short blurb (≤280 chars) describing what this workspace is for. Surfaced in sidebar tooltips, settings cards, and future public share pages.';



COMMENT ON COLUMN "public"."workspace"."domain" IS 'Discipline of the entity (ADR-062) — drives per-archetype vocabulary + default project types. NULL = unset (UI falls back to kind label).';



COMMENT ON COLUMN "public"."workspace"."city" IS 'Human home base ("Barcelona") — complements country (char2) + timezone. Surfaced on the space portada kicker.';



COMMENT ON COLUMN "public"."workspace"."logo_url" IS 'Company/act logo (R2 URL). Upload flow ships with the space-edit flow; column ready now.';



COMMENT ON COLUMN "public"."workspace"."alias" IS 'Optional pretty URL alias (ADR-067). Resolved inbound → redirect to the canonical slug form. Never emitted in internal links. Granted through workspace_alias_request review; revocable without breaking any shared link (identity lives in slug).';



CREATE OR REPLACE FUNCTION "public"."create_workspace"("p_name" "text", "p_slug" "text" DEFAULT NULL::"text", "p_accent" "text" DEFAULT NULL::"text", "p_description" "text" DEFAULT NULL::"text") RETURNS "public"."workspace"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_caller      uuid := auth.uid();
  v_account_id  uuid;
  v_accent      text;
  v_description text;
  v_workspace   public.workspace;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null — RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'name cannot be empty' USING ERRCODE = '22023';
  END IF;

  SELECT a.id INTO v_account_id
  FROM public.account a
  JOIN public.account_membership am ON am.account_id = a.id
  WHERE a.kind = 'personal'
    AND a.deleted_at IS NULL
    AND am.user_id = v_caller
    AND am.role = 'owner'
    AND am.accepted_at IS NOT NULL
    AND am.revoked_at IS NULL
  ORDER BY am.invited_at ASC
  LIMIT 1;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'caller has no personal account — cannot create workspace'
      USING ERRCODE = '42501';
  END IF;

  v_accent := NULLIF(trim(COALESCE(p_accent, '')), '');
  v_description := NULLIF(trim(COALESCE(p_description, '')), '');

  -- ADR-067: identity is machine-chosen. p_slug is ignored (kept for
  -- signature compat); the pretty name goes to workspace.name and, if the
  -- client wants a pretty URL, through the alias request flow.
  INSERT INTO public.workspace (slug, name, kind, account_id, accent, description)
  VALUES (public.generate_workspace_sid(), trim(p_name), 'personal', v_account_id, v_accent, v_description)
  RETURNING * INTO v_workspace;

  INSERT INTO public.workspace_membership (workspace_id, user_id, role, accepted_at)
  VALUES (v_workspace.id, v_caller, 'owner', now());

  RETURN v_workspace;
END;
$$;


ALTER FUNCTION "public"."create_workspace"("p_name" "text", "p_slug" "text", "p_accent" "text", "p_description" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_workspace"("p_name" "text", "p_slug" "text", "p_accent" "text", "p_description" "text") IS 'Creates a workspace under the caller''s personal account. ADR-067: slug is a machine short-id (generate_workspace_sid); p_slug is ignored, kept for signature compat. Pretty URLs go through request_workspace_alias.';



CREATE OR REPLACE FUNCTION "public"."current_user_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
  SELECT auth.uid();
$$;


ALTER FUNCTION "public"."current_user_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_workspace_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
  SELECT (auth.jwt() ->> 'current_workspace_id')::uuid;
$$;


ALTER FUNCTION "public"."current_workspace_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_workspace_role"() RETURNS "public"."membership_role"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
  SELECT role FROM public.workspace_membership
  WHERE user_id = auth.uid()
    AND workspace_id = current_workspace_id()
    AND accepted_at IS NOT NULL;
$$;


ALTER FUNCTION "public"."current_workspace_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."custom_access_token_hook"("event" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id      uuid  := (event ->> 'user_id')::uuid;
  v_claims       jsonb := COALESCE(event -> 'claims', '{}'::jsonb);
  v_workspace_id uuid;
BEGIN
  SELECT workspace_id
    INTO v_workspace_id
    FROM public.workspace_membership
   WHERE user_id = v_user_id
     AND accepted_at IS NOT NULL
   ORDER BY accepted_at ASC
   LIMIT 1;

  IF v_workspace_id IS NOT NULL THEN
    v_claims := v_claims || jsonb_build_object(
      'current_workspace_id', v_workspace_id::text
    );
  END IF;

  RETURN jsonb_set(event, '{claims}', v_claims);
END;
$$;


ALTER FUNCTION "public"."custom_access_token_hook"("event" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_asset_version"("p_asset_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_caller     uuid := auth.uid();
  v_project_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(a.project_id, l.project_id, p.project_id) INTO v_project_id
  FROM public.asset_version a
  LEFT JOIN public.line l ON l.id = a.line_id
  LEFT JOIN public.performance p ON p.id = a.performance_id
  WHERE a.id = p_asset_id AND a.deleted_at IS NULL;

  IF v_project_id IS NULL OR NOT public.has_permission(v_project_id, 'edit:performance') THEN
    RAISE EXCEPTION 'material not found' USING ERRCODE = '42501';
  END IF;

  UPDATE public.asset_version SET deleted_at = now()
  WHERE id = p_asset_id AND deleted_at IS NULL;
END;
$$;


ALTER FUNCTION "public"."delete_asset_version"("p_asset_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_availability_block"("p_availability_block_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_caller       uuid := auth.uid();
  v_workspace_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT workspace_id INTO v_workspace_id
  FROM public.availability_block
  WHERE id = p_availability_block_id AND deleted_at IS NULL;

  IF v_workspace_id IS NULL OR NOT public.is_workspace_member(v_workspace_id) THEN
    -- Not-found and no-membership collapse (no existence oracle).
    RAISE EXCEPTION 'availability block not found' USING ERRCODE = '42501';
  END IF;

  UPDATE public.availability_block SET deleted_at = now()
  WHERE id = p_availability_block_id AND deleted_at IS NULL;
END;
$$;


ALTER FUNCTION "public"."delete_availability_block"("p_availability_block_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."delete_availability_block"("p_availability_block_id" "uuid") IS 'Soft-delete a blackout (ADR-048: no DELETE policy, deleted_at never rides a client PATCH).';



CREATE OR REPLACE FUNCTION "public"."delete_conversation"("p_conversation_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_caller     uuid := auth.uid();
  v_project_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT project_id INTO v_project_id
  FROM public.conversation
  WHERE id = p_conversation_id AND deleted_at IS NULL;

  -- Not-found and no-permission collapse: no existence oracle.
  IF v_project_id IS NULL OR NOT public.has_permission(v_project_id, 'edit:conversation') THEN
    RAISE EXCEPTION 'conversation % not found', p_conversation_id
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.performance
    WHERE conversation_id = p_conversation_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'conversation has performances — unlink or delete them first'
      USING ERRCODE = '23503';
  END IF;

  UPDATE public.conversation
  SET deleted_at = now()
  WHERE id = p_conversation_id;
END;
$$;


ALTER FUNCTION "public"."delete_conversation"("p_conversation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_date"("p_date_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_caller     uuid := auth.uid();
  v_project_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null — RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  SELECT project_id INTO v_project_id
  FROM public.date
  WHERE id = p_date_id AND deleted_at IS NULL;

  IF v_project_id IS NULL
    OR NOT public.has_permission(v_project_id, 'edit:performance') THEN
    -- Not-found and no-permission collapse (no existence oracle).
    RAISE EXCEPTION 'date not found' USING ERRCODE = '42501';
  END IF;

  UPDATE public.date SET deleted_at = now()
  WHERE id = p_date_id AND deleted_at IS NULL;
END;
$$;


ALTER FUNCTION "public"."delete_date"("p_date_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."delete_date"("p_date_id" "uuid") IS 'Soft-delete a date row (ADR-048: no DELETE policy, deleted_at never rides a client PATCH).';



CREATE OR REPLACE FUNCTION "public"."delete_expense"("p_expense_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_caller     uuid := auth.uid();
  v_project_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(p.project_id, l.project_id) INTO v_project_id
  FROM public.expense e
  LEFT JOIN public.performance p ON p.id = e.performance_id
  LEFT JOIN public.line l ON l.id = e.line_id
  WHERE e.id = p_expense_id AND e.deleted_at IS NULL;

  IF v_project_id IS NULL OR NOT public.has_permission(v_project_id, 'edit:money') THEN
    RAISE EXCEPTION 'expense not found' USING ERRCODE = '42501';
  END IF;

  UPDATE public.expense SET deleted_at = now()
  WHERE id = p_expense_id AND deleted_at IS NULL;
END;
$$;


ALTER FUNCTION "public"."delete_expense"("p_expense_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_invoice"("p_invoice_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_inv public.invoice;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_inv FROM public.invoice
  WHERE id = p_invoice_id AND deleted_at IS NULL;
  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'invoice not found' USING ERRCODE = '42501';
  END IF;
  IF v_inv.project_id IS NOT NULL THEN
    IF NOT public.has_permission(v_inv.project_id, 'edit:money') THEN
      RAISE EXCEPTION 'edit:money required' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.workspace_membership m
      WHERE m.workspace_id = v_inv.workspace_id AND m.user_id = v_caller
        AND m.accepted_at IS NOT NULL AND m.role IN ('owner', 'admin')
    ) THEN
      RAISE EXCEPTION 'workspace owner/admin required' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF v_inv.status <> 'draft' THEN
    RAISE EXCEPTION 'only draft invoices can be deleted — cancel it instead' USING ERRCODE = '22023';
  END IF;
  UPDATE public.invoice SET deleted_at = now() WHERE id = p_invoice_id;
END;
$$;


ALTER FUNCTION "public"."delete_invoice"("p_invoice_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_performance"("p_performance_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_caller     uuid := auth.uid();
  v_project_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT project_id INTO v_project_id
  FROM public.performance
  WHERE id = p_performance_id AND deleted_at IS NULL;

  -- Not-found and no-permission collapse into one error: existence is
  -- never confirmed to a caller who couldn't see the row anyway.
  IF v_project_id IS NULL OR NOT public.has_permission(v_project_id, 'edit:performance') THEN
    RAISE EXCEPTION 'performance % not found', p_performance_id
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.invoice_line il
    JOIN public.invoice i ON i.id = il.invoice_id
    WHERE il.performance_id = p_performance_id
      AND i.deleted_at IS NULL
      AND i.status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'performance has invoices — discard or cancel them first'
      USING ERRCODE = '23503';
  END IF;

  UPDATE public.performance
  SET deleted_at = now()
  WHERE id = p_performance_id;
END;
$$;


ALTER FUNCTION "public"."delete_performance"("p_performance_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_person_note"("p_note_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_count  int;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null — RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.person_note
  SET deleted_at = now()
  WHERE id = p_note_id
    AND author_id = v_caller
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'note not found or not yours' USING ERRCODE = '42501';
  END IF;
END;
$$;


ALTER FUNCTION "public"."delete_person_note"("p_note_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_task"("p_task_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_caller       uuid := auth.uid();
  v_workspace_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT workspace_id INTO v_workspace_id
  FROM public.task
  WHERE id = p_task_id AND deleted_at IS NULL;

  IF v_workspace_id IS NULL OR NOT public.is_workspace_member(v_workspace_id) THEN
    -- Not-found and no-membership collapse (no existence oracle).
    RAISE EXCEPTION 'task not found' USING ERRCODE = '42501';
  END IF;

  UPDATE public.task SET deleted_at = now()
  WHERE id = p_task_id AND deleted_at IS NULL;
END;
$$;


ALTER FUNCTION "public"."delete_task"("p_task_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."delete_task"("p_task_id" "uuid") IS 'Soft-delete a task (ADR-048: no DELETE policy, deleted_at never rides a client PATCH).';



CREATE OR REPLACE FUNCTION "public"."generate_workspace_sid"() RETURNS "text"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_sid text;
BEGIN
  LOOP
    v_sid := substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.workspace
      WHERE deleted_at IS NULL AND (slug = v_sid OR alias = v_sid)
    );
  END LOOP;
  RETURN v_sid;
END;
$$;


ALTER FUNCTION "public"."generate_workspace_sid"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."generate_workspace_sid"() IS 'Machine identity segment for a workspace URL: 8 lowercase hex chars, unique vs live slugs AND aliases. Hex-only means it can never collide with a reserved route word (ADR-067).';



CREATE OR REPLACE FUNCTION "public"."get_public_calendar"("p_token" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_share public.calendar_share;
  v_result jsonb;
BEGIN
  SELECT * INTO v_share
  FROM public.calendar_share
  WHERE token = p_token AND revoked_at IS NULL;
  IF v_share.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- A soft-deleted workspace kills its feeds too.
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace w
    WHERE w.id = v_share.workspace_id AND w.deleted_at IS NULL
  ) THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'workspace', (SELECT jsonb_build_object('name', w.name, 'slug', w.slug, 'timezone', w.timezone)
                  FROM public.workspace w
                  WHERE w.id = v_share.workspace_id AND w.deleted_at IS NULL),
    'performances', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'slug', p.slug, 'performed_at', p.performed_at,
        'status', p.status, 'venue_name', p.venue_name, 'city', p.city,
        'country', p.country,
        'load_in_at', p.load_in_at, 'soundcheck_at', p.soundcheck_at,
        'start_at', p.start_at, 'loadout_at', p.loadout_at, 'wrap_at', p.wrap_at,
        'updated_at', p.updated_at,
        'project', (SELECT jsonb_build_object('name', pr.name)
                    FROM public.project pr WHERE pr.id = p.project_id),
        'venue', (SELECT jsonb_build_object(
                    'name', vn.name, 'city', vn.city, 'country', vn.country,
                    'address', vn.address, 'timezone', vn.timezone)
                  FROM public.venue vn WHERE vn.id = p.venue_id AND vn.deleted_at IS NULL)
      ) ORDER BY p.performed_at)
      FROM public.performance p
      WHERE p.workspace_id = v_share.workspace_id
        AND p.deleted_at IS NULL
        AND p.status IN ('confirmed', 'done', 'invoiced', 'paid')), '[]'::jsonb),
    'dates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', d.id, 'kind', d.kind, 'status', d.status, 'title', d.title,
        'starts_at', d.starts_at, 'ends_at', d.ends_at, 'all_day', d.all_day,
        'venue_name', d.venue_name, 'city', d.city, 'updated_at', d.updated_at,
        'project', (SELECT jsonb_build_object('name', pr.name)
                    FROM public.project pr WHERE pr.id = d.project_id)
      ) ORDER BY d.starts_at)
      FROM public.date d
      WHERE d.workspace_id = v_share.workspace_id
        AND d.deleted_at IS NULL
        AND d.status <> 'cancelled'), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."get_public_calendar"("p_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_public_roadsheet"("p_token" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_share public.roadsheet_share;
  v_result jsonb;
BEGIN
  SELECT * INTO v_share
  FROM public.roadsheet_share
  WHERE token = p_token AND revoked_at IS NULL;
  IF v_share.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'role', v_share.role,
    'performance', jsonb_build_object(
      'id', p.id, 'slug', p.slug, 'performed_at', p.performed_at,
      'status', p.status, 'venue_name', p.venue_name, 'city', p.city,
      'country', p.country,
      'load_in_at', p.load_in_at, 'soundcheck_at', p.soundcheck_at,
      'start_at', p.start_at, 'loadout_at', p.loadout_at, 'wrap_at', p.wrap_at,
      'logistics', p.logistics, 'hospitality', p.hospitality, 'technical', p.technical
    ),
    'project', (SELECT jsonb_build_object('name', pr.name, 'slug', pr.slug)
                FROM public.project pr WHERE pr.id = p.project_id),
    'venue', (SELECT jsonb_build_object(
                'name', vn.name, 'city', vn.city, 'country', vn.country,
                'address', vn.address, 'capacity', vn.capacity,
                'timezone', vn.timezone, 'contacts', vn.contacts)
              FROM public.venue vn WHERE vn.id = p.venue_id AND vn.deleted_at IS NULL),
    'cast', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'role', cm.role,
        'person', jsonb_build_object('full_name', pe.full_name, 'email', pe.email, 'phone', pe.phone)))
      FROM public.cast_member cm
      JOIN public.person pe ON pe.id = cm.person_id
      WHERE cm.project_id = p.project_id AND cm.deleted_at IS NULL), '[]'::jsonb),
    'cast_overrides', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'role', co.role, 'reason', co.reason,
        'person', jsonb_build_object('full_name', pe.full_name, 'email', pe.email, 'phone', pe.phone),
        'replaces', rp.full_name))
      FROM public.cast_override co
      JOIN public.person pe ON pe.id = co.person_id
      LEFT JOIN public.person rp ON rp.id = co.replaces_person_id
      WHERE co.performance_id = p.id AND co.deleted_at IS NULL), '[]'::jsonb),
    'crew', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'role', cr.role, 'notes', cr.notes, 'contact_override', cr.contact_override,
        'person', jsonb_build_object('full_name', pe.full_name, 'email', pe.email, 'phone', pe.phone)))
      FROM public.crew_assignment cr
      JOIN public.person pe ON pe.id = cr.person_id
      WHERE cr.performance_id = p.id AND cr.deleted_at IS NULL), '[]'::jsonb),
    'assets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'kind', av.kind, 'direction', av.direction, 'notes', av.notes, 'uploaded_at', av.uploaded_at))
      FROM public.asset_version av
      WHERE av.performance_id = p.id AND av.deleted_at IS NULL), '[]'::jsonb)
  ) INTO v_result
  FROM public.performance p
  WHERE p.id = v_share.performance_id AND p.deleted_at IS NULL;

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."get_public_roadsheet"("p_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_immutable_author"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.author_id IS DISTINCT FROM OLD.author_id THEN
    RAISE EXCEPTION 'author_id is immutable on %', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."guard_immutable_author"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_immutable_created_by"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'created_by is immutable on %', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."guard_immutable_created_by"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_immutable_task_parents"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.project_id      IS DISTINCT FROM OLD.project_id
  OR NEW.line_id         IS DISTINCT FROM OLD.line_id
  OR NEW.performance_id  IS DISTINCT FROM OLD.performance_id
  OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id THEN
    RAISE EXCEPTION 'task parent is immutable — delete and recreate'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."guard_immutable_task_parents"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."guard_immutable_task_parents"() IS 'Task parent is fixed at creation (ADR-068 v1). A relink would need cross-workspace coherence guards the app does not carry; the API whitelist already blocks it in-app — this closes the PostgREST-direct path.';



CREATE OR REPLACE FUNCTION "public"."guard_immutable_workspace_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
    RAISE EXCEPTION 'workspace_id is immutable on %', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."guard_immutable_workspace_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_performance_fee_columns"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.fee_amount IS DISTINCT FROM OLD.fee_amount OR NEW.fee_currency IS DISTINCT FROM OLD.fee_currency THEN
    IF NOT public.has_permission(NEW.project_id, 'edit:money') THEN
      RAISE EXCEPTION 'edit:money required to modify performance fee columns' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."guard_performance_fee_columns"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_full_name    text;
  v_slug         text;
  v_account_slug text;
  v_account_id   uuid;
  v_workspace_id uuid;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1));

  INSERT INTO public.user_profile (user_id, full_name, locale)
  VALUES (NEW.id, v_full_name, COALESCE(NEW.raw_user_meta_data ->> 'locale', 'es'))
  ON CONFLICT (user_id) DO NOTHING;

  -- ADR-067: personal workspace gets a machine short-id, not the email
  -- local-part — no signup can ever fight another over a name.
  v_slug := public.generate_workspace_sid();

  v_account_slug := v_slug || '-acc';
  WHILE EXISTS (SELECT 1 FROM public.account WHERE slug = v_account_slug AND deleted_at IS NULL) LOOP
    v_account_slug := v_slug || '-acc-' || substr(gen_random_uuid()::text, 1, 4);
  END LOOP;

  INSERT INTO public.account (slug, name, kind)
  VALUES (v_account_slug, v_full_name, 'personal')
  RETURNING id INTO v_account_id;

  INSERT INTO public.account_membership (account_id, user_id, role, accepted_at)
  VALUES (v_account_id, NEW.id, 'owner', now());

  INSERT INTO public.workspace (slug, name, kind, account_id)
  VALUES (v_slug, v_full_name, 'personal', v_account_id)
  RETURNING id INTO v_workspace_id;

  INSERT INTO public.workspace_membership (workspace_id, user_id, role, accepted_at)
  VALUES (v_workspace_id, NEW.id, 'owner', now());

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_permission"("p_project_id" "uuid", "p_perm" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
  select
    exists (
      select 1
      from public.workspace_membership wm
      join public.project p on p.workspace_id = wm.workspace_id
      where p.id = p_project_id
        and wm.user_id = auth.uid()
        and wm.accepted_at is not null
        and wm.role in ('owner', 'admin')
    )
    or
    exists (
      with mr as (
        select pm.roles,
               pm.permission_grants,
               pm.permission_revokes,
               p.workspace_id
        from public.project_membership pm
        join public.project p on p.id = pm.project_id
        join public.workspace_membership wm
          on wm.workspace_id = p.workspace_id
         and wm.user_id = pm.user_id
         and wm.accepted_at is not null
        where pm.project_id = p_project_id
          and pm.user_id = auth.uid()
      ),
      role_perms as (
        select unnest(wr.permissions) as perm
        from public.workspace_role wr
        join mr on mr.workspace_id = wr.workspace_id
        where wr.code = any (mr.roles)
          and wr.archived_at is null
      ),
      effective as (
        select perm from role_perms
        union
        select unnest(mr.permission_grants) from mr
        except
        select unnest(mr.permission_revokes) from mr
      )
      select 1 from effective where perm = p_perm
    );
$$;


ALTER FUNCTION "public"."has_permission"("p_project_id" "uuid", "p_perm" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."has_permission"("p_project_id" "uuid", "p_perm" "text") IS 'Effective project permission check. A live accepted workspace membership is the outer access envelope; project roles/grants/revokes specialize access inside it. Workspace owner/admin bypass is explicit (ADR-006). No wildcard.';



CREATE OR REPLACE FUNCTION "public"."is_account_admin"("acc_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.account_membership
    WHERE user_id = auth.uid()
      AND account_id = acc_id
      AND role IN ('owner', 'admin')
      AND accepted_at IS NOT NULL
      AND revoked_at IS NULL
  );
$$;


ALTER FUNCTION "public"."is_account_admin"("acc_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_account_member"("acc_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.account_membership
    WHERE user_id = auth.uid()
      AND account_id = acc_id
      AND accepted_at IS NOT NULL
      AND revoked_at IS NULL
  );
$$;


ALTER FUNCTION "public"."is_account_member"("acc_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_account_owner"("acc_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.account_membership
    WHERE user_id = auth.uid()
      AND account_id = acc_id
      AND role = 'owner'
      AND accepted_at IS NOT NULL
      AND revoked_at IS NULL
  );
$$;


ALTER FUNCTION "public"."is_account_owner"("acc_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_reserved_slug"("candidate" "text") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT lower(coalesce(candidate, '')) = ANY (ARRAY[
    'h','public','api','auth','login','logout','signup','signin','signout','oauth',
    'www','app','home','about','pricing','docs','blog','help','support','legal','terms','privacy','contact','careers','status','changelog',
    'admin','settings','account','profile','billing','dashboard','new','edit','delete','search','explore','discover',
    'house','room','run','gig','desk','plaza','roadsheet','conversation','conversations','person','venue','asset','invoice','calendar','planner','money','comms','archive',
    'agenda','people',
    'staging','dev','playground','booking','assets','static','cdn'
  ]);
$$;


ALTER FUNCTION "public"."is_reserved_slug"("candidate" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_reserved_slug"("candidate" "text") IS 'ADR-024: mirrors RESERVED_WORKSPACE_SLUGS in apps/web/src/lib/reserved-slugs.ts. Update both together.';



CREATE OR REPLACE FUNCTION "public"."is_workspace_admin"("ws_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
  select exists (
    select 1
    from public.workspace_membership
    where user_id = auth.uid()
      and workspace_id = ws_id
      and accepted_at is not null
      and role in ('owner', 'admin')
  );
$$;


ALTER FUNCTION "public"."is_workspace_admin"("ws_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_workspace_admin"("ws_id" "uuid") IS 'True only for a live workspace owner/admin. SECURITY DEFINER avoids recursive RLS when workspace_membership policies check their own table.';



CREATE OR REPLACE FUNCTION "public"."is_workspace_member"("ws_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_membership
    WHERE user_id = auth.uid() AND workspace_id = ws_id AND accepted_at IS NOT NULL
  );
$$;


ALTER FUNCTION "public"."is_workspace_member"("ws_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_calendar_shares"("p_workspace_id" "uuid") RETURNS SETOF "public"."calendar_share"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.workspace_membership m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id = auth.uid()
      AND m.accepted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT * FROM public.calendar_share
    WHERE workspace_id = p_workspace_id AND revoked_at IS NULL
    ORDER BY created_at DESC;
END;
$$;


ALTER FUNCTION "public"."list_calendar_shares"("p_workspace_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_roadsheet_shares"("p_performance_id" "uuid") RETURNS SETOF "public"."roadsheet_share"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_project uuid;
BEGIN
  SELECT project_id INTO v_project
  FROM public.performance WHERE id = p_performance_id AND deleted_at IS NULL;
  IF v_project IS NULL OR NOT public.has_permission(v_project, 'edit:performance') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT * FROM public.roadsheet_share
    WHERE performance_id = p_performance_id AND revoked_at IS NULL
    ORDER BY created_at DESC;
END;
$$;


ALTER FUNCTION "public"."list_roadsheet_shares"("p_performance_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."project_id_of_asset_version"("p_project_id" "uuid", "p_line_id" "uuid", "p_performance_id" "uuid") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT COALESCE(
    p_project_id,
    (SELECT project_id FROM public.line WHERE id = p_line_id),
    (SELECT project_id FROM public.performance WHERE id = p_performance_id)
  );
$$;


ALTER FUNCTION "public"."project_id_of_asset_version"("p_project_id" "uuid", "p_line_id" "uuid", "p_performance_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."project_id_of_expense"("p_expense_id" "uuid") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
  SELECT COALESCE(
    (SELECT pf.project_id FROM public.performance pf JOIN public.expense e ON e.performance_id = pf.id WHERE e.id = p_expense_id),
    (SELECT l.project_id  FROM public.line        l  JOIN public.expense e ON e.line_id        = l.id  WHERE e.id = p_expense_id)
  );
$$;


ALTER FUNCTION "public"."project_id_of_expense"("p_expense_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."project_id_of_performance"("p_performance_id" "uuid") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$ SELECT project_id FROM public.performance WHERE id = p_performance_id; $$;


ALTER FUNCTION "public"."project_id_of_performance"("p_performance_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workspace_alias_request" (
    "id" "uuid" DEFAULT "public"."uuid_generate_v7"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "workspace_name" "text" NOT NULL,
    "alias" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "requested_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "decided_at" timestamp with time zone,
    "decided_by" "uuid",
    CONSTRAINT "workspace_alias_request_alias_check" CHECK (("alias" ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'::"text")),
    CONSTRAINT "workspace_alias_request_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text", 'superseded'::"text"])))
);


ALTER TABLE "public"."workspace_alias_request" OWNER TO "postgres";


COMMENT ON TABLE "public"."workspace_alias_request" IS 'Alias claim flow (ADR-067): owner/admin requests → pending → platform admin reviews. workspace_name is a snapshot so reviewers need no RLS access to the workspace row.';



CREATE OR REPLACE FUNCTION "public"."request_workspace_alias"("p_workspace_id" "uuid", "p_alias" "text") RETURNS "public"."workspace_alias_request"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_caller uuid := auth.uid();
  v_alias  text := lower(trim(p_alias));
  v_ws     public.workspace;
  v_req    public.workspace_alias_request;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authenticated caller required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ws FROM public.workspace
  WHERE id = p_workspace_id AND deleted_at IS NULL;
  IF v_ws.id IS NULL THEN
    RAISE EXCEPTION 'workspace not found' USING ERRCODE = '22023';
  END IF;

  -- Only owner/admin of the space may claim its public address.
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_membership m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id = v_caller
      AND m.accepted_at IS NOT NULL
      AND m.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'owner or admin role required' USING ERRCODE = '42501';
  END IF;

  IF v_alias IS NULL OR v_alias !~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$' THEN
    RAISE EXCEPTION 'invalid alias format' USING ERRCODE = '22023';
  END IF;
  IF public.is_reserved_slug(v_alias) THEN
    RAISE EXCEPTION 'alias is a reserved word' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.workspace
    WHERE deleted_at IS NULL AND (slug = v_alias OR alias = v_alias)
  ) THEN
    RAISE EXCEPTION 'alias already taken' USING ERRCODE = '23505';
  END IF;

  -- A fresh request supersedes any pending one for the same workspace.
  UPDATE public.workspace_alias_request
  SET status = 'superseded', decided_at = now()
  WHERE workspace_id = p_workspace_id AND status = 'pending';

  INSERT INTO public.workspace_alias_request (workspace_id, workspace_name, alias, requested_by)
  VALUES (p_workspace_id, v_ws.name, v_alias, v_caller)
  RETURNING * INTO v_req;

  RETURN v_req;
END;
$_$;


ALTER FUNCTION "public"."request_workspace_alias"("p_workspace_id" "uuid", "p_alias" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."request_workspace_alias"("p_workspace_id" "uuid", "p_alias" "text") IS 'Owner/admin of a workspace requests a URL alias. Validates format + reserved + availability (vs live slugs AND aliases), supersedes prior pending request, inserts pending (ADR-067).';



CREATE OR REPLACE FUNCTION "public"."review_workspace_alias"("p_request_id" "uuid", "p_approve" boolean) RETURNS "public"."workspace_alias_request"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_req    public.workspace_alias_request;
BEGIN
  IF v_caller IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_profile p
    WHERE p.user_id = v_caller AND p.is_platform_admin
  ) THEN
    RAISE EXCEPTION 'platform admin required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_req FROM public.workspace_alias_request
  WHERE id = p_request_id AND status = 'pending'
  FOR UPDATE;
  IF v_req.id IS NULL THEN
    RAISE EXCEPTION 'pending request not found' USING ERRCODE = '22023';
  END IF;

  IF p_approve THEN
    -- Availability may have changed since the request was filed.
    IF EXISTS (
      SELECT 1 FROM public.workspace
      WHERE deleted_at IS NULL AND (slug = v_req.alias OR alias = v_req.alias)
    ) THEN
      RAISE EXCEPTION 'alias no longer available' USING ERRCODE = '23505';
    END IF;

    UPDATE public.workspace SET alias = v_req.alias, updated_at = now()
    WHERE id = v_req.workspace_id;

    UPDATE public.workspace_alias_request
    SET status = 'approved', decided_at = now(), decided_by = v_caller
    WHERE id = p_request_id
    RETURNING * INTO v_req;
  ELSE
    UPDATE public.workspace_alias_request
    SET status = 'rejected', decided_at = now(), decided_by = v_caller
    WHERE id = p_request_id
    RETURNING * INTO v_req;
  END IF;

  RETURN v_req;
END;
$$;


ALTER FUNCTION "public"."review_workspace_alias"("p_request_id" "uuid", "p_approve" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."review_workspace_alias"("p_request_id" "uuid", "p_approve" boolean) IS 'Platform admin approves (sets workspace.alias, re-checking availability) or rejects a pending alias request (ADR-067).';



CREATE OR REPLACE FUNCTION "public"."revoke_calendar_share"("p_share_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_ws uuid;
BEGIN
  SELECT s.workspace_id INTO v_ws
  FROM public.calendar_share s
  WHERE s.id = p_share_id AND s.revoked_at IS NULL;
  IF v_ws IS NULL OR auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.workspace_membership m
    WHERE m.workspace_id = v_ws
      AND m.user_id = auth.uid()
      AND m.accepted_at IS NOT NULL
      AND m.role IN ('owner', 'admin', 'member')
  ) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  UPDATE public.calendar_share SET revoked_at = now() WHERE id = p_share_id;
END;
$$;


ALTER FUNCTION "public"."revoke_calendar_share"("p_share_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."revoke_roadsheet_share"("p_share_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_project uuid;
BEGIN
  SELECT p.project_id INTO v_project
  FROM public.roadsheet_share s
  JOIN public.performance p ON p.id = s.performance_id
  WHERE s.id = p_share_id AND s.revoked_at IS NULL;
  IF v_project IS NULL OR NOT public.has_permission(v_project, 'edit:performance') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  UPDATE public.roadsheet_share SET revoked_at = now() WHERE id = p_share_id;
END;
$$;


ALTER FUNCTION "public"."revoke_roadsheet_share"("p_share_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."seed_system_roles_on_workspace"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  INSERT INTO workspace_role (workspace_id, code, label, is_system, access_level, permissions) VALUES
    (NEW.id, 'owner',              'Owner',                    true, 'owner',    ARRAY['read:money','read:conversation','read:person_note_private','read:internal_notes','edit:performance','edit:conversation','edit:money','edit:project_meta','edit:membership','admin:project']::text[]),
    (NEW.id, 'admin',              'Admin',                    true, 'admin',    ARRAY['read:money','read:conversation','read:person_note_private','read:internal_notes','edit:performance','edit:conversation','edit:money','edit:project_meta','edit:membership']::text[]),
    (NEW.id, 'producer',           'Producer',                 true, 'producer', ARRAY['read:money','read:conversation','read:person_note_private','read:internal_notes','edit:performance','edit:conversation','edit:money','edit:project_meta']::text[]),
    (NEW.id, 'production_manager', 'Production Manager',       true, 'producer', ARRAY['read:money','read:conversation','read:person_note_private','read:internal_notes','edit:performance','edit:conversation','edit:money','edit:project_meta']::text[]),
    (NEW.id, 'tour_manager',       'Tour Manager',             true, 'producer', ARRAY['read:money','read:conversation','read:person_note_private','read:internal_notes','edit:performance','edit:conversation','edit:money','edit:project_meta']::text[]),
    (NEW.id, 'distribution',       'Distribution',             true, 'producer', ARRAY['read:money','read:conversation','read:person_note_private','read:internal_notes','edit:performance','edit:conversation','edit:project_meta']::text[]),
    (NEW.id, 'director',           'Director',                 true, 'member',   ARRAY['read:conversation','read:internal_notes','edit:performance']::text[]),
    (NEW.id, 'author',             'Author',                   true, 'member',   ARRAY['read:internal_notes','edit:performance']::text[]),
    (NEW.id, 'technical_director', 'Technical Director',       true, 'member',   ARRAY['read:internal_notes','edit:performance']::text[]),
    (NEW.id, 'performer',          'Performer',                true, 'member',   ARRAY['read:internal_notes']::text[]),
    (NEW.id, 'light_design',       'Light Design',             true, 'member',   ARRAY['read:internal_notes']::text[]),
    (NEW.id, 'sound_design',       'Sound Design',             true, 'member',   ARRAY['read:internal_notes']::text[]),
    (NEW.id, 'stage_design',       'Stage Design',             true, 'member',   ARRAY['read:internal_notes']::text[]),
    (NEW.id, 'costume_design',     'Costume Design',           true, 'member',   ARRAY['read:internal_notes']::text[]),
    (NEW.id, 'press',              'Press',                    true, 'member',   ARRAY['read:internal_notes']::text[]);
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."seed_system_roles_on_workspace"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workspace_person" (
    "workspace_id" "uuid" NOT NULL,
    "person_id" "uuid" NOT NULL,
    "slug" "text" NOT NULL,
    "full_name" "text" NOT NULL,
    "first_name" "text",
    "last_name" "text",
    "email" "extensions"."citext",
    "phone" "text",
    "website" "text",
    "city" "text",
    "country" character(2),
    "languages" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "organization_id" "uuid",
    "title" "text",
    "notes" "text",
    "custom_fields" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "profile_sync_enabled" boolean DEFAULT false NOT NULL,
    "profile_shared_fields" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "profile_shared_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "workspace_person_country_format" CHECK ((("country" IS NULL) OR ("country" ~ '^[A-Z]{2}$'::"text"))),
    CONSTRAINT "workspace_person_name_nonempty" CHECK (("length"("btrim"("full_name")) > 0)),
    CONSTRAINT "workspace_person_slug_format" CHECK (("slug" ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'::"text"))
);

ALTER TABLE ONLY "public"."workspace_person" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."workspace_person" OWNER TO "postgres";


COMMENT ON TABLE "public"."workspace_person" IS 'A workspace-private dossier for one global person identity. No fields are copied from another workspace.';



COMMENT ON COLUMN "public"."workspace_person"."profile_sync_enabled" IS 'True only after the linked user explicitly shares their portable profile with this workspace.';



CREATE OR REPLACE FUNCTION "public"."share_my_profile_with_workspace"("p_workspace_id" "uuid", "p_fields" "text"[] DEFAULT ARRAY['full_name'::"text", 'first_name'::"text", 'last_name'::"text", 'phone'::"text", 'website'::"text", 'city'::"text", 'country'::"text", 'languages'::"text", 'professional_title'::"text"]) RETURNS "public"."workspace_person"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_caller uuid := auth.uid();
  v_profile public.user_profile;
  v_person public.person;
  v_person_id uuid;
  v_email extensions.citext;
  v_slug text;
  v_allowed constant text[] := array[
    'full_name', 'first_name', 'last_name', 'phone', 'website', 'city',
    'country', 'languages', 'professional_title'
  ];
  v_fields text[];
  v_result public.workspace_person;
begin
  if v_caller is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'accepted workspace membership required' using errcode = '42501';
  end if;

  select * into v_profile from public.user_profile where user_id = v_caller;
  if v_profile.user_id is null then
    raise exception 'user profile not found' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct f order by f), '{}') into v_fields
  from unnest(coalesce(p_fields, '{}')) f
  where f = any(v_allowed);
  if cardinality(v_fields) = 0 or not ('full_name' = any(v_fields)) then
    raise exception 'shared fields must include full_name' using errcode = '22023';
  end if;

  v_person_id := v_profile.person_id;
  if v_person_id is null then
    select u.email::extensions.citext into v_email
    from auth.users u
    where u.id = v_caller and u.email_confirmed_at is not null;

    -- Explicit share + verified auth email is the claim event. Unlike contact
    -- capture, this may link an existing local dossier to the signed-in user.
    -- Prefer the target workspace, then another accepted workspace.
    if v_email is not null then
      select p.* into v_person
      from public.workspace_person wp
      join public.workspace_membership m on m.workspace_id = wp.workspace_id
      join public.person p on p.id = wp.person_id
      where wp.email = v_email and wp.deleted_at is null
        and m.user_id = v_caller and m.accepted_at is not null
        and not exists (
          select 1 from public.user_profile claimed where claimed.person_id = p.id
        )
      order by (wp.workspace_id = p_workspace_id) desc, wp.created_at asc
      limit 1;
    end if;

    -- Legacy rows may still carry the old global email without any local
    -- dossier. Keep this as a migration bridge, after the workspace lookup.
    if v_person.id is null and v_email is not null then
      select p.* into v_person
      from public.person p
      where p.email = v_email and p.deleted_at is null
        and not exists (
          select 1 from public.user_profile claimed where claimed.person_id = p.id
        )
      limit 1;
    end if;

    if v_person.id is null then
      v_person_id := public.uuid_generate_v7();
      v_slug := 'person-' || substring(replace(v_person_id::text, '-', '') from 1 for 12);
      insert into public.person (id, slug, full_name, email, created_by)
      values (
        v_person_id,
        v_slug,
        'Person ' || substring(replace(v_person_id::text, '-', '') from 1 for 8),
        null,
        v_caller
      );
    else
      v_person_id := v_person.id;
    end if;

    update public.user_profile set person_id = v_person_id where user_id = v_caller;
  end if;

  v_slug := coalesce(
    nullif(rtrim(left(public.slugify(v_profile.full_name), 63), '-'), ''),
    'person'
  );
  if exists (
    select 1 from public.workspace_person wp
    where wp.workspace_id = p_workspace_id and wp.slug = v_slug
      and wp.person_id <> v_person_id and wp.deleted_at is null
  ) then
    v_slug := rtrim(left(v_slug, 56), '-') || '-' || substring(replace(v_person_id::text, '-', '') from 1 for 6);
  end if;

  insert into public.workspace_person (
    workspace_id, person_id, slug, full_name, first_name, last_name, phone,
    website, city, country, languages, title, profile_sync_enabled,
    profile_shared_fields, profile_shared_at, created_by
  ) values (
    p_workspace_id, v_person_id, v_slug, v_profile.full_name,
    case when 'first_name' = any(v_fields) then v_profile.first_name end,
    case when 'last_name' = any(v_fields) then v_profile.last_name end,
    case when 'phone' = any(v_fields) then v_profile.phone end,
    case when 'website' = any(v_fields) then v_profile.website end,
    case when 'city' = any(v_fields) then v_profile.city end,
    case when 'country' = any(v_fields) then v_profile.country end,
    case when 'languages' = any(v_fields) then v_profile.languages else '{}' end,
    case when 'professional_title' = any(v_fields) then v_profile.professional_title end,
    true, v_fields, now(), v_caller
  )
  on conflict (workspace_id, person_id) do update set
    full_name = case when 'full_name' = any(v_fields) then excluded.full_name else workspace_person.full_name end,
    first_name = case when 'first_name' = any(v_fields) then excluded.first_name else workspace_person.first_name end,
    last_name = case when 'last_name' = any(v_fields) then excluded.last_name else workspace_person.last_name end,
    phone = case when 'phone' = any(v_fields) then excluded.phone else workspace_person.phone end,
    website = case when 'website' = any(v_fields) then excluded.website else workspace_person.website end,
    city = case when 'city' = any(v_fields) then excluded.city else workspace_person.city end,
    country = case when 'country' = any(v_fields) then excluded.country else workspace_person.country end,
    languages = case when 'languages' = any(v_fields) then excluded.languages else workspace_person.languages end,
    title = case when 'professional_title' = any(v_fields) then excluded.title else workspace_person.title end,
    profile_sync_enabled = true,
    profile_shared_fields = v_fields,
    profile_shared_at = now(),
    deleted_at = null
  returning * into v_result;

  return v_result;
end;
$$;


ALTER FUNCTION "public"."share_my_profile_with_workspace"("p_workspace_id" "uuid", "p_fields" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."slugify"("input" "text") RETURNS "text"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
  SELECT trim(BOTH '-' FROM
    substring(
      regexp_replace(
        regexp_replace(
          lower(extensions.unaccent(coalesce(input, ''))),
          '[^a-z0-9]+', '-', 'g'
        ),
        '-+', '-', 'g'
      )
      FROM 1 FOR 64
    )
  );
$$;


ALTER FUNCTION "public"."slugify"("input" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."slugify"("input" "text") IS 'ADR-024: deterministic slugifier. Lowercase + accent-fold + dash-separate + clamp 64.';



CREATE OR REPLACE FUNCTION "public"."stop_sharing_my_profile_with_workspace"("p_workspace_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_caller uuid := auth.uid();
  v_person_id uuid;
begin
  if v_caller is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select person_id into v_person_id from public.user_profile where user_id = v_caller;
  if v_person_id is null then return; end if;

  update public.workspace_person
  set profile_sync_enabled = false, profile_shared_fields = '{}'
  where workspace_id = p_workspace_id and person_id = v_person_id;
end;
$$;


ALTER FUNCTION "public"."stop_sharing_my_profile_with_workspace"("p_workspace_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_shared_profile_to_workspace_people"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if new.person_id is null then return new; end if;

  update public.workspace_person wp set
    full_name = case when 'full_name' = any(wp.profile_shared_fields) then new.full_name else wp.full_name end,
    first_name = case when 'first_name' = any(wp.profile_shared_fields) then new.first_name else wp.first_name end,
    last_name = case when 'last_name' = any(wp.profile_shared_fields) then new.last_name else wp.last_name end,
    phone = case when 'phone' = any(wp.profile_shared_fields) then new.phone else wp.phone end,
    website = case when 'website' = any(wp.profile_shared_fields) then new.website else wp.website end,
    city = case when 'city' = any(wp.profile_shared_fields) then new.city else wp.city end,
    country = case when 'country' = any(wp.profile_shared_fields) then new.country else wp.country end,
    languages = case when 'languages' = any(wp.profile_shared_fields) then new.languages else wp.languages end,
    title = case when 'professional_title' = any(wp.profile_shared_fields) then new.professional_title else wp.title end
  where wp.person_id = new.person_id and wp.profile_sync_enabled;

  return new;
end;
$$;


ALTER FUNCTION "public"."sync_shared_profile_to_workspace_people"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_line_visit"("p_line_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_workspace_id uuid;
BEGIN
  SELECT workspace_id INTO v_workspace_id
  FROM public.line
  WHERE id = p_line_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Line not found' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_workspace_member(v_workspace_id) THEN
    RAISE EXCEPTION 'Not a workspace member' USING ERRCODE = '42501';
  END IF;

  UPDATE public.line SET last_navigated_at = now() WHERE id = p_line_id;
END;
$$;


ALTER FUNCTION "public"."touch_line_visit"("p_line_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."touch_line_visit"("p_line_id" "uuid") IS 'Touches line.last_navigated_at to now() if caller is a workspace member. Used by client when navigating to line detail; tracking global (not per-user) for Phase 0.';



CREATE OR REPLACE FUNCTION "public"."update_project"("p_project_id" "uuid", "p_patch" "jsonb") RETURNS "public"."project"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_caller  uuid := auth.uid();
  v_project public.project;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null — RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.project p
    JOIN public.workspace_membership m ON m.workspace_id = p.workspace_id
    WHERE p.id = p_project_id
      AND p.deleted_at IS NULL
      AND m.user_id     = v_caller
      AND m.accepted_at IS NOT NULL
      AND m.role        IN ('owner', 'admin', 'member')
  ) THEN
    RAISE EXCEPTION 'caller lacks permission to edit project %', p_project_id
      USING ERRCODE = '42501';
  END IF;

  IF p_patch ? 'name' AND length(trim(coalesce(p_patch->>'name', ''))) = 0 THEN
    RAISE EXCEPTION 'name cannot be empty' USING ERRCODE = '22023';
  END IF;

  UPDATE public.project p SET
    name        = CASE WHEN p_patch ? 'name'        THEN trim(p_patch->>'name')                   ELSE p.name        END,
    description = CASE WHEN p_patch ? 'description' THEN NULLIF(trim(p_patch->>'description'), '') ELSE p.description END,
    accent      = CASE WHEN p_patch ? 'accent'      THEN NULLIF(trim(p_patch->>'accent'), '')     ELSE p.accent      END,
    initials    = CASE WHEN p_patch ? 'initials'    THEN NULLIF(trim(p_patch->>'initials'), '')   ELSE p.initials    END,
    updated_at  = now()
  WHERE p.id = p_project_id AND p.deleted_at IS NULL
  RETURNING * INTO v_project;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'project % not found', p_project_id USING ERRCODE = 'P0002';
  END IF;

  RETURN v_project;
END;
$$;


ALTER FUNCTION "public"."update_project"("p_project_id" "uuid", "p_patch" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_project"("p_project_id" "uuid", "p_patch" "jsonb") IS 'Patch a project (name, description, accent, initials). SECURITY DEFINER; requires owner/admin/member membership of the project workspace. jsonb patch: only present keys change; ""/null clears nullable fields; slug/status not editable here. ADR-081.';



CREATE OR REPLACE FUNCTION "public"."update_workspace"("p_workspace_id" "uuid", "p_patch" "jsonb") RETURNS "public"."workspace"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_caller    uuid := auth.uid();
  v_workspace public.workspace;
  v_mode      text := NULLIF(trim(coalesce(p_patch->>'booking_mode', '')), '');
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null - RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_membership m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id      = v_caller
      AND m.role         IN ('owner', 'admin')
      AND m.accepted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'caller lacks permission to edit workspace %', p_workspace_id
      USING ERRCODE = '42501';
  END IF;

  IF p_patch ? 'name' AND length(trim(coalesce(p_patch->>'name', ''))) = 0 THEN
    RAISE EXCEPTION 'name cannot be empty' USING ERRCODE = '22023';
  END IF;

  IF p_patch ? 'booking_mode' AND v_mode IS NOT NULL
     AND v_mode NOT IN ('simple', 'prioritized') THEN
    RAISE EXCEPTION 'booking_mode must be simple or prioritized'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.workspace w SET
    name        = CASE WHEN p_patch ? 'name'        THEN trim(p_patch->>'name')                           ELSE w.name        END,
    description = CASE WHEN p_patch ? 'description' THEN NULLIF(trim(p_patch->>'description'), '')         ELSE w.description END,
    accent      = CASE WHEN p_patch ? 'accent'      THEN NULLIF(trim(p_patch->>'accent'), '')             ELSE w.accent      END,
    domain      = CASE WHEN p_patch ? 'domain'      THEN NULLIF(p_patch->>'domain', '')::workspace_domain ELSE w.domain      END,
    city        = CASE WHEN p_patch ? 'city'        THEN NULLIF(trim(p_patch->>'city'), '')               ELSE w.city        END,
    logo_url    = CASE WHEN p_patch ? 'logo_url'    THEN NULLIF(trim(p_patch->>'logo_url'), '')            ELSE w.logo_url    END,
    settings    = CASE
                    WHEN NOT (p_patch ? 'booking_mode') THEN w.settings
                    WHEN v_mode IS NULL                 THEN w.settings - 'booking_mode'
                    ELSE jsonb_set(w.settings, '{booking_mode}', to_jsonb(v_mode))
                  END,
    updated_at  = now()
  WHERE w.id = p_workspace_id AND w.deleted_at IS NULL
  RETURNING * INTO v_workspace;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'workspace % not found', p_workspace_id USING ERRCODE = 'P0002';
  END IF;

  RETURN v_workspace;
END;
$$;


ALTER FUNCTION "public"."update_workspace"("p_workspace_id" "uuid", "p_patch" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_workspace"("p_workspace_id" "uuid", "p_patch" "jsonb") IS 'Patch a workspace identity (name, description, accent, domain, city, logo_url) and settings.booking_mode. SECURITY DEFINER; requires owner/admin membership. jsonb patch: only present keys change; empty clears nullable fields and REMOVES booking_mode (absent = simple); slug/kind not editable here. ADR-062 + ADR-002.';



CREATE OR REPLACE FUNCTION "public"."validate_project_membership_roles"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_ws_id uuid;
  v_code  text;
BEGIN
  IF NEW.roles IS NULL OR cardinality(NEW.roles) = 0 THEN
    RETURN NEW;
  END IF;
  SELECT p.workspace_id INTO v_ws_id FROM public.project p WHERE p.id = NEW.project_id;
  IF v_ws_id IS NULL THEN
    RAISE EXCEPTION 'project % not found', NEW.project_id;
  END IF;
  FOREACH v_code IN ARRAY NEW.roles LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.workspace_role wr
      WHERE wr.workspace_id = v_ws_id AND wr.code = v_code AND wr.archived_at IS NULL
    ) THEN
      RAISE EXCEPTION 'unknown or archived role: % (workspace %)', v_code, v_ws_id USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validate_project_membership_roles"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_slug"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
BEGIN
  IF NEW.slug IS NULL OR length(NEW.slug) = 0 THEN
    RAISE EXCEPTION 'slug cannot be empty' USING ERRCODE = '22023';
  END IF;
  IF NEW.slug !~ '^[a-z0-9](-?[a-z0-9])*$' THEN
    RAISE EXCEPTION 'invalid slug format: %', NEW.slug USING ERRCODE = '22023';
  END IF;
  IF length(NEW.slug) > 64 THEN
    RAISE EXCEPTION 'slug too long: %', NEW.slug USING ERRCODE = '22023';
  END IF;
  IF public.is_reserved_slug(NEW.slug) THEN
    RAISE EXCEPTION 'slug % is reserved', NEW.slug USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$_$;


ALTER FUNCTION "public"."validate_slug"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."validate_slug"() IS 'ADR-024: format + reserved-list guard. Uniqueness via per-table partial unique indexes.';



CREATE OR REPLACE FUNCTION "public"."write_audit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_ws uuid;
  v_changes jsonb;
BEGIN
  IF TG_TABLE_NAME = 'workspace' AND TG_OP = 'DELETE' THEN
    v_ws := NULL;
  ELSE
    BEGIN
      v_ws := COALESCE(
        CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN (to_jsonb(NEW) ->> 'workspace_id')::uuid END,
        CASE WHEN TG_OP IN ('DELETE','UPDATE') THEN (to_jsonb(OLD) ->> 'workspace_id')::uuid END,
        current_workspace_id()
      );
    EXCEPTION WHEN OTHERS THEN
      v_ws := current_workspace_id();
    END;

    -- Guard against dangling reference during cascade DELETEs
    IF v_ws IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.workspace WHERE id = v_ws) THEN
      v_ws := NULL;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN v_changes := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN v_changes := jsonb_build_object('before', to_jsonb(OLD), 'after', to_jsonb(NEW));
  ELSIF TG_OP = 'DELETE' THEN v_changes := to_jsonb(OLD);
  END IF;

  INSERT INTO audit_log (workspace_id, actor_id, entity_type, entity_id, action, changes)
  VALUES (v_ws, auth.uid(), TG_TABLE_NAME, COALESCE((to_jsonb(NEW) ->> 'id')::uuid, (to_jsonb(OLD) ->> 'id')::uuid), lower(TG_OP), v_changes);
  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."write_audit"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."account" (
    "id" "uuid" DEFAULT "public"."uuid_generate_v7"() NOT NULL,
    "slug" "text" NOT NULL,
    "previous_slugs" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "name" "text" NOT NULL,
    "kind" "public"."account_kind" DEFAULT 'personal'::"public"."account_kind" NOT NULL,
    "billing_email" "text",
    "country" "text",
    "timezone" "text" DEFAULT 'Europe/Madrid'::"text" NOT NULL,
    "settings" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "custom_fields" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);

ALTER TABLE ONLY "public"."account" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."account" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."account_membership" (
    "account_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "public"."account_role" DEFAULT 'admin'::"public"."account_role" NOT NULL,
    "invited_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "accepted_at" timestamp with time zone,
    "revoked_at" timestamp with time zone
);

ALTER TABLE ONLY "public"."account_membership" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."account_membership" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    "id" "uuid" DEFAULT "public"."uuid_generate_v7"() NOT NULL,
    "workspace_id" "uuid",
    "actor_id" "uuid",
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "changes" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."audit_log" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cast_member" (
    "id" "uuid" DEFAULT "public"."uuid_generate_v7"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "person_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "joined_at" "date",
    "left_at" "date",
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "cast_member_date_range" CHECK ((("left_at" IS NULL) OR ("joined_at" IS NULL) OR ("left_at" >= "joined_at"))),
    CONSTRAINT "cast_member_role_nonempty" CHECK (("length"(TRIM(BOTH FROM "role")) > 0))
);

ALTER TABLE ONLY "public"."cast_member" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."cast_member" OWNER TO "postgres";


COMMENT ON TABLE "public"."cast_member" IS 'ADR-034: project-level canonical cast. Per-performance substitutions live in cast_override (replaces_person_id resolves to a person on the canonical cast).';



COMMENT ON COLUMN "public"."cast_member"."role" IS 'Freetext artistic role: performer, dancer, musician, narrator, co-director, etc. Vocabulary evolves per project; no closed enum in Phase 0.';



COMMENT ON COLUMN "public"."cast_member"."joined_at" IS 'Optional: when this person joined the production. Useful for productions with rotating cast over a long run.';



COMMENT ON COLUMN "public"."cast_member"."left_at" IS 'Optional: when this person left the production. Soft-deletion is preferred for permanent removal; left_at is for documented departures within an active project.';



CREATE TABLE IF NOT EXISTS "public"."cast_override" (
    "id" "uuid" DEFAULT "public"."uuid_generate_v7"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "performance_id" "uuid" NOT NULL,
    "person_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "replaces_person_id" "uuid",
    "reason" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "cast_override_role_nonempty" CHECK (("length"(TRIM(BOTH FROM "role")) > 0))
);

ALTER TABLE ONLY "public"."cast_override" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."cast_override" OWNER TO "postgres";


COMMENT ON TABLE "public"."cast_override" IS 'ADR-023: gig-specific cast change (understudy, rotation) without polluting project-wide engagements.';



CREATE TABLE IF NOT EXISTS "public"."collab_snapshot" (
    "id" "uuid" DEFAULT "public"."uuid_generate_v7"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "target_table" "text" NOT NULL,
    "target_id" "uuid" NOT NULL,
    "snapshot" "bytea" NOT NULL,
    "version" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "collab_snapshot_target_table_chk" CHECK (("target_table" = ANY (ARRAY['performance'::"text", 'project'::"text", 'line'::"text"]))),
    CONSTRAINT "collab_snapshot_version_positive" CHECK (("version" > 0))
);

ALTER TABLE ONLY "public"."collab_snapshot" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."collab_snapshot" OWNER TO "postgres";


COMMENT ON TABLE "public"."collab_snapshot" IS 'ADR-025: Yjs document snapshots persisted by the PartyServer Durable Object. Reads = workspace member. Writes = service_role only (via BYPASSRLS).';



CREATE TABLE IF NOT EXISTS "public"."crew_assignment" (
    "id" "uuid" DEFAULT "public"."uuid_generate_v7"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "performance_id" "uuid" NOT NULL,
    "person_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "contact_override" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "crew_assignment_role_nonempty" CHECK (("length"(TRIM(BOTH FROM "role")) > 0))
);

ALTER TABLE ONLY "public"."crew_assignment" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."crew_assignment" OWNER TO "postgres";


COMMENT ON TABLE "public"."crew_assignment" IS 'ADR-023: gig-specific crew roster. role is free-text — no enum, vocab evolves per project.';



COMMENT ON COLUMN "public"."crew_assignment"."contact_override" IS 'ADR-023: per-gig override of canonical person contact. Falls back to person.* when null/missing keys.';



CREATE TABLE IF NOT EXISTS "public"."invoice_line" (
    "id" "uuid" DEFAULT "public"."uuid_generate_v7"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "performance_id" "uuid",
    "description" "text" NOT NULL,
    "quantity" numeric(10,2) DEFAULT 1 NOT NULL,
    "unit_amount" numeric(12,2) NOT NULL,
    "line_total" numeric(12,2) GENERATED ALWAYS AS (("quantity" * "unit_amount")) STORED,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "invoice_line_description_nonempty" CHECK (("length"("btrim"("description")) > 0)),
    CONSTRAINT "invoice_line_quantity_positive" CHECK (("quantity" > (0)::numeric))
);

ALTER TABLE ONLY "public"."invoice_line" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoice_line" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment" (
    "id" "uuid" DEFAULT "public"."uuid_generate_v7"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "received_on" "date" DEFAULT CURRENT_DATE NOT NULL,
    "method" "public"."payment_method" DEFAULT 'transfer'::"public"."payment_method" NOT NULL,
    "reference" "text",
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "payment_amount_positive" CHECK (("amount" > (0)::numeric))
);

ALTER TABLE ONLY "public"."payment" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."payment" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."performance_redacted" WITH ("security_invoker"='true') AS
 SELECT "id",
    "workspace_id",
    "project_id",
    "line_id",
    "conversation_id",
    "performed_at",
    "venue_id",
    "venue_name",
    "city",
    "country",
    "status",
        CASE
            WHEN "public"."has_permission"("project_id", 'read:money'::"text") THEN "fee_amount"
            ELSE NULL::numeric
        END AS "fee_amount",
        CASE
            WHEN "public"."has_permission"("project_id", 'read:money'::"text") THEN "fee_currency"
            ELSE NULL::"bpchar"
        END AS "fee_currency",
    "notes",
    "custom_fields",
    "created_by",
    "created_at",
    "updated_at",
    "deleted_at",
    "slug"
   FROM "public"."performance";


ALTER VIEW "public"."performance_redacted" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."person" (
    "id" "uuid" DEFAULT "public"."uuid_generate_v7"() NOT NULL,
    "email" "extensions"."citext",
    "full_name" "text" NOT NULL,
    "first_name" "text",
    "last_name" "text",
    "phone" "text",
    "website" "text",
    "city" "text",
    "country" character(2),
    "languages" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "organization_name" "text",
    "title" "text",
    "created_by" "uuid",
    "custom_fields" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "slug" "text" NOT NULL,
    "previous_slugs" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    CONSTRAINT "person_country_format" CHECK ((("country" IS NULL) OR ("country" ~ '^[A-Z]{2}$'::"text")))
);

ALTER TABLE ONLY "public"."person" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."person" OWNER TO "postgres";


COMMENT ON TABLE "public"."person" IS 'Opaque global human identity. Workspace-owned contact data lives in workspace_person; signed-in portable data lives in user_profile.';



CREATE TABLE IF NOT EXISTS "public"."project_membership" (
    "id" "uuid" DEFAULT "public"."uuid_generate_v7"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "roles" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "permission_grants" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "permission_revokes" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "invited_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."project_membership" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_membership" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_profile" (
    "user_id" "uuid" NOT NULL,
    "full_name" "text" NOT NULL,
    "avatar_url" "text",
    "locale" "text" DEFAULT 'es'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_platform_admin" boolean DEFAULT false NOT NULL,
    "person_id" "uuid",
    "first_name" "text",
    "last_name" "text",
    "phone" "text",
    "website" "text",
    "city" "text",
    "country" character(2),
    "languages" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "professional_title" "text",
    "bio" "text",
    CONSTRAINT "user_profile_country_format" CHECK ((("country" IS NULL) OR ("country" ~ '^[A-Z]{2}$'::"text")))
);

ALTER TABLE ONLY "public"."user_profile" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_profile" OWNER TO "postgres";


COMMENT ON COLUMN "public"."user_profile"."is_platform_admin" IS 'Operator flag. Never user-writable: authenticated has UPDATE only on full_name/avatar_url/locale. Set by trusted operator tooling only.';



COMMENT ON COLUMN "public"."user_profile"."person_id" IS 'Verified user-to-person identity link. Never user-writable directly: set only by a gated claim/merge RPC after email verification and consent checks.';



CREATE TABLE IF NOT EXISTS "public"."workspace_membership" (
    "id" "uuid" DEFAULT "public"."uuid_generate_v7"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "public"."membership_role" DEFAULT 'member'::"public"."membership_role" NOT NULL,
    "accepted_at" timestamp with time zone,
    "invited_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."workspace_membership" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."workspace_membership" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workspace_organization" (
    "id" "uuid" DEFAULT "public"."uuid_generate_v7"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "kind" "text" DEFAULT 'other'::"text" NOT NULL,
    "email" "extensions"."citext",
    "phone" "text",
    "website" "text",
    "address" "text",
    "city" "text",
    "country" character(2),
    "notes" "text",
    "custom_fields" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "workspace_organization_country_format" CHECK ((("country" IS NULL) OR ("country" ~ '^[A-Z]{2}$'::"text"))),
    CONSTRAINT "workspace_organization_kind_check" CHECK (("kind" = ANY (ARRAY['company'::"text", 'festival'::"text", 'theatre'::"text", 'presenter'::"text", 'agency'::"text", 'institution'::"text", 'other'::"text"]))),
    CONSTRAINT "workspace_organization_name_nonempty" CHECK (("length"("btrim"("name")) > 0)),
    CONSTRAINT "workspace_organization_slug_format" CHECK (("slug" ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'::"text"))
);

ALTER TABLE ONLY "public"."workspace_organization" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."workspace_organization" OWNER TO "postgres";


COMMENT ON TABLE "public"."workspace_organization" IS 'Workspace-owned company/festival/theatre/institution. Distinct from venue, which is a physical place.';



CREATE TABLE IF NOT EXISTS "public"."workspace_role" (
    "id" "uuid" DEFAULT "public"."uuid_generate_v7"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "label" "text" NOT NULL,
    "is_system" boolean DEFAULT false NOT NULL,
    "archived_at" timestamp with time zone,
    "access_level" "public"."workspace_role_access_level" NOT NULL,
    "permissions" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "workspace_role_code_format" CHECK (("code" ~ '^[a-z][a-z0-9_]{0,39}$'::"text"))
);

ALTER TABLE ONLY "public"."workspace_role" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."workspace_role" OWNER TO "postgres";


COMMENT ON COLUMN "public"."workspace_role"."permissions" IS 'Closed vocabulary: read:money, read:conversation, read:person_note_private, read:internal_notes, edit:performance, edit:conversation, edit:money, edit:project_meta, edit:membership, admin:project.';



ALTER TABLE ONLY "public"."account_membership"
    ADD CONSTRAINT "account_membership_pkey" PRIMARY KEY ("account_id", "user_id");



ALTER TABLE ONLY "public"."account"
    ADD CONSTRAINT "account_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."asset_version"
    ADD CONSTRAINT "asset_version_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."availability_block"
    ADD CONSTRAINT "availability_block_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."calendar_share"
    ADD CONSTRAINT "calendar_share_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."calendar_share"
    ADD CONSTRAINT "calendar_share_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."cast_member"
    ADD CONSTRAINT "cast_member_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cast_override"
    ADD CONSTRAINT "cast_override_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."collab_snapshot"
    ADD CONSTRAINT "collab_snapshot_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversation"
    ADD CONSTRAINT "conversation_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversation"
    ADD CONSTRAINT "conversation_workspace_id_project_id_person_id_key" UNIQUE ("workspace_id", "project_id", "person_id");



ALTER TABLE ONLY "public"."crew_assignment"
    ADD CONSTRAINT "crew_assignment_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."date"
    ADD CONSTRAINT "date_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."expense"
    ADD CONSTRAINT "expense_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice_line"
    ADD CONSTRAINT "invoice_line_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice"
    ADD CONSTRAINT "invoice_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."line"
    ADD CONSTRAINT "line_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment"
    ADD CONSTRAINT "payment_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."performance"
    ADD CONSTRAINT "performance_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."person"
    ADD CONSTRAINT "person_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."person_note"
    ADD CONSTRAINT "person_note_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."person"
    ADD CONSTRAINT "person_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_membership"
    ADD CONSTRAINT "project_membership_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_membership"
    ADD CONSTRAINT "project_membership_project_id_user_id_key" UNIQUE ("project_id", "user_id");



ALTER TABLE ONLY "public"."project"
    ADD CONSTRAINT "project_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."roadsheet_share"
    ADD CONSTRAINT "roadsheet_share_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."roadsheet_share"
    ADD CONSTRAINT "roadsheet_share_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."task"
    ADD CONSTRAINT "task_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_profile"
    ADD CONSTRAINT "user_profile_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."venue"
    ADD CONSTRAINT "venue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workspace_alias_request"
    ADD CONSTRAINT "workspace_alias_request_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workspace_membership"
    ADD CONSTRAINT "workspace_membership_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workspace_membership"
    ADD CONSTRAINT "workspace_membership_workspace_id_user_id_key" UNIQUE ("workspace_id", "user_id");



ALTER TABLE ONLY "public"."workspace_organization"
    ADD CONSTRAINT "workspace_organization_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workspace_organization"
    ADD CONSTRAINT "workspace_organization_workspace_id_id_key" UNIQUE ("workspace_id", "id");



ALTER TABLE ONLY "public"."workspace_person"
    ADD CONSTRAINT "workspace_person_pkey" PRIMARY KEY ("workspace_id", "person_id");



ALTER TABLE ONLY "public"."workspace"
    ADD CONSTRAINT "workspace_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workspace_role"
    ADD CONSTRAINT "workspace_role_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workspace_role"
    ADD CONSTRAINT "workspace_role_workspace_id_code_key" UNIQUE ("workspace_id", "code");



CREATE INDEX "account_membership_user_id_idx" ON "public"."account_membership" USING "btree" ("user_id");



CREATE UNIQUE INDEX "account_slug_uidx" ON "public"."account" USING "btree" ("slug") WHERE ("deleted_at" IS NULL);



CREATE INDEX "asset_version_adapted_from_idx" ON "public"."asset_version" USING "btree" ("adapted_from_id") WHERE ("adapted_from_id" IS NOT NULL);



CREATE INDEX "asset_version_kind_idx" ON "public"."asset_version" USING "btree" ("workspace_id", "kind", "direction") WHERE ("deleted_at" IS NULL);



CREATE INDEX "asset_version_line_idx" ON "public"."asset_version" USING "btree" ("line_id") WHERE (("deleted_at" IS NULL) AND ("line_id" IS NOT NULL));



CREATE INDEX "asset_version_performance_idx" ON "public"."asset_version" USING "btree" ("performance_id") WHERE (("deleted_at" IS NULL) AND ("performance_id" IS NOT NULL));



CREATE INDEX "asset_version_previous_slugs_gin" ON "public"."asset_version" USING "gin" ("previous_slugs");



CREATE INDEX "asset_version_project_idx" ON "public"."asset_version" USING "btree" ("project_id") WHERE (("deleted_at" IS NULL) AND ("project_id" IS NOT NULL));



CREATE UNIQUE INDEX "asset_version_slug_uidx" ON "public"."asset_version" USING "btree" ("workspace_id", "slug") WHERE (("deleted_at" IS NULL) AND ("slug" IS NOT NULL));



CREATE INDEX "asset_version_uploaded_by_idx" ON "public"."asset_version" USING "btree" ("uploaded_by");



CREATE INDEX "asset_version_workspace_idx" ON "public"."asset_version" USING "btree" ("workspace_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "audit_log_actor_idx" ON "public"."audit_log" USING "btree" ("actor_id", "created_at" DESC);



CREATE INDEX "audit_log_entity_idx" ON "public"."audit_log" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "audit_log_workspace_idx" ON "public"."audit_log" USING "btree" ("workspace_id", "created_at" DESC);



CREATE INDEX "availability_block_created_by_idx" ON "public"."availability_block" USING "btree" ("created_by");



CREATE INDEX "availability_block_person_idx" ON "public"."availability_block" USING "btree" ("person_id") WHERE (("deleted_at" IS NULL) AND ("person_id" IS NOT NULL));



CREATE INDEX "availability_block_window_idx" ON "public"."availability_block" USING "btree" ("workspace_id", "starts_on", "ends_on") WHERE ("deleted_at" IS NULL);



CREATE INDEX "availability_block_workspace_idx" ON "public"."availability_block" USING "btree" ("workspace_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "availability_block_workspace_person_idx" ON "public"."availability_block" USING "btree" ("workspace_id", "person_id") WHERE ("person_id" IS NOT NULL);



CREATE INDEX "calendar_share_created_by_idx" ON "public"."calendar_share" USING "btree" ("created_by");



CREATE INDEX "calendar_share_ws_idx" ON "public"."calendar_share" USING "btree" ("workspace_id") WHERE ("revoked_at" IS NULL);



CREATE INDEX "cast_member_created_by_idx" ON "public"."cast_member" USING "btree" ("created_by");



CREATE INDEX "cast_member_person_idx" ON "public"."cast_member" USING "btree" ("person_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "cast_member_project_idx" ON "public"."cast_member" USING "btree" ("project_id") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "cast_member_project_person_role_uidx" ON "public"."cast_member" USING "btree" ("project_id", "person_id", "role") WHERE ("deleted_at" IS NULL);



CREATE INDEX "cast_member_workspace_idx" ON "public"."cast_member" USING "btree" ("workspace_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "cast_member_workspace_person_idx" ON "public"."cast_member" USING "btree" ("workspace_id", "person_id");



CREATE INDEX "cast_override_created_by_idx" ON "public"."cast_override" USING "btree" ("created_by");



CREATE INDEX "cast_override_performance_idx" ON "public"."cast_override" USING "btree" ("performance_id") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "cast_override_performance_person_uidx" ON "public"."cast_override" USING "btree" ("performance_id", "person_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "cast_override_person_idx" ON "public"."cast_override" USING "btree" ("person_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "cast_override_replaces_idx" ON "public"."cast_override" USING "btree" ("replaces_person_id") WHERE (("deleted_at" IS NULL) AND ("replaces_person_id" IS NOT NULL));



CREATE INDEX "cast_override_workspace_idx" ON "public"."cast_override" USING "btree" ("workspace_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "cast_override_workspace_person_idx" ON "public"."cast_override" USING "btree" ("workspace_id", "person_id");



CREATE INDEX "cast_override_workspace_replaces_person_idx" ON "public"."cast_override" USING "btree" ("workspace_id", "replaces_person_id") WHERE ("replaces_person_id" IS NOT NULL);



CREATE INDEX "collab_snapshot_target_idx" ON "public"."collab_snapshot" USING "btree" ("target_table", "target_id", "version" DESC);



CREATE UNIQUE INDEX "collab_snapshot_target_version_uidx" ON "public"."collab_snapshot" USING "btree" ("target_table", "target_id", "version");



CREATE INDEX "collab_snapshot_workspace_idx" ON "public"."collab_snapshot" USING "btree" ("workspace_id");



CREATE INDEX "conversation_created_by_idx" ON "public"."conversation" USING "btree" ("created_by");



CREATE INDEX "conversation_custom_fields_gin_idx" ON "public"."conversation" USING "gin" ("custom_fields" "jsonb_path_ops");



CREATE INDEX "conversation_line_idx" ON "public"."conversation" USING "btree" ("line_id") WHERE (("deleted_at" IS NULL) AND ("line_id" IS NOT NULL));



CREATE INDEX "conversation_person_idx" ON "public"."conversation" USING "btree" ("person_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "conversation_previous_slugs_gin" ON "public"."conversation" USING "gin" ("previous_slugs");



CREATE INDEX "conversation_project_idx" ON "public"."conversation" USING "btree" ("project_id") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "conversation_slug_uidx" ON "public"."conversation" USING "btree" ("workspace_id", "slug") WHERE ("deleted_at" IS NULL);



CREATE INDEX "conversation_status_idx" ON "public"."conversation" USING "btree" ("workspace_id", "status") WHERE ("deleted_at" IS NULL);



CREATE INDEX "conversation_workspace_idx" ON "public"."conversation" USING "btree" ("workspace_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "conversation_workspace_person_idx" ON "public"."conversation" USING "btree" ("workspace_id", "person_id");



CREATE INDEX "crew_assignment_created_by_idx" ON "public"."crew_assignment" USING "btree" ("created_by");



CREATE INDEX "crew_assignment_performance_idx" ON "public"."crew_assignment" USING "btree" ("performance_id") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "crew_assignment_performance_person_role_uidx" ON "public"."crew_assignment" USING "btree" ("performance_id", "person_id", "role") WHERE ("deleted_at" IS NULL);



CREATE INDEX "crew_assignment_person_idx" ON "public"."crew_assignment" USING "btree" ("person_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "crew_assignment_workspace_idx" ON "public"."crew_assignment" USING "btree" ("workspace_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "crew_assignment_workspace_person_idx" ON "public"."crew_assignment" USING "btree" ("workspace_id", "person_id");



CREATE INDEX "date_created_by_idx" ON "public"."date" USING "btree" ("created_by");



CREATE INDEX "date_custom_fields_gin_idx" ON "public"."date" USING "gin" ("custom_fields" "jsonb_path_ops");



CREATE INDEX "date_line_idx" ON "public"."date" USING "btree" ("line_id") WHERE (("deleted_at" IS NULL) AND ("line_id" IS NOT NULL));



CREATE INDEX "date_performance_idx" ON "public"."date" USING "btree" ("performance_id") WHERE (("deleted_at" IS NULL) AND ("performance_id" IS NOT NULL));



CREATE INDEX "date_project_idx" ON "public"."date" USING "btree" ("project_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "date_season_idx" ON "public"."date" USING "btree" ("workspace_id", "season") WHERE (("deleted_at" IS NULL) AND ("season" IS NOT NULL));



CREATE INDEX "date_series_idx" ON "public"."date" USING "btree" ("series_id") WHERE (("deleted_at" IS NULL) AND ("series_id" IS NOT NULL));



CREATE INDEX "date_starts_at_idx" ON "public"."date" USING "btree" ("starts_at") WHERE ("deleted_at" IS NULL);



CREATE INDEX "date_venue_idx" ON "public"."date" USING "btree" ("venue_id");



CREATE INDEX "date_workspace_idx" ON "public"."date" USING "btree" ("workspace_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "expense_category_idx" ON "public"."expense" USING "btree" ("workspace_id", "category") WHERE ("deleted_at" IS NULL);



CREATE INDEX "expense_created_by_idx" ON "public"."expense" USING "btree" ("created_by");



CREATE INDEX "expense_line_idx" ON "public"."expense" USING "btree" ("line_id") WHERE (("deleted_at" IS NULL) AND ("line_id" IS NOT NULL));



CREATE INDEX "expense_paid_by_user_idx" ON "public"."expense" USING "btree" ("paid_by_user_id");



CREATE INDEX "expense_performance_idx" ON "public"."expense" USING "btree" ("performance_id") WHERE (("deleted_at" IS NULL) AND ("performance_id" IS NOT NULL));



CREATE INDEX "expense_workspace_idx" ON "public"."expense" USING "btree" ("workspace_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "invoice_created_by_idx" ON "public"."invoice" USING "btree" ("created_by");



CREATE INDEX "invoice_issued_on_idx" ON "public"."invoice" USING "btree" ("issued_on");



CREATE INDEX "invoice_line_invoice_idx" ON "public"."invoice_line" USING "btree" ("invoice_id");



CREATE INDEX "invoice_line_performance_idx" ON "public"."invoice_line" USING "btree" ("performance_id") WHERE ("performance_id" IS NOT NULL);



CREATE INDEX "invoice_line_workspace_idx" ON "public"."invoice_line" USING "btree" ("workspace_id");



CREATE INDEX "invoice_payer_person_idx" ON "public"."invoice" USING "btree" ("payer_person_id");



CREATE INDEX "invoice_project_idx" ON "public"."invoice" USING "btree" ("project_id") WHERE (("deleted_at" IS NULL) AND ("project_id" IS NOT NULL));



CREATE INDEX "invoice_status_idx" ON "public"."invoice" USING "btree" ("workspace_id", "status") WHERE ("deleted_at" IS NULL);



CREATE INDEX "invoice_workspace_idx" ON "public"."invoice" USING "btree" ("workspace_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "invoice_workspace_payer_person_idx" ON "public"."invoice" USING "btree" ("workspace_id", "payer_person_id") WHERE ("payer_person_id" IS NOT NULL);



CREATE INDEX "line_created_by_idx" ON "public"."line" USING "btree" ("created_by");



CREATE INDEX "line_last_navigated_idx" ON "public"."line" USING "btree" ("workspace_id", "last_navigated_at" DESC NULLS LAST) WHERE ("deleted_at" IS NULL);



CREATE INDEX "line_previous_slugs_gin" ON "public"."line" USING "gin" ("previous_slugs");



CREATE INDEX "line_project_idx" ON "public"."line" USING "btree" ("project_id") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "line_slug_uidx" ON "public"."line" USING "btree" ("workspace_id", "slug") WHERE (("deleted_at" IS NULL) AND ("slug" IS NOT NULL));



CREATE INDEX "line_status_idx" ON "public"."line" USING "btree" ("workspace_id", "status") WHERE ("deleted_at" IS NULL);



CREATE INDEX "line_workspace_idx" ON "public"."line" USING "btree" ("workspace_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "payment_created_by_idx" ON "public"."payment" USING "btree" ("created_by");



CREATE INDEX "payment_invoice_idx" ON "public"."payment" USING "btree" ("invoice_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "payment_workspace_idx" ON "public"."payment" USING "btree" ("workspace_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "performance_conversation_idx" ON "public"."performance" USING "btree" ("conversation_id") WHERE (("deleted_at" IS NULL) AND ("conversation_id" IS NOT NULL));



CREATE INDEX "performance_created_by_idx" ON "public"."performance" USING "btree" ("created_by");



CREATE INDEX "performance_hospitality_gin_idx" ON "public"."performance" USING "gin" ("hospitality" "jsonb_path_ops");



CREATE INDEX "performance_line_idx" ON "public"."performance" USING "btree" ("line_id") WHERE (("deleted_at" IS NULL) AND ("line_id" IS NOT NULL));



CREATE INDEX "performance_logistics_gin_idx" ON "public"."performance" USING "gin" ("logistics" "jsonb_path_ops");



CREATE INDEX "performance_performed_at_idx" ON "public"."performance" USING "btree" ("performed_at") WHERE ("deleted_at" IS NULL);



CREATE INDEX "performance_previous_slugs_gin" ON "public"."performance" USING "gin" ("previous_slugs");



CREATE INDEX "performance_project_idx" ON "public"."performance" USING "btree" ("project_id") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "performance_slug_uidx" ON "public"."performance" USING "btree" ("workspace_id", "slug") WHERE (("deleted_at" IS NULL) AND ("slug" IS NOT NULL));



CREATE INDEX "performance_status_idx" ON "public"."performance" USING "btree" ("workspace_id", "status") WHERE ("deleted_at" IS NULL);



CREATE INDEX "performance_technical_gin_idx" ON "public"."performance" USING "gin" ("technical" "jsonb_path_ops");



CREATE INDEX "performance_venue_idx" ON "public"."performance" USING "btree" ("venue_id");



CREATE INDEX "performance_workspace_idx" ON "public"."performance" USING "btree" ("workspace_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "person_created_by_idx" ON "public"."person" USING "btree" ("created_by");



CREATE INDEX "person_custom_fields_gin_idx" ON "public"."person" USING "gin" ("custom_fields" "jsonb_path_ops");



CREATE INDEX "person_full_name_trgm_idx" ON "public"."person" USING "gin" ("full_name" "extensions"."gin_trgm_ops");



CREATE INDEX "person_note_author_idx" ON "public"."person_note" USING "btree" ("author_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "person_note_person_idx" ON "public"."person_note" USING "btree" ("person_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "person_note_visibility_idx" ON "public"."person_note" USING "btree" ("workspace_id", "visibility") WHERE ("deleted_at" IS NULL);



CREATE INDEX "person_note_workspace_idx" ON "public"."person_note" USING "btree" ("workspace_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "person_note_workspace_person_idx" ON "public"."person_note" USING "btree" ("workspace_id", "person_id");



CREATE INDEX "person_previous_slugs_gin" ON "public"."person" USING "gin" ("previous_slugs");



CREATE UNIQUE INDEX "person_slug_uidx" ON "public"."person" USING "btree" ("slug") WHERE ("deleted_at" IS NULL);



CREATE INDEX "project_created_by_idx" ON "public"."project" USING "btree" ("created_by");



CREATE INDEX "project_membership_invited_by_idx" ON "public"."project_membership" USING "btree" ("invited_by");



CREATE INDEX "project_membership_project_idx" ON "public"."project_membership" USING "btree" ("project_id");



CREATE INDEX "project_membership_user_idx" ON "public"."project_membership" USING "btree" ("user_id");



CREATE INDEX "project_owner_idx" ON "public"."project" USING "btree" ("owner_id");



CREATE INDEX "project_previous_slugs_gin" ON "public"."project" USING "gin" ("previous_slugs");



CREATE UNIQUE INDEX "project_slug_uidx" ON "public"."project" USING "btree" ("workspace_id", "slug") WHERE ("deleted_at" IS NULL);



CREATE INDEX "project_status_idx" ON "public"."project" USING "btree" ("workspace_id", "status") WHERE ("deleted_at" IS NULL);



CREATE INDEX "project_workspace_idx" ON "public"."project" USING "btree" ("workspace_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "roadsheet_share_created_by_idx" ON "public"."roadsheet_share" USING "btree" ("created_by");



CREATE INDEX "roadsheet_share_perf_idx" ON "public"."roadsheet_share" USING "btree" ("performance_id") WHERE ("revoked_at" IS NULL);



CREATE INDEX "roadsheet_share_workspace_idx" ON "public"."roadsheet_share" USING "btree" ("workspace_id");



CREATE INDEX "task_conversation_idx" ON "public"."task" USING "btree" ("conversation_id") WHERE (("deleted_at" IS NULL) AND ("conversation_id" IS NOT NULL));



CREATE INDEX "task_created_by_idx" ON "public"."task" USING "btree" ("created_by");



CREATE INDEX "task_due_idx" ON "public"."task" USING "btree" ("workspace_id", "due_at") WHERE (("deleted_at" IS NULL) AND ("status" = 'open'::"public"."task_status"));



CREATE INDEX "task_line_idx" ON "public"."task" USING "btree" ("line_id") WHERE (("deleted_at" IS NULL) AND ("line_id" IS NOT NULL));



CREATE INDEX "task_performance_idx" ON "public"."task" USING "btree" ("performance_id") WHERE (("deleted_at" IS NULL) AND ("performance_id" IS NOT NULL));



CREATE INDEX "task_project_idx" ON "public"."task" USING "btree" ("project_id") WHERE (("deleted_at" IS NULL) AND ("project_id" IS NOT NULL));



CREATE INDEX "task_status_idx" ON "public"."task" USING "btree" ("workspace_id", "status") WHERE ("deleted_at" IS NULL);



CREATE INDEX "task_workspace_idx" ON "public"."task" USING "btree" ("workspace_id") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "user_profile_person_id_key" ON "public"."user_profile" USING "btree" ("person_id") WHERE ("person_id" IS NOT NULL);



CREATE INDEX "venue_created_by_idx" ON "public"."venue" USING "btree" ("created_by");



CREATE INDEX "venue_previous_slugs_gin" ON "public"."venue" USING "gin" ("previous_slugs");



CREATE UNIQUE INDEX "venue_slug_uidx" ON "public"."venue" USING "btree" ("workspace_id", "slug") WHERE (("deleted_at" IS NULL) AND ("slug" IS NOT NULL));



CREATE INDEX "venue_workspace_idx" ON "public"."venue" USING "btree" ("workspace_id") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "venue_workspace_name_city_idx" ON "public"."venue" USING "btree" ("workspace_id", "lower"("name"), COALESCE("lower"("city"), ''::"text")) WHERE ("deleted_at" IS NULL);



CREATE INDEX "workspace_account_idx" ON "public"."workspace" USING "btree" ("account_id");



CREATE UNIQUE INDEX "workspace_alias_key" ON "public"."workspace" USING "btree" ("alias") WHERE (("deleted_at" IS NULL) AND ("alias" IS NOT NULL));



CREATE INDEX "workspace_alias_request_decided_by_idx" ON "public"."workspace_alias_request" USING "btree" ("decided_by");



CREATE INDEX "workspace_alias_request_requested_by_idx" ON "public"."workspace_alias_request" USING "btree" ("requested_by");



CREATE INDEX "workspace_alias_request_status_idx" ON "public"."workspace_alias_request" USING "btree" ("status") WHERE ("status" = 'pending'::"text");



CREATE INDEX "workspace_alias_request_ws_idx" ON "public"."workspace_alias_request" USING "btree" ("workspace_id");



CREATE INDEX "workspace_deleted_at_idx" ON "public"."workspace" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "workspace_kind_idx" ON "public"."workspace" USING "btree" ("kind") WHERE ("deleted_at" IS NULL);



CREATE INDEX "workspace_membership_invited_by_idx" ON "public"."workspace_membership" USING "btree" ("invited_by");



CREATE INDEX "workspace_membership_user_idx" ON "public"."workspace_membership" USING "btree" ("user_id");



CREATE INDEX "workspace_membership_workspace_idx" ON "public"."workspace_membership" USING "btree" ("workspace_id");



CREATE INDEX "workspace_organization_created_by_idx" ON "public"."workspace_organization" USING "btree" ("created_by");



CREATE UNIQUE INDEX "workspace_organization_name_key" ON "public"."workspace_organization" USING "btree" ("workspace_id", "lower"("btrim"("name"))) WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "workspace_organization_slug_key" ON "public"."workspace_organization" USING "btree" ("workspace_id", "slug") WHERE ("deleted_at" IS NULL);



CREATE INDEX "workspace_organization_workspace_idx" ON "public"."workspace_organization" USING "btree" ("workspace_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "workspace_person_created_by_idx" ON "public"."workspace_person" USING "btree" ("created_by");



CREATE INDEX "workspace_person_email_idx" ON "public"."workspace_person" USING "btree" ("workspace_id", "email") WHERE (("deleted_at" IS NULL) AND ("email" IS NOT NULL));



CREATE INDEX "workspace_person_organization_idx" ON "public"."workspace_person" USING "btree" ("workspace_id", "organization_id") WHERE ("organization_id" IS NOT NULL);



CREATE INDEX "workspace_person_person_idx" ON "public"."workspace_person" USING "btree" ("person_id");



CREATE UNIQUE INDEX "workspace_person_slug_key" ON "public"."workspace_person" USING "btree" ("workspace_id", "slug") WHERE ("deleted_at" IS NULL);



CREATE INDEX "workspace_role_workspace_idx" ON "public"."workspace_role" USING "btree" ("workspace_id") WHERE ("archived_at" IS NULL);



CREATE UNIQUE INDEX "workspace_slug_uidx" ON "public"."workspace" USING "btree" ("slug") WHERE ("deleted_at" IS NULL);



CREATE OR REPLACE TRIGGER "account_set_updated_at" BEFORE UPDATE ON "public"."account" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "account_slug_validate" BEFORE INSERT OR UPDATE ON "public"."account" FOR EACH ROW EXECUTE FUNCTION "public"."validate_slug"();



CREATE OR REPLACE TRIGGER "asset_version_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."asset_version" FOR EACH ROW EXECUTE FUNCTION "public"."write_audit"();



CREATE OR REPLACE TRIGGER "asset_version_guard_ws" BEFORE UPDATE ON "public"."asset_version" FOR EACH ROW EXECUTE FUNCTION "public"."guard_immutable_workspace_id"();



CREATE OR REPLACE TRIGGER "asset_version_set_updated_at" BEFORE UPDATE ON "public"."asset_version" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "asset_version_slug_validate" BEFORE INSERT OR UPDATE OF "slug" ON "public"."asset_version" FOR EACH ROW WHEN (("new"."slug" IS NOT NULL)) EXECUTE FUNCTION "public"."validate_slug"();



CREATE OR REPLACE TRIGGER "availability_block_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."availability_block" FOR EACH ROW EXECUTE FUNCTION "public"."write_audit"();



CREATE OR REPLACE TRIGGER "availability_block_guard_creator" BEFORE UPDATE ON "public"."availability_block" FOR EACH ROW EXECUTE FUNCTION "public"."guard_immutable_created_by"();



CREATE OR REPLACE TRIGGER "availability_block_guard_ws" BEFORE UPDATE ON "public"."availability_block" FOR EACH ROW EXECUTE FUNCTION "public"."guard_immutable_workspace_id"();



CREATE OR REPLACE TRIGGER "availability_block_set_updated_at" BEFORE UPDATE ON "public"."availability_block" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "cast_member_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."cast_member" FOR EACH ROW EXECUTE FUNCTION "public"."write_audit"();



CREATE OR REPLACE TRIGGER "cast_member_guard_ws" BEFORE UPDATE ON "public"."cast_member" FOR EACH ROW EXECUTE FUNCTION "public"."guard_immutable_workspace_id"();



CREATE OR REPLACE TRIGGER "cast_member_set_updated_at" BEFORE UPDATE ON "public"."cast_member" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "cast_override_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."cast_override" FOR EACH ROW EXECUTE FUNCTION "public"."write_audit"();



CREATE OR REPLACE TRIGGER "cast_override_guard_ws" BEFORE UPDATE ON "public"."cast_override" FOR EACH ROW EXECUTE FUNCTION "public"."guard_immutable_workspace_id"();



CREATE OR REPLACE TRIGGER "cast_override_set_updated_at" BEFORE UPDATE ON "public"."cast_override" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "collab_snapshot_guard_ws" BEFORE UPDATE ON "public"."collab_snapshot" FOR EACH ROW EXECUTE FUNCTION "public"."guard_immutable_workspace_id"();



CREATE OR REPLACE TRIGGER "conversation_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."conversation" FOR EACH ROW EXECUTE FUNCTION "public"."write_audit"();



CREATE OR REPLACE TRIGGER "conversation_guard_creator" BEFORE UPDATE ON "public"."conversation" FOR EACH ROW EXECUTE FUNCTION "public"."guard_immutable_created_by"();



CREATE OR REPLACE TRIGGER "conversation_guard_ws" BEFORE UPDATE ON "public"."conversation" FOR EACH ROW EXECUTE FUNCTION "public"."guard_immutable_workspace_id"();



CREATE OR REPLACE TRIGGER "conversation_set_updated_at" BEFORE UPDATE ON "public"."conversation" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "conversation_slug_validate" BEFORE INSERT OR UPDATE OF "slug" ON "public"."conversation" FOR EACH ROW EXECUTE FUNCTION "public"."validate_slug"();



CREATE OR REPLACE TRIGGER "crew_assignment_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."crew_assignment" FOR EACH ROW EXECUTE FUNCTION "public"."write_audit"();



CREATE OR REPLACE TRIGGER "crew_assignment_guard_ws" BEFORE UPDATE ON "public"."crew_assignment" FOR EACH ROW EXECUTE FUNCTION "public"."guard_immutable_workspace_id"();



CREATE OR REPLACE TRIGGER "crew_assignment_set_updated_at" BEFORE UPDATE ON "public"."crew_assignment" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "date_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."date" FOR EACH ROW EXECUTE FUNCTION "public"."write_audit"();



CREATE OR REPLACE TRIGGER "date_guard_ws" BEFORE UPDATE ON "public"."date" FOR EACH ROW EXECUTE FUNCTION "public"."guard_immutable_workspace_id"();



CREATE OR REPLACE TRIGGER "date_set_updated_at" BEFORE UPDATE ON "public"."date" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "expense_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."expense" FOR EACH ROW EXECUTE FUNCTION "public"."write_audit"();



CREATE OR REPLACE TRIGGER "expense_guard_creator" BEFORE UPDATE ON "public"."expense" FOR EACH ROW EXECUTE FUNCTION "public"."guard_immutable_created_by"();



CREATE OR REPLACE TRIGGER "expense_guard_ws" BEFORE UPDATE ON "public"."expense" FOR EACH ROW EXECUTE FUNCTION "public"."guard_immutable_workspace_id"();



CREATE OR REPLACE TRIGGER "expense_set_updated_at" BEFORE UPDATE ON "public"."expense" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "invoice_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."invoice" FOR EACH ROW EXECUTE FUNCTION "public"."write_audit"();



CREATE OR REPLACE TRIGGER "invoice_guard_creator" BEFORE UPDATE ON "public"."invoice" FOR EACH ROW EXECUTE FUNCTION "public"."guard_immutable_created_by"();



CREATE OR REPLACE TRIGGER "invoice_guard_ws" BEFORE UPDATE ON "public"."invoice" FOR EACH ROW EXECUTE FUNCTION "public"."guard_immutable_workspace_id"();



CREATE OR REPLACE TRIGGER "invoice_line_guard_ws" BEFORE UPDATE ON "public"."invoice_line" FOR EACH ROW EXECUTE FUNCTION "public"."guard_immutable_workspace_id"();



CREATE OR REPLACE TRIGGER "invoice_line_set_updated_at" BEFORE UPDATE ON "public"."invoice_line" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "invoice_set_updated_at" BEFORE UPDATE ON "public"."invoice" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "line_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."line" FOR EACH ROW EXECUTE FUNCTION "public"."write_audit"();



CREATE OR REPLACE TRIGGER "line_guard_creator" BEFORE UPDATE ON "public"."line" FOR EACH ROW EXECUTE FUNCTION "public"."guard_immutable_created_by"();



CREATE OR REPLACE TRIGGER "line_guard_ws" BEFORE UPDATE ON "public"."line" FOR EACH ROW EXECUTE FUNCTION "public"."guard_immutable_workspace_id"();



CREATE OR REPLACE TRIGGER "line_set_updated_at" BEFORE UPDATE ON "public"."line" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "line_slug_validate" BEFORE INSERT OR UPDATE OF "slug" ON "public"."line" FOR EACH ROW WHEN (("new"."slug" IS NOT NULL)) EXECUTE FUNCTION "public"."validate_slug"();



CREATE OR REPLACE TRIGGER "payment_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."payment" FOR EACH ROW EXECUTE FUNCTION "public"."write_audit"();



CREATE OR REPLACE TRIGGER "payment_guard_creator" BEFORE UPDATE ON "public"."payment" FOR EACH ROW EXECUTE FUNCTION "public"."guard_immutable_created_by"();



CREATE OR REPLACE TRIGGER "payment_guard_ws" BEFORE UPDATE ON "public"."payment" FOR EACH ROW EXECUTE FUNCTION "public"."guard_immutable_workspace_id"();



CREATE OR REPLACE TRIGGER "payment_set_updated_at" BEFORE UPDATE ON "public"."payment" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "performance_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."performance" FOR EACH ROW EXECUTE FUNCTION "public"."write_audit"();



CREATE OR REPLACE TRIGGER "performance_guard_creator" BEFORE UPDATE ON "public"."performance" FOR EACH ROW EXECUTE FUNCTION "public"."guard_immutable_created_by"();



CREATE OR REPLACE TRIGGER "performance_guard_fee_columns" BEFORE UPDATE ON "public"."performance" FOR EACH ROW EXECUTE FUNCTION "public"."guard_performance_fee_columns"();



CREATE OR REPLACE TRIGGER "performance_guard_ws" BEFORE UPDATE ON "public"."performance" FOR EACH ROW EXECUTE FUNCTION "public"."guard_immutable_workspace_id"();



CREATE OR REPLACE TRIGGER "performance_set_updated_at" BEFORE UPDATE ON "public"."performance" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "performance_slug_validate" BEFORE INSERT OR UPDATE OF "slug" ON "public"."performance" FOR EACH ROW WHEN (("new"."slug" IS NOT NULL)) EXECUTE FUNCTION "public"."validate_slug"();



CREATE OR REPLACE TRIGGER "person_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."person" FOR EACH ROW EXECUTE FUNCTION "public"."write_audit"();



CREATE OR REPLACE TRIGGER "person_guard_creator" BEFORE UPDATE ON "public"."person" FOR EACH ROW EXECUTE FUNCTION "public"."guard_immutable_created_by"();



CREATE OR REPLACE TRIGGER "person_note_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."person_note" FOR EACH ROW EXECUTE FUNCTION "public"."write_audit"();



CREATE OR REPLACE TRIGGER "person_note_guard_author" BEFORE UPDATE ON "public"."person_note" FOR EACH ROW EXECUTE FUNCTION "public"."guard_immutable_author"();



CREATE OR REPLACE TRIGGER "person_note_guard_ws" BEFORE UPDATE ON "public"."person_note" FOR EACH ROW EXECUTE FUNCTION "public"."guard_immutable_workspace_id"();



CREATE OR REPLACE TRIGGER "person_note_set_updated_at" BEFORE UPDATE ON "public"."person_note" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "person_set_updated_at" BEFORE UPDATE ON "public"."person" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "person_slug_validate" BEFORE INSERT OR UPDATE OF "slug" ON "public"."person" FOR EACH ROW EXECUTE FUNCTION "public"."validate_slug"();



CREATE OR REPLACE TRIGGER "project_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."project" FOR EACH ROW EXECUTE FUNCTION "public"."write_audit"();



CREATE OR REPLACE TRIGGER "project_guard_creator" BEFORE UPDATE ON "public"."project" FOR EACH ROW EXECUTE FUNCTION "public"."guard_immutable_created_by"();



CREATE OR REPLACE TRIGGER "project_guard_ws" BEFORE UPDATE ON "public"."project" FOR EACH ROW EXECUTE FUNCTION "public"."guard_immutable_workspace_id"();



CREATE OR REPLACE TRIGGER "project_membership_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."project_membership" FOR EACH ROW EXECUTE FUNCTION "public"."write_audit"();



CREATE OR REPLACE TRIGGER "project_membership_set_updated_at" BEFORE UPDATE ON "public"."project_membership" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "project_membership_validate_roles" BEFORE INSERT OR UPDATE ON "public"."project_membership" FOR EACH ROW EXECUTE FUNCTION "public"."validate_project_membership_roles"();



CREATE OR REPLACE TRIGGER "project_set_updated_at" BEFORE UPDATE ON "public"."project" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "project_slug_validate" BEFORE INSERT OR UPDATE OF "slug" ON "public"."project" FOR EACH ROW EXECUTE FUNCTION "public"."validate_slug"();



CREATE OR REPLACE TRIGGER "task_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."task" FOR EACH ROW EXECUTE FUNCTION "public"."write_audit"();



CREATE OR REPLACE TRIGGER "task_guard_creator" BEFORE UPDATE ON "public"."task" FOR EACH ROW EXECUTE FUNCTION "public"."guard_immutable_created_by"();



CREATE OR REPLACE TRIGGER "task_guard_parents" BEFORE UPDATE ON "public"."task" FOR EACH ROW EXECUTE FUNCTION "public"."guard_immutable_task_parents"();



CREATE OR REPLACE TRIGGER "task_guard_ws" BEFORE UPDATE ON "public"."task" FOR EACH ROW EXECUTE FUNCTION "public"."guard_immutable_workspace_id"();



CREATE OR REPLACE TRIGGER "task_set_updated_at" BEFORE UPDATE ON "public"."task" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "user_profile_set_updated_at" BEFORE UPDATE ON "public"."user_profile" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "user_profile_sync_shared_profile" AFTER UPDATE OF "full_name", "first_name", "last_name", "phone", "website", "city", "country", "languages", "professional_title" ON "public"."user_profile" FOR EACH ROW EXECUTE FUNCTION "public"."sync_shared_profile_to_workspace_people"();



CREATE OR REPLACE TRIGGER "venue_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."venue" FOR EACH ROW EXECUTE FUNCTION "public"."write_audit"();



CREATE OR REPLACE TRIGGER "venue_guard_creator" BEFORE UPDATE ON "public"."venue" FOR EACH ROW EXECUTE FUNCTION "public"."guard_immutable_created_by"();



CREATE OR REPLACE TRIGGER "venue_guard_ws" BEFORE UPDATE ON "public"."venue" FOR EACH ROW EXECUTE FUNCTION "public"."guard_immutable_workspace_id"();



CREATE OR REPLACE TRIGGER "venue_set_updated_at" BEFORE UPDATE ON "public"."venue" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "venue_slug_validate" BEFORE INSERT OR UPDATE OF "slug" ON "public"."venue" FOR EACH ROW WHEN (("new"."slug" IS NOT NULL)) EXECUTE FUNCTION "public"."validate_slug"();



CREATE OR REPLACE TRIGGER "workspace_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."workspace" FOR EACH ROW EXECUTE FUNCTION "public"."write_audit"();



CREATE OR REPLACE TRIGGER "workspace_membership_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."workspace_membership" FOR EACH ROW EXECUTE FUNCTION "public"."write_audit"();



CREATE OR REPLACE TRIGGER "workspace_membership_guard_ws" BEFORE UPDATE ON "public"."workspace_membership" FOR EACH ROW EXECUTE FUNCTION "public"."guard_immutable_workspace_id"();



CREATE OR REPLACE TRIGGER "workspace_membership_set_updated_at" BEFORE UPDATE ON "public"."workspace_membership" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "workspace_organization_set_updated_at" BEFORE UPDATE ON "public"."workspace_organization" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "workspace_person_set_updated_at" BEFORE UPDATE ON "public"."workspace_person" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "workspace_role_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."workspace_role" FOR EACH ROW EXECUTE FUNCTION "public"."write_audit"();



CREATE OR REPLACE TRIGGER "workspace_role_guard_ws" BEFORE UPDATE ON "public"."workspace_role" FOR EACH ROW EXECUTE FUNCTION "public"."guard_immutable_workspace_id"();



CREATE OR REPLACE TRIGGER "workspace_role_set_updated_at" BEFORE UPDATE ON "public"."workspace_role" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "workspace_seed_roles" AFTER INSERT ON "public"."workspace" FOR EACH ROW EXECUTE FUNCTION "public"."seed_system_roles_on_workspace"();



CREATE OR REPLACE TRIGGER "workspace_set_updated_at" BEFORE UPDATE ON "public"."workspace" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "workspace_slug_validate" BEFORE INSERT OR UPDATE OF "slug" ON "public"."workspace" FOR EACH ROW EXECUTE FUNCTION "public"."validate_slug"();



ALTER TABLE ONLY "public"."account_membership"
    ADD CONSTRAINT "account_membership_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."account_membership"
    ADD CONSTRAINT "account_membership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_version"
    ADD CONSTRAINT "asset_version_adapted_from_id_fkey" FOREIGN KEY ("adapted_from_id") REFERENCES "public"."asset_version"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."asset_version"
    ADD CONSTRAINT "asset_version_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "public"."line"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_version"
    ADD CONSTRAINT "asset_version_performance_id_fkey" FOREIGN KEY ("performance_id") REFERENCES "public"."performance"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_version"
    ADD CONSTRAINT "asset_version_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_version"
    ADD CONSTRAINT "asset_version_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."asset_version"
    ADD CONSTRAINT "asset_version_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."availability_block"
    ADD CONSTRAINT "availability_block_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."availability_block"
    ADD CONSTRAINT "availability_block_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."availability_block"
    ADD CONSTRAINT "availability_block_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."availability_block"
    ADD CONSTRAINT "availability_block_workspace_person_fkey" FOREIGN KEY ("workspace_id", "person_id") REFERENCES "public"."workspace_person"("workspace_id", "person_id");



ALTER TABLE ONLY "public"."calendar_share"
    ADD CONSTRAINT "calendar_share_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."calendar_share"
    ADD CONSTRAINT "calendar_share_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cast_member"
    ADD CONSTRAINT "cast_member_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."cast_member"
    ADD CONSTRAINT "cast_member_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."cast_member"
    ADD CONSTRAINT "cast_member_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cast_member"
    ADD CONSTRAINT "cast_member_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cast_member"
    ADD CONSTRAINT "cast_member_workspace_person_fkey" FOREIGN KEY ("workspace_id", "person_id") REFERENCES "public"."workspace_person"("workspace_id", "person_id");



ALTER TABLE ONLY "public"."cast_override"
    ADD CONSTRAINT "cast_override_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."cast_override"
    ADD CONSTRAINT "cast_override_performance_id_fkey" FOREIGN KEY ("performance_id") REFERENCES "public"."performance"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cast_override"
    ADD CONSTRAINT "cast_override_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."cast_override"
    ADD CONSTRAINT "cast_override_replaces_person_id_fkey" FOREIGN KEY ("replaces_person_id") REFERENCES "public"."person"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cast_override"
    ADD CONSTRAINT "cast_override_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cast_override"
    ADD CONSTRAINT "cast_override_workspace_person_fkey" FOREIGN KEY ("workspace_id", "person_id") REFERENCES "public"."workspace_person"("workspace_id", "person_id");



ALTER TABLE ONLY "public"."cast_override"
    ADD CONSTRAINT "cast_override_workspace_replaces_person_fkey" FOREIGN KEY ("workspace_id", "replaces_person_id") REFERENCES "public"."workspace_person"("workspace_id", "person_id");



ALTER TABLE ONLY "public"."collab_snapshot"
    ADD CONSTRAINT "collab_snapshot_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation"
    ADD CONSTRAINT "conversation_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."conversation"
    ADD CONSTRAINT "conversation_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "public"."line"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."conversation"
    ADD CONSTRAINT "conversation_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."conversation"
    ADD CONSTRAINT "conversation_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation"
    ADD CONSTRAINT "conversation_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation"
    ADD CONSTRAINT "conversation_workspace_person_fkey" FOREIGN KEY ("workspace_id", "person_id") REFERENCES "public"."workspace_person"("workspace_id", "person_id");



ALTER TABLE ONLY "public"."crew_assignment"
    ADD CONSTRAINT "crew_assignment_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."crew_assignment"
    ADD CONSTRAINT "crew_assignment_performance_id_fkey" FOREIGN KEY ("performance_id") REFERENCES "public"."performance"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crew_assignment"
    ADD CONSTRAINT "crew_assignment_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."crew_assignment"
    ADD CONSTRAINT "crew_assignment_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crew_assignment"
    ADD CONSTRAINT "crew_assignment_workspace_person_fkey" FOREIGN KEY ("workspace_id", "person_id") REFERENCES "public"."workspace_person"("workspace_id", "person_id");



ALTER TABLE ONLY "public"."date"
    ADD CONSTRAINT "date_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."date"
    ADD CONSTRAINT "date_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "public"."line"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."date"
    ADD CONSTRAINT "date_performance_id_fkey" FOREIGN KEY ("performance_id") REFERENCES "public"."performance"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."date"
    ADD CONSTRAINT "date_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."date"
    ADD CONSTRAINT "date_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venue"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."date"
    ADD CONSTRAINT "date_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."expense"
    ADD CONSTRAINT "expense_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."expense"
    ADD CONSTRAINT "expense_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "public"."line"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."expense"
    ADD CONSTRAINT "expense_paid_by_user_id_fkey" FOREIGN KEY ("paid_by_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."expense"
    ADD CONSTRAINT "expense_performance_id_fkey" FOREIGN KEY ("performance_id") REFERENCES "public"."performance"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."expense"
    ADD CONSTRAINT "expense_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoice"
    ADD CONSTRAINT "invoice_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."invoice_line"
    ADD CONSTRAINT "invoice_line_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoice_line"
    ADD CONSTRAINT "invoice_line_performance_id_fkey" FOREIGN KEY ("performance_id") REFERENCES "public"."performance"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invoice_line"
    ADD CONSTRAINT "invoice_line_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoice"
    ADD CONSTRAINT "invoice_payer_person_id_fkey" FOREIGN KEY ("payer_person_id") REFERENCES "public"."person"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invoice"
    ADD CONSTRAINT "invoice_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invoice"
    ADD CONSTRAINT "invoice_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoice"
    ADD CONSTRAINT "invoice_workspace_payer_person_fkey" FOREIGN KEY ("workspace_id", "payer_person_id") REFERENCES "public"."workspace_person"("workspace_id", "person_id");



ALTER TABLE ONLY "public"."line"
    ADD CONSTRAINT "line_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."line"
    ADD CONSTRAINT "line_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."line"
    ADD CONSTRAINT "line_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment"
    ADD CONSTRAINT "payment_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."payment"
    ADD CONSTRAINT "payment_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment"
    ADD CONSTRAINT "payment_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."performance"
    ADD CONSTRAINT "performance_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."performance"
    ADD CONSTRAINT "performance_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."performance"
    ADD CONSTRAINT "performance_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "public"."line"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."performance"
    ADD CONSTRAINT "performance_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."performance"
    ADD CONSTRAINT "performance_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venue"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."performance"
    ADD CONSTRAINT "performance_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."person"
    ADD CONSTRAINT "person_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."person_note"
    ADD CONSTRAINT "person_note_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."person_note"
    ADD CONSTRAINT "person_note_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."person_note"
    ADD CONSTRAINT "person_note_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."person_note"
    ADD CONSTRAINT "person_note_workspace_person_fkey" FOREIGN KEY ("workspace_id", "person_id") REFERENCES "public"."workspace_person"("workspace_id", "person_id");



ALTER TABLE ONLY "public"."project"
    ADD CONSTRAINT "project_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."project_membership"
    ADD CONSTRAINT "project_membership_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."project_membership"
    ADD CONSTRAINT "project_membership_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_membership"
    ADD CONSTRAINT "project_membership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project"
    ADD CONSTRAINT "project_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."workspace_membership"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."project"
    ADD CONSTRAINT "project_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."roadsheet_share"
    ADD CONSTRAINT "roadsheet_share_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."roadsheet_share"
    ADD CONSTRAINT "roadsheet_share_performance_id_fkey" FOREIGN KEY ("performance_id") REFERENCES "public"."performance"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."roadsheet_share"
    ADD CONSTRAINT "roadsheet_share_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task"
    ADD CONSTRAINT "task_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task"
    ADD CONSTRAINT "task_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."task"
    ADD CONSTRAINT "task_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "public"."line"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task"
    ADD CONSTRAINT "task_performance_id_fkey" FOREIGN KEY ("performance_id") REFERENCES "public"."performance"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task"
    ADD CONSTRAINT "task_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task"
    ADD CONSTRAINT "task_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_profile"
    ADD CONSTRAINT "user_profile_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_profile"
    ADD CONSTRAINT "user_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."venue"
    ADD CONSTRAINT "venue_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."venue"
    ADD CONSTRAINT "venue_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workspace"
    ADD CONSTRAINT "workspace_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id");



ALTER TABLE ONLY "public"."workspace_alias_request"
    ADD CONSTRAINT "workspace_alias_request_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."workspace_alias_request"
    ADD CONSTRAINT "workspace_alias_request_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."workspace_alias_request"
    ADD CONSTRAINT "workspace_alias_request_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workspace_membership"
    ADD CONSTRAINT "workspace_membership_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."workspace_membership"
    ADD CONSTRAINT "workspace_membership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workspace_membership"
    ADD CONSTRAINT "workspace_membership_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workspace_organization"
    ADD CONSTRAINT "workspace_organization_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."workspace_organization"
    ADD CONSTRAINT "workspace_organization_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workspace_person"
    ADD CONSTRAINT "workspace_person_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."workspace_person"
    ADD CONSTRAINT "workspace_person_organization_fkey" FOREIGN KEY ("workspace_id", "organization_id") REFERENCES "public"."workspace_organization"("workspace_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."workspace_person"
    ADD CONSTRAINT "workspace_person_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workspace_person"
    ADD CONSTRAINT "workspace_person_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workspace_role"
    ADD CONSTRAINT "workspace_role_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE CASCADE;



ALTER TABLE "public"."account" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."account_membership" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "account_membership_delete" ON "public"."account_membership" FOR DELETE TO "authenticated" USING ("public"."is_account_owner"("account_id"));



CREATE POLICY "account_membership_insert" ON "public"."account_membership" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_account_owner"("account_id") OR ("public"."is_account_admin"("account_id") AND ("role" = 'admin'::"public"."account_role"))));



CREATE POLICY "account_membership_select" ON "public"."account_membership" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."is_account_admin"("account_id")));



CREATE POLICY "account_membership_update" ON "public"."account_membership" FOR UPDATE TO "authenticated" USING (("public"."is_account_owner"("account_id") OR ("public"."is_account_admin"("account_id") AND ("role" = 'admin'::"public"."account_role")))) WITH CHECK (("public"."is_account_owner"("account_id") OR ("public"."is_account_admin"("account_id") AND ("role" = 'admin'::"public"."account_role"))));



CREATE POLICY "account_select" ON "public"."account" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."is_account_member"("id")));



CREATE POLICY "account_update" ON "public"."account" FOR UPDATE TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."is_account_owner"("id"))) WITH CHECK ("public"."is_account_owner"("id"));



CREATE POLICY "alias_request_select" ON "public"."workspace_alias_request" FOR SELECT TO "authenticated" USING ((("workspace_id" IN ( SELECT "m"."workspace_id"
   FROM "public"."workspace_membership" "m"
  WHERE (("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("m"."accepted_at" IS NOT NULL)))) OR (EXISTS ( SELECT 1
   FROM "public"."user_profile" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."is_platform_admin")))));



ALTER TABLE "public"."asset_version" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "asset_version_delete" ON "public"."asset_version" FOR DELETE TO "authenticated" USING ("public"."has_permission"("public"."project_id_of_asset_version"("project_id", "line_id", "performance_id"), 'edit:performance'::"text"));



CREATE POLICY "asset_version_insert" ON "public"."asset_version" FOR INSERT TO "authenticated" WITH CHECK ((("workspace_id" = "public"."current_workspace_id"()) AND "public"."has_permission"("public"."project_id_of_asset_version"("project_id", "line_id", "performance_id"), 'edit:performance'::"text")));



CREATE POLICY "asset_version_select" ON "public"."asset_version" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."has_permission"("public"."project_id_of_asset_version"("project_id", "line_id", "performance_id"), 'edit:performance'::"text")));



CREATE POLICY "asset_version_update" ON "public"."asset_version" FOR UPDATE TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."has_permission"("public"."project_id_of_asset_version"("project_id", "line_id", "performance_id"), 'edit:performance'::"text"))) WITH CHECK ("public"."has_permission"("public"."project_id_of_asset_version"("project_id", "line_id", "performance_id"), 'edit:performance'::"text"));



ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_log_select" ON "public"."audit_log" FOR SELECT TO "authenticated" USING ((("actor_id" = ( SELECT "auth"."uid"() AS "uid")) OR (("workspace_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."workspace_membership" "m"
  WHERE (("m"."workspace_id" = "audit_log"."workspace_id") AND ("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("m"."accepted_at" IS NOT NULL) AND ("m"."role" = ANY (ARRAY['owner'::"public"."membership_role", 'admin'::"public"."membership_role"]))))))));



CREATE POLICY "auth_admin_read_membership" ON "public"."workspace_membership" FOR SELECT TO "supabase_auth_admin" USING (true);



CREATE POLICY "auth_admin_read_workspace_membership" ON "public"."workspace_membership" FOR SELECT TO "supabase_auth_admin" USING (true);



ALTER TABLE "public"."availability_block" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "availability_block_insert" ON "public"."availability_block" FOR INSERT TO "authenticated" WITH CHECK ((("workspace_id" = "public"."current_workspace_id"()) AND "public"."is_workspace_member"("workspace_id") AND ("created_by" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "availability_block_select" ON "public"."availability_block" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."is_workspace_member"("workspace_id")));



CREATE POLICY "availability_block_update" ON "public"."availability_block" FOR UPDATE TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."is_workspace_member"("workspace_id"))) WITH CHECK ("public"."is_workspace_member"("workspace_id"));



ALTER TABLE "public"."calendar_share" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "calendar_share_direct_access_denied" ON "public"."calendar_share" TO "authenticated", "anon" USING (false) WITH CHECK (false);



ALTER TABLE "public"."cast_member" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cast_member_delete" ON "public"."cast_member" FOR DELETE TO "authenticated" USING ("public"."has_permission"("project_id", 'edit:performance'::"text"));



CREATE POLICY "cast_member_insert" ON "public"."cast_member" FOR INSERT TO "authenticated" WITH CHECK ((("workspace_id" = "public"."current_workspace_id"()) AND "public"."has_permission"("project_id", 'edit:performance'::"text")));



CREATE POLICY "cast_member_select" ON "public"."cast_member" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."has_permission"("project_id", 'edit:performance'::"text")));



CREATE POLICY "cast_member_update" ON "public"."cast_member" FOR UPDATE TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."has_permission"("project_id", 'edit:performance'::"text"))) WITH CHECK ("public"."has_permission"("project_id", 'edit:performance'::"text"));



ALTER TABLE "public"."cast_override" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cast_override_delete" ON "public"."cast_override" FOR DELETE TO "authenticated" USING ("public"."has_permission"("public"."project_id_of_performance"("performance_id"), 'edit:performance'::"text"));



CREATE POLICY "cast_override_insert" ON "public"."cast_override" FOR INSERT TO "authenticated" WITH CHECK ((("workspace_id" = "public"."current_workspace_id"()) AND "public"."has_permission"("public"."project_id_of_performance"("performance_id"), 'edit:performance'::"text")));



CREATE POLICY "cast_override_select" ON "public"."cast_override" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."has_permission"("public"."project_id_of_performance"("performance_id"), 'edit:performance'::"text")));



CREATE POLICY "cast_override_update" ON "public"."cast_override" FOR UPDATE TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."has_permission"("public"."project_id_of_performance"("performance_id"), 'edit:performance'::"text"))) WITH CHECK ("public"."has_permission"("public"."project_id_of_performance"("performance_id"), 'edit:performance'::"text"));



ALTER TABLE "public"."collab_snapshot" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "collab_snapshot_select" ON "public"."collab_snapshot" FOR SELECT TO "authenticated" USING ("public"."is_workspace_member"("workspace_id"));



ALTER TABLE "public"."conversation" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "conversation_insert" ON "public"."conversation" FOR INSERT TO "authenticated" WITH CHECK ((("workspace_id" = "public"."current_workspace_id"()) AND "public"."has_permission"("project_id", 'edit:conversation'::"text") AND ("created_by" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "conversation_select" ON "public"."conversation" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."has_permission"("project_id", 'read:conversation'::"text")));



CREATE POLICY "conversation_update" ON "public"."conversation" FOR UPDATE TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."has_permission"("project_id", 'edit:conversation'::"text"))) WITH CHECK ("public"."has_permission"("project_id", 'edit:conversation'::"text"));



ALTER TABLE "public"."crew_assignment" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "crew_assignment_delete" ON "public"."crew_assignment" FOR DELETE TO "authenticated" USING ("public"."has_permission"("public"."project_id_of_performance"("performance_id"), 'edit:performance'::"text"));



CREATE POLICY "crew_assignment_insert" ON "public"."crew_assignment" FOR INSERT TO "authenticated" WITH CHECK ((("workspace_id" = "public"."current_workspace_id"()) AND "public"."has_permission"("public"."project_id_of_performance"("performance_id"), 'edit:performance'::"text")));



CREATE POLICY "crew_assignment_select" ON "public"."crew_assignment" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."has_permission"("public"."project_id_of_performance"("performance_id"), 'edit:performance'::"text")));



CREATE POLICY "crew_assignment_update" ON "public"."crew_assignment" FOR UPDATE TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."has_permission"("public"."project_id_of_performance"("performance_id"), 'edit:performance'::"text"))) WITH CHECK ("public"."has_permission"("public"."project_id_of_performance"("performance_id"), 'edit:performance'::"text"));



ALTER TABLE "public"."date" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "date_insert" ON "public"."date" FOR INSERT TO "authenticated" WITH CHECK ((("workspace_id" = "public"."current_workspace_id"()) AND "public"."has_permission"("project_id", 'edit:performance'::"text")));



CREATE POLICY "date_select" ON "public"."date" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."has_permission"("project_id", 'edit:performance'::"text")));



CREATE POLICY "date_update" ON "public"."date" FOR UPDATE TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."has_permission"("project_id", 'edit:performance'::"text"))) WITH CHECK ("public"."has_permission"("project_id", 'edit:performance'::"text"));



ALTER TABLE "public"."expense" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "expense_insert" ON "public"."expense" FOR INSERT TO "authenticated" WITH CHECK ((("workspace_id" = "public"."current_workspace_id"()) AND "public"."has_permission"(COALESCE(( SELECT "pf"."project_id"
   FROM "public"."performance" "pf"
  WHERE ("pf"."id" = "expense"."performance_id")), ( SELECT "l"."project_id"
   FROM "public"."line" "l"
  WHERE ("l"."id" = "expense"."line_id"))), 'edit:money'::"text")));



CREATE POLICY "expense_select" ON "public"."expense" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."has_permission"("public"."project_id_of_expense"("id"), 'read:money'::"text")));



CREATE POLICY "expense_update" ON "public"."expense" FOR UPDATE TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."has_permission"("public"."project_id_of_expense"("id"), 'edit:money'::"text"))) WITH CHECK ("public"."has_permission"(COALESCE(( SELECT "pf"."project_id"
   FROM "public"."performance" "pf"
  WHERE ("pf"."id" = "expense"."performance_id")), ( SELECT "l"."project_id"
   FROM "public"."line" "l"
  WHERE ("l"."id" = "expense"."line_id"))), 'edit:money'::"text"));



ALTER TABLE "public"."invoice" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invoice_insert" ON "public"."invoice" FOR INSERT TO "authenticated" WITH CHECK ((("workspace_id" = "public"."current_workspace_id"()) AND ((("project_id" IS NOT NULL) AND "public"."has_permission"("project_id", 'edit:money'::"text")) OR (("project_id" IS NULL) AND ("public"."current_workspace_role"() = ANY (ARRAY['owner'::"public"."membership_role", 'admin'::"public"."membership_role"]))))));



ALTER TABLE "public"."invoice_line" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invoice_line_delete" ON "public"."invoice_line" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."invoice" "i"
  WHERE (("i"."id" = "invoice_line"."invoice_id") AND ((("i"."project_id" IS NOT NULL) AND "public"."has_permission"("i"."project_id", 'edit:money'::"text")) OR (("i"."project_id" IS NULL) AND ("public"."current_workspace_role"() = ANY (ARRAY['owner'::"public"."membership_role", 'admin'::"public"."membership_role"]))))))));



CREATE POLICY "invoice_line_insert" ON "public"."invoice_line" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."invoice" "i"
  WHERE (("i"."id" = "invoice_line"."invoice_id") AND ("i"."workspace_id" = "invoice_line"."workspace_id") AND ((("i"."project_id" IS NOT NULL) AND "public"."has_permission"("i"."project_id", 'edit:money'::"text")) OR (("i"."project_id" IS NULL) AND ("public"."current_workspace_role"() = ANY (ARRAY['owner'::"public"."membership_role", 'admin'::"public"."membership_role"]))))))));



CREATE POLICY "invoice_line_select" ON "public"."invoice_line" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."invoice" "i"
  WHERE (("i"."id" = "invoice_line"."invoice_id") AND ("i"."deleted_at" IS NULL) AND ((("i"."project_id" IS NOT NULL) AND "public"."has_permission"("i"."project_id", 'read:money'::"text")) OR (("i"."project_id" IS NULL) AND (EXISTS ( SELECT 1
           FROM "public"."workspace_membership" "m"
          WHERE (("m"."workspace_id" = "i"."workspace_id") AND ("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("m"."accepted_at" IS NOT NULL) AND ("m"."role" = ANY (ARRAY['owner'::"public"."membership_role", 'admin'::"public"."membership_role"])))))))))));



CREATE POLICY "invoice_line_update" ON "public"."invoice_line" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."invoice" "i"
  WHERE (("i"."id" = "invoice_line"."invoice_id") AND ((("i"."project_id" IS NOT NULL) AND "public"."has_permission"("i"."project_id", 'edit:money'::"text")) OR (("i"."project_id" IS NULL) AND ("public"."current_workspace_role"() = ANY (ARRAY['owner'::"public"."membership_role", 'admin'::"public"."membership_role"])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."invoice" "i"
  WHERE (("i"."id" = "invoice_line"."invoice_id") AND ("i"."workspace_id" = "invoice_line"."workspace_id") AND ((("i"."project_id" IS NOT NULL) AND "public"."has_permission"("i"."project_id", 'edit:money'::"text")) OR (("i"."project_id" IS NULL) AND ("public"."current_workspace_role"() = ANY (ARRAY['owner'::"public"."membership_role", 'admin'::"public"."membership_role"]))))))));



CREATE POLICY "invoice_select" ON "public"."invoice" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND ((("project_id" IS NOT NULL) AND "public"."has_permission"("project_id", 'read:money'::"text")) OR (("project_id" IS NULL) AND (EXISTS ( SELECT 1
   FROM "public"."workspace_membership" "m"
  WHERE (("m"."workspace_id" = "invoice"."workspace_id") AND ("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("m"."accepted_at" IS NOT NULL) AND ("m"."role" = ANY (ARRAY['owner'::"public"."membership_role", 'admin'::"public"."membership_role"])))))))));



CREATE POLICY "invoice_update" ON "public"."invoice" FOR UPDATE TO "authenticated" USING ((("deleted_at" IS NULL) AND ((("project_id" IS NOT NULL) AND "public"."has_permission"("project_id", 'edit:money'::"text")) OR (("project_id" IS NULL) AND (EXISTS ( SELECT 1
   FROM "public"."workspace_membership" "m"
  WHERE (("m"."workspace_id" = "invoice"."workspace_id") AND ("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("m"."accepted_at" IS NOT NULL) AND ("m"."role" = ANY (ARRAY['owner'::"public"."membership_role", 'admin'::"public"."membership_role"]))))))))) WITH CHECK (((("project_id" IS NOT NULL) AND "public"."has_permission"("project_id", 'edit:money'::"text")) OR (("project_id" IS NULL) AND ("public"."current_workspace_role"() = ANY (ARRAY['owner'::"public"."membership_role", 'admin'::"public"."membership_role"])))));



ALTER TABLE "public"."line" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "line_insert" ON "public"."line" FOR INSERT TO "authenticated" WITH CHECK ((("workspace_id" = "public"."current_workspace_id"()) AND ("public"."has_permission"("project_id", 'edit:performance'::"text") OR "public"."has_permission"("project_id", 'edit:project_meta'::"text"))));



CREATE POLICY "line_select" ON "public"."line" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND ("public"."has_permission"("project_id", 'edit:performance'::"text") OR "public"."has_permission"("project_id", 'edit:project_meta'::"text"))));



CREATE POLICY "line_update" ON "public"."line" FOR UPDATE TO "authenticated" USING ((("deleted_at" IS NULL) AND ("public"."has_permission"("project_id", 'edit:performance'::"text") OR "public"."has_permission"("project_id", 'edit:project_meta'::"text")))) WITH CHECK (("public"."has_permission"("project_id", 'edit:performance'::"text") OR "public"."has_permission"("project_id", 'edit:project_meta'::"text")));



ALTER TABLE "public"."payment" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payment_delete" ON "public"."payment" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."invoice" "i"
  WHERE (("i"."id" = "payment"."invoice_id") AND ((("i"."project_id" IS NOT NULL) AND "public"."has_permission"("i"."project_id", 'edit:money'::"text")) OR (("i"."project_id" IS NULL) AND ("public"."current_workspace_role"() = ANY (ARRAY['owner'::"public"."membership_role", 'admin'::"public"."membership_role"]))))))));



CREATE POLICY "payment_insert" ON "public"."payment" FOR INSERT TO "authenticated" WITH CHECK ((("workspace_id" = "public"."current_workspace_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."invoice" "i"
  WHERE (("i"."id" = "payment"."invoice_id") AND ("i"."workspace_id" = "payment"."workspace_id") AND ((("i"."project_id" IS NOT NULL) AND "public"."has_permission"("i"."project_id", 'edit:money'::"text")) OR (("i"."project_id" IS NULL) AND ("public"."current_workspace_role"() = ANY (ARRAY['owner'::"public"."membership_role", 'admin'::"public"."membership_role"])))))))));



CREATE POLICY "payment_select" ON "public"."payment" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND (EXISTS ( SELECT 1
   FROM "public"."invoice" "i"
  WHERE (("i"."id" = "payment"."invoice_id") AND ((("i"."project_id" IS NOT NULL) AND "public"."has_permission"("i"."project_id", 'read:money'::"text")) OR (("i"."project_id" IS NULL) AND (EXISTS ( SELECT 1
           FROM "public"."workspace_membership" "m"
          WHERE (("m"."workspace_id" = "i"."workspace_id") AND ("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("m"."accepted_at" IS NOT NULL) AND ("m"."role" = ANY (ARRAY['owner'::"public"."membership_role", 'admin'::"public"."membership_role"]))))))))))));



CREATE POLICY "payment_update" ON "public"."payment" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."invoice" "i"
  WHERE (("i"."id" = "payment"."invoice_id") AND ((("i"."project_id" IS NOT NULL) AND "public"."has_permission"("i"."project_id", 'edit:money'::"text")) OR (("i"."project_id" IS NULL) AND ("public"."current_workspace_role"() = ANY (ARRAY['owner'::"public"."membership_role", 'admin'::"public"."membership_role"])))))))) WITH CHECK ((("workspace_id" = "public"."current_workspace_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."invoice" "i"
  WHERE (("i"."id" = "payment"."invoice_id") AND ("i"."workspace_id" = "payment"."workspace_id") AND ((("i"."project_id" IS NOT NULL) AND "public"."has_permission"("i"."project_id", 'edit:money'::"text")) OR (("i"."project_id" IS NULL) AND ("public"."current_workspace_role"() = ANY (ARRAY['owner'::"public"."membership_role", 'admin'::"public"."membership_role"])))))))));



ALTER TABLE "public"."performance" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "performance_insert" ON "public"."performance" FOR INSERT TO "authenticated" WITH CHECK ((("workspace_id" = "public"."current_workspace_id"()) AND "public"."has_permission"("project_id", 'edit:performance'::"text")));



CREATE POLICY "performance_select" ON "public"."performance" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."has_permission"("project_id", 'edit:performance'::"text")));



CREATE POLICY "performance_update" ON "public"."performance" FOR UPDATE TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."has_permission"("project_id", 'edit:performance'::"text"))) WITH CHECK ("public"."has_permission"("project_id", 'edit:performance'::"text"));



ALTER TABLE "public"."person" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "person_insert" ON "public"."person" FOR INSERT TO "authenticated" WITH CHECK (("created_by" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."person_note" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "person_note_insert" ON "public"."person_note" FOR INSERT TO "authenticated" WITH CHECK ((("workspace_id" = "public"."current_workspace_id"()) AND "public"."is_workspace_member"("workspace_id") AND ("author_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "person_note_select" ON "public"."person_note" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND ((("visibility" = 'workspace'::"public"."person_note_visibility") AND "public"."is_workspace_member"("workspace_id")) OR (("visibility" = 'private'::"public"."person_note_visibility") AND ("author_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."project" "p"
  WHERE (("p"."workspace_id" = "person_note"."workspace_id") AND "public"."has_permission"("p"."id", 'read:person_note_private'::"text"))
 LIMIT 1))))));



CREATE POLICY "person_note_update" ON "public"."person_note" FOR UPDATE TO "authenticated" USING ((("deleted_at" IS NULL) AND ("author_id" = ( SELECT "auth"."uid"() AS "uid")))) WITH CHECK (("author_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "person_select" ON "public"."person" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."can_see_person"("id")));



CREATE POLICY "person_update" ON "public"."person" FOR UPDATE TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."can_see_person"("id"))) WITH CHECK ("public"."can_see_person"("id"));



ALTER TABLE "public"."project" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "project_insert" ON "public"."project" FOR INSERT TO "authenticated" WITH CHECK ((("workspace_id" = "public"."current_workspace_id"()) AND ("public"."current_workspace_role"() = ANY (ARRAY['owner'::"public"."membership_role", 'admin'::"public"."membership_role", 'member'::"public"."membership_role"]))));



ALTER TABLE "public"."project_membership" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "project_membership_delete" ON "public"."project_membership" FOR DELETE TO "authenticated" USING ("public"."has_permission"("project_id", 'edit:membership'::"text"));



CREATE POLICY "project_membership_insert" ON "public"."project_membership" FOR INSERT TO "authenticated" WITH CHECK ("public"."has_permission"("project_id", 'edit:membership'::"text"));



CREATE POLICY "project_membership_select" ON "public"."project_membership" FOR SELECT TO "authenticated" USING (((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."project" "p"
  WHERE (("p"."id" = "project_membership"."project_id") AND "public"."is_workspace_member"("p"."workspace_id"))))) OR "public"."has_permission"("project_id", 'edit:membership'::"text")));



CREATE POLICY "project_membership_update" ON "public"."project_membership" FOR UPDATE TO "authenticated" USING ("public"."has_permission"("project_id", 'edit:membership'::"text")) WITH CHECK ("public"."has_permission"("project_id", 'edit:membership'::"text"));



CREATE POLICY "project_select" ON "public"."project" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."is_workspace_member"("workspace_id")));



CREATE POLICY "project_update" ON "public"."project" FOR UPDATE TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."has_permission"("id", 'edit:project_meta'::"text"))) WITH CHECK ("public"."has_permission"("id", 'edit:project_meta'::"text"));



ALTER TABLE "public"."roadsheet_share" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "roadsheet_share_direct_access_denied" ON "public"."roadsheet_share" TO "authenticated", "anon" USING (false) WITH CHECK (false);



ALTER TABLE "public"."task" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_insert" ON "public"."task" FOR INSERT TO "authenticated" WITH CHECK ((("workspace_id" = "public"."current_workspace_id"()) AND "public"."is_workspace_member"("workspace_id") AND ("created_by" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "task_select" ON "public"."task" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."is_workspace_member"("workspace_id")));



CREATE POLICY "task_update" ON "public"."task" FOR UPDATE TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."is_workspace_member"("workspace_id"))) WITH CHECK ("public"."is_workspace_member"("workspace_id"));



ALTER TABLE "public"."user_profile" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_profile_select" ON "public"."user_profile" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
   FROM ("public"."workspace_membership" "m1"
     JOIN "public"."workspace_membership" "m2" ON (("m2"."workspace_id" = "m1"."workspace_id")))
  WHERE (("m1"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("m1"."accepted_at" IS NOT NULL) AND ("m2"."user_id" = "user_profile"."user_id") AND ("m2"."accepted_at" IS NOT NULL))))));



CREATE POLICY "user_profile_update_self" ON "public"."user_profile" FOR UPDATE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."venue" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "venue_delete" ON "public"."venue" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."workspace_membership" "m"
  WHERE (("m"."workspace_id" = "venue"."workspace_id") AND ("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("m"."accepted_at" IS NOT NULL) AND ("m"."role" = ANY (ARRAY['owner'::"public"."membership_role", 'admin'::"public"."membership_role"]))))));



CREATE POLICY "venue_insert" ON "public"."venue" FOR INSERT TO "authenticated" WITH CHECK ((("workspace_id" = "public"."current_workspace_id"()) AND "public"."is_workspace_member"("workspace_id")));



CREATE POLICY "venue_select" ON "public"."venue" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."is_workspace_member"("workspace_id")));



CREATE POLICY "venue_update" ON "public"."venue" FOR UPDATE TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."is_workspace_member"("workspace_id"))) WITH CHECK ("public"."is_workspace_member"("workspace_id"));



ALTER TABLE "public"."workspace" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workspace_alias_request" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workspace_membership" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workspace_membership_delete" ON "public"."workspace_membership" FOR DELETE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."is_workspace_admin"("workspace_id")));



CREATE POLICY "workspace_membership_insert" ON "public"."workspace_membership" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_workspace_admin"("workspace_id"));



CREATE POLICY "workspace_membership_select" ON "public"."workspace_membership" FOR SELECT TO "authenticated" USING ("public"."is_workspace_member"("workspace_id"));



CREATE POLICY "workspace_membership_update" ON "public"."workspace_membership" FOR UPDATE TO "authenticated" USING ("public"."is_workspace_admin"("workspace_id")) WITH CHECK ("public"."is_workspace_admin"("workspace_id"));



ALTER TABLE "public"."workspace_organization" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workspace_organization_insert" ON "public"."workspace_organization" FOR INSERT TO "authenticated" WITH CHECK ((("created_by" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."workspace_membership" "m"
  WHERE (("m"."workspace_id" = "workspace_organization"."workspace_id") AND ("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("m"."accepted_at" IS NOT NULL) AND ("m"."role" = ANY (ARRAY['owner'::"public"."membership_role", 'admin'::"public"."membership_role", 'member'::"public"."membership_role"])))))));



CREATE POLICY "workspace_organization_select" ON "public"."workspace_organization" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."is_workspace_member"("workspace_id")));



CREATE POLICY "workspace_organization_update" ON "public"."workspace_organization" FOR UPDATE TO "authenticated" USING ((("deleted_at" IS NULL) AND (EXISTS ( SELECT 1
   FROM "public"."workspace_membership" "m"
  WHERE (("m"."workspace_id" = "workspace_organization"."workspace_id") AND ("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("m"."accepted_at" IS NOT NULL) AND ("m"."role" = ANY (ARRAY['owner'::"public"."membership_role", 'admin'::"public"."membership_role", 'member'::"public"."membership_role"]))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."workspace_membership" "m"
  WHERE (("m"."workspace_id" = "workspace_organization"."workspace_id") AND ("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("m"."accepted_at" IS NOT NULL) AND ("m"."role" = ANY (ARRAY['owner'::"public"."membership_role", 'admin'::"public"."membership_role", 'member'::"public"."membership_role"]))))));



ALTER TABLE "public"."workspace_person" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workspace_person_insert" ON "public"."workspace_person" FOR INSERT TO "authenticated" WITH CHECK ((("created_by" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."workspace_membership" "m"
  WHERE (("m"."workspace_id" = "workspace_person"."workspace_id") AND ("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("m"."accepted_at" IS NOT NULL) AND ("m"."role" = ANY (ARRAY['owner'::"public"."membership_role", 'admin'::"public"."membership_role", 'member'::"public"."membership_role"])))))));



CREATE POLICY "workspace_person_select" ON "public"."workspace_person" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."is_workspace_member"("workspace_id")));



CREATE POLICY "workspace_person_update" ON "public"."workspace_person" FOR UPDATE TO "authenticated" USING ((("deleted_at" IS NULL) AND (EXISTS ( SELECT 1
   FROM "public"."workspace_membership" "m"
  WHERE (("m"."workspace_id" = "workspace_person"."workspace_id") AND ("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("m"."accepted_at" IS NOT NULL) AND ("m"."role" = ANY (ARRAY['owner'::"public"."membership_role", 'admin'::"public"."membership_role", 'member'::"public"."membership_role"]))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."workspace_membership" "m"
  WHERE (("m"."workspace_id" = "workspace_person"."workspace_id") AND ("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("m"."accepted_at" IS NOT NULL) AND ("m"."role" = ANY (ARRAY['owner'::"public"."membership_role", 'admin'::"public"."membership_role", 'member'::"public"."membership_role"]))))));



ALTER TABLE "public"."workspace_role" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workspace_role_delete" ON "public"."workspace_role" FOR DELETE TO "authenticated" USING ((("is_system" = false) AND (EXISTS ( SELECT 1
   FROM "public"."workspace_membership" "m"
  WHERE (("m"."workspace_id" = "workspace_role"."workspace_id") AND ("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("m"."accepted_at" IS NOT NULL) AND ("m"."role" = ANY (ARRAY['owner'::"public"."membership_role", 'admin'::"public"."membership_role"])))))));



CREATE POLICY "workspace_role_insert" ON "public"."workspace_role" FOR INSERT TO "authenticated" WITH CHECK ((("workspace_id" = "public"."current_workspace_id"()) AND ("public"."current_workspace_role"() = ANY (ARRAY['owner'::"public"."membership_role", 'admin'::"public"."membership_role"]))));



CREATE POLICY "workspace_role_select" ON "public"."workspace_role" FOR SELECT TO "authenticated" USING ("public"."is_workspace_member"("workspace_id"));



CREATE POLICY "workspace_role_update" ON "public"."workspace_role" FOR UPDATE TO "authenticated" USING (("public"."is_workspace_member"("workspace_id") AND (EXISTS ( SELECT 1
   FROM "public"."workspace_membership" "m"
  WHERE (("m"."workspace_id" = "workspace_role"."workspace_id") AND ("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("m"."accepted_at" IS NOT NULL) AND ("m"."role" = ANY (ARRAY['owner'::"public"."membership_role", 'admin'::"public"."membership_role"]))))))) WITH CHECK (("public"."is_workspace_member"("workspace_id") AND (EXISTS ( SELECT 1
   FROM "public"."workspace_membership" "m"
  WHERE (("m"."workspace_id" = "workspace_role"."workspace_id") AND ("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("m"."accepted_at" IS NOT NULL) AND ("m"."role" = ANY (ARRAY['owner'::"public"."membership_role", 'admin'::"public"."membership_role"])))))));



CREATE POLICY "workspace_select" ON "public"."workspace" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."is_workspace_member"("id")));



CREATE POLICY "workspace_update" ON "public"."workspace" FOR UPDATE TO "authenticated" USING ((("deleted_at" IS NULL) AND (EXISTS ( SELECT 1
   FROM "public"."workspace_membership" "m"
  WHERE (("m"."workspace_id" = "workspace"."id") AND ("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("m"."accepted_at" IS NOT NULL) AND ("m"."role" = ANY (ARRAY['owner'::"public"."membership_role", 'admin'::"public"."membership_role"]))))))) WITH CHECK ((("deleted_at" IS NULL) AND (EXISTS ( SELECT 1
   FROM "public"."workspace_membership" "m"
  WHERE (("m"."workspace_id" = "workspace"."id") AND ("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("m"."accepted_at" IS NOT NULL) AND ("m"."role" = ANY (ARRAY['owner'::"public"."membership_role", 'admin'::"public"."membership_role"])))))));



REVOKE USAGE ON SCHEMA "public" FROM PUBLIC;
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
GRANT USAGE ON SCHEMA "public" TO "supabase_auth_admin";



REVOKE ALL ON FUNCTION "public"."can_edit_project"("p_project_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_edit_project"("p_project_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."can_see_person"("p_person_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_see_person"("p_person_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."uuid_generate_v7"() TO "anon";
GRANT ALL ON FUNCTION "public"."uuid_generate_v7"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."uuid_generate_v7"() TO "service_role";



GRANT ALL ON TABLE "public"."asset_version" TO "anon";
GRANT ALL ON TABLE "public"."asset_version" TO "authenticated";
GRANT ALL ON TABLE "public"."asset_version" TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_asset_version"("p_line_id" "uuid", "p_kind" "public"."asset_kind", "p_url" "text", "p_direction" "public"."asset_direction", "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_asset_version"("p_line_id" "uuid", "p_kind" "public"."asset_kind", "p_url" "text", "p_direction" "public"."asset_direction", "p_notes" "text") TO "authenticated";



GRANT ALL ON TABLE "public"."availability_block" TO "anon";
GRANT ALL ON TABLE "public"."availability_block" TO "authenticated";
GRANT ALL ON TABLE "public"."availability_block" TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_availability_block"("p_workspace_id" "uuid", "p_starts_on" "date", "p_ends_on" "date", "p_person_id" "uuid", "p_certainty" "text", "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_availability_block"("p_workspace_id" "uuid", "p_starts_on" "date", "p_ends_on" "date", "p_person_id" "uuid", "p_certainty" "text", "p_note" "text") TO "authenticated";



GRANT ALL ON TABLE "public"."calendar_share" TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_calendar_share"("p_workspace_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_calendar_share"("p_workspace_id" "uuid") TO "authenticated";



GRANT ALL ON TABLE "public"."conversation" TO "anon";
GRANT ALL ON TABLE "public"."conversation" TO "authenticated";
GRANT ALL ON TABLE "public"."conversation" TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_conversation"("p_project_id" "uuid", "p_person_id" "uuid", "p_full_name" "text", "p_email" "text", "p_phone" "text", "p_organization_name" "text", "p_title" "text", "p_status" "public"."conversation_status", "p_role" "text", "p_next_action_at" timestamp with time zone, "p_next_action_note" "text", "p_line_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_conversation"("p_project_id" "uuid", "p_person_id" "uuid", "p_full_name" "text", "p_email" "text", "p_phone" "text", "p_organization_name" "text", "p_title" "text", "p_status" "public"."conversation_status", "p_role" "text", "p_next_action_at" timestamp with time zone, "p_next_action_note" "text", "p_line_id" "uuid") TO "authenticated";



GRANT ALL ON TABLE "public"."date" TO "anon";
GRANT ALL ON TABLE "public"."date" TO "authenticated";
GRANT ALL ON TABLE "public"."date" TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_date"("p_project_id" "uuid", "p_kind" "public"."date_kind", "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone, "p_all_day" boolean, "p_title" "text", "p_venue_name" "text", "p_city" "text", "p_country" "text", "p_status" "public"."date_status", "p_performance_id" "uuid", "p_line_id" "uuid", "p_travel_direction" "text", "p_label" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_date"("p_project_id" "uuid", "p_kind" "public"."date_kind", "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone, "p_all_day" boolean, "p_title" "text", "p_venue_name" "text", "p_city" "text", "p_country" "text", "p_status" "public"."date_status", "p_performance_id" "uuid", "p_line_id" "uuid", "p_travel_direction" "text", "p_label" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_date_series"("p_project_id" "uuid", "p_kind" "public"."date_kind", "p_starts" timestamp with time zone[], "p_ends" timestamp with time zone[], "p_all_day" boolean, "p_title" "text", "p_venue_name" "text", "p_city" "text", "p_country" "text", "p_status" "public"."date_status", "p_line_id" "uuid", "p_label" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_date_series"("p_project_id" "uuid", "p_kind" "public"."date_kind", "p_starts" timestamp with time zone[], "p_ends" timestamp with time zone[], "p_all_day" boolean, "p_title" "text", "p_venue_name" "text", "p_city" "text", "p_country" "text", "p_status" "public"."date_status", "p_line_id" "uuid", "p_label" "text") TO "authenticated";



GRANT ALL ON TABLE "public"."expense" TO "anon";
GRANT ALL ON TABLE "public"."expense" TO "authenticated";
GRANT ALL ON TABLE "public"."expense" TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_expense"("p_performance_id" "uuid", "p_line_id" "uuid", "p_category" "public"."expense_category", "p_description" "text", "p_amount" numeric, "p_currency" "text", "p_incurred_on" "date", "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_expense"("p_performance_id" "uuid", "p_line_id" "uuid", "p_category" "public"."expense_category", "p_description" "text", "p_amount" numeric, "p_currency" "text", "p_incurred_on" "date", "p_notes" "text") TO "authenticated";



GRANT ALL ON TABLE "public"."invoice" TO "anon";
GRANT ALL ON TABLE "public"."invoice" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice" TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_invoice"("p_performance_id" "uuid", "p_vat_pct" numeric, "p_irpf_pct" numeric, "p_number" "text", "p_due_on" "date", "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_invoice"("p_performance_id" "uuid", "p_vat_pct" numeric, "p_irpf_pct" numeric, "p_number" "text", "p_due_on" "date", "p_notes" "text") TO "authenticated";



GRANT ALL ON TABLE "public"."line" TO "anon";
GRANT ALL ON TABLE "public"."line" TO "authenticated";
GRANT ALL ON TABLE "public"."line" TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_line"("p_project_id" "uuid", "p_name" "text", "p_accent" "text", "p_description" "text", "p_kind" "public"."line_kind", "p_modules" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_line"("p_project_id" "uuid", "p_name" "text", "p_accent" "text", "p_description" "text", "p_kind" "public"."line_kind", "p_modules" "jsonb") TO "authenticated";



GRANT ALL ON TABLE "public"."performance" TO "anon";
GRANT ALL ON TABLE "public"."performance" TO "authenticated";
GRANT ALL ON TABLE "public"."performance" TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_performance"("p_project_id" "uuid", "p_performed_at" "date", "p_venue_name" "text", "p_city" "text", "p_country" "text", "p_status" "public"."performance_status", "p_conversation_id" "uuid", "p_line_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_performance"("p_project_id" "uuid", "p_performed_at" "date", "p_venue_name" "text", "p_city" "text", "p_country" "text", "p_status" "public"."performance_status", "p_conversation_id" "uuid", "p_line_id" "uuid") TO "authenticated";



GRANT ALL ON TABLE "public"."person_note" TO "anon";
GRANT ALL ON TABLE "public"."person_note" TO "authenticated";
GRANT ALL ON TABLE "public"."person_note" TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_person_note"("p_person_id" "uuid", "p_workspace_id" "uuid", "p_body" "text", "p_visibility" "public"."person_note_visibility") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_person_note"("p_person_id" "uuid", "p_workspace_id" "uuid", "p_body" "text", "p_visibility" "public"."person_note_visibility") TO "authenticated";



GRANT ALL ON TABLE "public"."project" TO "anon";
GRANT ALL ON TABLE "public"."project" TO "authenticated";
GRANT ALL ON TABLE "public"."project" TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_project"("p_workspace_id" "uuid", "p_name" "text", "p_accent" "text", "p_description" "text", "p_slug" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_project"("p_workspace_id" "uuid", "p_name" "text", "p_accent" "text", "p_description" "text", "p_slug" "text") TO "authenticated";



GRANT ALL ON TABLE "public"."roadsheet_share" TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_roadsheet_share"("p_performance_id" "uuid", "p_role" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_roadsheet_share"("p_performance_id" "uuid", "p_role" "text") TO "authenticated";



GRANT ALL ON TABLE "public"."task" TO "anon";
GRANT ALL ON TABLE "public"."task" TO "authenticated";
GRANT ALL ON TABLE "public"."task" TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_task"("p_title" "text", "p_note" "text", "p_due_at" "date", "p_from_at" "date", "p_lead_days" integer, "p_workspace_id" "uuid", "p_project_id" "uuid", "p_line_id" "uuid", "p_performance_id" "uuid", "p_conversation_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_task"("p_title" "text", "p_note" "text", "p_due_at" "date", "p_from_at" "date", "p_lead_days" integer, "p_workspace_id" "uuid", "p_project_id" "uuid", "p_line_id" "uuid", "p_performance_id" "uuid", "p_conversation_id" "uuid") TO "authenticated";



GRANT ALL ON TABLE "public"."venue" TO "anon";
GRANT ALL ON TABLE "public"."venue" TO "authenticated";
GRANT ALL ON TABLE "public"."venue" TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_venue"("p_workspace_id" "uuid", "p_name" "text", "p_city" "text", "p_country" "text", "p_address" "text", "p_capacity" integer, "p_timezone" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_venue"("p_workspace_id" "uuid", "p_name" "text", "p_city" "text", "p_country" "text", "p_address" "text", "p_capacity" integer, "p_timezone" "text") TO "authenticated";



GRANT ALL ON TABLE "public"."workspace" TO "anon";
GRANT ALL ON TABLE "public"."workspace" TO "authenticated";
GRANT ALL ON TABLE "public"."workspace" TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_workspace"("p_name" "text", "p_slug" "text", "p_accent" "text", "p_description" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_workspace"("p_name" "text", "p_slug" "text", "p_accent" "text", "p_description" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."current_user_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_id"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."current_workspace_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_workspace_id"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."current_workspace_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_workspace_role"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") TO "supabase_auth_admin";
GRANT ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_asset_version"("p_asset_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_asset_version"("p_asset_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."delete_availability_block"("p_availability_block_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_availability_block"("p_availability_block_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."delete_conversation"("p_conversation_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_conversation"("p_conversation_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."delete_date"("p_date_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_date"("p_date_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."delete_expense"("p_expense_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_expense"("p_expense_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."delete_invoice"("p_invoice_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_invoice"("p_invoice_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."delete_performance"("p_performance_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_performance"("p_performance_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."delete_person_note"("p_note_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_person_note"("p_note_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."delete_task"("p_task_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_task"("p_task_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."generate_workspace_sid"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."generate_workspace_sid"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_public_calendar"("p_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_public_calendar"("p_token" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_calendar"("p_token" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_public_roadsheet"("p_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_public_roadsheet"("p_token" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_roadsheet"("p_token" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."guard_immutable_author"() TO "anon";
GRANT ALL ON FUNCTION "public"."guard_immutable_author"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_immutable_author"() TO "service_role";



GRANT ALL ON FUNCTION "public"."guard_immutable_created_by"() TO "anon";
GRANT ALL ON FUNCTION "public"."guard_immutable_created_by"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_immutable_created_by"() TO "service_role";



GRANT ALL ON FUNCTION "public"."guard_immutable_task_parents"() TO "anon";
GRANT ALL ON FUNCTION "public"."guard_immutable_task_parents"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_immutable_task_parents"() TO "service_role";



GRANT ALL ON FUNCTION "public"."guard_immutable_workspace_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."guard_immutable_workspace_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_immutable_workspace_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."guard_performance_fee_columns"() TO "anon";
GRANT ALL ON FUNCTION "public"."guard_performance_fee_columns"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_performance_fee_columns"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."has_permission"("p_project_id" "uuid", "p_perm" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."has_permission"("p_project_id" "uuid", "p_perm" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."is_account_admin"("acc_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_account_admin"("acc_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."is_account_member"("acc_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_account_member"("acc_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."is_account_owner"("acc_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_account_owner"("acc_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."is_reserved_slug"("candidate" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_reserved_slug"("candidate" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."is_workspace_admin"("ws_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_workspace_admin"("ws_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."is_workspace_member"("ws_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_workspace_member"("ws_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."list_calendar_shares"("p_workspace_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_calendar_shares"("p_workspace_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."list_roadsheet_shares"("p_performance_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_roadsheet_shares"("p_performance_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."project_id_of_asset_version"("p_project_id" "uuid", "p_line_id" "uuid", "p_performance_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."project_id_of_asset_version"("p_project_id" "uuid", "p_line_id" "uuid", "p_performance_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."project_id_of_expense"("p_expense_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."project_id_of_expense"("p_expense_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."project_id_of_performance"("p_performance_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."project_id_of_performance"("p_performance_id" "uuid") TO "authenticated";



GRANT ALL ON TABLE "public"."workspace_alias_request" TO "anon";
GRANT ALL ON TABLE "public"."workspace_alias_request" TO "authenticated";
GRANT ALL ON TABLE "public"."workspace_alias_request" TO "service_role";



REVOKE ALL ON FUNCTION "public"."request_workspace_alias"("p_workspace_id" "uuid", "p_alias" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."request_workspace_alias"("p_workspace_id" "uuid", "p_alias" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."review_workspace_alias"("p_request_id" "uuid", "p_approve" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."review_workspace_alias"("p_request_id" "uuid", "p_approve" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."revoke_calendar_share"("p_share_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."revoke_calendar_share"("p_share_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."revoke_roadsheet_share"("p_share_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."revoke_roadsheet_share"("p_share_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."seed_system_roles_on_workspace"() FROM PUBLIC;



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON TABLE "public"."workspace_person" TO "service_role";
GRANT SELECT ON TABLE "public"."workspace_person" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."share_my_profile_with_workspace"("p_workspace_id" "uuid", "p_fields" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."share_my_profile_with_workspace"("p_workspace_id" "uuid", "p_fields" "text"[]) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."slugify"("input" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."slugify"("input" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."stop_sharing_my_profile_with_workspace"("p_workspace_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."stop_sharing_my_profile_with_workspace"("p_workspace_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."sync_shared_profile_to_workspace_people"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."touch_line_visit"("p_line_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."touch_line_visit"("p_line_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."update_project"("p_project_id" "uuid", "p_patch" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_project"("p_project_id" "uuid", "p_patch" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."update_workspace"("p_workspace_id" "uuid", "p_patch" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_workspace"("p_workspace_id" "uuid", "p_patch" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."validate_project_membership_roles"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."validate_slug"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."write_audit"() FROM PUBLIC;



GRANT ALL ON TABLE "public"."account" TO "anon";
GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."account" TO "authenticated";
GRANT ALL ON TABLE "public"."account" TO "service_role";



GRANT ALL ON TABLE "public"."account_membership" TO "anon";
GRANT ALL ON TABLE "public"."account_membership" TO "authenticated";
GRANT ALL ON TABLE "public"."account_membership" TO "service_role";



GRANT ALL ON TABLE "public"."audit_log" TO "anon";
GRANT ALL ON TABLE "public"."audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."cast_member" TO "anon";
GRANT ALL ON TABLE "public"."cast_member" TO "authenticated";
GRANT ALL ON TABLE "public"."cast_member" TO "service_role";



GRANT ALL ON TABLE "public"."cast_override" TO "anon";
GRANT ALL ON TABLE "public"."cast_override" TO "authenticated";
GRANT ALL ON TABLE "public"."cast_override" TO "service_role";



GRANT ALL ON TABLE "public"."collab_snapshot" TO "anon";
GRANT ALL ON TABLE "public"."collab_snapshot" TO "authenticated";
GRANT ALL ON TABLE "public"."collab_snapshot" TO "service_role";



GRANT ALL ON TABLE "public"."crew_assignment" TO "anon";
GRANT ALL ON TABLE "public"."crew_assignment" TO "authenticated";
GRANT ALL ON TABLE "public"."crew_assignment" TO "service_role";



GRANT ALL ON TABLE "public"."invoice_line" TO "anon";
GRANT ALL ON TABLE "public"."invoice_line" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_line" TO "service_role";



GRANT ALL ON TABLE "public"."payment" TO "anon";
GRANT ALL ON TABLE "public"."payment" TO "authenticated";
GRANT ALL ON TABLE "public"."payment" TO "service_role";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."performance_redacted" TO "anon";
GRANT ALL ON TABLE "public"."performance_redacted" TO "authenticated";
GRANT ALL ON TABLE "public"."performance_redacted" TO "service_role";



GRANT ALL ON TABLE "public"."person" TO "anon";
GRANT ALL ON TABLE "public"."person" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."person" TO "authenticated";



GRANT ALL ON TABLE "public"."project_membership" TO "anon";
GRANT ALL ON TABLE "public"."project_membership" TO "authenticated";
GRANT ALL ON TABLE "public"."project_membership" TO "service_role";



GRANT ALL ON TABLE "public"."user_profile" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."user_profile" TO "authenticated";
GRANT ALL ON TABLE "public"."user_profile" TO "service_role";



GRANT UPDATE("full_name") ON TABLE "public"."user_profile" TO "authenticated";



GRANT UPDATE("avatar_url") ON TABLE "public"."user_profile" TO "authenticated";



GRANT UPDATE("locale") ON TABLE "public"."user_profile" TO "authenticated";



GRANT UPDATE("first_name") ON TABLE "public"."user_profile" TO "authenticated";



GRANT UPDATE("last_name") ON TABLE "public"."user_profile" TO "authenticated";



GRANT UPDATE("phone") ON TABLE "public"."user_profile" TO "authenticated";



GRANT UPDATE("website") ON TABLE "public"."user_profile" TO "authenticated";



GRANT UPDATE("city") ON TABLE "public"."user_profile" TO "authenticated";



GRANT UPDATE("country") ON TABLE "public"."user_profile" TO "authenticated";



GRANT UPDATE("languages") ON TABLE "public"."user_profile" TO "authenticated";



GRANT UPDATE("professional_title") ON TABLE "public"."user_profile" TO "authenticated";



GRANT UPDATE("bio") ON TABLE "public"."user_profile" TO "authenticated";



GRANT SELECT ON TABLE "public"."workspace_membership" TO "supabase_auth_admin";
GRANT ALL ON TABLE "public"."workspace_membership" TO "anon";
GRANT ALL ON TABLE "public"."workspace_membership" TO "authenticated";
GRANT ALL ON TABLE "public"."workspace_membership" TO "service_role";



GRANT ALL ON TABLE "public"."workspace_organization" TO "service_role";
GRANT SELECT ON TABLE "public"."workspace_organization" TO "authenticated";



GRANT ALL ON TABLE "public"."workspace_role" TO "anon";
GRANT ALL ON TABLE "public"."workspace_role" TO "authenticated";
GRANT ALL ON TABLE "public"."workspace_role" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";

-- The hosted project predates the current local-stack defaults. A plain
-- schema dump does not emit REVOKEs for privileges inherited while CREATE
-- TABLE runs, so make the production ACL state explicit and reproducible.
REVOKE ALL ON TABLE "public"."calendar_share" FROM "anon", "authenticated";
REVOKE ALL ON TABLE "public"."roadsheet_share" FROM "anon", "authenticated";
REVOKE ALL ON TABLE "public"."workspace_person" FROM "anon", "authenticated";
GRANT SELECT ON TABLE "public"."workspace_person" TO "authenticated";
REVOKE ALL ON TABLE "public"."workspace_organization" FROM "anon", "authenticated";
GRANT SELECT ON TABLE "public"."workspace_organization" TO "authenticated";
REVOKE ALL ON TABLE "public"."person" FROM "authenticated";
GRANT SELECT ("id") ON TABLE "public"."person" TO "authenticated";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"
  REVOKE ALL ON SEQUENCES FROM "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"
  REVOKE ALL ON FUNCTIONS FROM "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"
  REVOKE ALL ON TABLES FROM "postgres";

COMMENT ON SCHEMA "public" IS NULL;
