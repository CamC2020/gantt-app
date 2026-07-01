-- Convert member_holidays from single days to date ranges
-- Rename date → start_date, add end_date

alter table public.member_holidays
  rename column date to start_date;

alter table public.member_holidays
  add column if not exists end_date date;

-- Default end_date to start_date for any existing rows
update public.member_holidays set end_date = start_date where end_date is null;

alter table public.member_holidays
  alter column end_date set not null,
  alter column end_date set default current_date;

-- Drop the old unique constraint (date per user) and replace with a looser one
alter table public.member_holidays drop constraint if exists member_holidays_user_id_date_key;
