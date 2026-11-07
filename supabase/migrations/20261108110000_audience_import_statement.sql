-- 105 · ADR-191: la declaración de una importación del público, más firme.
--
-- Antes, `import_audience` no sabía si quien importaba había aceptado la
-- declaración: la casilla vivía sólo en la pantalla y en el endpoint, y una
-- llamada directa a la RPC importaba sin ella. La declaración de clientes
-- (`relationship`) decía sólo «Han sido clientes de X», sin «puedo demostrarlo»
-- y sin decir que el trato fue directo (plan § 3.6: si vendió la sala o una
-- ticketera, la excepción de LSSI 21.2 probablemente no aplica).
--
--   · `audience_import.statement_version`: la versión del texto aceptado. Las
--     filas de antes quedan en 1; las nuevas, 2. Quién y cuándo ya estaban
--     (`declared_by`, `declared_at`), y el texto exacto (`statement_text`).
--   · `import_audience` pide `p_statement_accepted = true` para las dos bases y
--     guarda la versión 2. El texto de clientes dice ahora que compraron o
--     contrataron directamente a la compañía y «puedo demostrarlo».
--
-- Firma nueva (un parámetro más, al final, con DEFAULT false): se borra la
-- vieja antes de crear la nueva, para no dejar una sobrecarga (PostgREST
-- respondería 300). El cuerpo es el vivo (`pg_get_functiondef`, 2026-11-07),
-- con sólo esos cambios. Rollback: build/runbooks/rollback-20261108-audience-import-statement.sql.

ALTER TABLE public.audience_import
  ADD COLUMN statement_version smallint NOT NULL DEFAULT 1,
  ADD CONSTRAINT audience_import_statement_version_check CHECK (statement_version BETWEEN 1 AND 2);

COMMENT ON COLUMN public.audience_import.statement_version IS
  '105 · ADR-191: version of the statement text the importer accepted. 1: before 2026-11-08 (acceptance checked only by the app; customers text without «I can prove it»). 2: acceptance required by import_audience; customers text says direct relationship and «I can prove it».';

DROP FUNCTION public.import_audience(uuid, text, jsonb, public.mail_basis_kind, text, text);

