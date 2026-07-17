-- Migration: rename_engagement_to_conversation
-- ADR-075: rename schema `engagement` → `conversation`, and the closed RBAC
-- vocab `read:engagement`/`edit:engagement` → `read:conversation`/
-- `edit:conversation`. "Engagement" failed the same exam that killed `show`
-- (ADR-036 — opaque in castellano) and adds the marketing homonym on top.
-- The domain word, the Desk's verbs, the gap-#2 log and the AI all say
-- *conversation*. ADR-069 wants an AI-legible schema: table `engagement` +
-- product "conversación" is a permanent translation dictionary for every
-- agent and every prompt.
--
-- ALSO (Marco, 2026-07-17): `edit:show` → `edit:performance`, closing the
-- debt ADR-036 deferred. That deferral's stated reason ("requiere update
-- masivo de workspace_role.permissions + project_membership") does not hold:
-- it is 46 workspace_role rows and 0 project_membership rows. Leaving
-- `edit:show` while `edit:conversation` lands would half-migrate the closed
-- vocabulary — worse than consistently stale. ADR-036 § deferral: superseded.
--
-- Permission codes are NOT cached in the JWT (custom_access_token_hook only
-- stamps current_workspace_id); has_permission() reads workspace_role live,
-- so the data rename below takes effect without any re-login.
--
-- `person` is untouched (a person is a person). Old migrations are history
-- and are not rewritten.
--
-- Applied via Supabase MCP apply_migration 2026-07-17 (name:
-- rename_engagement_to_conversation). This file is the canonical record.
-- The BEGIN/COMMIT below were omitted from the MCP call: apply_migration
-- supplies its own transaction (probed: a failing statement rolled back an
-- earlier CREATE SCHEMA), so a nested COMMIT would have closed the wrapper
-- mid-migration. They are kept here so the file runs standalone under psql.
--
-- ── Ordering notes (each one bites if moved) ─────────────────────────────
--  • §3 drops the 4 functions whose SIGNATURE carries a renamed type or
--    param. It MUST precede §4: after `ALTER TYPE engagement_status RENAME`,
--    a DROP naming `engagement_status` no longer resolves. Postgres cannot
--    rename a function parameter via CREATE OR REPLACE — drop is the only way.
--  • The other 11 functions go through CREATE OR REPLACE (§9), which
--    PRESERVES their ACL. The 4 dropped ones lose it (default is EXECUTE TO
--    PUBLIC) and are re-granted explicitly. Getting this wrong opens the RPCs
--    to anon.
--  • §11 renames the view's OWN column instead of DROP+CREATE. Renaming a
--    base column leaves a dependent view publishing the OLD name
--    (`SELECT conversation_id AS engagement_id`) — verified on a scratch
--    schema. DROP+CREATE would fix the name but Supabase's default privileges
--    re-grant ALL to anon on the new view, silently handing anon the SELECT
--    that was deliberately revoked, and would drop security_invoker=true.
--    ALTER VIEW ... RENAME COLUMN preserves reloptions and grants. (This is
--    where the show→performance precedent, §20, was luckier than it was right:
--    it had no column to rename inside the view.)

BEGIN;

-- ═══ §1 Drop the dependent CHECK on collab_snapshot? ═════════════════════
-- Not needed, on two counts. collab_snapshot_target_table_chk lists
-- ('performance','project','line') — no engagement; and target_table is a
-- plain text discriminator, so the CHECK carries no catalog dependency on the
-- renamed table at all (pg_depend: it depends only on collab_snapshot itself).
-- task_at_most_one_parent DOES reference engagement_id, but Postgres stores
-- CHECK expressions by attnum, so the column rename in §5 rewrites it.

