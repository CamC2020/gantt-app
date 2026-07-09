-- Pull Plan snapshots: point-in-time copies of the whole board
create table if not exists public.pull_snapshots (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_by uuid not null references public.profiles (id) on delete cascade,
  data       jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.pull_snapshots enable row level security;

create policy "read pull snapshots" on public.pull_snapshots for select to authenticated using (true);

create policy "insert own pull snapshots" on public.pull_snapshots for insert to authenticated
  with check (created_by = auth.uid());

create policy "delete pull snapshots" on public.pull_snapshots for delete to authenticated
  using (
    created_by = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );
