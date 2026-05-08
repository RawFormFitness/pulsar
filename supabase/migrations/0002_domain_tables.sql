-- 0002_domain_tables.sql
-- Fact tables for parsed CSV imports.
-- Every table:
--   * has gym_id uuid not null references gyms(id) on delete cascade
--   * has its natural key constrained as (gym_id, ...), never globally
--   * carries a `raw jsonb` column for unmapped source columns (forward-compat)
-- RLS is enabled here; policies live in 0004_rls_policies.sql.

-- =============================================================================
-- leads — Gym Sales lead export, one row per lead.
-- Natural key: (gym_id, source_id).
-- The source export's `id` is text-shaped in practice (large numeric IDs);
-- we store it verbatim to avoid lossy int conversions.
-- =============================================================================
create table public.leads (
  id                  uuid primary key default gen_random_uuid(),
  gym_id              uuid not null references public.gyms(id) on delete cascade,

  source_id           text not null,                -- the export's `id` column
  status              text,
  source              text,
  tags                text[] not null default '{}',

  first_name          text,
  last_name           text,
  email               text,
  phone               text,

  salesperson         text,
  sale_at             timestamptz,                  -- when the lead converted
  waiver_signed_date  timestamptz,
  first_contact       timestamptz,
  trial_end_at        timestamptz,
  leaving_at          timestamptz,
  leaving_reason      text,

  created_at          timestamptz not null,         -- from the source export
  updated_at          timestamptz,
  imported_at         timestamptz not null default now(),

  raw                 jsonb not null default '{}'::jsonb,

  constraint leads_natural_key unique (gym_id, source_id)
);

comment on table public.leads is
  'Gym Sales lead export rows. Re-imports upsert on (gym_id, source_id).';

alter table public.leads enable row level security;

-- =============================================================================
-- sales — ABC Ignite sale agreements.
-- Natural key: (gym_id, agreement_number).
-- agreement_number is large but representable as bigint; ABC's IDs are numeric.
-- =============================================================================
create table public.sales (
  id                uuid primary key default gen_random_uuid(),
  gym_id            uuid not null references public.gyms(id) on delete cascade,

  agreement_number  bigint not null,
  member_name       text,
  plan_name         text,                  -- "Membership Type" in source
  agreement_type    text,
  payment_plan      text,
  term              text,
  department        text,

  queue             text,
  queue_date        timestamptz,           -- the sale's effective date

  salesperson       text,
  club_name         text,

  imported_at       timestamptz not null default now(),

  raw               jsonb not null default '{}'::jsonb,

  constraint sales_natural_key unique (gym_id, agreement_number)
);

comment on table public.sales is
  'ABC Ignite "Membership Sales by Sign Date" rows. Upsert on (gym_id, agreement_number).';

alter table public.sales enable row level security;

-- =============================================================================
-- members — Active member snapshot rows.
-- Snapshot-style: an `as_of` timestamp captures the import that produced this
-- row, so the analytics-engine can answer "active members as of date X" by
-- selecting the latest snapshot ≤ X. Re-imports for the SAME as_of upsert.
-- Natural key: (gym_id, agreement_number, as_of).
-- =============================================================================
create table public.members (
  id                  uuid primary key default gen_random_uuid(),
  gym_id              uuid not null references public.gyms(id) on delete cascade,

  agreement_number    bigint not null,
  as_of               timestamptz not null,        -- snapshot timestamp

  member_name         text,
  primary_member      text,                        -- "Yes"/"No" verbatim
  member_status       text,
  plan_name           text,                        -- "Membership Type" in source
  payment_plan        text,
  management_group    text,                        -- ABC group label
  club_name           text,

  begin_date          date,
  expiration_date     date,
  last_visit_date     date,

  next_due_amount     numeric(12, 2),
  renewal_cash        numeric(12, 2),
  renewal_eft         numeric(12, 2),
  renewal_statement   numeric(12, 2),
  mrr                 numeric(12, 2),              -- engine-derived; nullable

  visits_used         integer,
  check_in_count      integer,

  age                 integer,
  gender              text,
  email               text,
  primary_phone       text,

  imported_at         timestamptz not null default now(),

  raw                 jsonb not null default '{}'::jsonb,

  constraint members_natural_key unique (gym_id, agreement_number, as_of)
);

comment on table public.members is
  'Active-member snapshot rows. One row per (agreement, as_of). Latest as_of per agreement = current state.';

alter table public.members enable row level security;

-- =============================================================================
-- rfc_entries — Members removed for collections (ABC RFC report).
-- An agreement can re-appear on different status_dates; key on both.
-- Natural key: (gym_id, agreement_number, status_date).
-- =============================================================================
create table public.rfc_entries (
  id                uuid primary key default gen_random_uuid(),
  gym_id            uuid not null references public.gyms(id) on delete cascade,

  agreement_number  bigint not null,
  status_date       date not null,         -- when the member was RFC'd

  member_name       text,
  member_status     text,
  plan_name         text,
  salesperson       text,
  club_name         text,

  begin_date        date,
  last_billing_date date,

  term              text,
  payment_method    text,

  next_due_amount   numeric(12, 2),
  total_past_due    numeric(12, 2),
  days_past_due     integer,

  imported_at       timestamptz not null default now(),

  raw               jsonb not null default '{}'::jsonb,

  constraint rfc_entries_natural_key unique (gym_id, agreement_number, status_date)
);

comment on table public.rfc_entries is
  'ABC "Return For Collections" rows. Key is (agreement_number, status_date) per gym.';

alter table public.rfc_entries enable row level security;

-- =============================================================================
-- cancellations — Parsed Cancel Report rows.
-- PROJECT.md deviation from the spec PDF (search "Deviations from the spec PDF"):
--   v1 does NOT split into cancels vs revocations and does NOT store reason text.
--   Treat all cancellations as one undifferentiated stream.
-- The Cancel Report has 4 columns: Agreement #, Member Name, Primary Member,
-- Member Status. There is no cancel_date column in the source; the report's
-- header row carries the date range, which is captured on import_history.
-- Natural key: (gym_id, agreement_number).
-- =============================================================================
create table public.cancellations (
  id                uuid primary key default gen_random_uuid(),
  gym_id            uuid not null references public.gyms(id) on delete cascade,

  agreement_number  bigint not null,
  member_name       text,
  primary_member    text,                  -- "Yes"/"No" verbatim
  member_status     text,                  -- e.g., "Cancelled", "Pending Cancel"

  imported_at       timestamptz not null default now(),

  raw               jsonb not null default '{}'::jsonb,

  constraint cancellations_natural_key unique (gym_id, agreement_number)
);

comment on table public.cancellations is
  'Cancel Report rows. v1 deviation: no is_revocation flag, no reason_text. One stream.';

alter table public.cancellations enable row level security;

-- =============================================================================
-- promo_windows — Per-gym promo cohorts (named date ranges).
-- Storing them as rows lets the v1.5 UI manage them. v1's analytics-engine
-- can read these OR pull them from gym_configs.config — the schema is generic.
-- =============================================================================
create table public.promo_windows (
  id          uuid primary key default gen_random_uuid(),
  gym_id      uuid not null references public.gyms(id) on delete cascade,

  name        text not null,
  start_date  date not null,
  end_date    date not null,

  created_at  timestamptz not null default now(),

  constraint promo_windows_dates_ordered check (end_date >= start_date),
  constraint promo_windows_natural_key unique (gym_id, name)
);

comment on table public.promo_windows is
  'Per-gym promo cohort definitions (date ranges + label).';

alter table public.promo_windows enable row level security;
