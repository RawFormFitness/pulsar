# Pulsar

A configurable analytics engine for independent gyms.

## What it is

Pulsar takes raw CSV exports from a gym's existing software (ABC Ignite, Gym Sales, etc.) and produces a focused dashboard with the metrics that drive the business — sales pipeline, conversion, retention, MRR, member engagement.

The product is a **configurable engine**, not a fixed report. Each gym has a config that defines its channels, plan exclusions, promo windows, attribution rules, and thresholds. The engine runs that config against the gym's data. Powerhouse Gym NYC is the reference implementation and v1's only customer.

**Tagline:** Run your gym on signal, not noise.

## v1 acceptance test

Pulsar v1 is "done" when, given Powerhouse NYC's source files for April 2026, it produces output that exactly matches `prototype/spec/April_Output_Report.pdf` — with the deviations noted at the bottom of this document.

The methodology spec at `prototype/spec/Powerhouse_NYC_Methodology_Spec.pdf` describes how those numbers are computed. Treat it as **a worked example** of one gym's config — not as a universal product spec. The shape of the engine is universal; the values come from the config.

## Architecture principle: three levels of flexibility

Every feature gets categorized into one of three levels.

**Level 1 — Hardcoded.** Universal concepts that mean the same thing at every gym: the math behind MRR, conversion rates, cohort retention; the structure of the database; the validation rules ("sales reconcile, member math reconciles"); the parsing/upsert pipeline.

**Level 2 — Configured.** Per-gym values plugged into universal concepts: plan exclusion lists, promo windows, channel attribution rules, RFC tier boundaries, churn thresholds, timezone, the data dictionary mapping CSV columns to Pulsar fields. Lives in a per-gym JSON config.

**Level 3 — Custom modules.** The escape hatch for genuinely gym-specific logic that can't be expressed as config values: e.g., Powerhouse NYC's channel attribution function (a small program based on source/status/tags). Implemented as named modules (`attribution_powerhouse_nyc.ts`) that the gym's config points at. We use this sparingly.

**Hard rule:** No business logic ever hardcoded into core code. If it's gym-specific, it lives in config or a custom module.

## Source files (v1)

Five source inputs per gym per import:

1. **Leads** (Gym Sales export) — flat snake_case CSV, all leads ever, includes `status`, `source`, `tags`, timestamps, `salesperson`, `waiver_signed_date`
2. **Sales** (ABC Ignite "Membership Sales by Sign Date") — grouped report, 2 header lines to skip, agreements grouped by club → salesperson
3. **Member Snapshot** (ABC Ignite "Active Members") — grouped report, 2 header lines to skip, current active members with MRR data, last visit, check-in count
4. **RFC** (ABC Ignite — members removed for collections) — grouped report; title row, club-number sub-header, real headers, then group-divider rows separating the data block. Parser uses the standard grouped-report engine to locate headers and skip group rows.
5. **Cancel Ledger** (Powerhouse internal CSV — replaces the older ABC "Cancelled Members" snapshot) — flat format with one header row; col-0 is the cancellation queue date (header is unlabeled), then Member Name (last, first), Primary Phone, Email, Effective Date, membership $, Membership Type, Out Of Contract?, Reason For Cancel. The engine partitions ledger rows into Cancels (voluntary, eff in period) and Revocations (gym-initiated reason) via cancel_date + reason classification. Pending Cancel is computed separately from the Members snapshot per spec rule, not from the ledger — see the Pending Cancel deviation below.

Working parsers for the three core CSVs are in `prototype/parsers.py`. They handle the grouped-report format (title rows, sub-headers attached as group context, footer totals dropped). RFC and Cancel parsers will be added.

## MVP feature set

**Data ingestion**
- Drag-and-drop CSV upload, one file at a time or batch
- Format auto-detection (which report is this?)
- Preview before commit (row counts, sample data, validation warnings)
- Re-import safe via upsert keyed on stable IDs (agreement number, lead id)
- Import history log

**Core analytics (per Powerhouse NYC config)**
- Lead Generation: Web Leads, Walk-in Leads, Total Leads
- Sales: Web Sales, Walk-in Sales, Total Sales (after plan exclusions)
- Conversion: Web Visit Conversion, Web Visit-to-Sale Conversion, Web Sales Conversion, Walk-in Sales Conversion
- Losses: Cancels, RFC, Revocations, Pending Cancel
- Membership: Start-of-Month Base, Current Member Base, Net Gain, Attrition Rate
- Pipeline Velocity (cumulative): Same day / 7 days / 30 days / 31+ days, per channel

