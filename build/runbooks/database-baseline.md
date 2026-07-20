# Hour — reproducible database baseline

## Contract

`supabase/migrations/` is the executable database history. A clean checkout
must be able to reconstruct the current `public` schema with:

```bash
pnpm install
pnpm db:start
pnpm db:reset
```

The CLI is pinned to `2.109.1` in the root package. Local Postgres is pinned to
major version 17 in `supabase/config.toml`, matching the hosted project.

The local stack is development-only. It binds default credentials and must not
be exposed to external traffic.

## Baseline layout

- `20260720105713_remote_schema_checkpoint.sql` is the reconstructive,
  schema-only baseline generated from production on 2026-07-20.
- The next five migration files are version markers. Production already
  records those exact versions as applied, while their final state is folded
  into the baseline.
- The legacy pre-checkpoint history is folded at the migration-ledger level by
  the guarded `repair-baseline-history` mode in
  `.github/workflows/production-migrate.yml`. The mode first proves the
  checkpoint itself is applied, then marks only versions older than
  `20260720105713` as reverted. It does not execute or undo schema SQL.
- `20260720164803_harden_data_api_defaults.sql` explicitly narrows the hosted
  Data API grants and revokes broad default privileges for future public
  tables, sequences and functions.
- Their original SQL remains under
  `build/migrations/squashed-20260720/` for audit. It is not executable history.
- `supabase/seed.sql` is intentionally empty. Production people, Auth users,
  contact data and secrets must never be copied into a committed seed.

New changes always use a new timestamped SQL file in `supabase/migrations/`.
Never edit the baseline for normal product work.

## Provenance and verification

The source schema was produced by GitHub Actions run `29754532658` from a
fresh Supabase dump at `2026-07-20T15:18:07Z`. The workflow stores full backups
privately in R2 and exposes only the schema as a one-day GitHub artifact.

The baseline passed a destructive local `pnpm db:reset` on 2026-07-20. The
reconstructed database was compared with production using stable, ordered
catalog fingerprints. These categories matched:

- relations and RLS flags;
- columns and defaults;
- enum values;
- constraints and indexes;
- functions, views and triggers;
- RLS policies and table ACLs.

The raw `pg_dump` diff contains only PostgreSQL formatting/order noise after
normalization; its semantic catalog state is equal.

The hosted acceptance gate also passed on 2026-07-20 against `hour-staging`
(`slccyknqpgmzhyiyclsq`, `eu-west-1`): GitHub Actions
[run 29761298044](https://github.com/marcorubiol/hour/actions/runs/29761298044)
rebuilt the project from the committed migrations, provisioned Auth through
the Admin API, loaded synthetic fixtures, passed RLS 114/114, built the app and
passed the critical-route smoke 2/2. Commit assessed: `84056f8`; duration:
1 minute 56 seconds.

## Backup schema retrieval

The `Supabase backup → R2` workflow accepts the optional manual input
`source_stamp`. With no input it creates the normal fresh schema/data/roles
backup. With a stamp such as `2026-07-19T06-04-38Z`, it reads that existing R2
backup and exposes only its schema as a one-day artifact. It never exposes the
data file.

Use this for audits and restore preparation, not as a substitute for the
executable migration baseline.

## Future migration checklist

1. Create a new timestamped migration in `supabase/migrations/`.
2. Review grants and RLS explicitly; new tables are not assumed to be exposed.
3. Run `pnpm db:reset` from a clean local stack.
4. Run the affected unit, RLS and E2E suites.
5. Apply to staging and compare `supabase migration list` before production.

Do not run `supabase db reset --linked` against production. It is destructive
and reserved for disposable development or staging projects after checking the
linked project ref.
