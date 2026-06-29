-- Gantt app schema
-- Run this in the Supabase SQL editor (or via `supabase db push`) on a fresh project.

-- ============================================================================
-- Extensions
-- ============================================================================
create extension if not exists "pgcrypto";

-- ============================================================================
-- Tables
-- ============================================================================

-- profiles: mirrors auth.users, created automatically via trigger on signup
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create type public.project_role as enum ('owner', 'member');

create table if not exists public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.project_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create type public.task_status as enum ('not_started', 'in_progress', 'done');

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null,
  start_date date not null,
  end_date date not null,
  assignee_id uuid references public.profiles (id) on delete set null,
  status public.task_status not null default 'not_started',
  created_at timestamptz not null default now()
);

create index if not exists tasks_project_id_idx on public.tasks (project_id);
create index if not exists project_members_user_id_idx on public.project_members (user_id);
create index if not exists project_members_project_id_idx on public.project_members (project_id);

-- ============================================================================
-- profiles: auto-create on signup
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', null)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================================
-- Helper: when a project is created, the creator becomes owner + member
-- ============================================================================

create or replace function public.handle_new_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.project_members (project_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (project_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_project_created on public.projects;
create trigger on_project_created
  after insert on public.projects
  for each row execute procedure public.handle_new_project();

-- ============================================================================
-- RLS
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.tasks enable row level security;

-- profiles: readable by all authenticated users; users can update their own row
create policy "profiles are readable by authenticated users"
  on public.profiles for select
  to authenticated
  using (true);

create policy "users can update their own profile"
  on public.profiles for update
  to authenticated
  using (id = auth.uid());

create policy "users can insert their own profile"
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid());

-- helper function: is the current user a member of a given project?
create or replace function public.is_project_member(p_project_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.project_members pm
    where pm.project_id = p_project_id
      and pm.user_id = auth.uid()
  );
$$;

-- helper function: is the current user the owner of a given project?
create or replace function public.is_project_owner(p_project_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = p_project_id
      and p.owner_id = auth.uid()
  );
$$;

-- projects: members (incl. owner) can read; only owner can update/delete;
-- any authenticated user can create a project (becomes owner via trigger)
create policy "members can read their projects"
  on public.projects for select
  to authenticated
  using (public.is_project_member(id));

create policy "authenticated users can create projects"
  on public.projects for insert
  to authenticated
  with check (owner_id = auth.uid());

create policy "owner can update project"
  on public.projects for update
  to authenticated
  using (owner_id = auth.uid());

create policy "owner can delete project"
  on public.projects for delete
  to authenticated
  using (owner_id = auth.uid());

-- project_members: members can read the membership list for their projects;
-- only the project owner can add/remove members
create policy "members can read project membership"
  on public.project_members for select
  to authenticated
  using (public.is_project_member(project_id));

create policy "owner can add project members"
  on public.project_members for insert
  to authenticated
  with check (public.is_project_owner(project_id));

create policy "owner can remove project members"
  on public.project_members for delete
  to authenticated
  using (public.is_project_owner(project_id));

create policy "owner can update project members"
  on public.project_members for update
  to authenticated
  using (public.is_project_owner(project_id));

-- tasks: project members can read/write tasks for their projects
create policy "members can read tasks"
  on public.tasks for select
  to authenticated
  using (public.is_project_member(project_id));

create policy "members can create tasks"
  on public.tasks for insert
  to authenticated
  with check (public.is_project_member(project_id));

create policy "members can update tasks"
  on public.tasks for update
  to authenticated
  using (public.is_project_member(project_id));

create policy "members can delete tasks"
  on public.tasks for delete
  to authenticated
  using (public.is_project_member(project_id));
