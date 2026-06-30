-- Member personal holidays (individual non-working days per user)
create table if not exists public.member_holidays (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  date       date not null,
  label      text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

create index if not exists member_holidays_user_id_idx on public.member_holidays (user_id);
create index if not exists member_holidays_date_idx    on public.member_holidays (date);

alter table public.member_holidays enable row level security;

-- All authenticated users can read all member holidays (so the Gantt can show them)
create policy "authenticated users can read member holidays"
  on public.member_holidays for select
  to authenticated
  using (true);

-- Users can only insert/update/delete their own holidays
create policy "users can insert own holidays"
  on public.member_holidays for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "users can delete own holidays"
  on public.member_holidays for delete
  to authenticated
  using (user_id = auth.uid());

-- New task fields
alter table public.tasks
  add column if not exists subcontractor text,
  add column if not exists crew_size     integer;
