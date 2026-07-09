-- Pull Plan v2: roles (trade colors), responsible person, locations,
-- ticket dependencies, and the active line

-- Roles / trades — each has a color; tickets are colored by role
create table if not exists public.pull_roles (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  color      text not null default '#86efac',
  created_at timestamptz not null default now()
);

alter table public.pull_tickets
  add column if not exists role_id        uuid references public.pull_roles (id) on delete set null,
  add column if not exists responsible_id uuid references public.profiles (id) on delete set null,
  add column if not exists location       text not null default '';

-- Ticket predecessor links
create table if not exists public.pull_ticket_deps (
  ticket_id      uuid not null references public.pull_tickets (id) on delete cascade,
  predecessor_id uuid not null references public.pull_tickets (id) on delete cascade,
  primary key (ticket_id, predecessor_id)
);

-- Single-row board settings (active line date)
create table if not exists public.pull_settings (
  id          integer primary key default 1 check (id = 1),
  active_date date not null default current_date
);
insert into public.pull_settings (id) values (1) on conflict (id) do nothing;

alter table public.pull_roles       enable row level security;
alter table public.pull_ticket_deps enable row level security;
alter table public.pull_settings    enable row level security;

create policy "read pull roles"    on public.pull_roles for select to authenticated using (true);
create policy "insert pull roles"  on public.pull_roles for insert to authenticated with check (true);
create policy "update pull roles"  on public.pull_roles for update to authenticated using (true);
create policy "delete pull roles"  on public.pull_roles for delete to authenticated using (true);

create policy "read pull deps"   on public.pull_ticket_deps for select to authenticated using (true);
create policy "insert pull deps" on public.pull_ticket_deps for insert to authenticated with check (true);
create policy "delete pull deps" on public.pull_ticket_deps for delete to authenticated using (true);

create policy "read pull settings"   on public.pull_settings for select to authenticated using (true);
create policy "update pull settings" on public.pull_settings for update to authenticated using (true);