CREATE FUNCTION public.import_audience(
  p_audience_id        uuid,
  p_filename           text,
  p_rows               jsonb,
  p_basis_kind         public.mail_basis_kind,
  p_source_note        text,
  p_statement_language text DEFAULT 'es',
  p_statement_accepted boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_a         public.audience := private.audience_for_caller(p_audience_id, true);
  v_note      text := nullif(btrim(coalesce(p_source_note, '')), '');
  v_lang      text := coalesce(p_statement_language, 'es');
  v_company   text;
  v_statement text;
  v_import    public.audience_import;
  v_skipped   jsonb;
  v_rows      integer;
  v_imported  integer;
BEGIN
  IF p_basis_kind IS NULL OR p_basis_kind NOT IN ('consent', 'relationship') THEN
    RAISE EXCEPTION 'an import needs a basis: consent or relationship' USING ERRCODE = '22023';
  END IF;
  -- La declaración la acepta quien importa, y lo dice la base, no sólo la
  -- pantalla (105, ADR-191): sin ella no entra nada, con ninguna de las dos bases.
  IF p_statement_accepted IS NOT TRUE THEN
    RAISE EXCEPTION 'an import needs the statement accepted: I can prove it' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NULL OR length(v_note) NOT BETWEEN 10 AND 1000 THEN
    RAISE EXCEPTION 'an import needs its source in writing (10 to 1000 characters)' USING ERRCODE = '22023';
  END IF;
  IF v_lang NOT IN ('es', 'ca', 'en', 'fr') THEN
    RAISE EXCEPTION 'statement language must be es, ca, en or fr' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'rows must be a non-empty array' USING ERRCODE = '22023';
  END IF;
  v_rows := jsonb_array_length(p_rows);
  IF v_rows > 5000 THEN
    RAISE EXCEPTION 'at most 5000 rows per import' USING ERRCODE = '22023';
  END IF;
  IF v_a.status = 'archived' THEN
    RAISE EXCEPTION 'this list is archived' USING ERRCODE = '22023';
  END IF;

  -- La declaración exacta que se acepta, en su idioma (plan § 6.2), versión 2.
  SELECT w.name INTO v_company FROM public.workspace w WHERE w.id = v_a.workspace_id;
  v_statement := CASE p_basis_kind
    WHEN 'consent' THEN CASE v_lang
      WHEN 'ca' THEN 'Van acceptar rebre comunicacions de ' || v_company || '. Puc demostrar que aquestes persones ho van acceptar.'
      WHEN 'en' THEN 'They agreed to receive messages from ' || v_company || '. I can prove these people agreed to it.'
      WHEN 'fr' THEN 'Ils ont accepté de recevoir des messages de ' || v_company || '. Je peux prouver que ces personnes l''ont accepté.'
      ELSE 'Aceptaron recibir comunicaciones de ' || v_company || '. Puedo demostrar que estas personas lo aceptaron.' END
    ELSE CASE v_lang
      WHEN 'ca' THEN 'Han estat clients de ' || v_company || ': van comprar o contractar directament a ' || v_company || ', no a una sala ni a una ticketera. Puc demostrar que aquestes persones han estat clients de ' || v_company || '.'
      WHEN 'en' THEN 'They have been customers of ' || v_company || ': they bought or hired directly from ' || v_company || ', not from a venue or a ticketing service. I can prove these people have been customers of ' || v_company || '.'
      WHEN 'fr' THEN 'Ils ont été clients de ' || v_company || ' : ils ont acheté ou engagé directement auprès de ' || v_company || ', pas auprès d''une salle ni d''une billetterie. Je peux prouver que ces personnes ont été clientes de ' || v_company || '.'
      ELSE 'Han sido clientes de ' || v_company || ': compraron o contrataron directamente a ' || v_company || ', no a una sala ni a una ticketera. Puedo demostrar que estas personas han sido clientes de ' || v_company || '.' END
  END;

  INSERT INTO public.audience_import (
    workspace_id, audience_id, filename, basis_kind, source_note, statement_text, statement_language,
    statement_version, declared_by, row_count, status
  ) VALUES (
    v_a.workspace_id, v_a.id, left(nullif(btrim(coalesce(p_filename, '')), ''), 255), p_basis_kind, v_note,
    v_statement, v_lang, 2, auth.uid(), v_rows,
    CASE WHEN EXISTS (SELECT 1 FROM public.audience_import i
                      WHERE i.workspace_id = v_a.workspace_id AND i.status = 'done')
         THEN 'done' ELSE 'review' END::public.audience_import_status
  ) RETURNING * INTO v_import;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.audience_import_rows (
    ord bigint, address text, name text, language text, skip text
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.audience_import_rows;
  INSERT INTO pg_temp.audience_import_rows
  SELECT x.ord, x.address, x.name, x.language,
         CASE
           WHEN x.address IS NULL OR x.address !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(x.address) > 254 THEN 'invalid'
           WHEN row_number() OVER (PARTITION BY x.address ORDER BY x.ord) > 1 THEN 'duplicate'
           WHEN EXISTS (SELECT 1 FROM public.mail_suppression s
                        WHERE s.workspace_id = v_a.workspace_id AND s.address = x.address::extensions.citext) THEN 'suppressed'
           WHEN EXISTS (SELECT 1 FROM public.audience_subscription s
                        WHERE s.audience_id = v_a.id AND s.address = x.address::extensions.citext
                          AND s.status = 'unsubscribed') THEN 'unsubscribed'
           WHEN EXISTS (SELECT 1 FROM public.audience_subscription s
                        WHERE s.audience_id = v_a.id AND s.address = x.address::extensions.citext) THEN 'existing'
         END
  FROM (
    SELECT t.ord,
           lower(nullif(btrim(t.r ->> 'email'), '')) AS address,
           left(nullif(btrim(t.r ->> 'name'), ''), 200) AS name,
           lower(nullif(btrim(t.r ->> 'language'), '')) AS language
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS t(r, ord)
  ) x;

  SELECT coalesce(jsonb_object_agg(k.skip, k.n), '{}'::jsonb) INTO v_skipped
  FROM (SELECT skip, count(*) AS n FROM pg_temp.audience_import_rows WHERE skip IS NOT NULL GROUP BY skip) k;

  WITH ins AS (
    INSERT INTO public.audience_subscription (
      workspace_id, audience_id, address, name, language, status, basis_kind, source, import_id, confirmed_at
    )
    SELECT v_a.workspace_id, v_a.id, x.address::extensions.citext, x.name,
           CASE WHEN x.language = ANY (v_a.languages) THEN x.language ELSE v_a.default_language END,
           'confirmed', p_basis_kind, 'import', v_import.id, now()
    FROM pg_temp.audience_import_rows x
    WHERE x.skip IS NULL
    ORDER BY x.ord
    ON CONFLICT (audience_id, address) DO NOTHING
    RETURNING id
  ), ev AS (
    INSERT INTO public.audience_consent_event (workspace_id, subscription_id, kind, channel, actor_user_id, import_id)
    SELECT v_a.workspace_id, ins.id, 'imported', 'import', auth.uid(), v_import.id FROM ins
    RETURNING 1
  )
  SELECT count(*) INTO v_imported FROM ev;

  UPDATE public.audience_import
  SET imported_count = v_imported, skipped = v_skipped
  WHERE id = v_import.id
  RETURNING * INTO v_import;

  RETURN jsonb_build_object(
    'import_id', v_import.id, 'status', v_import.status, 'row_count', v_import.row_count,
    'imported_count', v_import.imported_count, 'skipped', v_import.skipped
  );
END;
$$;

REVOKE ALL ON FUNCTION public.import_audience(uuid, text, jsonb, public.mail_basis_kind, text, text, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.import_audience(uuid, text, jsonb, public.mail_basis_kind, text, text, boolean) TO authenticated;
