-- Add is_admin flag to profiles
alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- Set the primary admin
update public.profiles
  set is_admin = true
  where email = 'ccheney@jacobbros.ca';

-- ============================================================================
-- Tighten task write policies — only admins can freely edit tasks
-- Members can only update the status field on tasks they are assigned to
-- via the update_task_status RPC below (which uses SECURITY DEFINER)
-- ============================================================================

drop policy if exists "members can update tasks" on public.tasks;
drop policy if exists "members can delete tasks" on public.tasks;
drop policy if exists "members can create tasks" on public.tasks;

-- Only admins can insert / delete tasks or update any field
create policy "admins can create tasks"
  on public.tasks for insert
  to authenticated
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

create policy "admins can update tasks"
  on public.tasks for update
  to authenticated
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

create policy "admins can delete tasks"
  on public.tasks for delete
  to authenticated
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

-- ============================================================================
-- RPC: any user assigned to a task can update its status only
-- SECURITY DEFINER bypasses RLS so regular members can call it safely
-- ============================================================================

create or replace function public.update_task_status(p_task_id uuid, p_status public.task_status)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Must be admin, assignee, champion, or supporter
  if not (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
    or exists (
      select 1 from public.tasks t
      where t.id = p_task_id
        and (t.assignee_id = auth.uid() or t.champion_id = auth.uid())
    )
    or exists (
      select 1 from public.task_support ts
      where ts.task_id = p_task_id and ts.user_id = auth.uid()
    )
  ) then
    raise exception 'Not authorized to update this task';
  end if;

  update public.tasks set status = p_status where id = p_task_id;
end;
$$;

-- Grant execute to authenticated users
grant execute on function public.update_task_status(uuid, public.task_status) to authenticated;

-- ============================================================================
-- Also tighten task_dependencies and task_support to admin-only writes
-- ============================================================================

drop policy if exists "members can manage dependencies" on public.task_dependencies;
drop policy if exists "members can manage support" on public.task_support;

create policy "admins can manage dependencies"
  on public.task_dependencies for all
  to authenticated
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  )
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

create policy "admins can manage support"
  on public.task_support for all
  to authenticated
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  )
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );
