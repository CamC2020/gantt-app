-- Pull Plan v5: notes, variance reasons, constraint fields, RLS fix for responsible users

alter table public.pull_tickets
  add column if not exists notes              text not null default '',
  add column if not exists variance_reason    text not null default '',
  add column if not exists variance_note      text not null default '',
  add column if not exists roadblock_need_by  date,
  add column if not exists roadblock_priority text not null default 'on_track'
    check (roadblock_priority in ('on_track','needs_attention','critical'));

-- Fix: the Responsible person must be able to update their tickets, not just the owner
drop policy if exists "update pull tickets" on public.pull_tickets;
create policy "update pull tickets" on public.pull_tickets for update to authenticated
  using (
    owner_id = auth.uid()
    or responsible_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

drop policy if exists "delete pull tickets" on public.pull_tickets;
create policy "delete pull tickets" on public.pull_tickets for delete to authenticated
  using (
    owner_id = auth.uid()
    or responsible_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );
