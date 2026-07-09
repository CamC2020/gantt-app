-- Pull Plan board (TouchPlan-style): swimlanes, sticky-note tickets, milestones

-- Swimlanes (rows on the board, e.g. site areas/zones)
create table if not exists public.pull_lanes (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- Sticky-note tickets
create table if not exists public.pull_tickets (
  id           uuid primary key default gen_random_uuid(),
  lane_id      uuid references public.pull_lanes (id) on delete set null,
  owner_id     uuid not null references public.profiles (id) on delete cascade,
  description  text not null,
  start_date   date,                -- null = still in the "unplanned" tray
  duration     integer not null default 1,   -- working days
  crew_size    integer,
  status       text not null default 'planned'
               check (status in ('planned','promised','in_progress','done_early','done_ontime','done_late')),
  roadblock    boolean not null default false,
  roadblock_note text not null default '',
  promised_end date,               -- pinned finish date at time of promise
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);

-- Milestones (diamonds on the board)
create table if not exists public.pull_milestones (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  date       date not null,
  created_at timestamptz not null default now()
);

create index if not exists pull_tickets_lane_idx  on public.pull_tickets (lane_id);
create index if not exists pull_tickets_owner_idx on public.pull_tickets (owner_id);
create index if not exists pull_tickets_date_idx  on public.pull_tickets (start_date);

alter table public.pull_lanes      enable row level security;
alter table public.pull_tickets    enable row level security;
alter table public.pull_milestones enable row level security;

-- Everyone authenticated can read everything on the board
create policy "read pull lanes"      on public.pull_lanes      for select to authenticated using (true);
create policy "read pull tickets"    on public.pull_tickets    for select to authenticated using (true);
create policy "read pull milestones" on public.pull_milestones for select to authenticated using (true);

-- Lanes & milestones: any authenticated user can manage (collaborative planning)
create policy "insert pull lanes" on public.pull_lanes for insert to authenticated with check (true);
create policy "update pull lanes" on public.pull_lanes for update to authenticated using (true);
create policy "delete pull lanes" on public.pull_lanes for delete to authenticated using (true);

create policy "insert pull milestones" on public.pull_milestones for insert to authenticated with check (true);
create policy "update pull milestones" on public.pull_milestones for update to authenticated using (true);
create policy "delete pull milestones" on public.pull_milestones for delete to authenticated using (true);

-- Tickets: anyone can create their own; only the owner (or an admin) can edit/delete
create policy "insert own pull tickets" on public.pull_tickets for insert to authenticated
  with check (owner_id = auth.uid());

create policy "update pull tickets" on public.pull_tickets for update to authenticated
  using (
    owner_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

create policy "delete pull tickets" on public.pull_tickets for delete to authenticated
  using (
    owner_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );
