-- Rollback de 20261020100000_conversation_relation (ADR-138, fase E1).
-- Desplegar antes el Worker que no lee la relación ni los bolos.
-- `conversation.status` no se tocó: el estado viejo sigue ahí entero, y
-- `custom_fields.legacy_status` es una copia que se puede quitar sin pérdida.
-- Se pierde lo marcado como «no esta vez» después de la migración.

BEGIN;
DROP FUNCTION public.conversation_bolos(uuid);
DROP FUNCTION public.conversations_bolos(uuid[]);
DROP FUNCTION public.conversation_regular(public.conversation);
DROP FUNCTION public.conversation_relation(public.conversation);
DROP FUNCTION private.conversation_relation_for(uuid, uuid);
DROP FUNCTION private.organization_is_regular(uuid, uuid, date);
DROP FUNCTION private.relation_of(timestamptz, date, timestamptz, timestamptz, boolean, boolean, boolean, date);
REVOKE UPDATE (not_now_at, not_now_until) ON TABLE public.conversation FROM authenticated;
ALTER TABLE public.conversation
  DROP CONSTRAINT conversation_not_now_until_check,
  DROP COLUMN not_now_at,
  DROP COLUMN not_now_until,
  DROP COLUMN contacted_undated;
UPDATE public.conversation SET custom_fields = custom_fields - 'legacy_status'
WHERE custom_fields ? 'legacy_status';
COMMIT;
