-- Clean up duplicate "Lookahead" projects. Users who couldn't see the original
-- through the old RLS membership gate (fixed in 019) each spawned their own
-- empty copy via getOrCreateLookaheadProject, and once several rows shared the
-- name, that function's maybeSingle() errored on every load and created even
-- more. Keep the copy that actually holds the exported tasks (most tasks; tie
-- broken by oldest) and delete the rest — their (empty) task lists cascade.
with ranked as (
  select p.id,
         row_number() over (
           order by (select count(*) from public.tasks t where t.project_id = p.id) desc,
                    p.created_at asc
         ) as rn
  from public.projects p
  where p.name = 'Lookahead' and p.is_master = false
)
delete from public.projects
where id in (select id from ranked where rn > 1);
