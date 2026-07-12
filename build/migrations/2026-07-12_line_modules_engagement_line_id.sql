-- ADR-056: line detail = module composition. Model changes (the only ones):
--
-- (1) line.modules — ordered jsonb array of module keys; NULL = defaults by
--     kind (app-side mapping in $lib/line-templates.ts). A module is a
--     line-scoped view of an existing entity/lens — never a new data silo.
-- (2) engagement.line_id — the operational frame of a conversation (a
--     difusión campaign IS a line). Nullable; same-project invariant is
--     enforced by create_engagement + the PATCH guard (pattern ADR-043),
--     mirroring performance.line_id — not by composite FK, for consistency
--     with the sibling column.
-- (3) Backfill: the season-2026-27 engagements of MaMeMi → line
--     difusion-2026-27. custom_fields.season stays as metadata.
--
-- Applied 2026-07-12 via Supabase MCP apply_migration
-- (name: line_modules_engagement_line_id). This file is the canonical record.

ALTER TABLE public.line
  ADD COLUMN modules jsonb
  CHECK (modules IS NULL OR jsonb_typeof(modules) = 'array');

COMMENT ON COLUMN public.line.modules IS
  'ADR-056: ordered array of module keys (calendar, contacts, roadsheets, notes, materials, money, people). NULL = defaults by kind. Modules are line-scoped views of existing entities, never their own data.';

ALTER TABLE public.engagement
  ADD COLUMN line_id uuid REFERENCES public.line(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.engagement.line_id IS
  'ADR-056: optional operational frame — the line this conversation belongs to (e.g. a difusión campaign). Must belong to the same project; enforced by create_engagement and the PATCH cross-project guard, like performance.line_id.';

-- Module queries filter engagements by line; the FK alone is not indexed.
CREATE INDEX engagement_line_idx ON public.engagement (line_id)
  WHERE deleted_at IS NULL AND line_id IS NOT NULL;

-- ── Backfill: the real campaign ─────────────────────────────────────────
-- Joining on l.project_id keeps this correct even if another workspace ever
-- reuses the slug (line slugs are unique per workspace, not globally).
UPDATE public.engagement e
SET line_id = l.id
FROM public.line l
WHERE l.slug = 'difusion-2026-27'
  AND l.deleted_at IS NULL
  AND e.project_id = l.project_id
  AND e.deleted_at IS NULL
  AND e.custom_fields->>'season' = '2026-27'
  AND e.line_id IS NULL;
