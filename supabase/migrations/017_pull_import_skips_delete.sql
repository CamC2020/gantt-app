-- pull_import_skips had no delete policy, so a deleted master import was
-- permanently blacklisted with no way to bring it back via "Import Master".
-- Let admins clear the blacklist (see resetImportSkips in PullPlanBoard.tsx).
create policy "admins can delete pull import skips" on public.pull_import_skips
  for delete to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );
