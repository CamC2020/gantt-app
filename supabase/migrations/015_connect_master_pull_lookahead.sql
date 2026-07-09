-- Connect master schedule <-> pull plan <-> lookahead

-- Master/lookahead tasks: role/trade (replaces subcontractor) + constraint marker
alter table public.tasks
  add column if not exists role_id       uuid references public.pull_roles (id) on delete set null,
  add column if not exists is_constraint boolean not null default false;

-- Track which master task a pull item was imported from (for skip-on-reimport)
alter table public.pull_tickets
  add column if not exists source_task_id uuid references public.tasks (id) on delete set null;
alter table public.pull_milestones
  add column if not exists source_task_id uuid references public.tasks (id) on delete set null;

-- Support members on pull tickets
create table if not exists public.pull_ticket_support (
  ticket_id uuid not null references public.pull_tickets (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  primary key (ticket_id, user_id)
);

alter table public.pull_ticket_support enable row level security;

create policy "read pull ticket support"   on public.pull_ticket_support for select to authenticated using (true);
create policy "insert pull ticket support" on public.pull_ticket_support for insert to authenticated with check (true);
create policy "delete pull ticket support" on public.pull_ticket_support for delete to authenticated using (true);
