-- Migration: add_account_layer
-- Applied: 2026-05-18 via Supabase MCP apply_migration
-- ADR: ADR-032 (_decisions.md)
--
-- Multi-tenant model goes from 2 levels (workspace + project) to 3:
--
--   account (billing entity, Basecamp-like)
--     ↓ has_many
--   workspace (= "Project" UI, RLS scope, Slack-like cross-account membership)
--     ↓ has_many
--   project / section / show / engagement / ... (workspace-internal data)
--
-- A user can hold workspace_membership in N workspaces across DIFFERENT
-- accounts at the same time (Slack-like). Only one of those accounts is
-- "theirs" (the one that pays); the rest they're invited to. This matches
-- Marco's case in the sketch (1 personal account "Marco Rubiol-acc",
-- invited to MaMeMi + Avi + Kairos + Fulana accounts via their respective
-- workspaces).
--
-- Phase 0 has 3 accounts after this migration (one per existing workspace).
-- The handle_new_user trigger is updated so future signups get a complete
-- billing-ready tenant tree (account → account_membership → workspace →
-- workspace_membership) from day one.
--
-- No audit trigger on account / account_membership yet — write_audit
-- expects workspace_id and the account layer has none. Account-level
-- audit comes when admin UI surfaces it (Phase 1).

-- 1) Enums
CREATE TYPE public.account_kind AS ENUM ('personal', 'team');
CREATE TYPE public.account_role AS ENUM ('owner', 'admin');

-- 2) account table
CREATE TABLE public.account (
  id              uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  slug            text NOT NULL,
  previous_slugs  text[] NOT NULL DEFAULT '{}',
  name            text NOT NULL,
  kind            public.account_kind NOT NULL DEFAULT 'personal',
  billing_email   text,
  country         text,
  timezone        text NOT NULL DEFAULT 'Europe/Madrid',
  settings        jsonb NOT NULL DEFAULT '{}',
  custom_fields   jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE UNIQUE INDEX account_slug_uidx ON public.account (slug) WHERE deleted_at IS NULL;

CREATE TRIGGER account_set_updated_at BEFORE UPDATE ON public.account
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER account_slug_validate BEFORE INSERT OR UPDATE ON public.account
  FOR EACH ROW EXECUTE FUNCTION public.validate_slug();

ALTER TABLE public.account ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account FORCE ROW LEVEL SECURITY;

-- 3) account_membership table
CREATE TABLE public.account_membership (
  account_id      uuid NOT NULL REFERENCES public.account(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role            public.account_role NOT NULL DEFAULT 'admin',
  invited_at      timestamptz NOT NULL DEFAULT now(),
  accepted_at     timestamptz,
  revoked_at      timestamptz,
  PRIMARY KEY (account_id, user_id)
);

CREATE INDEX account_membership_user_id_idx ON public.account_membership(user_id);

ALTER TABLE public.account_membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_membership FORCE ROW LEVEL SECURITY;

-- 4) Initial accounts for the 3 existing workspaces + memberships.
DO $$
DECLARE
  marco_id            uuid := 'fcdc82df-58df-4917-860c-8e3af03900f3';
  playwright_id       uuid := '65419d0a-68aa-468e-8c76-2ad00670d327';
  marco_account_id    uuid;
  mamemi_account_id   uuid;
  pw_account_id       uuid;
BEGIN
  INSERT INTO public.account (slug, name, kind, country, timezone)
  VALUES ('marco-rubiol-acc', 'Marco Rubiol', 'personal', 'ES', 'Europe/Madrid')
  RETURNING id INTO marco_account_id;
  INSERT INTO public.account_membership (account_id, user_id, role, accepted_at)
  VALUES (marco_account_id, marco_id, 'owner', now());

  INSERT INTO public.account (slug, name, kind, country, timezone)
  VALUES ('mamemi-acc', 'MaMeMi', 'team', 'ES', 'Europe/Madrid')
  RETURNING id INTO mamemi_account_id;
  INSERT INTO public.account_membership (account_id, user_id, role, accepted_at)
  VALUES (mamemi_account_id, marco_id, 'owner', now());

  INSERT INTO public.account (slug, name, kind, country, timezone)
  VALUES ('playwright-acc', 'Playwright', 'personal', 'ES', 'Europe/Madrid')
  RETURNING id INTO pw_account_id;
  INSERT INTO public.account_membership (account_id, user_id, role, accepted_at)
  VALUES (pw_account_id, playwright_id, 'owner', now());

  -- 5) Add workspace.account_id (nullable for backfill).
  ALTER TABLE public.workspace ADD COLUMN account_id uuid REFERENCES public.account(id);

  -- 6) Backfill.
  UPDATE public.workspace SET account_id = marco_account_id  WHERE slug = 'marco-rubiol';
  UPDATE public.workspace SET account_id = mamemi_account_id WHERE slug = 'mamemi';
  UPDATE public.workspace SET account_id = pw_account_id     WHERE slug = 'playwright';
