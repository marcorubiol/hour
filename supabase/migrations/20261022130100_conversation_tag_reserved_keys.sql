-- `all` y `team` no pueden ser claves de etiqueta de conversación.
--
-- Son los dos chips fijos de la lente (`ALL`, `TEAM` en
-- `apps/web/src/lib/conversation-tags.ts`, `RESERVED_TAG_KEYS`). La ruta de
-- ajustes ya los rechaza (400 reserved), pero el admin tiene INSERT directo
-- por grant de columnas en `conversation_tag`: la base lo cierra también.
-- Marco lo aprobó el 2026-10-22.
--
-- Producción, en solo lectura el 2026-10-22: 7 filas en `conversation_tag`,
-- ninguna con clave `all` ni `team`. La restricción entra validada.
-- Una clave no cambia (`guard_conversation_tag_key`), así que basta con mirar
-- el INSERT.
-- Rollback: build/runbooks/rollback-20261022130100-conversation-tag-reserved-keys.sql.

ALTER TABLE public.conversation_tag
  ADD CONSTRAINT conversation_tag_key_not_reserved CHECK (key NOT IN ('all', 'team'));
