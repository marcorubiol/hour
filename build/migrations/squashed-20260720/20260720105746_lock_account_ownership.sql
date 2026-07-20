-- Account admins may manage admins, but only owners can create or modify an
-- owner. Initial account ownership remains in trusted signup/operator code.

begin;

revoke insert on table public.account from authenticated;

drop policy if exists account_insert on public.account;

drop policy if exists account_membership_insert on public.account_membership;
create policy account_membership_insert on public.account_membership
  for insert to authenticated
  with check (
    public.is_account_owner(account_id)
    or (
      public.is_account_admin(account_id)
      and role = 'admin'
    )
  );

drop policy if exists account_membership_update on public.account_membership;
create policy account_membership_update on public.account_membership
  for update to authenticated
  using (
    public.is_account_owner(account_id)
    or (
      public.is_account_admin(account_id)
      and role = 'admin'
    )
  )
  with check (
    public.is_account_owner(account_id)
    or (
      public.is_account_admin(account_id)
      and role = 'admin'
    )
  );

commit;