END $$;

-- 7) Lock NOT NULL.
ALTER TABLE public.workspace ALTER COLUMN account_id SET NOT NULL;

-- 8) RLS on account.
CREATE POLICY account_select ON public.account FOR SELECT TO authenticated
USING (
  deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM public.account_membership am
    WHERE am.account_id = account.id
      AND am.user_id = auth.uid()
      AND am.accepted_at IS NOT NULL
      AND am.revoked_at IS NULL
  )
);

CREATE POLICY account_insert ON public.account FOR INSERT TO authenticated
WITH CHECK (true);

CREATE POLICY account_update ON public.account FOR UPDATE TO authenticated
USING (
  deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM public.account_membership am
    WHERE am.account_id = account.id
      AND am.user_id = auth.uid()
      AND am.role = 'owner'
      AND am.accepted_at IS NOT NULL
      AND am.revoked_at IS NULL
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.account_membership am
    WHERE am.account_id = account.id
      AND am.user_id = auth.uid()
      AND am.role = 'owner'
      AND am.accepted_at IS NOT NULL
      AND am.revoked_at IS NULL
  )
);

-- 9) RLS on account_membership.
CREATE POLICY account_membership_select ON public.account_membership FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.account_membership am2
    WHERE am2.account_id = account_membership.account_id
      AND am2.user_id = auth.uid()
      AND am2.role IN ('owner', 'admin')
      AND am2.accepted_at IS NOT NULL
      AND am2.revoked_at IS NULL
  )
);

CREATE POLICY account_membership_insert ON public.account_membership FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.account_membership am
    WHERE am.account_id = account_membership.account_id
      AND am.user_id = auth.uid()
      AND am.role IN ('owner', 'admin')
      AND am.accepted_at IS NOT NULL
      AND am.revoked_at IS NULL
  )
  OR (
    user_id = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM public.account_membership am2
      WHERE am2.account_id = account_membership.account_id
    )
  )
);

CREATE POLICY account_membership_update ON public.account_membership FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.account_membership am
    WHERE am.account_id = account_membership.account_id
      AND am.user_id = auth.uid()
      AND am.role IN ('owner', 'admin')
      AND am.accepted_at IS NOT NULL
      AND am.revoked_at IS NULL
  )
);

CREATE POLICY account_membership_delete ON public.account_membership FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.account_membership am
    WHERE am.account_id = account_membership.account_id
      AND am.user_id = auth.uid()
      AND am.role = 'owner'
      AND am.accepted_at IS NOT NULL
      AND am.revoked_at IS NULL
  )
);

-- 10) handle_new_user trigger: create account + account_membership BEFORE
--     the personal workspace. Future signups inherit the 3-layer tree.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_full_name     text;
  v_slug          text;
  v_account_slug  text;
  v_account_id    uuid;
  v_workspace_id  uuid;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1));

  INSERT INTO public.user_profile (user_id, full_name, locale)
  VALUES (NEW.id, v_full_name, COALESCE(NEW.raw_user_meta_data ->> 'locale', 'es'))
  ON CONFLICT (user_id) DO NOTHING;

  v_slug := regexp_replace(lower(split_part(NEW.email, '@', 1)), '[^a-z0-9-]+', '-', 'g');
  IF v_slug IS NULL OR v_slug = '' OR v_slug = '-' THEN
    v_slug := 'user-' || substr(NEW.id::text, 1, 8);
  END IF;
  WHILE EXISTS (SELECT 1 FROM public.workspace WHERE slug = v_slug AND deleted_at IS NULL) LOOP
    v_slug := v_slug || '-' || substr(gen_random_uuid()::text, 1, 4);
  END LOOP;

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
$function$;
