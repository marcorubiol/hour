-- Migration: workspace_domain_city_logo
-- ADR-062 — universal space-identity fields (thought "in global" against the
-- 8 archetypes). Three columns, all nullable, additive:
--
--   domain (workspace_domain enum): the discipline of the entity. It DRIVES
--     per-archetype vocabulary + default project types (music → holds /
--     difusión; theatre → carta de interés / distribución), so it is an
--     opinionated enum, not free text. The mockup kicker "Theatre company"
--     is this field. NULL = unset → UI falls back to the kind label.
--   city (text ≤120): human home base ("Barcelona"), complements the char(2)
--     country + timezone. The mockup kicker "· Barcelona" is this field.
--   logo_url (text ≤2048): company/act mark (R2 URL). The upload flow ships
--     with the space-edit flow; the column is ready now.
--
-- All NULL for the existing workspaces; consumers must handle NULL (domain →
-- kind label, city hidden, logo hidden). Fiscal identity (legal name, tax id,
-- currency, regime) is deferred to the Money module (Phase 1) — it will land
-- on this same table.
--
-- Reversible:
--   ALTER TABLE public.workspace DROP COLUMN domain, DROP COLUMN city, DROP COLUMN logo_url;
--   DROP TYPE workspace_domain;
--
-- Applied via Supabase MCP apply_migration 2026-07-14 (name:
-- workspace_domain_city_logo). This file is the canonical record.

CREATE TYPE workspace_domain AS ENUM ('theatre', 'dance', 'circus', 'music', 'mixed', 'other');

ALTER TABLE public.workspace
  ADD COLUMN domain   workspace_domain,
  ADD COLUMN city     text CHECK (city IS NULL OR length(city) <= 120),
  ADD COLUMN logo_url text CHECK (logo_url IS NULL OR length(logo_url) <= 2048);

COMMENT ON COLUMN public.workspace.domain IS
  'Discipline of the entity (ADR-062) — drives per-archetype vocabulary + default project types. NULL = unset (UI falls back to kind label).';
COMMENT ON COLUMN public.workspace.city IS
  'Human home base ("Barcelona") — complements country (char2) + timezone. Surfaced on the space portada kicker.';
COMMENT ON COLUMN public.workspace.logo_url IS
  'Company/act logo (R2 URL). Upload flow ships with the space-edit flow; column ready now.';
