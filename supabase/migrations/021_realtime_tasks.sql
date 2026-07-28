-- Live task sync between My Tasks and All Tasks.
--
-- Both pages render server-side and previously only reflected changes on a
-- manual reload, so two people working the same lookahead could sit on stale
-- statuses indefinitely. Publish `tasks` over Realtime so every open page can
-- refresh itself the moment a status changes.
--
-- Realtime respects RLS, and 019_shared_read_access.sql already lets any
-- authenticated user SELECT tasks, so all signed-in users receive these events.
-- Writes remain gated by the update_task_status RPC (003_admin.sql).

-- `full` so UPDATE/DELETE payloads carry the complete row rather than just the
-- primary key — lets clients tell which task changed without a follow-up read.
alter table public.tasks replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tasks'
  ) then
    alter publication supabase_realtime add table public.tasks;
  end if;
end $$;
