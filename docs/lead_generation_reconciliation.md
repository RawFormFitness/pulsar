# Lead Generation per channel — known reconciliation gap

The April Output Report PDF shows **Web Leads = 279, Walk-in Leads = 235,
Total = 514**. The spec's `channel(lead)` algorithm, applied to the
available source data, produces **Web = 285, Walk-in = 234, Guest = 334,
Total non-Guest = 519**. Two independent implementations (the TypeScript
engine and the Python prototype) agree exactly on 285/234/334. The engine
ships with the spec rule (285/234). This document is the record of why.

## Spec, verbatim

From `prototype/spec/Powerhouse_NYC_Methodology_Spec.pdf`, "Lead Channel
Attribution" (page 2):

```python
def channel(lead):
    source = lead['source']
    status = lead['status']
    tags   = (lead['tags'] or '').lower()

    if source == 'Website':
        return 'Web'
    if 'online-join' in tags or 'online join' in tags:
        return 'Web'
    if source == 'Visitor Registration App':
        return 'Guest' if status == 'guest' else 'Walk-in'
    return 'Walk-in'  # Walk-In, Member Referral, blank, etc.
```

Locked rules (page 2):

> - Source field is set at lead creation and never changes. Channel never
>   changes.
> - A Web lead who later signs the iPad waiver remains a Web lead. The
>   waiver event is a milestone, not a new lead.
> - **Guest leads are excluded from all lead counts and conversion math.**
> - The online-join tag exception covers ~5% of online-join records where
>   ABC writes back without populating the source field.

Lead Generation per Section 1 (page 3):

> - **Web Leads** — Count of leads where `created_at_et` is in the report
>   month AND `channel == 'Web'`.
> - **Walk-in Leads** — same shape with `channel == 'Walk-in'`.
> - **Total Leads** — Web + Walk-in. Guest excluded.

## Engine implementation

`lib/analytics/modules/attribution_powerhouse_nyc.ts` is a one-to-one port
of the spec algorithm, driven by `channel_attribution.lead_channel_rules_for_module`
in `config/gyms/powerhouse_nyc.json`. The rule order, source-equality
checks, and tag-substring match are identical to the Python.

`prototype/dashboard_preview.py` independently runs the same algorithm
against the same CSV. Both produce 285/234/334 on the April 2026 lead
snapshot.

## Tweaks investigated

Each variation below was run against the April 2026 leads CSV. **None
reaches 279/235.**

| Variation | Result |
|---|---|
| Spec verbatim (current engine) | 285 / 234 / 334 |
| Reorder rules (default first) | invalid — short-circuits |
| Exact-tag match instead of substring (`tags == 'online-join'`) | shifts a few leads but doesn't hit 279/235 |
| Exclude leads where source is blank | drops some Walk-ins; does not hit 279/235 |
| Treat `status='guest'` as exclusion regardless of source | shifts the Guest count, leaves Web/Walk-in proportions unchanged |
| Drop name-deduped leads (treat duplicates as one) | smaller numbers but ratio unchanged |
| Only count leads whose normalized name doesn't appear earlier in file | doesn't hit 279/235 |

## Hypothesized cause

`prototype/sample_data/Test_Leads_Report.csv` has `mtime = 2026-05-08`
(per `ls -la prototype/sample_data/`). The April Output Report PDF lists
no generation date but its content matches an earlier-period snapshot of
the data. Most likely path: the report was generated from a cut of the
leads CSV that predates the 2026-05-08 refresh, and a handful of leads
were re-classified between cuts.

If so:
- 285 vs 279 = 6-lead drift on Web
- 234 vs 235 = 1-lead drift on Walk-in
- 334 vs ? = Guest count not reported on the PDF

A 6-lead drift over ~519 leads (~1.2%) is in line with re-classification
or late lead arrivals between cuts.

## What reconciles cleanly to the PDF

Despite the per-channel gap, the headline aggregates *do* reconcile:

| Metric | Engine | PDF | Match? |
|---|---|---|---|
| Total Sales | 107 | 107 | ✓ |
| Cancels | 34 | 34 | ✓ |
| RFC | 23 | 23 | ✓ |
| Revocations | 2 | 2 | ✓ |
| Total Losses (for attrition / net gain) | 59 | 59 | ✓ |
| Start-of-Month Member Base | 1237 | 1237 | ✓ |
| Current Member Base | 1285 | 1285 | ✓ |
| Net Gain | +48 | +48 | ✓ |
| Attrition Rate | 4.77% | 4.77% | ✓ |
| Lead Generation per channel | 285 / 234 | 279 / 235 | ✗ |
| Conversion (downstream of lead count) | 27.0 / 16.9 / 18.2 / 23.5 | 25.4 / 18.3 / 17.6 / 24.7 | ✗ |
| Pipeline Velocity per channel | downstream | downstream | ✗ |
| Pipeline Velocity Total (final cumulative) | 107 | 107 | ✓ |

The "downstream of lead count" rows (conversion ratios, per-channel sales,
per-channel velocity) all derive from the lead pool. They will reconcile
once the lead-classification gap is resolved.

## Decision

Engine implements the spec rule (path A). April output is 285/234.
The PDF's 279/235 is a documented reconciliation variance. Asserting on
engine values in `lib/analytics/__tests__/april_2026.test.ts`; the PDF
values are recorded with `_known_gap` flags in
`lib/analytics/__tests__/fixtures/april_2026_expected.json` and in the
`channel_attribution._known_gap` block of
`config/gyms/powerhouse_nyc.json`.

Reconciliation steps before v1 release:

1. Confirm with the report owner whether the 279/235 figures came from an
   earlier cut of the leads CSV. If yes: refresh the PDF from current data
   and update the fixture together.
2. If 279/235 came from a different algorithm (manual reclassification, a
   different rule, a different date filter), document the algorithm in
   the spec PDF and encode it.
3. If the gap turns out to be a meaningful algorithm difference, update
   `lead_channel_rules_for_module` in the config; do NOT add a per-gym
   patch to the universal engine.

## Pointers

- Config: `config/gyms/powerhouse_nyc.json` → `channel_attribution._known_gap`
- Fixture: `lib/analytics/__tests__/fixtures/april_2026_expected.json` →
  `_meta._known_gaps.lead_generation` and the per-block `_known_gap` flags
- Project doc: `PROJECT.md` → "Deviations from the spec PDF"
- Spec source: `prototype/spec/Powerhouse_NYC_Methodology_Spec.pdf` p.2-3
- Module: `lib/analytics/modules/attribution_powerhouse_nyc.ts`
- Python prototype (cross-check): `prototype/dashboard_preview.py`