-- ═══ §2 Drop every policy that names the renamed table or renamed codes ═══
-- 28 policies across 8 tables. Emitted from pg_policies, not hand-listed.
DROP POLICY IF EXISTS asset_version_delete ON public.asset_version;
DROP POLICY IF EXISTS asset_version_insert ON public.asset_version;
DROP POLICY IF EXISTS asset_version_select ON public.asset_version;
DROP POLICY IF EXISTS asset_version_update ON public.asset_version;
DROP POLICY IF EXISTS cast_member_delete ON public.cast_member;
DROP POLICY IF EXISTS cast_member_insert ON public.cast_member;
DROP POLICY IF EXISTS cast_member_select ON public.cast_member;
DROP POLICY IF EXISTS cast_member_update ON public.cast_member;
DROP POLICY IF EXISTS cast_override_delete ON public.cast_override;
DROP POLICY IF EXISTS cast_override_insert ON public.cast_override;
DROP POLICY IF EXISTS cast_override_select ON public.cast_override;
DROP POLICY IF EXISTS cast_override_update ON public.cast_override;
DROP POLICY IF EXISTS crew_assignment_delete ON public.crew_assignment;
DROP POLICY IF EXISTS crew_assignment_insert ON public.crew_assignment;
DROP POLICY IF EXISTS crew_assignment_select ON public.crew_assignment;
DROP POLICY IF EXISTS crew_assignment_update ON public.crew_assignment;
DROP POLICY IF EXISTS date_insert ON public.date;
DROP POLICY IF EXISTS date_select ON public.date;
DROP POLICY IF EXISTS date_update ON public.date;
DROP POLICY IF EXISTS engagement_insert ON public.engagement;
DROP POLICY IF EXISTS engagement_select ON public.engagement;
DROP POLICY IF EXISTS engagement_update ON public.engagement;
DROP POLICY IF EXISTS line_insert ON public.line;
DROP POLICY IF EXISTS line_select ON public.line;
DROP POLICY IF EXISTS line_update ON public.line;
DROP POLICY IF EXISTS performance_insert ON public.performance;
DROP POLICY IF EXISTS performance_select ON public.performance;
DROP POLICY IF EXISTS performance_update ON public.performance;

-- ═══ §3 Drop the 4 functions whose signature carries a renamed type/param ══
-- MUST run before §4 (see ordering notes).
DROP FUNCTION IF EXISTS public.create_engagement(uuid, uuid, text, text, text, text, text, engagement_status, text, timestamp with time zone, text, uuid);
DROP FUNCTION IF EXISTS public.delete_engagement(uuid);
DROP FUNCTION IF EXISTS public.create_performance(uuid, date, text, text, text, performance_status, uuid, uuid);
DROP FUNCTION IF EXISTS public.create_task(text, text, date, date, integer, uuid, uuid, uuid, uuid, uuid);

-- ═══ §4 Rename the table and the enum ════════════════════════════════════
-- The composite type `engagement` rides along with the table rename.
ALTER TABLE public.engagement RENAME TO conversation;
ALTER TYPE  public.engagement_status RENAME TO conversation_status;

-- ═══ §5 Rename the FK columns ════════════════════════════════════════════
ALTER TABLE public.performance RENAME COLUMN engagement_id TO conversation_id;
ALTER TABLE public.task        RENAME COLUMN engagement_id TO conversation_id;

-- ═══ §6 Rename constraints on conversation ═══════════════════════════════
ALTER TABLE public.conversation RENAME CONSTRAINT engagement_pkey            TO conversation_pkey;
ALTER TABLE public.conversation RENAME CONSTRAINT engagement_workspace_id_fkey TO conversation_workspace_id_fkey;
ALTER TABLE public.conversation RENAME CONSTRAINT engagement_project_id_fkey TO conversation_project_id_fkey;
ALTER TABLE public.conversation RENAME CONSTRAINT engagement_person_id_fkey  TO conversation_person_id_fkey;
ALTER TABLE public.conversation RENAME CONSTRAINT engagement_line_id_fkey    TO conversation_line_id_fkey;
ALTER TABLE public.conversation RENAME CONSTRAINT engagement_created_by_fkey TO conversation_created_by_fkey;
ALTER TABLE public.conversation RENAME CONSTRAINT engagement_workspace_id_project_id_person_id_key
  TO conversation_workspace_id_project_id_person_id_key;

-- ═══ §7 Rename FK constraints on the referring tables ════════════════════
ALTER TABLE public.performance RENAME CONSTRAINT performance_engagement_id_fkey TO performance_conversation_id_fkey;
ALTER TABLE public.task        RENAME CONSTRAINT task_engagement_id_fkey        TO task_conversation_id_fkey;

