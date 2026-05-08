-- 0005_indexes.sql
-- Access-pattern indexes. Every query in lib/db/ is gym_id-scoped + date-range,
-- so all indexes lead with gym_id and then a date column.
--
-- Natural-key uniqueness constraints (from 0002) already provide btree indexes
-- on (gym_id, agreement_number / source_id), which covers point lookups.
-- These indexes are for range scans and ordering.

-- leads: monthly cohorts by created_at.
create index leads_gym_created_at_idx
  on public.leads (gym_id, created_at);

-- leads: salesperson filters used by attribution + reporting.
create index leads_gym_salesperson_idx
  on public.leads (gym_id, salesperson)
  where salesperson is not null;

-- sales: monthly cohorts by queue_date.
create index sales_gym_queue_date_idx
  on public.sales (gym_id, queue_date);

-- sales: salesperson filters.
create index sales_gym_salesperson_idx
  on public.sales (gym_id, salesperson)
  where salesperson is not null;

-- members: latest snapshot lookups ("members as of date X").
create index members_gym_as_of_idx
  on public.members (gym_id, as_of desc);

-- members: churn-risk queries ("last_visit_date older than threshold").
create index members_gym_last_visit_idx
  on public.members (gym_id, last_visit_date)
  where last_visit_date is not null;

-- rfc_entries: forecast queries by status_date and days_past_due.
create index rfc_entries_gym_status_date_idx
  on public.rfc_entries (gym_id, status_date);

create index rfc_entries_gym_days_past_due_idx
  on public.rfc_entries (gym_id, days_past_due)
  where days_past_due is not null;

-- promo_windows: range overlap lookups.
create index promo_windows_gym_dates_idx
  on public.promo_windows (gym_id, start_date, end_date);
