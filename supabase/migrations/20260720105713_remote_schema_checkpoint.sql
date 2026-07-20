-- Safety checkpoint for the historical schema predating this Supabase
-- migration directory. It is intentionally not a reconstructive baseline.
--
-- On the linked hour-phase0 database this migration is a no-op and records
-- where managed migrations begin. On an empty or wrong project it aborts
-- before any additive migration can run. Replace this checkpoint with a real
-- schema-only baseline before using `supabase db reset` or creating production.

do $$
begin
  if to_regclass('public.workspace') is null
    or to_regclass('public.workspace_membership') is null
    or to_regclass('public.project') is null
    or to_regclass('public.person') is null
    or to_regclass('public.user_profile') is null
    or to_regclass('public.account_membership') is null
  then
    raise exception using
      errcode = '55000',
      message = 'Historical Hour schema is missing: refusing to apply additive migrations to an empty or wrong database.';
  end if;
end
$$;
