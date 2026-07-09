-- Pull Plan v3: managed locations list, manual row placement in lanes

create table if not exists public.pull_locations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  color      text not null default '#8f5bd9',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.pull_tickets
  add column if not exists location_id uuid references public.pull_locations (id) on delete set null,
  add column if not exists row_index   integer not null default 0;

alter table public.pull_locations enable row level security;

create policy "read pull locations"   on public.pull_locations for select to authenticated using (true);
create policy "insert pull locations" on public.pull_locations for insert to authenticated with check (true);
create policy "update pull locations" on public.pull_locations for update to authenticated using (true);
create policy "delete pull locations" on public.pull_locations for delete to authenticated using (true);
