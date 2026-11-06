create or replace function fiscus.has_workspace_access(p_workspace_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from fiscus.workspace_access wa
    where wa.workspace_id = p_workspace_id
      and wa.expires_at > now()
  );
$$;

grant select on fiscus.workspace_access to authenticated;
revoke insert, update, delete on fiscus.workspace_access from authenticated;

create policy fiscus_workspace_access_owner_read
  on fiscus.workspace_access for select to authenticated
  using (clerk_user_id = (select auth.jwt() ->> 'sub'));
