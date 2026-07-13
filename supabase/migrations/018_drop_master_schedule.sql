-- Master Schedule feature removed (app now uses MS Project + "Import MS
-- Project" file import directly into the Pull Plan). pull_import_skips only
-- ever existed to support "Import Master" re-import de-duplication, which no
-- longer exists in the app — safe to drop.
drop table if exists public.pull_import_skips;
