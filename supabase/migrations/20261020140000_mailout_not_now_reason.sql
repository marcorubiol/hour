-- ADR-138 § 3: «no esta vez» saca la conversación de los envíos mientras dura.
-- El motivo nuevo va solo en su migración: un valor añadido a un enum no se
-- puede usar en la misma transacción que lo añade (20261020140100 lo usa).

ALTER TYPE public.mailout_skip_reason ADD VALUE IF NOT EXISTS 'not_now';
