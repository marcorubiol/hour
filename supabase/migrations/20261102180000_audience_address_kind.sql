-- ADR-173 · El público, fase 1: el valor nuevo del tipo de dirección.
-- Va solo en su migración: un valor añadido a un enum no se puede usar en la
-- misma transacción que lo añade (20261102180100_audience lo usa).
-- Rollback: build/runbooks/rollback-20261102-audience.sql (un valor de enum no
-- se quita; se deja).

ALTER TYPE public.mailout_address_kind ADD VALUE IF NOT EXISTS 'subscriber';
