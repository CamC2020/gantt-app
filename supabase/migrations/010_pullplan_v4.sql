-- Pull Plan v4: milestone connections + per-ticket weekend workday flags

alter table public.pull_tickets
  add column if not exists work_sat boolean not null default false,
  add column if not exists work_sun boolean not null default false;

-- Links between tickets and milestones (either direction)
create table if not exists public.pull_milestone_links (
  id             uuid primary key default gen_random_uuid(),
  ticket_id      uuid not null references public.pull_tickets (id) on delete cascade,
  milestone_id   uuid not null references public.pull_milestones (id) on delete cascade,
  ticket_is_pred boolean not null default true, -- true: ticket → milestone; false: milestone → ticket
  unique (ticket_id, milestone_id)
);

alter table public.pull_milestone_links enable row level security;

create policy "read pull milestone links"   on public.pull_milestone_links for select to authenticated using (true);
create policy "insert pull milestone links" on public.pull_milestone_links for insert to authenticated with check (true);
create policy "delete pull milestone links" on public.pull_milestone_links for delete to authenticated using (true);
