-- Rollback de 20261020150000_help_seen (ayuda contextual, enfoque A).
-- Borra las dos RPC y la tabla. Lo que se pierde: qué tarjetas y avisos ha
-- visto cada persona; vuelven a salir todos una vez. Antes de aplicarlo,
-- desplegar un Worker que no lea `help_seen` ni llame a `/api/me/help`.

BEGIN;

DROP FUNCTION IF EXISTS public.reset_help_seen();
DROP FUNCTION IF EXISTS public.mark_help_seen(text);
DROP POLICY IF EXISTS help_seen_select_self ON public.help_seen;
DROP TABLE IF EXISTS public.help_seen;

COMMIT;
