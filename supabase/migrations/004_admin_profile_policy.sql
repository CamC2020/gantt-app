-- Allow admins to update any profile (needed for toggling is_admin on other users)
create policy "admins can update any profile"
  on public.profiles for update
  to authenticated
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );
