-- Milestones behave like tickets: swimlane placement, tray (null date), row position
alter table public.pull_milestones
  add column if not exists lane_id   uuid references public.pull_lanes (id) on delete set null,
  add column if not exists row_index integer not null default 0;

alter table public.pull_milestones alter column date drop not null;

-- Any authenticated user can update milestones (needed for dragging)
drop policy if exists "update pull milestones" on public.pull_milestones;
create policy "update pull milestones" on public.pull_milestones for update to authenticated using (true);
