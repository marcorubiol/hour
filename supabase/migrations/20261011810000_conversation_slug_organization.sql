-- ADR-102, añadido, punto 7 (fase 2 del plan): el slug de una conversación es
-- el de su organización; el anterior pasa a `previous_slugs` y sigue
-- resolviendo (GET /api/conversations/[slug] mira también ahí).
--
-- REESCRIBE DATOS: el slug de las conversaciones vivas con organización cuyo
-- slug no es ya el de la organización (en producción, 36 de 181 el
-- 2026-10-11, solo SELECT). No cambia nada más; `updated_at` no se toca (no es
-- una edición de nadie) y la auditoría sí lo apunta. Gate: `inspect` y backup
-- antes del apply.
--
-- Va aparte de 20261011800000 para poder aplicar la parte aditiva sin esta.
-- Depende de `conversation_free_slug`, que crea aquella.
-- Rollback: build/runbooks/rollback-20261011-conversation-slug-organization.sql
-- (devuelve el último de `previous_slugs`, que hoy está vacío en todas).

ALTER TABLE public.conversation DISABLE TRIGGER conversation_set_updated_at;

DO $$
DECLARE
  r      record;
  v_slug text;
  v_n    integer := 0;
BEGIN
  FOR r IN
    SELECT c.id, c.workspace_id, c.slug, c.previous_slugs, o.slug AS org_slug
    FROM public.conversation c
    JOIN public.workspace_organization o
      ON o.workspace_id = c.workspace_id AND o.id = c.organization_id
    WHERE c.deleted_at IS NULL
    ORDER BY c.created_at, c.id
  LOOP
    v_slug := public.conversation_free_slug(r.workspace_id, r.org_slug, r.id);
    CONTINUE WHEN v_slug = r.slug;
    UPDATE public.conversation
    SET slug = v_slug,
        previous_slugs = CASE WHEN r.slug = ANY (r.previous_slugs) THEN r.previous_slugs
                              ELSE r.previous_slugs || r.slug END
    WHERE id = r.id;
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'conversation slugs moved to their organization: %', v_n;
END
$$;

ALTER TABLE public.conversation ENABLE TRIGGER conversation_set_updated_at;
