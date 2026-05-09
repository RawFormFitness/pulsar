-- 0007_cancel_ledger_schema.sql
--
-- Reshape `cancellations` to back the Powerhouse cancel ledger CSV
-- (replaces the prior ABC "Cancelled Members" snapshot adapter).
--
-- The cancel ledger is the single source of truth for three of the four
-- loss tiles (Cancels, Revocations, Pending Cancel). Partitioning them
-- requires a row-level cancel date and the cancellation reason text —
-- neither of which existed on the old schema.
--
-- Schema delta:
--   * drop columns: agreement_number (ledger has no stable row id),
--                   primary_member, member_status (snapshot leftovers).
--   * add columns: cancel_date, effective_date, reason,
--                  membership_amount_cents, membership_type, out_of_contract.
--   * member_name becomes NOT NULL (it is part of the new natural key).
--   * natural key: (gym_id, cancel_date, member_name). Re-imports overwrite
--     by design; the ledger has no stable identifier finer than this.
--
-- The old data is dropped — none of it carries forward (different schema,
-- different source). The matching `import_history` rows are also removed
-- so re-importing the ledger doesn't trip source_hash de-dup against a
-- stale entry.

-- 1. Wipe stale data tied to the old schema/format.
delete from public.cancellations;
delete from public.import_history where format = 'abc_cancel';

-- 2. Drop the old natural key + columns.
alter table public.cancellations
  drop constraint if exists cancellations_natural_key;

alter table public.cancellations
  drop column if exists agreement_number,
  drop column if exists primary_member,
  drop column if exists member_status;

-- 3. Add the ledger columns.
alter table public.cancellations
  add column cancel_date              date,
  add column effective_date           date,
  add column reason                   text,
  add column membership_amount_cents  integer,
  add column membership_type          text,
  add column out_of_contract          boolean;

-- 4. cancel_date and member_name are required. Backfill is moot (table is
--    empty after step 1), so set NOT NULL straight away.
alter table public.cancellations
  alter column cancel_date set not null,
  alter column member_name set not null;

-- 5. New natural key. (gym_id, cancel_date, member_name) is unique enough
--    at this scale; if a duplicate is ever observed in real data, the next
--    import of the ledger will overwrite by design.
alter table public.cancellations
  add constraint cancellations_natural_key
    unique (gym_id, cancel_date, member_name);

-- 6. An index on (gym_id, cancel_date) makes the period-filter scan in the
--    analytics engine a btree range scan instead of a seq scan.
create index if not exists cancellations_gym_id_cancel_date_idx
  on public.cancellations (gym_id, cancel_date);

comment on table public.cancellations is
  'Powerhouse cancel ledger rows. Partitioned by the analytics engine into '
  'cancels / revocations / pending-cancel via cancel_date + effective_date '
  '+ reason. Natural key: (gym_id, cancel_date, member_name).';
