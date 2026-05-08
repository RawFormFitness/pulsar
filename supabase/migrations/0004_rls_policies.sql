-- 0004_rls_policies.sql
-- RLS policies for every domain and operational table.
-- All policies route through public.auth_user_has_gym_access(gym_id).
--
-- For v1, authenticated users get SELECT only. INSERT/UPDATE/DELETE on data
-- tables happens via server code using the service role (which bypasses RLS).
-- This means the importer / analytics layer is the only path for writes,
-- and that path explicitly scopes by gym_id (defense in depth — see lib/db).
--
-- v1.5 will add per-role write policies if/when in-app editing lands.

-- ---------------------------------------------------------------------------
-- leads
-- ---------------------------------------------------------------------------
create policy leads_select_own on public.leads
  for select to authenticated
  using (public.auth_user_has_gym_access(gym_id));

-- ---------------------------------------------------------------------------
-- sales
-- ---------------------------------------------------------------------------
create policy sales_select_own on public.sales
  for select to authenticated
  using (public.auth_user_has_gym_access(gym_id));

-- ---------------------------------------------------------------------------
-- members
-- ---------------------------------------------------------------------------
create policy members_select_own on public.members
  for select to authenticated
  using (public.auth_user_has_gym_access(gym_id));

-- ---------------------------------------------------------------------------
-- rfc_entries
-- ---------------------------------------------------------------------------
create policy rfc_entries_select_own on public.rfc_entries
  for select to authenticated
  using (public.auth_user_has_gym_access(gym_id));

-- ---------------------------------------------------------------------------
-- cancellations
-- ---------------------------------------------------------------------------
create policy cancellations_select_own on public.cancellations
  for select to authenticated
  using (public.auth_user_has_gym_access(gym_id));

-- ---------------------------------------------------------------------------
-- promo_windows
-- ---------------------------------------------------------------------------
create policy promo_windows_select_own on public.promo_windows
  for select to authenticated
  using (public.auth_user_has_gym_access(gym_id));

-- ---------------------------------------------------------------------------
-- import_history
-- ---------------------------------------------------------------------------
create policy import_history_select_own on public.import_history
  for select to authenticated
  using (public.auth_user_has_gym_access(gym_id));

-- ---------------------------------------------------------------------------
-- validation_runs
-- ---------------------------------------------------------------------------
create policy validation_runs_select_own on public.validation_runs
  for select to authenticated
  using (public.auth_user_has_gym_access(gym_id));

-- ---------------------------------------------------------------------------
-- Sanity check: no domain table should be missing gym_id or RLS.
-- This DO block runs once at migration time and raises if any public table
-- (other than known-exempt utility tables) lacks gym_id while RLS is off.
-- Tenancy roots (gyms, gym_members) are intentionally exempt.
-- ---------------------------------------------------------------------------
do $$
declare
  bad record;
  exempt text[] := array['gyms', 'gym_members'];
begin
  for bad in
    select c.relname as table_name,
           c.relrowsecurity as rls_enabled,
           exists (
             select 1 from pg_attribute a
              where a.attrelid = c.oid
                and a.attname = 'gym_id'
                and not a.attisdropped
           ) as has_gym_id
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and c.relname <> all (exempt)
  loop
    if not bad.has_gym_id then
      raise exception 'Multi-tenancy violation: table public.% has no gym_id column', bad.table_name;
    end if;
    if not bad.rls_enabled then
      raise exception 'Multi-tenancy violation: RLS not enabled on public.%', bad.table_name;
    end if;
  end loop;
end$$;
