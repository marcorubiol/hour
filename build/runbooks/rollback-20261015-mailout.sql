-- ROLLBACK for 20261015100000_mailout.sql (ADR-109, ADR-110, ADR-112)
--
-- What it undoes: every function, table and enum of the bulk send (mailout),
-- the five new workspace columns, and it gives `authenticated` back the
-- table-wide UPDATE on workspace that it had before (anon included, as before).
--
-- What it destroys, on purpose: sending domains, mailouts, their recipients
-- and delivery events, the suppression list and the per-address basis. Take
-- the backup first (production-migrate.yml / backup.yml): the suppression list
-- and the basis are the legal record of who unsubscribed and why an address
-- could be written to (ADR-110 § 2), and they cannot be rebuilt.
--
-- What it does not undo: the conversation_event rows the mailouts wrote (the
-- emails sent and the unsubscribe notes). They are ordinary history of each
-- conversation and the schema already knew how to hold them.
--
-- Symptom that would call for it: none of the deployed code reads this until
-- the phase 2 Worker is live. If it is, roll the Worker back first.

BEGIN;

DROP FUNCTION IF EXISTS public.mailout_record_event(jsonb);
DROP FUNCTION IF EXISTS public.mailout_record_failure(uuid, text, timestamptz);
DROP FUNCTION IF EXISTS public.mailout_record_sent(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.mailout_claim(integer, uuid);
DROP FUNCTION IF EXISTS public.mailout_approve_review(uuid, uuid);
DROP FUNCTION IF EXISTS public.mail_domain_record_status(uuid, text, text, jsonb, text, text);
DROP FUNCTION IF EXISTS public.mailout_resubscribe(text);
DROP FUNCTION IF EXISTS public.mailout_unsubscribe(text);
DROP FUNCTION IF EXISTS public.remove_mail_suppression(uuid, text);
DROP FUNCTION IF EXISTS public.suppress_mail_address(uuid, text);
DROP FUNCTION IF EXISTS public.withdraw_mail_basis(uuid, text);
DROP FUNCTION IF EXISTS public.set_mail_basis(uuid, text, public.mail_basis_kind, text, uuid);
DROP FUNCTION IF EXISTS public.cancel_mailout(uuid);
DROP FUNCTION IF EXISTS public.queue_mailout(uuid);
DROP FUNCTION IF EXISTS public.mailout_test_authorize(uuid);
DROP FUNCTION IF EXISTS public.mailout_preview(uuid);
DROP FUNCTION IF EXISTS public.set_mailout_recipients(uuid, uuid[]);
DROP FUNCTION IF EXISTS public.update_mailout(uuid, text, text, text, text, text, uuid, uuid);
DROP FUNCTION IF EXISTS public.create_mailout(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.remove_mail_domain(uuid);
DROP FUNCTION IF EXISTS public.add_mail_domain(uuid, text, public.mail_sending_provider);
DROP FUNCTION IF EXISTS private.mailout_record_note(public.mailout_recipient, text);
DROP FUNCTION IF EXISTS private.mailout_record_conversation_event(public.mailout_recipient, text);
DROP FUNCTION IF EXISTS private.mailout_maybe_finish(uuid);
DROP FUNCTION IF EXISTS private.mail_address_kind_for_caller(uuid, extensions.citext);
DROP FUNCTION IF EXISTS private.mailout_for_caller(uuid, boolean);

DROP TABLE IF EXISTS public.mail_basis;
DROP TABLE IF EXISTS public.mail_suppression;
DROP TABLE IF EXISTS public.mailout_event;
DROP TABLE IF EXISTS public.mailout_recipient;
DROP TABLE IF EXISTS public.mailout;
DROP TABLE IF EXISTS public.mail_domain;

DROP TYPE IF EXISTS public.mail_basis_kind;
DROP TYPE IF EXISTS public.mail_suppression_reason;
DROP TYPE IF EXISTS public.mailout_event_type;
DROP TYPE IF EXISTS public.mailout_address_kind;
DROP TYPE IF EXISTS public.mailout_skip_reason;
DROP TYPE IF EXISTS public.mailout_recipient_status;
DROP TYPE IF EXISTS public.mailout_status;
DROP TYPE IF EXISTS public.mail_sending_provider;

DROP INDEX IF EXISTS public.workspace_mailout_reviewed_by_idx;
ALTER TABLE public.workspace
  DROP CONSTRAINT IF EXISTS workspace_privacy_url_check,
  DROP CONSTRAINT IF EXISTS workspace_mailout_daily_cap_check,
  DROP COLUMN IF EXISTS privacy_url,
  DROP COLUMN IF EXISTS mailout_simulator_only,
  DROP COLUMN IF EXISTS mailout_daily_cap,
  DROP COLUMN IF EXISTS mailout_reviewed_at,
  DROP COLUMN IF EXISTS mailout_reviewed_by;

-- UPDATE on workspace as before: table-wide (the workspace_update policy
-- keeps it to admins).
GRANT UPDATE ON TABLE public.workspace TO anon, authenticated;

COMMIT;