-- ═══ §8 Rename indexes and triggers ══════════════════════════════════════
ALTER INDEX public.engagement_workspace_idx         RENAME TO conversation_workspace_idx;
ALTER INDEX public.engagement_project_idx           RENAME TO conversation_project_idx;
ALTER INDEX public.engagement_person_idx            RENAME TO conversation_person_idx;
ALTER INDEX public.engagement_line_idx              RENAME TO conversation_line_idx;
ALTER INDEX public.engagement_status_idx            RENAME TO conversation_status_idx;
ALTER INDEX public.engagement_created_by_idx        RENAME TO conversation_created_by_idx;
ALTER INDEX public.engagement_custom_fields_gin_idx RENAME TO conversation_custom_fields_gin_idx;
ALTER INDEX public.engagement_slug_uidx             RENAME TO conversation_slug_uidx;
ALTER INDEX public.engagement_previous_slugs_gin    RENAME TO conversation_previous_slugs_gin;
-- pkey / unique-key indexes follow their constraint rename in §6 automatically.
ALTER INDEX public.performance_engagement_idx RENAME TO performance_conversation_idx;
ALTER INDEX public.task_engagement_idx        RENAME TO task_conversation_idx;

ALTER TRIGGER engagement_set_updated_at ON public.conversation RENAME TO conversation_set_updated_at;
ALTER TRIGGER engagement_audit          ON public.conversation RENAME TO conversation_audit;
ALTER TRIGGER engagement_guard_ws       ON public.conversation RENAME TO conversation_guard_ws;
ALTER TRIGGER engagement_guard_creator  ON public.conversation RENAME TO conversation_guard_creator;
ALTER TRIGGER engagement_slug_validate  ON public.conversation RENAME TO conversation_slug_validate;

-- ═══ §9 Recreate the functions ═══════════════════════════════════════════
-- 9.1 — CREATE OR REPLACE (signature unchanged → ACL preserved).

CREATE OR REPLACE FUNCTION public.is_reserved_slug(candidate text)
 RETURNS boolean LANGUAGE sql IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT lower(coalesce(candidate, '')) = ANY (ARRAY[
    'h','public','api','auth','login','logout','signup','signin','signout','oauth',
    'www','app','home','about','pricing','docs','blog','help','support','legal','terms','privacy','contact','careers','status','changelog',
    'admin','settings','account','profile','billing','dashboard','new','edit','delete','search','explore','discover',
    'house','room','run','gig','desk','plaza','roadsheet','conversation','conversations','person','venue','asset','invoice','calendar','money','comms','archive',
    'staging','dev','playground','booking','assets','static','cdn'
  ]);
