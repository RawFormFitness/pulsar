-- seed.sql
-- Local dev seed only. NEVER contains real gym data.
--
-- Creates:
--   * Two gyms (alpha, beta) — used by the RLS smoke test to confirm a
--     user in gym A cannot see gym B's rows.
--   * Two auth users (one per gym) with matching gym_members rows.
--   * Empty gym_configs rows for both.
--   * A handful of fact rows in each gym so cross-gym leakage is detectable.
--
-- IDs are deterministic so tests can reference them.

-- ---- gyms -------------------------------------------------------------------
insert into public.gyms (id, name, slug, timezone) values
  ('11111111-1111-1111-1111-111111111111', 'Alpha Gym (dev)', 'alpha-dev', 'America/New_York'),
  ('22222222-2222-2222-2222-222222222222', 'Beta Gym (dev)',  'beta-dev',  'America/Los_Angeles')
on conflict (id) do nothing;

-- ---- gym_configs ------------------------------------------------------------
insert into public.gym_configs (gym_id, config) values
  ('11111111-1111-1111-1111-111111111111', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222222222', '{}'::jsonb)
on conflict (gym_id) do nothing;

-- ---- auth users -------------------------------------------------------------
-- Direct inserts to auth.users are how Supabase's local seed.sql usually does
-- this. Passwords are bcrypt-hashed; both users below have password 'password'.
-- This is local dev only.
insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
) values
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'alpha@dev.local',
    crypt('password', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now(),
    '', '', '', ''
  ),
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'beta@dev.local',
    crypt('password', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now(),
    '', '', '', ''
  )
on conflict (id) do nothing;

-- ---- gym_members (auth → gym mapping) ---------------------------------------
insert into public.gym_members (user_id, gym_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'owner')
on conflict (user_id, gym_id) do nothing;

-- ---- fact rows: distinguishable per gym for the RLS smoke test --------------
-- Two leads per gym. If RLS leaks, a query as alpha@dev.local will show beta's rows.
insert into public.leads (
  gym_id, source_id, status, source, created_at
) values
  ('11111111-1111-1111-1111-111111111111', 'alpha-lead-1', 'sale', 'Website', now() - interval '10 days'),
  ('11111111-1111-1111-1111-111111111111', 'alpha-lead-2', 'not_interested', 'Walk-in', now() - interval '5 days'),
  ('22222222-2222-2222-2222-222222222222', 'beta-lead-1',  'sale', 'Website', now() - interval '8 days'),
  ('22222222-2222-2222-2222-222222222222', 'beta-lead-2',  'pending', 'Referral', now() - interval '3 days')
on conflict (gym_id, source_id) do nothing;
