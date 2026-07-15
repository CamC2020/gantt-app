-- This app is used by one company, not as a multi-tenant project tool — but
-- the generic project_members model from the original schema is still gating
-- reads, and nothing ever populates project_members beyond whoever happened
-- to create a project (getOrCreateLookaheadProject/getOrCreateMasterProject
-- never add other users as members). So the Lookahead's tasks were only ever
-- visible to that one account — every other user's My Tasks and Lookahead
-- page silently came back empty, since RLS just filters rows rather than
-- erroring. Loosen SELECT to all authenticated users; write access is
-- unaffected (still admin-only per 003_admin.sql).

drop policy if exists "members can read their projects" on public.projects;
create policy "authenticated users can read all projects"
  on public.projects for select
  to authenticated
  using (true);

drop policy if exists "members can read tasks" on public.tasks;
create policy "authenticated users can read all tasks"
  on public.tasks for select
  to authenticated
  using (true);

create policy "authenticated users can read task dependencies"
  on public.task_dependencies for select
  to authenticated
  using (true);

create policy "authenticated users can read task support"
  on public.task_support for select
  to authenticated
  using (true);
