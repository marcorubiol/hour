-- Supabase advisor follow-up (2026-07-20).
--
-- 1. Cache auth.uid() once per statement in RLS expressions.
-- 2. Remove overlapping permissive SELECT policies without changing access.
-- 3. Make the deliberate direct-deny posture of share-token tables explicit.
-- 4. Cover every live public foreign key reported by the performance advisor.

-- Preserve each policy verb, role list and expression while replacing direct
-- auth.uid() calls with an init-plan subquery. This is the form recommended by
-- Supabase for policies that can scan more than one row.
do $advisor_rls$
declare
  policy_row record;
  alter_sql text;
begin
  for policy_row in
    select schemaname, tablename, policyname, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (
        coalesce(qual, '') like '%auth.uid()%'
        or coalesce(with_check, '') like '%auth.uid()%'
      )
  loop
    alter_sql := format(
      'alter policy %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );

    if policy_row.qual is not null then
      alter_sql := alter_sql || format(
        ' using (%s)',
        replace(policy_row.qual, 'auth.uid()', '(select auth.uid())')
      );
    end if;

    if policy_row.with_check is not null then
      alter_sql := alter_sql || format(
        ' with check (%s)',
        replace(policy_row.with_check, 'auth.uid()', '(select auth.uid())')
      );
    end if;

    execute alter_sql;
  end loop;
end
$advisor_rls$;

-- Two SELECT policies on the same table are ORed by Postgres. Express that OR
-- once so each row does not evaluate two separate permissive policies.
drop policy if exists audit_log_select_privileged on public.audit_log;
drop policy if exists audit_log_select_self on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (
    actor_id = (select auth.uid())
    or (
      workspace_id is not null
      and exists (
        select 1
        from public.workspace_membership m
        where m.workspace_id = audit_log.workspace_id
          and m.user_id = (select auth.uid())
          and m.accepted_at is not null
          and m.role in ('owner', 'admin')
      )
    )
  );

drop policy if exists user_profile_select_coworker on public.user_profile;
drop policy if exists user_profile_select_self on public.user_profile;
create policy user_profile_select on public.user_profile
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1
      from public.workspace_membership m1
      join public.workspace_membership m2
        on m2.workspace_id = m1.workspace_id
      where m1.user_id = (select auth.uid())
        and m1.accepted_at is not null
        and m2.user_id = user_profile.user_id
        and m2.accepted_at is not null
    )
  );

-- FOR ALL also participates in SELECT. Split mutation policies by verb so the
-- read policy remains the only permissive SELECT policy.
drop policy if exists invoice_line_write on public.invoice_line;
create policy invoice_line_insert on public.invoice_line
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.invoice i
      where i.id = invoice_line.invoice_id
        and i.workspace_id = invoice_line.workspace_id
        and (
          (i.project_id is not null and has_permission(i.project_id, 'edit:money'))
          or (
            i.project_id is null
            and current_workspace_role() in ('owner', 'admin')
          )
        )
    )
  );
create policy invoice_line_update on public.invoice_line
  for update to authenticated
  using (
    exists (
      select 1
      from public.invoice i
      where i.id = invoice_line.invoice_id
        and (
          (i.project_id is not null and has_permission(i.project_id, 'edit:money'))
          or (
            i.project_id is null
            and current_workspace_role() in ('owner', 'admin')
          )
        )
    )
  )
  with check (
    exists (
      select 1
      from public.invoice i
      where i.id = invoice_line.invoice_id
        and i.workspace_id = invoice_line.workspace_id
        and (
          (i.project_id is not null and has_permission(i.project_id, 'edit:money'))
          or (
            i.project_id is null
            and current_workspace_role() in ('owner', 'admin')
          )
        )
    )
  );
create policy invoice_line_delete on public.invoice_line
  for delete to authenticated
  using (
    exists (
      select 1
      from public.invoice i
      where i.id = invoice_line.invoice_id
        and (
          (i.project_id is not null and has_permission(i.project_id, 'edit:money'))
          or (
            i.project_id is null
            and current_workspace_role() in ('owner', 'admin')
          )
        )
    )
  );

drop policy if exists payment_write on public.payment;
create policy payment_insert on public.payment
  for insert to authenticated
  with check (
    workspace_id = current_workspace_id()
    and exists (
      select 1
      from public.invoice i
      where i.id = payment.invoice_id
        and i.workspace_id = payment.workspace_id
        and (
          (i.project_id is not null and has_permission(i.project_id, 'edit:money'))
          or (
            i.project_id is null
            and current_workspace_role() in ('owner', 'admin')
          )
        )
    )
  );
