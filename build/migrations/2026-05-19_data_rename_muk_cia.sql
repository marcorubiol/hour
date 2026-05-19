-- Migration: data_rename_muk_cia (data-only, no DDL)
-- Date: 2026-05-19
-- Context: naming gate vivido (sesión 2026-05-19). Decisión:
--   - El nombre real de la compañía es "MüK Cia" (no "MaMeMi").
--   - "MaMeMi" es UN espectáculo (producción) de MüK Cia, no la compañía.
--   - "Difusión 2026-27" no es el project — es una line (campaign) dentro
--     del project MaMeMi.
-- Aplicado vía Supabase MCP execute_sql (data UPDATE + INSERT). Este
-- archivo es el registro canónico.

BEGIN;

-- 1) Rename account mamemi-acc → muk-cia-acc
UPDATE account
SET slug = 'muk-cia-acc',
    name = 'MüK Cia',
    previous_slugs = array_append(previous_slugs, 'mamemi-acc'),
    updated_at = now()
WHERE slug = 'mamemi-acc';

-- 2) Rename workspace mamemi → muk-cia
UPDATE workspace
SET slug = 'muk-cia',
    name = 'MüK Cia',
    previous_slugs = array_append(previous_slugs, 'mamemi'),
    updated_at = now()
WHERE slug = 'mamemi';

-- 3) Project display rename "Difusión 2026-27" → "MaMeMi"
--    Slug stays `mamemi` — that's the production's natural slug.
--    The previous display "Difusión 2026-27" was a misnomer — it was a
--    campaign label conflated with the project itself.
UPDATE project
SET name = 'MaMeMi',
    updated_at = now()
WHERE slug = 'mamemi'
  AND workspace_id = (SELECT id FROM workspace WHERE slug = 'muk-cia');

-- 4) Create line "Difusión 2026-27" (kind=campaign) inside MaMeMi project.
--    154 engagements stay attached to project MaMeMi (their semantic
--    target = the production we're selling). The line is the operational
--    frame; engagements don't reference line_id directly.
INSERT INTO line (workspace_id, project_id, name, slug, kind, status, custom_fields, notes)
SELECT
  p.workspace_id,
  p.id,
  'Difusión 2026-27',
  'difusion-2026-27',
  'campaign'::line_kind,
  'open'::line_status,
  '{"season": "2026-27"}'::jsonb,
  'Campaña de difusión 2026-27. 154 engagements activos atados al project MaMeMi.'
FROM project p
WHERE p.slug = 'mamemi'
  AND p.workspace_id = (SELECT id FROM workspace WHERE slug = 'muk-cia');

COMMIT;
