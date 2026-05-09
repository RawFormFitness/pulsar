-- 0008_cancel_ledger_contact_columns.sql
--
-- Follow-up to 0007: the cancel_ledger parser captures the member's
-- primary_phone and email (real columns in the source CSV), but 0007
-- forgot to add the corresponding table columns. The first import after
-- 0007 fails with PGRST204 "could not find the 'email' column" because
-- of this gap. Adding both as nullable text — they're informational, not
-- part of any natural key.

alter table public.cancellations
  add column if not exists primary_phone  text,
  add column if not exists email          text;
