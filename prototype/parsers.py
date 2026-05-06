"""
Gym Analytics — CSV Parser v2
==============================
Handles ABC Ignite's grouped-report format where context (club, salesperson)
is encoded as text rows between data rows, not as columns.
"""

import pandas as pd
import re


def normalize_col(c: str) -> str:
    """Normalize column header: lowercase snake_case, no double spaces, # → number."""
    c = str(c).strip().lower()
    c = c.replace("#", "number")
    c = re.sub(r"[^a-z0-9]+", "_", c)
    c = re.sub(r"_+", "_", c).strip("_")
    return c


def parse_leads(path: str) -> pd.DataFrame:
    """Gym Sales lead export — already a flat clean CSV."""
    df = pd.read_csv(path)
    df.columns = [normalize_col(c) for c in df.columns]

    required = {"id", "created_at", "status", "source"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"Leads file missing required columns: {missing}")

    for col in ["created_at", "updated_at", "sale_at", "trial_end_at",
                "leaving_at", "first_contact", "birthday", "waiver_signed_date"]:
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors="coerce", utc=True)

    for col in ["opted_out_of_sms", "opted_out_of_email", "guest_waiver_signed"]:
        if col in df.columns:
            df[col] = df[col].map({"Yes": True, "No": False})

    return df


def _find_header_row(raw: pd.DataFrame, marker_keywords: list) -> int:
    for i in range(min(15, len(raw))):
        cells = " ".join(raw.iloc[i].astype(str).str.lower().fillna(""))
        if all(kw.lower() in cells for kw in marker_keywords):
            return i
    raise ValueError(f"Could not find header row containing all of: {marker_keywords}")


def _parse_grouped_report(path, header_markers, data_anchor_col, group_levels):
    """
    Generic ABC grouped-report parser.

    group_levels: list of (column_index, output_field_name) for rows where ONLY
                  that column is populated → those values are group context that
                  attaches to subsequent data rows.
    data_anchor_col: a normalized column name that's reliably numeric on real
                     data rows (used to filter out junk and group-label rows).
    """
    raw = pd.read_csv(path, header=None, dtype=str, keep_default_na=False)

    header_idx = _find_header_row(raw, header_markers)
    header_cells = raw.iloc[header_idx].tolist()

    col_names = []
    for i, h in enumerate(header_cells):
        h = str(h).strip()
        col_names.append(normalize_col(h) if h else f"col_{i}")

    anchor_idx = col_names.index(data_anchor_col) if data_anchor_col in col_names else None

    data_rows = []
    current_groups = {field: None for _, field in group_levels}

    for r in range(header_idx + 1, len(raw)):
        row = raw.iloc[r]
        non_empty = [(i, v) for i, v in enumerate(row) if v and str(v).strip()]
        if not non_empty:
            continue

        # Group label row: exactly one cell populated
        if len(non_empty) == 1:
            ci, val = non_empty[0]
            for col_idx, field in group_levels:
                if ci == col_idx:
                    current_groups[field] = val.strip()
                    break
            continue

        # Real data row: anchor column must parse as a number
        if anchor_idx is not None:
            anchor_val = row.iloc[anchor_idx] if anchor_idx < len(row) else ""
            try:
                float(str(anchor_val).strip())
            except (ValueError, TypeError):
                continue

        record = {col_names[i]: row.iloc[i] for i in range(min(len(col_names), len(row)))}
        record.update(current_groups)
        data_rows.append(record)

    return pd.DataFrame(data_rows)


def parse_abc_sales(path: str) -> pd.DataFrame:
    """ABC Membership Sales by Sign Date. Grouped: club → salesperson."""
    df = _parse_grouped_report(
        path,
        header_markers=["agreement", "queue date", "membership type"],
        data_anchor_col="agreement_number",
        group_levels=[(0, "club_name"), (3, "salesperson")],
    )
    if df.empty:
        return df

    df["agreement_number"] = pd.to_numeric(df["agreement_number"], errors="coerce").astype("Int64")
    if "queue_date" in df.columns:
        df["queue_date"] = pd.to_datetime(df["queue_date"], errors="coerce")
    df = df.loc[:, ~df.columns.str.startswith("col_")]
    return df.reset_index(drop=True)


def parse_abc_members(path: str) -> pd.DataFrame:
    """ABC Active Members. Grouped: club → management/billing type."""
    df = _parse_grouped_report(
        path,
        header_markers=["member", "agreement", "last visit", "next due"],
        data_anchor_col="agreement_number",
        group_levels=[(0, "club_name"), (4, "management_group")],
    )
    if df.empty:
        return df

    df["agreement_number"] = pd.to_numeric(df["agreement_number"], errors="coerce").astype("Int64")

    for col in ["last_visit_date", "begin_date", "expiration_date"]:
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors="coerce")

    for col in ["next_due_amount", "renewal_cash", "renewal_eft",
                "renewal_statement", "age", "visits_used", "check_in_count"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    df = df.loc[:, ~df.columns.str.startswith("col_")]
    return df.reset_index(drop=True)


def detect_format(path: str) -> str:
    raw = pd.read_csv(path, header=None, dtype=str, keep_default_na=False, nrows=10)
    blob = " ".join(raw.fillna("").astype(str).agg(" ".join, axis=1)).lower()

    if "first_name" in blob and "salesperson" in blob and "trial_end_at" in blob:
        return "leads"
    if "membership sales" in blob:
        return "abc_sales"
    if "active members" in blob:
        return "abc_members"
    return "unknown"


def parse_file(path: str):
    fmt = detect_format(path)
    if fmt == "leads":
        return fmt, parse_leads(path)
    elif fmt == "abc_sales":
        return fmt, parse_abc_sales(path)
    elif fmt == "abc_members":
        return fmt, parse_abc_members(path)
    else:
        raise ValueError(f"Could not detect format of {path}")
