# SQL folded into the 2026-07-20 baseline

These five migrations were applied to production before Hour gained a
reconstructive Supabase baseline. Their final schema state is included in
`supabase/migrations/20260720105713_remote_schema_checkpoint.sql`.

The version marker files remain in `supabase/migrations/` because production
already records those versions as applied. Keeping the markers avoids lying to
the Supabase migration-history comparison; keeping the original SQL here
preserves the audit trail without replaying it over the final-state baseline.

Do not run these archived files as migrations. New schema changes belong in a
new timestamped file under `supabase/migrations/` and must pass a clean local
`supabase db reset` before deployment.
