-- Pull Plan v6: remember deleted imports so "Import Master" doesn't resurrect them
create table if not exists public.pull_import_skips (
  task_id    uuid primary key references public.tasks (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.pull_import_skips enable row level security;

create policy "read pull import skips"   on public.pull_import_skips for select to authenticated using (true);
create policy "insert pull import skips" on public.pull_import_skips for insert to authenticated with check (true);

-- Allow fractional sort_order (constraints are positioned at ticketOrder - 0.5
-- so they render directly above the task they block).
alter table public.tasks alter column sort_order type numeric using sort_order::numeric;
