-- First-class constraints: separate circle tickets placed like milestones
create table if not exists public.pull_constraints (
  id             uuid primary key default gen_random_uuid(),
  description    text not null,
  lane_id        uuid references public.pull_lanes (id) on delete set null,
  date           date,               -- planned resolution date; null = tray
  row_index      integer not null default 0,
  need_by        date,               -- deadline for resolving
  priority       text not null default 'on_track'
    check (priority in ('on_track','needs_attention','critical')),
  responsible_id uuid references public.profiles (id) on delete set null,
  note           text not null default '',
  resolved       boolean not null default false,
  created_at     timestamptz not null default now()
);

-- Which tasks a constraint is blocking
create table if not exists public.pull_constraint_links (
  id            uuid primary key default gen_random_uuid(),
  constraint_id uuid not null references public.pull_constraints (id) on delete cascade,
  ticket_id     uuid not null references public.pull_tickets (id) on delete cascade,
  unique (constraint_id, ticket_id)
);

alter table public.pull_constraints      enable row level security;
alter table public.pull_constraint_links enable row level security;

create policy "read pull constraints"   on public.pull_constraints for select to authenticated using (true);
create policy "insert pull constraints" on public.pull_constraints for insert to authenticated with check (true);
create policy "update pull constraints" on public.pull_constraints for update to authenticated using (true);
create policy "delete pull constraints" on public.pull_constraints for delete to authenticated using (true);

create policy "read pull constraint links"   on public.pull_constraint_links for select to authenticated using (true);
create policy "insert pull constraint links" on public.pull_constraint_links for insert to authenticated with check (true);
create policy "delete pull constraint links" on public.pull_constraint_links for delete to authenticated using (true);
