-- Rollback de 20261120030000_desk_set_aside («Ahora no» en «Te espera», ADR-231).
-- Borra la RPC y la tabla. Lo que se pierde: lo que cada persona tenía
-- apartado; esas filas vuelven a «Te espera». El Worker aguanta sin la tabla
-- (la lectura falla en silencio y no se aparta nada), así que no hace falta
-- desplegar antes.

BEGIN;

DROP FUNCTION IF EXISTS public.set_aside_desk_item(text, date);
DROP POLICY IF EXISTS desk_set_aside_select_self ON public.desk_set_aside;
DROP TABLE IF EXISTS public.desk_set_aside;

COMMIT;
