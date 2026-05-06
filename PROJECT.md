# Pulsar

The analytics dashboard for independent gyms. Built by someone who actually sells gym memberships.

## What it is

A modern sales + retention dashboard for indie gyms running on **ABC Ignite** and **Gym Sales**. Owners and managers upload CSV exports and get the metrics that matter on one screen — without the bloat or cost of enterprise tools.

**Tagline:** Run your gym on signal, not noise.

## Who it's for

- **Primary user:** sales manager / general manager at an independent gym (1–5 locations)
- **Buyer:** gym owner — same person about half the time
- **Not for:** big-box chains, franchise HQs, boutique studios with totally different data

## Core value proposition

ABC Ignite has reporting, but it's slow, dated, and buried under a hundred views. Pulsar surfaces the six numbers that drive a gym business and lets the manager act on them today.

## MVP feature set (locked)

**Sales side**
1. Lead funnel dashboard (leads → trials → joins, with conversion %)
2. Lead source ROI (which channels actually produce paying members)
3. Salesperson leaderboard + stalled leads list

**Retention side**
4. Churn risk list (members ranked by likelihood to cancel)
5. Retention cohort chart (by join month)
6. Net member growth + MRR

**Plumbing**
- Drag-and-drop CSV import for ABC Ignite + Gym Sales exports
- Daily email digest with the three numbers that matter most

## Explicitly out of scope for v1

- Class scheduling, billing, payments, member-facing app
- Direct API integrations to ABC or Gym Sales (CSV-first)
- Mobile app (web responsive is enough)
- Trainer scheduling or PT management

## Architecture decisions

- **Frontend:** Next.js (App Router) + TypeScript + Tailwind + shadcn/ui
- **Charts:** Recharts
- **Backend:** Next.js API routes (no separate server)
- **Database:** Supabase (Postgres + Auth + Storage)
- **Hosting:** Vercel
- **CSV parsing:** Papaparse on the client for previews; server-side parsing for the real import
- **Multi-tenant from day one:** every row tagged with `gym_id`, Row-Level Security in Supabase

## Data sources (v1)

Three CSV exports, parsers already prototyped in `/prototype`:

1. **Gym Sales lead export** — flat snake_case CSV, 34 columns, leads + statuses
2. **ABC Ignite Membership Sales by Sign Date** — grouped report (by club → salesperson) with title rows, sub-headers, and footer totals
3. **ABC Ignite Active Members** — same grouped pattern, with member status, MRR data, last visit date, check-in counts

**Important:** ABC exports are NOT flat tables. They're hierarchical reports where group context (club name, salesperson) is encoded as text rows between data rows. The parser must walk row by row and attach the most recent group label to each data row. See `/prototype/parsers.py` for the working logic.

## Goals

- **3 months:** pilot live at our gym, daily use by the sales team
- **6 months:** 5 paying gyms, $400 MRR
- **12 months:** 50 gyms, ~$4k MRR side-project income

## Pricing direction (not yet locked)

- $49–$99/month per gym, flat rate
- Free trial: 14 days, no credit card
- Self-serve onboarding (no sales calls required)
