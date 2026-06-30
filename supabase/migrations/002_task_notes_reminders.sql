-- task_notes: one row per (task, user) — stores user-specific notes/details on a master-schedule task
create table if not exists public.task_notes (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  content     text not null default '',
  updated_at  timestamptz not null default now(),
  unique (task_id, user_id)
);

create index if not exists task_notes_task_id_idx  on public.task_notes (task_id);
create index if not exists task_notes_user_id_idx  on public.task_notes (user_id);

alter table public.task_notes enable row level security;

-- Users can only read/write their own notes
create policy "users can read own task notes"
  on public.task_notes for select
  to authenticated
  using (user_id = auth.uid());

create policy "users can insert own task notes"
  on public.task_notes for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "users can update own task notes"
  on public.task_notes for update
  to authenticated
  using (user_id = auth.uid());

create policy "users can delete own task notes"
  on public.task_notes for delete
  to authenticated
  using (user_id = auth.uid());

-- reminder_log: tracks which reminder emails have been sent so we don't duplicate
create type public.reminder_type as enum ('5_day', '1_day');

create table if not exists public.reminder_log (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid not null references public.tasks (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  reminder_type public.reminder_type not null,
  sent_at       timestamptz not null default now(),
  unique (task_id, user_id, reminder_type)
);

create index if not exists reminder_log_task_id_idx on public.reminder_log (task_id);

alter table public.reminder_log enable row level security;

-- Only service role (cron) writes; authenticated users have no access
create policy "service role only on reminder_log"
  on public.reminder_log for all
  to service_role
  using (true)
  with check (true);
