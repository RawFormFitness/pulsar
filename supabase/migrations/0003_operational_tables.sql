-- 0003_operational_tables.sql
-- Operational tables for ingestion observability.
-- Same multi-tenant rules as domain tables: gym_id required, RLS on.

-- =============================================================================
-- import_history — one row per file imported.
-- The `format` column is text (not an enum) deliberately: per gym_configs
-- conventions, gyms may add formats over time and the schema stays generic.
-- `source_hash` is a content hash so the importer can detect & skip duplicates.
-- =============================================================================
create table public.import_history (
  id              uuid primary key default gen_random_uuid(),
  gym_id          uuid not null references public.gyms(id) on delete cascade,

  format          text not null,         -- e.g., 'leads', 'abc_sales', 'abc_members', 'abc_rfc', 'cancel_ledger'
  filename        text not null,
  storage_path    text,                  -- Supabase Storage path of the raw upload, if retained
  source_hash     text,                  -- sha256 of raw bytes for re-import detection

  row_count       integer not null default 0,
  warnings_count  integer not null default 0,

  -- The source's reporting window, when the report carries one (e.g., "01/01/2025 - 05/08/2026"
  -- in the cancel/RFC headers). Optional because not every source declares it.
  reporting_period_start  date,
  reporting_period_end    date,

  imported_by     uuid references auth.users(id) on delete set null,
  imported_at     timestamptz not null default now()
);

create index import_history_gym_imported_at_idx
  on public.import_history (gym_id, imported_at desc);

create index import_history_gym_format_idx
  on public.import_history (gym_id, format);

create unique index import_history_source_hash_uniq
  on public.import_history (gym_id, source_hash)
  where source_hash is not null;

comment on table public.import_history is
  'One row per file ingested. source_hash makes re-imports idempotent.';

alter table public.import_history enable row level security;

-- =============================================================================
-- validation_runs — output of validation checks per import.
-- E.g., "sales reconcile (Web + Walk-in = Total)", "member math reconciles".
-- Each check yields one row; details jsonb carries the diagnostic payload.
-- =============================================================================
create table public.validation_runs (
  id          uuid primary key default gen_random_uuid(),
  gym_id      uuid not null references public.gyms(id) on delete cascade,

  import_id   uuid references public.import_history(id) on delete cascade,
  check_name  text not null,                 -- e.g., 'sales_reconciliation'
  passed      boolean not null,
  details     jsonb not null default '{}'::jsonb,

  ran_at      timestamptz not null default now()
);

create index validation_runs_gym_import_idx
  on public.validation_runs (gym_id, import_id);

create index validation_runs_gym_check_idx
  on public.validation_runs (gym_id, check_name);

comment on table public.validation_runs is
  'Per-import validation results. One row per check. details jsonb is free-form.';

alter table public.validation_runs enable row level security;
