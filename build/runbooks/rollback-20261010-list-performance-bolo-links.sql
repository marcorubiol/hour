-- Rollback de 20261010140000_list_performance_bolo_links.sql.
-- Solo lectura y aditiva: retirarla no toca datos. La ficha de función deja de
-- ofrecer el selector de bolo (el endpoint responde 5xx y la pantalla lo calla).
DROP FUNCTION IF EXISTS public.list_performance_bolo_links(uuid[]);
