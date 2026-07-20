-- A live, accepted workspace membership is the outer tenancy envelope.
-- Project roles and grants only specialize access inside that envelope.

begin;

create or replace function public.is_workspace_admin(ws_id uuid)
returns boolean as $$
  select exists (
    select 1
    from public.workspace_membership
    where user_id = auth.uid()
      and workspace_id = ws_id
      and accepted_at is not null
      and role in ('owner', 'admin')
  );
$$ language sql stable security definer
set search_path = public, extensions, pg_temp;

revoke all on function public.is_workspace_admin(uuid) from public, anon, service_role;
grant execute on function public.is_workspace_admin(uuid) to authenticated;

comment on function public.is_workspace_admin(uuid) is
  'True only for a live workspace owner/admin. SECURITY DEFINER avoids recursive RLS when workspace_membership policies check their own table.';

create or replace function public.has_permission(p_project_id uuid, p_perm text)
returns boolean as $$
  select
    exists (
      select 1
      from public.workspace_membership wm
      join public.project p on p.workspace_id = wm.workspace_id
      where p.id = p_project_id
        and wm.user_id = auth.uid()
        and wm.accepted_at is not null
        and wm.role in ('owner', 'admin')
    )
    or
    exists (
      with mr as (
        select pm.roles,
               pm.permission_grants,
               pm.permission_revokes,
               p.workspace_id
        from public.project_membership pm
        join public.project p on p.id = pm.project_id
        join public.workspace_membership wm
          on wm.workspace_id = p.workspace_id
         and wm.user_id = pm.user_id
         and wm.accepted_at is not null
        where pm.project_id = p_project_id
          and pm.user_id = auth.uid()
      ),
      role_perms as (
        select unnest(wr.permissions) as perm
        from public.workspace_role wr
        join mr on mr.workspace_id = wr.workspace_id
        where wr.code = any (mr.roles)
          and wr.archived_at is null
      ),
      effective as (
        select perm from role_perms
        union
        select unnest(mr.permission_grants) from mr
        except
        select unnest(mr.permission_revokes) from mr
      )
      select 1 from effective where perm = p_perm
    );
$$ language sql stable security definer
set search_path = public, extensions, pg_temp;

comment on function public.has_permission(uuid, text) is
  'Effective project permission check. A live accepted workspace membership is the outer access envelope; project roles/grants/revokes specialize access inside it. Workspace owner/admin bypass is explicit (ADR-006). No wildcard.';

drop policy if exists workspace_membership_insert on public.workspace_membership;
create policy workspace_membership_insert on public.workspace_membership
  for insert to authenticated
  with check (is_workspace_admin(workspace_id));

drop policy if exists workspace_membership_update on public.workspace_membership;
create policy workspace_membership_update on public.workspace_membership
  for update to authenticated
  using (is_workspace_admin(workspace_id))
  with check (is_workspace_admin(workspace_id));

drop policy if exists workspace_membership_delete on public.workspace_membership;
create policy workspace_membership_delete on public.workspace_membership
  for delete to authenticated
  using (
    user_id = auth.uid()
    or is_workspace_admin(workspace_id)
  );

drop policy if exists project_select on public.project;
create policy project_select on public.project
  for select to authenticated
  using (
    deleted_at is null
    and is_workspace_member(workspace_id)
  );

drop policy if exists project_membership_select on public.project_membership;
create policy project_membership_select on public.project_membership
  for select to authenticated
  using (
    (
      user_id = auth.uid()
      and exists (
        select 1
        from public.project p
        where p.id = project_membership.project_id
          and is_workspace_member(p.workspace_id)
      )
    )
    or has_permission(project_id, 'edit:membership')
  );

commit;
