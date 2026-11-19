-- Rollback de 20261119120000_performance_preparation: borra
-- `set_performance_preparation`. No toca datos: lo marcado a mano queda en
-- `performance.custom_fields.preparation` y nadie lo lee. Para limpiarlo:
-- UPDATE public.performance SET custom_fields = custom_fields - 'preparation';

BEGIN;

DROP FUNCTION IF EXISTS public.set_performance_preparation(uuid, text, text);

COMMIT;