**Action layer**
- Past-due / RFC forecast workflow (six urgency tiers, sorted by promo cohort then RFC date)
- Churn risk list (configurable threshold, currently 30 days no-visit)

**Validation**
- Sales reconciliation (Web + Walk-in = Total)
- Velocity rows reconcile
- Member math reconciles (Start + New − Losses = Current)
- Conversion rate sanity bounds (5%–40%, flag if outside)
- Promo window coverage (alert on untagged sales in known promo dates)

**Multi-tenancy**
- Every row tagged with `gym_id`
- Supabase Row-Level Security
- Auth via Supabase (email + password for v1, magic link available)
- Each gym's config lives in a `gym_configs` table or equivalent

## Out of scope for v1

- Class scheduling, billing, payments, member-facing app
- Live API integrations (CSV-first)
- Mobile-native app (responsive web is enough)
- Multi-user roles within a gym (one user per gym in v1)
- Settings UI for editing the config (config is hand-edited JSON in v1, UI in v1.5)
- AI features (those are Phase 3)

## Tech stack

- **Frontend:** Next.js 15 (App Router) + TypeScript + Tailwind v4 + shadcn/ui
- **Charts:** Recharts
- **Backend:** Next.js API routes + Server Actions
- **Database:** Supabase (Postgres + Auth + Storage + RLS)
- **CSV parsing:** Papaparse (browser preview) + server-side parsers ported from `prototype/parsers.py`
- **Hosting:** Vercel

## Goals

- **By end of month:** v1 reproduces the April report from raw source files at Powerhouse NYC
- **3 months:** daily use by Powerhouse NYC sales team, replaces ABC's reports for daily decisions
- **6 months:** 3–5 paying gyms, ~$300 MRR, validated configurability
- **12 months:** 50 gyms, ~$4k MRR side-project income

## Deviations from the spec PDF

The methodology spec PDF is a worked example, not the final product spec. Where Pulsar's behavior intentionally diverges from the spec, we document it here. PROJECT.md takes precedence over the spec PDF when they conflict.

- **Member-status terminology — "Ok" not "Active."** The spec PDF refers to an "Active" member status, but the string "Active" does not appear in Powerhouse's actual data. The canonical active value is `"Ok"`. Config and engine code use `"Ok"`; the spec's "Active" is treated as a synonym in documentation only.

- **Pending Cancel — engine follows spec rule (snapshot status='Pending Cancel' after plan exclusions), which produces 13 for April 2026.** The April Output Report PDF shows 18; the discrepancy is documented as a known gap and will be reconciled with the report owner before v1 release. Full investigation in `docs/pending_cancel_reconciliation.md`.

- **Lead Generation per channel — engine produces 285 Web / 234 Walk-in for April 2026; PDF shows 279 / 235.** The spec's `channel(lead)` algorithm is implemented as a verified Python port; both the TypeScript engine and `prototype/dashboard_preview.py` produce identical 285/234/334 from the April lead snapshot. No tweak to the algorithm reaches 279/235. The sample CSVs were last updated 2026-05-08; the report PDF predates this. Most likely cause: report was generated from an earlier cut of the leads data. Total Sales (107), losses (59), and the membership block (1237→1285, +48, 4.77%) all reconcile cleanly to the PDF — only the per-channel lead split varies. Will be reconciled with the report owner / by refreshing the PDF before v1 release. Full investigation in `docs/lead_generation_reconciliation.md`.

## Open architectural questions (deferred to v2)

- **Gym-config storage source of truth.** v1 reads each gym's config from a JSON file under `config/gyms/<slug>.json` (committed to source control). The `gym_configs` Supabase table is provisioned in the schema but is not yet the canonical source — it's reserved for v2 multi-tenant runtime config (the eventual settings UI promised in "Out of scope for v1" will write to it). Migration path: when v2 ships, sync the JSON files into the table on first deploy, point the engine loader at the table, and treat the JSON files as a legacy bootstrap input. Until then: edit JSON, commit, deploy. Do NOT scatter config reads across both surfaces — the engine reads from JSON in v1, period.

## Reference docs

- `prototype/spec/Powerhouse_NYC_Methodology_Spec.pdf` — Powerhouse NYC's full calculation spec (treat as worked example)
- `prototype/spec/April_Output_Report.pdf` — expected v1 output for April 2026 (acceptance test, with the deviation above applied)
- `prototype/parsers.py` — working CSV parsers for the three core sample files
- `prototype/dashboard_preview.py` — proof-of-concept metrics computation
- `prototype/sample_data/` — five real CSVs for development (NEVER commit real gym data)
