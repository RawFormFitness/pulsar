# Pending Cancel — known reconciliation gap

The April Output Report PDF shows **Pending Cancel = 18**. The methodology
spec's rule, applied to the available source data, produces **13**. None of
the rules investigated could reproduce 18 without reverse-engineering. The
engine ships with the spec rule (13). This document is the record of why.

## Spec, verbatim

From `prototype/spec/Powerhouse_NYC_Methodology_Spec.pdf`, Section 4: Losses
(page 4):

> **Pending Cancel** — Count of members in Member_Snapshot.csv where
> Member Status == 'Pending Cancel' (after applying plan exclusions).

That's the entire definition. Snapshot only, plan-exclusion filter only.
Applied to the April 2026 snapshot in `prototype/sample_data/`, this rule
yields **13** rows.

## Candidate counts investigated

Each rule below was run against the April 2026 fixture. None hits 18 except
a reverse-engineered union with a hand-tuned exclusion (path C, rejected).

| Rule | Count |
|---|---|
| Spec verbatim — snapshot `'Pending Cancel'` AND `plan NOT IN excluded_plans` | **13** |
| Snapshot `'Pending Cancel'` raw (no plan filter) | 13 |
| Ledger: `cancel_date in April AND effective_date > Apr 30` | 11 |
| Ledger: `cancel_date <= Apr 30 AND (effective_date null OR > Apr 30)` (all-history pending pool) | 20 |
| Ledger: `effective_date in May 2026` (any cancel_date) | 24 |
| Ledger: `effective_date >= 2026-04-01 AND cancel_date <= 2026-04-30` | 44 |
| Snapshot `Expiration Date in May 2026` | 17 |
| **Snapshot pending ∪ April-ledger-pending (deduped by name)** | 19 |
| **Snapshot pending ∪ April-ledger-pending non-revocation (deduped)** | **18** ← reverse-engineered |

The only rule that reaches 18 requires (a) unioning the snapshot with the
ledger and (b) excluding revocations from the ledger side. Both pieces are
absent from the spec.

## The 18-row union (reverse-engineered, NOT used)

For reference. The engine does not implement this rule. Path C below.

| # | Member | Source | Cancel | Effective | Snap status | Reason |
|---|---|---|---|---|---|---|
| 1 | Balaji, Sid | BOTH | 2026-04-30 | 2026-05-11 | Pending Cancel | Switched to working remote |
| 2 | Brown, Nathan | BOTH | 2026-04-10 | 2026-06-09 | Pending Cancel | Office moved Hudson Yards → FiDi |
| 3 | DeLuca, Dylan | snapshot | (3/26 in ledger) | (5/9) | Pending Cancel | move - Old Brookville |
| 4 | Ibarra, Maximiliano A | BOTH | 2026-04-14 | 2026-06-12 | Pending Cancel | Lifetime Pickleball |
| 5 | Jiang, Edgar | BOTH | 2026-04-22 | 2026-06-18 | Pending Cancel | no contract — hasn't used gym |
| 6 | Kanjilal, Devjit | snapshot | — | — | Pending Cancel | (no ledger row) |
| 7 | Kotler, Thomas | snapshot | (3/17 in ledger) | (6/11) | Pending Cancel | Move to Florida |
| 8 | Pelka, Karol | snapshot | (3/17 in ledger) | (unparseable) | Pending Cancel | Move to Florida |
| 9 | Sanchez, Yahir | BOTH | 2026-04-13 | 2026-05-29 | Pending Cancel | Contracted to Singapore 6 mo |
| 10 | Torres, John | snapshot | (5/1 in ledger — POST-April) | (5/1) | Pending Cancel | Move to New Rochelle |
| 11 | Trevor, Jake | snapshot | — | — | Pending Cancel | (no ledger row) |
| 12 | Wayne, Richard | snapshot | (5/5 in ledger — POST-April) | (6/5) | Pending Cancel | Not training with Nico |
| 13 | Zmoira, Larry | snapshot | (5/1 in ledger — POST-April) | (6/11) | Pending Cancel | Hasn't used club since Dec |
| 14 | Hadi Abdelaal | ledger | 2026-04-01 | 2026-05-03 | (not in snap) | Lives in Queens; job temporary |
| 15 | George Natsis | ledger | 2026-04-03 | 2026-05-03 | (not in snap) | Too far from work (86th St) |
| 16 | Parker Lowell | ledger | 2026-04-20 | 2026-05-03 | (not in snap) | Move to Cincinnati |
| 17 | Salene Parnese | ledger | 2026-04-30 | 2026-05-02 | (not in snap) | Client stopped training - Vanyo |
| 18 | Johana Maron | ledger | 2026-04-30 | 2026-05-06 | (not in snap) | Low usage |
| — | Rebecca Vanyo | ledger | 2026-04-30 | 2026-05-05 | — | Trainer no longer here - Salene |

The Vanyo row is excluded by the path-C rule because her reason matches the
revocation-substring list (`no longer here`) and is therefore counted under
the Revocations tile. Without that exclusion the union is 19, not 18.

## Why path C was rejected

### Q1. Why exclude revocations from the ledger side?

There is no principled reason. Excluding Vanyo is what makes the math hit
18. The spec is silent on whether the report's 18 includes or excludes
members who also classify as revocations.

### Q2. Is the snapshot "lagging" the ledger?

No — the opposite. The April snapshot in the fixture contains members with
**May** cancel_dates in the ledger (Torres, Wayne, Zmoira), meaning the
snapshot was taken some time after May 5. The snapshot's Pending Cancel
list reflects activity from at least a 2-month window straddling April,
not a clean April-end view. The "lag" intuition that initially motivated
the union rule is wrong.

### Q3. Did the spec define Pending Cancel as a union of two sources?

No. The spec defines Pending Cancel as a snapshot status filter only. The
union rule is reverse-engineered to match the report's number.

### Q4. Is the union rule stable across periods?

No. The Members snapshot is a point-in-time view as of when the operator
runs the import — typically days or weeks after the period ends. Two
specific failure modes:

1. **Snapshot drift.** Importing the May snapshot on June 15 means a
   member who flipped to `Pending Cancel` on June 5 contaminates the
   "Pending Cancel for May" computation.
2. **Snapshot ahead of period end.** Demonstrated above: the April
   snapshot includes May-cancel-date members (Torres, Wayne, Zmoira).

A defensible rule would tie Pending Cancel to the period boundary, not
the snapshot moment. The spec rule is also affected by snapshot drift,
but at least it doesn't claim to read the period-aligned ledger.

## Decision

Engine implements the spec rule (path A): snapshot `member_status =
'Pending Cancel'` AND `plan_name NOT IN excluded_plans`. April output is
**13**. The 18 in the PDF is a documented reconciliation variance.

Reconciliation steps before v1 release:

1. Confirm with the report owner how the 18 was produced (formula? tool?
   manual entry?).
2. If the formula is documented somewhere we don't have, encode it.
3. If the 18 turns out to be hand-edited or wrong, update the PDF and the
   fixture together.
4. If the formula is genuinely the path-C union and we accept the
   period-instability, encode it explicitly and add validation that warns
   when the snapshot's `as_of` is more than N days outside the period.

## Pointers

- Config: `config/gyms/powerhouse_nyc.json` → `cancellations.pending_cancel`
- Fixture: `lib/analytics/__tests__/fixtures/april_2026_expected.json` →
  `losses.Pending Cancel` and the `pending_cancel_*` sibling keys
- Project doc: `PROJECT.md` → "Deviations from the spec PDF"
- Spec source: `prototype/spec/Powerhouse_NYC_Methodology_Spec.pdf` p.4