create policy payment_update on public.payment
  for update to authenticated
  using (
    exists (
      select 1
      from public.invoice i
      where i.id = payment.invoice_id
        and (
          (i.project_id is not null and has_permission(i.project_id, 'edit:money'))
          or (
            i.project_id is null
            and current_workspace_role() in ('owner', 'admin')
          )
        )
    )
  )
  with check (
    workspace_id = current_workspace_id()
    and exists (
      select 1
      from public.invoice i
      where i.id = payment.invoice_id
        and i.workspace_id = payment.workspace_id
        and (
          (i.project_id is not null and has_permission(i.project_id, 'edit:money'))
          or (
            i.project_id is null
            and current_workspace_role() in ('owner', 'admin')
          )
        )
    )
  );
create policy payment_delete on public.payment
  for delete to authenticated
  using (
    exists (
      select 1
      from public.invoice i
      where i.id = payment.invoice_id
        and (
          (i.project_id is not null and has_permission(i.project_id, 'edit:money'))
          or (
            i.project_id is null
            and current_workspace_role() in ('owner', 'admin')
          )
        )
    )
  );

drop policy if exists project_membership_write on public.project_membership;
create policy project_membership_insert on public.project_membership
  for insert to authenticated
  with check (has_permission(project_id, 'edit:membership'));
create policy project_membership_update on public.project_membership
  for update to authenticated
  using (has_permission(project_id, 'edit:membership'))
  with check (has_permission(project_id, 'edit:membership'));
create policy project_membership_delete on public.project_membership
  for delete to authenticated
  using (has_permission(project_id, 'edit:membership'));

-- These rows are accessible only through their token-validating SECURITY
-- DEFINER RPCs. Explicit policies document the direct-table deny posture.
drop policy if exists calendar_share_direct_access_denied on public.calendar_share;
create policy calendar_share_direct_access_denied on public.calendar_share
  for all to anon, authenticated
  using (false)
  with check (false);

drop policy if exists roadsheet_share_direct_access_denied on public.roadsheet_share;
create policy roadsheet_share_direct_access_denied on public.roadsheet_share
  for all to anon, authenticated
  using (false)
  with check (false);

-- Foreign-key covering indexes reported by the advisor. Existing composite
-- indexes already covering other FKs are intentionally not duplicated.
create index if not exists asset_version_uploaded_by_idx
  on public.asset_version (uploaded_by);
create index if not exists availability_block_created_by_idx
  on public.availability_block (created_by);
create index if not exists calendar_share_created_by_idx
  on public.calendar_share (created_by);
create index if not exists cast_member_created_by_idx
  on public.cast_member (created_by);
create index if not exists cast_override_created_by_idx
  on public.cast_override (created_by);
create index if not exists crew_assignment_created_by_idx
  on public.crew_assignment (created_by);
create index if not exists date_created_by_idx
  on public.date (created_by);
create index if not exists date_venue_idx
  on public.date (venue_id);
create index if not exists expense_created_by_idx
  on public.expense (created_by);
create index if not exists expense_paid_by_user_idx
  on public.expense (paid_by_user_id);
create index if not exists invoice_created_by_idx
  on public.invoice (created_by);
create index if not exists invoice_payer_person_idx
  on public.invoice (payer_person_id);
create index if not exists line_created_by_idx
  on public.line (created_by);
create index if not exists payment_created_by_idx
  on public.payment (created_by);
create index if not exists performance_created_by_idx
  on public.performance (created_by);
create index if not exists performance_venue_idx
  on public.performance (venue_id);
create index if not exists project_created_by_idx
  on public.project (created_by);
create index if not exists project_owner_idx
  on public.project (owner_id);
create index if not exists project_membership_invited_by_idx
  on public.project_membership (invited_by);
create index if not exists roadsheet_share_created_by_idx
  on public.roadsheet_share (created_by);
create index if not exists roadsheet_share_workspace_idx
  on public.roadsheet_share (workspace_id);
create index if not exists task_created_by_idx
  on public.task (created_by);
create index if not exists venue_created_by_idx
  on public.venue (created_by);
create index if not exists workspace_account_idx
  on public.workspace (account_id);
create index if not exists workspace_alias_request_decided_by_idx
  on public.workspace_alias_request (decided_by);
create index if not exists workspace_alias_request_requested_by_idx
  on public.workspace_alias_request (requested_by);
create index if not exists workspace_membership_invited_by_idx
  on public.workspace_membership (invited_by);
create index if not exists workspace_organization_created_by_idx
  on public.workspace_organization (created_by);
create index if not exists workspace_person_created_by_idx
  on public.workspace_person (created_by);
create index if not exists workspace_person_person_idx
  on public.workspace_person (person_id);
