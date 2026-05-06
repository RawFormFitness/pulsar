"""Real dashboard metrics computed from parsed data."""

import sys
sys.path.insert(0, "/home/claude/gym_parser")
from parsers import parse_file
import pandas as pd
from datetime import datetime, timezone

UPLOADS = "/mnt/user-data/uploads"

_, leads = parse_file(f"{UPLOADS}/Test_Leads.csv")
_, sales = parse_file(f"{UPLOADS}/Test_Sales.csv")
_, members = parse_file(f"{UPLOADS}/Test_Members.csv")

now = pd.Timestamp.now(tz="UTC")
today = now.normalize()
today_naive = pd.Timestamp.now().normalize()  # for ABC's tz-naive dates

print("\n" + "="*70)
print(" GYM ANALYTICS DASHBOARD — PREVIEW")
print("="*70)

# === SECTION 1: HEADLINE NUMBERS ===
print("\n📊  HEADLINE NUMBERS")
print("-" * 70)

active_count = len(members)
mrr_eft = members["renewal_eft"].sum()
mrr_cash = members["renewal_cash"].sum()
mrr_total = mrr_eft + mrr_cash
arpu = mrr_total / active_count if active_count else 0

print(f"  Active members:             {active_count:>10,}")
print(f"  MRR (EFT):                  ${mrr_eft:>10,.2f}")
print(f"  MRR (Cash):                 ${mrr_cash:>10,.2f}")
print(f"  MRR (Total):                ${mrr_total:>10,.2f}")
print(f"  ARPU (avg revenue/member):  ${arpu:>10,.2f}")

# === SECTION 2: SALES PIPELINE ===
print("\n🎯  SALES PIPELINE (lead funnel)")
print("-" * 70)
total_leads = len(leads)
converted = leads["sale_at"].notna().sum()
trials = leads["trial_end_at"].notna().sum()
left = leads["leaving_at"].notna().sum()
print(f"  Total leads in system:      {total_leads:>10,}")
print(f"  Started a trial:            {trials:>10,}  ({trials/total_leads*100:.1f}%)")
print(f"  Converted to sale:          {converted:>10,}  ({converted/total_leads*100:.1f}%)")
print(f"  Lost / left pipeline:       {left:>10,}  ({left/total_leads*100:.1f}%)")

# === SECTION 3: LEAD SOURCES ===
print("\n📈  LEAD SOURCE ROI (top 10)")
print("-" * 70)
src = leads.groupby("source").agg(
    leads=("id", "count"),
    sales=("sale_at", lambda s: s.notna().sum()),
).reset_index()
src["conv_rate"] = (src["sales"] / src["leads"] * 100).round(1)
src = src.sort_values("leads", ascending=False).head(10)
print(f"  {'Source':<25s} {'Leads':>8s} {'Sales':>8s} {'Conv %':>8s}")
for _, r in src.iterrows():
    print(f"  {str(r['source'])[:24]:<25s} {r['leads']:>8,} {r['sales']:>8,} {r['conv_rate']:>7.1f}%")

# === SECTION 4: SALESPERSON LEADERBOARD ===
print("\n🏆  SALESPERSON LEADERBOARD (this period)")
print("-" * 70)
# From sales report — counts agreements signed
sp_sales = sales[sales["salesperson"].notna()].groupby("salesperson").size().sort_values(ascending=False).head(10)
print(f"  {'Salesperson':<30s} {'Agreements':>12s}")
for name, count in sp_sales.items():
    print(f"  {str(name)[:29]:<30s} {count:>12,}")

# === SECTION 5: CHURN RISK ===
print("\n⚠️   CHURN RISK (members not seen in 30+ days)")
print("-" * 70)
days_since = (today_naive - members["last_visit_date"]).dt.days
risk_30 = (days_since > 30).sum()
risk_60 = (days_since > 60).sum()
risk_90 = (days_since > 90).sum()
never = members["last_visit_date"].isna().sum()
print(f"  No visit in 30+ days:       {risk_30:>10,}  ({risk_30/active_count*100:.1f}%)")
print(f"  No visit in 60+ days:       {risk_60:>10,}  ({risk_60/active_count*100:.1f}%)")
print(f"  No visit in 90+ days:       {risk_90:>10,}  ({risk_90/active_count*100:.1f}%)")
print(f"  Never visited:              {never:>10,}  (probably new sign-ups)")
print(f"\n  ⚡ This is your 'who to call' list — {risk_30} members need outreach")

# === SECTION 6: MEMBERSHIP TYPE MIX ===
print("\n📋  MEMBERSHIP TYPE BREAKDOWN")
print("-" * 70)
mt = members["membership_type"].value_counts().head(8)
for name, count in mt.items():
    pct = count / active_count * 100
    bar = "█" * int(pct / 2)
    print(f"  {str(name)[:30]:<30s} {count:>5,}  {pct:>5.1f}%  {bar}")

# === SECTION 7: ENGAGEMENT BUCKETS ===
print("\n🏋️   ENGAGEMENT (visits used in current period)")
print("-" * 70)
buckets = pd.cut(members["check_in_count"], bins=[-1, 0, 4, 12, 30, 1000],
                 labels=["0 visits (dormant)", "1-4 visits (low)", "5-12 visits (moderate)",
                         "13-30 visits (engaged)", "31+ visits (super-user)"])
for label, count in buckets.value_counts().sort_index().items():
    pct = count/active_count*100
    print(f"  {str(label):<28s} {count:>5,}  ({pct:>4.1f}%)")

# === SECTION 8: NEW MEMBERS THIS MONTH ===
print("\n✨  NEW MEMBER GROWTH")
print("-" * 70)
this_month = members[members["begin_date"] >= (today_naive - pd.Timedelta(days=30))]
last_month = members[(members["begin_date"] >= (today_naive - pd.Timedelta(days=60))) &
                     (members["begin_date"] < (today_naive - pd.Timedelta(days=30)))]
print(f"  New members (last 30 days):   {len(this_month):>8,}")
print(f"  New members (30-60 days ago): {len(last_month):>8,}")

print("\n" + "="*70)
print(" END OF DASHBOARD PREVIEW")
print("="*70)
