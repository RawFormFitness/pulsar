-- 0001_init_tenancy.sql
-- Tenant root tables and the auth → gym mapping.
-- Establishes the helper functions every other migration's RLS policies use.

-- gyms: one row per customer
create table public.gyms (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  timezone    text not null default 'America/New_York',
  created_at  timestamptz not null default now()
);

comment on table public.gyms is
  'Tenant root. Every domain row references a gym via gym_id.';

-- gym_members: which auth users belong to which gyms (and in what role).
-- This is the join table RLS policies use to authorize access.
-- v1 has one user per gym; the table is built for the v1.5+ multi-user case.
create table public.gym_members (
  user_id     uuid not null references auth.users(id) on delete cascade,
  gym_id      uuid not null references public.gyms(id) on delete cascade,
  role        text not null default 'owner'
              check (role in ('owner', 'admin', 'staff', 'viewer')),
  created_at  timestamptz not null default now(),
  primary key (user_id, gym_id)
);

create index gym_members_gym_id_idx on public.gym_members (gym_id);

comment on table public.gym_members is
  'Auth-user → gym membership. Source of truth for RLS authorization.';

-- gym_configs: per-gym JSON config. Holds plan exclusions, channel attribution
-- references, promo windows, RFC tier boundaries, churn thresholds, data-
-- dictionary CSV→field mappings, custom-module references. Hand-edited in v1.
create table public.gym_configs (
  gym_id      uuid primary key references public.gyms(id) on delete cascade,
  config      jsonb not null default '{}'::jsonb,
  version     integer not null default 1,
  updated_at  timestamptz not null default now()
);

comment on table public.gym_configs is
  'Per-gym JSON config. All Level-2 (configured) values live here. Schema stays generic.';

-- Helper: does the current authenticated user have access to this gym?
-- Used by every domain table's RLS policy. SECURITY DEFINER so it can read
-- gym_members without recursing into RLS on that table.
create or replace function public.auth_user_has_gym_access(target_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.gym_members
     where user_id = auth.uid()
       and gym_id  = target_gym_id
  );
$$;

comment on function public.auth_user_has_gym_access(uuid) is
  'True if the calling auth user is a member of the given gym. Used by RLS policies.';

revoke all on function public.auth_user_has_gym_access(uuid) from public;
grant execute on function public.auth_user_has_gym_access(uuid) to authenticated;

-- Enable RLS on tenancy tables. Policies in 0004 wire up the rest.
alter table public.gyms        enable row level security;
alter table public.gym_members enable row level security;
alter table public.gym_configs enable row level security;

-- gyms: a user sees a gym row iff they're a member of it.
create policy gyms_select_own on public.gyms
  for select to authenticated
  using (public.auth_user_has_gym_access(id));

-- gym_members: a user sees their own membership rows. (Cross-user visibility
-- within the same gym is a v1.5 concern when multi-user lands.)
create policy gym_members_select_own on public.gym_members
  for select to authenticated
  using (user_id = auth.uid());

-- gym_configs: a user sees the config of any gym they belong to.
create policy gym_configs_select_own on public.gym_configs
  for select to authenticated
  using (public.auth_user_has_gym_access(gym_id));

-- Note: no INSERT/UPDATE/DELETE policies for authenticated users in v1.
-- Tenancy bootstrap (creating gyms, assigning members) is service-role only.
-- Config edits are also service-role in v1; v1.5 will add a UI + policies.
