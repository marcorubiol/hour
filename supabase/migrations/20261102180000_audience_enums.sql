-- ADR-173 y ADR-174 · El público, fase 1: los valores nuevos de dos enums.
-- Van solos en su migración: un valor añadido a un enum no se puede usar en la
-- misma transacción que lo añade (20261102180100_audience usa `subscriber`).
--   · `mailout_address_kind.subscriber`: un destinatario del público.
--   · `mail_basis_kind.sector` (ADR-174): «contacto profesional del sector», la
--     cuarta base para escribir a un profesional. La declara quien envía; la
--     puerta del envío y de la rama profesional de una invitación la acepta
--     como las otras tres (miran que haya base vigente, no cuál).
-- Rollback: build/runbooks/rollback-20261102-audience.sql (un valor de enum no
-- se quita; se dejan).

ALTER TYPE public.mailout_address_kind ADD VALUE IF NOT EXISTS 'subscriber';
ALTER TYPE public.mail_basis_kind ADD VALUE IF NOT EXISTS 'sector';