$function$;
-- ADR-075: 'engagement' and 'contacts' leave the list (dead vocabulary, and the
-- app is pre-public so no old URL needs protecting); 'conversation' (entity
-- segment) and 'conversations' (the lens, which competes with the space
-- segment at /h/*) enter. Mirror: apps/web/src/lib/reserved-slugs.ts.

CREATE OR REPLACE FUNCTION public.can_see_person(p_person_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.person WHERE id = p_person_id AND created_by = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.conversation c
    JOIN public.workspace_membership m ON m.workspace_id = c.workspace_id
    WHERE c.person_id = p_person_id AND c.deleted_at IS NULL
      AND m.user_id = auth.uid() AND m.accepted_at IS NOT NULL
  )
  OR EXISTS (
    SELECT 1 FROM public.crew_assignment c
    JOIN public.workspace_membership m ON m.workspace_id = c.workspace_id
    WHERE c.person_id = p_person_id AND c.deleted_at IS NULL
      AND m.user_id = auth.uid() AND m.accepted_at IS NOT NULL
  )
  OR EXISTS (
    SELECT 1 FROM public.cast_member cm
    JOIN public.workspace_membership m ON m.workspace_id = cm.workspace_id
    WHERE cm.person_id = p_person_id AND cm.deleted_at IS NULL
      AND m.user_id = auth.uid() AND m.accepted_at IS NOT NULL
  )
  OR EXISTS (
    SELECT 1 FROM public.cast_override co
    JOIN public.workspace_membership m ON m.workspace_id = co.workspace_id
    WHERE (co.person_id = p_person_id OR co.replaces_person_id = p_person_id)
      AND co.deleted_at IS NULL
      AND m.user_id = auth.uid() AND m.accepted_at IS NOT NULL
  );
$function$;

CREATE OR REPLACE FUNCTION public.guard_immutable_task_parents()
 RETURNS trigger LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.seed_system_roles_on_workspace()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.create_invoice(p_performance_id uuid, p_vat_pct numeric DEFAULT NULL::numeric, p_irpf_pct numeric DEFAULT NULL::numeric, p_number text DEFAULT NULL::text, p_due_on date DEFAULT NULL::date, p_notes text DEFAULT NULL::text)
 RETURNS invoice LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.create_asset_version(p_line_id uuid, p_kind asset_kind, p_url text, p_direction asset_direction DEFAULT 'outbound'::asset_direction, p_notes text DEFAULT NULL::text)
 RETURNS asset_version LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.delete_asset_version(p_asset_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.create_roadsheet_share(p_performance_id uuid, p_role text)
 RETURNS roadsheet_share LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.list_roadsheet_shares(p_performance_id uuid)
 RETURNS SETOF roadsheet_share LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.revoke_roadsheet_share(p_share_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.delete_performance(p_performance_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

-- 9.2 — Recreated from scratch (param/type renames forced the DROP in §3).
--       These LOSE their ACL on create — re-granted explicitly below.

CREATE FUNCTION public.create_conversation(p_project_id uuid, p_person_id uuid DEFAULT NULL::uuid, p_full_name text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_organization_name text DEFAULT NULL::text, p_title text DEFAULT NULL::text, p_status conversation_status DEFAULT 'contacted'::conversation_status, p_role text DEFAULT NULL::text, p_next_action_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_next_action_note text DEFAULT NULL::text, p_line_id uuid DEFAULT NULL::uuid)
 RETURNS conversation LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_caller       uuid := auth.uid();
  v_workspace_id uuid;
  v_full_name    text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_email        text := nullif(btrim(coalesce(p_email, '')), '');
  v_person       public.person;
  v_person_id    uuid;
  v_slug         text;
  v_conv_id      uuid;
  v_conv_slug    text;
  v_conv         public.conversation;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT workspace_id INTO v_workspace_id
  FROM public.project
  WHERE id = p_project_id AND deleted_at IS NULL;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'project % not found', p_project_id USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_permission(p_project_id, 'edit:conversation') THEN
    RAISE EXCEPTION 'edit:conversation required to create a conversation'
      USING ERRCODE = '42501';
  END IF;

  -- ADR-056: the operational frame must belong to the same project.
  IF p_line_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.line
    WHERE id = p_line_id AND project_id = p_project_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'line does not belong to project' USING ERRCODE = '22023';
  END IF;

  -- ── Resolve the person ────────────────────────────────────────────────
  IF p_person_id IS NOT NULL THEN
    SELECT * INTO v_person FROM public.person
    WHERE id = p_person_id AND deleted_at IS NULL;
    IF v_person.id IS NULL OR NOT public.can_see_person(p_person_id) THEN
      RAISE EXCEPTION 'person % not found', p_person_id USING ERRCODE = '42501';
    END IF;
    v_person_id := v_person.id;
  ELSE
    IF v_full_name IS NULL THEN
      RAISE EXCEPTION 'full_name is required when person_id is not given'
        USING ERRCODE = '22023';
    END IF;
    IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
      RAISE EXCEPTION 'email is not valid' USING ERRCODE = '22023';
    END IF;

    IF v_email IS NOT NULL THEN
      -- citext equality; matches soft-deleted rows too (full UNIQUE).
      SELECT * INTO v_person FROM public.person WHERE email = v_email;
    END IF;

    IF v_person.id IS NOT NULL THEN
      v_person_id := v_person.id;
      IF v_person.deleted_at IS NOT NULL THEN
        -- Resurrect: while deleted the slug left the partial unique index,
        -- so a live row may have claimed it — re-suffix if needed.
        v_slug := v_person.slug;
        IF EXISTS (
          SELECT 1 FROM public.person
          WHERE slug = v_slug AND deleted_at IS NULL AND id <> v_person_id
        ) THEN
          v_slug := v_slug || '-' ||
            substring(replace(v_person_id::text, '-', '') FROM 1 FOR 6);
        END IF;
        UPDATE public.person
        SET deleted_at = NULL, slug = v_slug
        WHERE id = v_person_id;
      END IF;
      -- Fill blanks only; an existing file is never overwritten.
      UPDATE public.person SET
        phone             = coalesce(phone, nullif(btrim(coalesce(p_phone, '')), '')),
        organization_name = coalesce(organization_name, nullif(btrim(coalesce(p_organization_name, '')), '')),
        title             = coalesce(title, nullif(btrim(coalesce(p_title, '')), ''))
      WHERE id = v_person_id;
    ELSE
      v_person_id := public.uuid_generate_v7();
      v_slug := coalesce(nullif(public.slugify(v_full_name), ''), 'person');
      IF EXISTS (
        SELECT 1 FROM public.person WHERE slug = v_slug AND deleted_at IS NULL
      ) THEN
        v_slug := v_slug || '-' ||
          substring(replace(v_person_id::text, '-', '') FROM 1 FOR 6);
      END IF;
      INSERT INTO public.person (id, slug, full_name, email, phone, organization_name, title, created_by)
      VALUES (
        v_person_id, v_slug, v_full_name, v_email,
        nullif(btrim(coalesce(p_phone, '')), ''),
        nullif(btrim(coalesce(p_organization_name, '')), ''),
        nullif(btrim(coalesce(p_title, '')), ''),
        v_caller
      );
    END IF;
  END IF;

  -- ── Resurrect a soft-deleted conversation for the same triple ────────
  SELECT * INTO v_conv FROM public.conversation
  WHERE workspace_id = v_workspace_id
    AND project_id = p_project_id
    AND person_id = v_person_id
    AND deleted_at IS NOT NULL;
  IF v_conv.id IS NOT NULL THEN
    v_conv_slug := v_conv.slug;
    IF EXISTS (
      SELECT 1 FROM public.conversation
      WHERE workspace_id = v_workspace_id AND slug = v_conv_slug
        AND deleted_at IS NULL AND id <> v_conv.id
    ) THEN
      v_conv_slug := v_conv_slug || '-' ||
        substring(replace(v_conv.id::text, '-', '') FROM 1 FOR 6);
    END IF;
    UPDATE public.conversation SET
      deleted_at = NULL,
      slug = v_conv_slug,
      status = p_status,
      role = nullif(btrim(coalesce(p_role, '')), ''),
      last_contacted_at = now(),
      next_action_at = p_next_action_at,
      next_action_note = nullif(btrim(coalesce(p_next_action_note, '')), ''),
      line_id = p_line_id
    WHERE id = v_conv.id
    RETURNING * INTO v_conv;
    RETURN v_conv;
  END IF;

  -- ── Create the conversation ───────────────────────────────────────────
  v_conv_id := public.uuid_generate_v7();
  SELECT slug INTO v_conv_slug FROM public.person WHERE id = v_person_id;
  v_conv_slug := coalesce(v_conv_slug, 'conversation');
  IF EXISTS (
    SELECT 1 FROM public.conversation
    WHERE workspace_id = v_workspace_id AND slug = v_conv_slug AND deleted_at IS NULL
  ) THEN
    v_conv_slug := v_conv_slug || '-' ||
      substring(replace(v_conv_id::text, '-', '') FROM 1 FOR 6);
  END IF;

  INSERT INTO public.conversation (
    id, slug, workspace_id, project_id, person_id, line_id, status, role,
    first_contacted_at, last_contacted_at, next_action_at, next_action_note,
    created_by
  ) VALUES (
    v_conv_id, v_conv_slug, v_workspace_id, p_project_id, v_person_id, p_line_id,
    p_status,
    nullif(btrim(coalesce(p_role, '')), ''),
    now(), now(), p_next_action_at,
    nullif(btrim(coalesce(p_next_action_note, '')), ''),
    v_caller
  )
  RETURNING * INTO v_conv;

  RETURN v_conv;
END;
$function$;
REVOKE ALL ON FUNCTION public.create_conversation(uuid, uuid, text, text, text, text, text, conversation_status, text, timestamp with time zone, text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_conversation(uuid, uuid, text, text, text, text, text, conversation_status, text, timestamp with time zone, text, uuid) TO authenticated;

CREATE FUNCTION public.delete_conversation(p_conversation_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION public.delete_conversation(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_conversation(uuid) TO authenticated;

CREATE FUNCTION public.create_performance(p_project_id uuid, p_performed_at date, p_venue_name text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_status performance_status DEFAULT 'proposed'::performance_status, p_conversation_id uuid DEFAULT NULL::uuid, p_line_id uuid DEFAULT NULL::uuid)
 RETURNS performance LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION public.create_performance(uuid, date, text, text, text, performance_status, uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_performance(uuid, date, text, text, text, performance_status, uuid, uuid) TO authenticated;

CREATE FUNCTION public.create_task(p_title text, p_note text DEFAULT NULL::text, p_due_at date DEFAULT NULL::date, p_from_at date DEFAULT NULL::date, p_lead_days integer DEFAULT NULL::integer, p_workspace_id uuid DEFAULT NULL::uuid, p_project_id uuid DEFAULT NULL::uuid, p_line_id uuid DEFAULT NULL::uuid, p_performance_id uuid DEFAULT NULL::uuid, p_conversation_id uuid DEFAULT NULL::uuid)
 RETURNS task LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION public.create_task(text, text, date, date, integer, uuid, uuid, uuid, uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_task(text, text, date, date, integer, uuid, uuid, uuid, uuid, uuid) TO authenticated;

-- ═══ §10 Recreate the policies ═══════════════════════════════════════════
-- Emitted from pg_policies with only the permission-code strings replaced —
-- every expression is the catalog's own, so coverage cannot drift.
CREATE POLICY asset_version_delete ON public.asset_version FOR DELETE TO authenticated
  USING (has_permission(project_id_of_asset_version(project_id, line_id, performance_id), 'edit:performance'::text));
CREATE POLICY asset_version_insert ON public.asset_version FOR INSERT TO authenticated
  WITH CHECK (((workspace_id = current_workspace_id()) AND has_permission(project_id_of_asset_version(project_id, line_id, performance_id), 'edit:performance'::text)));
CREATE POLICY asset_version_select ON public.asset_version FOR SELECT TO authenticated
  USING (((deleted_at IS NULL) AND has_permission(project_id_of_asset_version(project_id, line_id, performance_id), 'edit:performance'::text)));
CREATE POLICY asset_version_update ON public.asset_version FOR UPDATE TO authenticated
  USING (((deleted_at IS NULL) AND has_permission(project_id_of_asset_version(project_id, line_id, performance_id), 'edit:performance'::text)))
  WITH CHECK (has_permission(project_id_of_asset_version(project_id, line_id, performance_id), 'edit:performance'::text));
CREATE POLICY cast_member_delete ON public.cast_member FOR DELETE TO authenticated
  USING (has_permission(project_id, 'edit:performance'::text));
CREATE POLICY cast_member_insert ON public.cast_member FOR INSERT TO authenticated
  WITH CHECK (((workspace_id = current_workspace_id()) AND has_permission(project_id, 'edit:performance'::text)));
CREATE POLICY cast_member_select ON public.cast_member FOR SELECT TO authenticated
  USING (((deleted_at IS NULL) AND has_permission(project_id, 'edit:performance'::text)));
CREATE POLICY cast_member_update ON public.cast_member FOR UPDATE TO authenticated
  USING (((deleted_at IS NULL) AND has_permission(project_id, 'edit:performance'::text)))
  WITH CHECK (has_permission(project_id, 'edit:performance'::text));
CREATE POLICY cast_override_delete ON public.cast_override FOR DELETE TO authenticated
  USING (has_permission(project_id_of_performance(performance_id), 'edit:performance'::text));
CREATE POLICY cast_override_insert ON public.cast_override FOR INSERT TO authenticated
  WITH CHECK (((workspace_id = current_workspace_id()) AND has_permission(project_id_of_performance(performance_id), 'edit:performance'::text)));
CREATE POLICY cast_override_select ON public.cast_override FOR SELECT TO authenticated
  USING (((deleted_at IS NULL) AND has_permission(project_id_of_performance(performance_id), 'edit:performance'::text)));
CREATE POLICY cast_override_update ON public.cast_override FOR UPDATE TO authenticated
  USING (((deleted_at IS NULL) AND has_permission(project_id_of_performance(performance_id), 'edit:performance'::text)))
  WITH CHECK (has_permission(project_id_of_performance(performance_id), 'edit:performance'::text));
CREATE POLICY conversation_insert ON public.conversation FOR INSERT TO authenticated
  WITH CHECK (((workspace_id = current_workspace_id()) AND has_permission(project_id, 'edit:conversation'::text) AND (created_by = auth.uid())));
CREATE POLICY conversation_select ON public.conversation FOR SELECT TO authenticated
  USING (((deleted_at IS NULL) AND has_permission(project_id, 'read:conversation'::text)));
CREATE POLICY conversation_update ON public.conversation FOR UPDATE TO authenticated
  USING (((deleted_at IS NULL) AND has_permission(project_id, 'edit:conversation'::text)))
  WITH CHECK (has_permission(project_id, 'edit:conversation'::text));
CREATE POLICY crew_assignment_delete ON public.crew_assignment FOR DELETE TO authenticated
  USING (has_permission(project_id_of_performance(performance_id), 'edit:performance'::text));
CREATE POLICY crew_assignment_insert ON public.crew_assignment FOR INSERT TO authenticated
  WITH CHECK (((workspace_id = current_workspace_id()) AND has_permission(project_id_of_performance(performance_id), 'edit:performance'::text)));
CREATE POLICY crew_assignment_select ON public.crew_assignment FOR SELECT TO authenticated
  USING (((deleted_at IS NULL) AND has_permission(project_id_of_performance(performance_id), 'edit:performance'::text)));
CREATE POLICY crew_assignment_update ON public.crew_assignment FOR UPDATE TO authenticated
  USING (((deleted_at IS NULL) AND has_permission(project_id_of_performance(performance_id), 'edit:performance'::text)))
  WITH CHECK (has_permission(project_id_of_performance(performance_id), 'edit:performance'::text));
CREATE POLICY date_insert ON public.date FOR INSERT TO authenticated
  WITH CHECK (((workspace_id = current_workspace_id()) AND has_permission(project_id, 'edit:performance'::text)));
CREATE POLICY date_select ON public.date FOR SELECT TO authenticated
  USING (((deleted_at IS NULL) AND has_permission(project_id, 'edit:performance'::text)));
CREATE POLICY date_update ON public.date FOR UPDATE TO authenticated
  USING (((deleted_at IS NULL) AND has_permission(project_id, 'edit:performance'::text)))
  WITH CHECK (has_permission(project_id, 'edit:performance'::text));
CREATE POLICY line_insert ON public.line FOR INSERT TO authenticated
  WITH CHECK (((workspace_id = current_workspace_id()) AND (has_permission(project_id, 'edit:performance'::text) OR has_permission(project_id, 'edit:project_meta'::text))));
CREATE POLICY line_select ON public.line FOR SELECT TO authenticated
  USING (((deleted_at IS NULL) AND (has_permission(project_id, 'edit:performance'::text) OR has_permission(project_id, 'edit:project_meta'::text))));
CREATE POLICY line_update ON public.line FOR UPDATE TO authenticated
  USING (((deleted_at IS NULL) AND (has_permission(project_id, 'edit:performance'::text) OR has_permission(project_id, 'edit:project_meta'::text))))
  WITH CHECK ((has_permission(project_id, 'edit:performance'::text) OR has_permission(project_id, 'edit:project_meta'::text)));
CREATE POLICY performance_insert ON public.performance FOR INSERT TO authenticated
  WITH CHECK (((workspace_id = current_workspace_id()) AND has_permission(project_id, 'edit:performance'::text)));
CREATE POLICY performance_select ON public.performance FOR SELECT TO authenticated
  USING (((deleted_at IS NULL) AND has_permission(project_id, 'edit:performance'::text)));
CREATE POLICY performance_update ON public.performance FOR UPDATE TO authenticated
  USING (((deleted_at IS NULL) AND has_permission(project_id, 'edit:performance'::text)))
  WITH CHECK (has_permission(project_id, 'edit:performance'::text));

-- ═══ §11 Fix the view's own output column ════════════════════════════════
-- §5 left it publishing `SELECT conversation_id AS engagement_id`. Renaming in
-- place keeps security_invoker=true and the deliberate REVOKE of SELECT from
-- anon, both of which a DROP+CREATE would silently undo.
ALTER VIEW public.performance_redacted RENAME COLUMN engagement_id TO conversation_id;

-- ═══ §12 Data: the closed RBAC vocabulary ════════════════════════════════
-- ADR-006 vocabulary is stored, not enum'd — so the rename is a data update.
-- Safe live: permissions are read by has_permission() per query, never cached
-- in the JWT.
UPDATE public.workspace_role
SET permissions = array_replace(permissions, 'read:engagement', 'read:conversation')
WHERE permissions && ARRAY['read:engagement']::text[];
UPDATE public.workspace_role
SET permissions = array_replace(permissions, 'edit:engagement', 'edit:conversation')
WHERE permissions && ARRAY['edit:engagement']::text[];
UPDATE public.workspace_role
SET permissions = array_replace(permissions, 'edit:show', 'edit:performance')
WHERE permissions && ARRAY['edit:show']::text[];

-- project_membership is empty today; kept so the migration is correct rather
-- than merely lucky.
UPDATE public.project_membership
SET permission_grants = array_replace(array_replace(array_replace(
      permission_grants, 'read:engagement', 'read:conversation'),
      'edit:engagement', 'edit:conversation'),
      'edit:show', 'edit:performance')
WHERE permission_grants && ARRAY['read:engagement','edit:engagement','edit:show']::text[];
UPDATE public.project_membership
SET permission_revokes = array_replace(array_replace(array_replace(
      permission_revokes, 'read:engagement', 'read:conversation'),
      'edit:engagement', 'edit:conversation'),
      'edit:show', 'edit:performance')
WHERE permission_revokes && ARRAY['read:engagement','edit:engagement','edit:show']::text[];

-- ═══ §13 Data: the line module key ═══════════════════════════════════════
-- ADR-075: the line module keyed `contacts` always listed the line's
-- conversations (its own docstring said so) — that mismatch is what opened the
-- ADR. A data migration, not a read-time alias: the system stays alias-free.
-- Order is preserved (WITH ORDINALITY); `roadsheet.ts`'s unrelated 'contacts'
-- section key is a different namespace and is NOT touched.
UPDATE public.line
SET modules = (
  SELECT jsonb_agg(
    CASE WHEN elem = to_jsonb('contacts'::text) THEN to_jsonb('conversations'::text) ELSE elem END
    ORDER BY ord)
  FROM jsonb_array_elements(modules) WITH ORDINALITY AS e(elem, ord)
)
WHERE jsonb_typeof(modules) = 'array'
  AND modules @> to_jsonb(ARRAY['contacts']);

-- ═══ §14 Comments ════════════════════════════════════════════════════════
COMMENT ON TABLE  public.conversation IS
  'Conversation state for (person × project × workspace). Distinct from performance (ADR-001). Renamed from `engagement` — ADR-075.';
COMMENT ON COLUMN public.conversation.status IS
  'Anti-CRM. contacted | in_conversation | hold | confirmed | declined | dormant | recurring.';
COMMENT ON COLUMN public.workspace_role.permissions IS
  'Closed vocabulary: read:money, read:conversation, read:person_note_private, read:internal_notes, edit:performance, edit:conversation, edit:money, edit:project_meta, edit:membership, admin:project.';

COMMIT;
