"""
Clean the SYDE 2026 class-profile survey export (data/data.tsv) into an
analysis-ready Excel workbook (data/data_clean.xlsx).

Read the Methodology sheet of the output workbook for the full list of
cleaning decisions and the flat FX rates applied.

Run from the repo root:
    python3 scripts/clean_data.py
"""

import re
from datetime import datetime

import numpy as np
import pandas as pd

RAW_PATH = "data/data.tsv"
OUT_PATH = "data/data_clean.xlsx"

# Flat conversion rates (documented in the Methodology sheet).
FX_RATES = {"CAD": 1.0, "USD": 1.39, "EUR": 1.60, "GBP": 1.85}

TERMS = ["1A", "1B", "2A", "2B", "3A", "3B", "4A", "4B"]
COOPS = list(range(1, 7))

# Global typo / spelling fixes applied to every text cell.
GLOBAL_FIXES = {
    "Muncipal": "Municipal",
    "Ectasy": "Ecstasy",
    "Sucidial": "Suicidal",
    "Extracurricuals": "Extracurricular",
    " waterloo": " Waterloo",
    "waterloo": "Waterloo",
    "Roydan": "Roydon",
    "Volunteer experience": "Volunteer Experience",
}

# Known professor-name variants (trimmed) -> canonical spelling.
PROFESSOR_FIXES = {
    "Reem Rouffail": "Reem Roufail",
    "Reem Roufaill": "Reem Roufail",
    "Roydan Fraser": "Roydon Fraser",
}

# Canonical exchange universities (matched longest-first) -> city, country.
EXCHANGE_UNIVERSITIES = [
    ("Hong Kong University of Science and Technology", "Hong Kong", "China"),
    ("Hong Kong University", "Hong Kong", "China"),
    ("Universidad Carlos III de Madrid", "Madrid", "Spain"),
    ("Singapore University of Technology and Design", "Singapore", "Singapore"),
    ("National University of Singapore", "Singapore", "Singapore"),
    ("Nanyang Technological University", "Singapore", "Singapore"),
    ("École Polytechnique Fédérale de Lausanne", "Lausanne", "Switzerland"),
    ("Delft University of Technology", "Delft", "Netherlands"),
    ("University of Leeds", "Leeds", "United Kingdom"),
    ("Bilkent University", "Ankara", "Turkey"),
    ("Ewha Womans University", "Seoul", "South Korea"),
    ("Tampere University", "Tampere", "Finland"),
    ("Lund University", "Lund", "Sweden"),
]

# Per-term AI-assignment buckets (kept as ranges — no midpoints).
AI_BUCKETS = {"0", "1 - 25%", "26 - 50%", "51 - 75%", "75 - 99%", "100%"}

# FYDP AI-percentage buckets (kept as ranges — no midpoints).
FYDP_AI_BUCKETS = {"0 - 25%", "26 - 50%", "51 - 75%", "76 - 100%"}

# Hometown grouping.
# Province abbreviations / full names (lowercase) -> province group label.
PROVINCE_GROUPS = {
    "ab": "Alberta",
    "bc": "British Columbia",
    "mb": "Manitoba",
    "nb": "New Brunswick",
    "nl": "Newfoundland and Labrador",
    "ns": "Nova Scotia",
    "nt": "Northwest Territories",
    "nu": "Nunavut",
    "on": "Ontario",
    "pe": "Prince Edward Island",
    "qc": "Quebec",
    "sk": "Saskatchewan",
    "yt": "Yukon",
    "alberta": "Alberta",
    "british columbia": "British Columbia",
    "manitoba": "Manitoba",
    "new brunswick": "New Brunswick",
    "newfoundland and labrador": "Newfoundland and Labrador",
    "nova scotia": "Nova Scotia",
    "northwest territories": "Northwest Territories",
    "nunavut": "Nunavut",
    "ontario": "Ontario",
    "prince edward island": "Prince Edward Island",
    "quebec": "Quebec",
    "saskatchewan": "Saskatchewan",
    "yukon": "Yukon",
}

# Cities grouped into KW, Toronto, Ottawa, or GTA.
KW_CITIES = {"waterloo", "kitchener", "cambridge"}
TORONTO_CITIES = {"toronto", "east york", "etobicoke", "north york", "scarborough", "york"}
GTA_CITIES = {
    "ajax", "aurora", "brampton", "burlington", "caledon", "halton hills",
    "markham", "milton", "mississauga", "newmarket", "oakville", "oshawa",
    "pickering", "richmond hill", "vaughan", "whitby", "whitchurch-stouffville",
}

CURRENCY_RE = re.compile(r"([0-9][0-9,.]*)\s*(CAD|USD|EUR|GBP)", re.IGNORECASE)
NUMBER_RE = re.compile(r"[0-9][0-9,]*")
WHITESPACE_RE = re.compile(r"\s+")


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def strip_cell(value):
    if isinstance(value, str):
        return value.strip().strip("\ufeff")
    return value


def apply_global_fixes(value):
    if not isinstance(value, str) or not value:
        return value
    out = value
    for old, new in GLOBAL_FIXES.items():
        out = out.replace(old, new)
    return out


def to_numeric(value):
    """Parse a survey cell to float. Handles '30%', '1,000', blanks."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return np.nan
    s = str(value).strip().rstrip("%").replace(",", "").strip()
    try:
        return float(s)
    except ValueError:
        return np.nan


def to_int(value):
    f = to_numeric(value)
    return int(f) if not np.isnan(f) else np.nan


def clean_multi(value):
    """Clean a comma-separated multi-select cell.

    Splits on commas, trims, drops empties, removes a leading 'None' when other
    options are present, and de-dupes while preserving order.
    """
    if not isinstance(value, str) or not value.strip():
        return np.nan
    tokens = [t.strip() for t in value.split(",") if t.strip()]
    if not tokens:
        return np.nan
    if len(tokens) > 1:
        tokens = [t for t in tokens if t.lower() not in ("none", "n/a", "na")]
    seen = []
    for t in tokens:
        if t not in seen:
            seen.append(t)
    if not seen:
        return np.nan
    return ", ".join(seen)


def normalize_course(value):
    if not isinstance(value, str) or not value.strip():
        return np.nan
    v = value.strip().upper()
    return WHITESPACE_RE.sub(" ", v)


def normalize_professor(value):
    if not isinstance(value, str) or not value.strip():
        return np.nan
    v = WHITESPACE_RE.sub(" ", value.strip())
    return PROFESSOR_FIXES.get(v, v)


def parse_money(value):
    """Parse 'N CURRENCY' cells (commas allowed as thousand separators).

    Returns (list of (amount, currency), raw text).  Currencies that cannot be
    found yield a bare-number fallback tagged with currency None.
    """
    raw = strip_cell(value)
    if not raw:
        return [], raw
    text = raw.replace("\u00a0", " ").replace("\u2009", " ")
    parts = []
    for amt, cur in CURRENCY_RE.findall(text):
        try:
            parts.append((float(amt.replace(",", "")), cur.upper()))
        except ValueError:
            continue
    if not parts:
        nums = NUMBER_RE.findall(text)
        if nums:
            try:
                parts.append((float(nums[0].replace(",", "")), None))
            except ValueError:
                pass
    return parts, raw


def money_to_cad(parts):
    total = 0.0
    assumed_currency = False
    for amt, cur in parts:
        if cur is None:
            assumed_currency = True
            total += amt * FX_RATES["CAD"]
        else:
            total += amt * FX_RATES.get(cur, 0.0)
    return total, assumed_currency


def parse_ai_bucket(value):
    """Normalize an AI-assignment range; returns the range label (no midpoint)."""
    if not isinstance(value, str) or not value.strip():
        return np.nan
    return value.strip()


def normalize_where_lived(value):
    if not isinstance(value, str) or not value.strip():
        return np.nan
    v = value.strip().lower()
    if v.startswith("at home"):
        return "At home"
    if v.startswith("residence"):
        return "Residence"
    if v.startswith("off"):
        return "Off-Campus"
    return value.strip()


def parse_hometown_group(value):
    """Group a 'City, Province' hometown: KW, Toronto, Ottawa, GTA, Ontario (other),
    province label for other Canadian provinces, or International."""
    if not isinstance(value, str) or not value.strip():
        return np.nan
    v = value.strip()
    if v.lower() == "international":
        return "International"
    parts = [p.strip() for p in v.split(",")]
    if len(parts) < 2:
        return "International"
    city = parts[0].strip()
    region = parts[1].strip()
    prov = PROVINCE_GROUPS.get(region.lower())
    if prov is None:
        return "International"
    if prov != "Ontario":
        return prov
    cl = city.lower()
    if cl in KW_CITIES:
        return "KW"
    if cl == "ottawa":
        return "Ottawa"
    if cl in TORONTO_CITIES:
        return "Toronto"
    if cl in GTA_CITIES:
        return "GTA"
    return "Ontario (other)"


def normalize_balding(value):
    if not isinstance(value, str) or not value.strip():
        return np.nan
    v = value.strip()
    if v.lower().startswith("balding likely"):
        return "Balding likely caused by coming to Waterloo"
    if v.lower().startswith("balding but"):
        return "Balding but NOT due to Waterloo"
    if v.lower().startswith("not balding"):
        return "Not balding"
    return v


def parse_age(value):
    """Parse age cells that may be 'Never' or '35+'."""
    if not isinstance(value, str) or not value.strip():
        return np.nan
    v = value.strip()
    if v.lower() in ("never", "n/a"):
        return np.nan
    if v.endswith("+"):
        try:
            return float(v[:-1])
        except ValueError:
            return np.nan
    return to_numeric(v)


def parse_exchange_location(value):
    """Parse the (messy) exchange-location free text into uni/city/country."""
    if not isinstance(value, str) or not value.strip():
        return np.nan, np.nan, np.nan
    text = value.strip()
    for name, city, country in sorted(EXCHANGE_UNIVERSITIES, key=lambda x: -len(x[0])):
        if name.lower() in text.lower():
            return name, city, country
    # Fallback: take the first comma-separated token as the university.
    first = text.split(",")[0].strip()
    return first, np.nan, np.nan


def parse_timestamp(value):
    try:
        return pd.to_datetime(value, errors="coerce")
    except Exception:
        return np.nan


# --------------------------------------------------------------------------
# Read raw data
# --------------------------------------------------------------------------

df = pd.read_csv(RAW_PATH, sep="\t", dtype=str, keep_default_na=False, encoding="utf-8")

# --------------------------------------------------------------------------
# Column dictionary (raw 0-based index -> clean short name)
# --------------------------------------------------------------------------

names = [None] * 222

names[0] = "timestamp"
names[1] = "consent"  # consent column — 66/66 "Yes", dropped.
names[2] = "hometown"
names[3] = "birth_year"
names[4] = "parents"
names[5] = "parents_stem"
names[6] = "parents_education"
names[7] = "household_income"
names[8] = "tuition_covered_pct"
names[9] = "living_expenses_covered_pct"
names[10] = "political_alignment"
names[11] = "voted_in_university"
names[12] = "elections_voted"
names[13] = "political_view_changed"
names[14] = "ethnicity"
names[15] = "religion"
names[16] = "more_religious"
names[17] = "religion_changed"
names[18] = "gender"
names[19] = "sexuality"
names[20] = "hs_admission_avg"
names[21] = "extracurriculars"
names[22] = "enrichment_program"
names[23] = "universities_applied"
names[24] = "industry_expected"
names[25] = "other_fields_applied"
names[26] = "original_cohort"
names[27] = "most_interesting_course"
names[28] = "most_useful_course"
names[29] = "most_difficult_course"
names[30] = "recommended_non_syde_course"
names[31] = "favourite_professor"
names[32] = "most_disliked_professor"
names[33] = "option_completed"
names[34] = "minor"
names[35] = "design_enjoyability"
names[36] = "design_usefulness"

stress_base = 37
for i, term in enumerate(TERMS):
    names[stress_base + i] = f"stress_{term}"

names[45] = "hardest_term"
names[46] = "pick_syde_again"
names[47] = "alternate_program"
names[48] = "failed_course"
names[49] = "academic_misconduct"
names[50] = "fydp_type"
names[51] = "fydp_space"
names[52] = "proud_fydp"
names[53] = "continue_fydp"
names[54] = "fydp_group_get_along"
names[55] = "fydp_ai_pct"
names[56] = "went_on_exchange"
names[57] = "no_exchange_reason"
names[58] = "exchange_reason"
names[59] = "exchange_location"
names[60] = "exchange_term"
names[61] = "recommend_exchange"
names[62] = "same_university_choice"
names[63] = "different_university_why"
names[64] = "exchange_coop_impact"
names[65] = "exchange_grad_impact"
names[66] = "exchange_spend"

# Per-term blocks (1A-4B): cGPA, lectures %, where lived, rent, AI % bucket
# (+ favorite AI tool from 2A onward).
term_starts = [67, 72, 77, 83, 89, 95, 101, 107]
for i, term in enumerate(TERMS):
    start = term_starts[i]
    names[start] = f"cgpa_{term}"
    names[start + 1] = f"lectures_pct_{term}"
    names[start + 2] = f"where_lived_{term}"
    names[start + 3] = f"rent_{term}"
    names[start + 4] = f"ai_bucket_{term}"
    if i >= 2:  # favorite AI tool from 2A onward
        names[start + 5] = f"ai_tool_{term}"

# Co-op blocks: how found / where / industry / size / rating (each field has 6
# consecutive columns, one per co-op).
coop_base = 113
for j, field in enumerate(["how_found", "work_location", "industry", "company_size", "perf_rating"]):
    for k in range(6):
        names[coop_base + j * 6 + k] = f"coop{k + 1}_{field}"

names[143] = "reneged_coop"
names[144] = "rescinded_offer"
names[145] = "coolest_perk"
for k in range(6):
    names[146 + k] = f"coop{k + 1}_company"
for k in range(6):
    names[152 + k] = f"coop{k + 1}_hourly_pay"
names[158] = "favourite_restaurant"
names[159] = "friends_in_class"
names[160] = "closest_friends_syde"
names[161] = "social_terms_attended"
names[162] = "cooking_before"
names[163] = "cooking_during"
names[164] = "fitness_before"
names[165] = "fitness_during"
names[166] = "balding"
names[167] = "intramurals"
names[168] = "clubs_member"
names[169] = "intramurals_list"
names[170] = "clubs_list"
names[171] = "mental_health"
names[172] = "mental_health_causes"
names[173] = "relationship_months"
names[174] = "where_met_partners"
names[175] = "sydecest"
names[176] = "relationships_count"
names[177] = "situationships_count"
names[178] = "currently_in_relationship"
names[179] = "first_kiss"
names[180] = "kissing_partners"
names[181] = "first_sex"
names[182] = "sexual_partners"
names[183] = "more_active"
names[184] = "drugs_tried"

freq_names = ["drink", "weed", "vape", "cigs"]
for i, f in enumerate(freq_names):
    names[185 + i * 2] = f"{f}_firstyear"
    names[186 + i * 2] = f"{f}_upper_years"

names[193] = "student_debt"
names[194] = "savings"
names[195] = "investing_method"
names[196] = "plans_1yr"
names[197] = "full_time_job"
names[198] = "returning_employer"
names[199] = "offer_date"
names[200] = "working_location"
names[201] = "returning_to_canada"
names[202] = "when_returning"
names[203] = "company_school"
names[204] = "base_salary"
names[205] = "bonus_year1"
names[206] = "further_education"
names[207] = "marry_age"
names[208] = "first_child_age"
names[209] = "countries_visited"
names[210] = "grad_trip_spend"
names[211] = "ai_job_worry"
names[212] = "ai_subscription"
names[213] = "ai_regulated"
names[214] = "fav_tech_ceo"
names[215] = "advice_first_years"
names[216] = "favourite_memory"
names[217] = "great_about_syde"
names[218] = "new_grad_excitement"
names[219] = "public_message"
names[220] = "private_message"
names[221] = "dream_job"

assert len(names) == 222 and names.count(None) == 0, "column mapping is incomplete"

df.columns = names
df = df.drop(columns=["consent"])

# --------------------------------------------------------------------------
# 1. Basic cell cleaning: trim, strip BOM, apply global typo fixes.
# --------------------------------------------------------------------------

for col in df.columns:
    df[col] = df[col].map(strip_cell).map(apply_global_fixes)

df["timestamp"] = df["timestamp"].map(parse_timestamp)
df["respondent_id"] = ["R%02d" % (i + 1) for i in range(len(df))]

# --------------------------------------------------------------------------
# 2. Per-column text cleaning.
# --------------------------------------------------------------------------

df["hometown"] = df["hometown"].where(df["hometown"].str.strip() != "", np.nan)
df["hometown_group"] = df["hometown"].map(parse_hometown_group)

course_cols = [
    "most_interesting_course",
    "most_useful_course",
    "most_difficult_course",
    "recommended_non_syde_course",
]
for col in course_cols:
    df[col] = df[col].map(normalize_course)

for col in ["favourite_professor", "most_disliked_professor"]:
    df[col] = df[col].map(normalize_professor)

df["gender"] = df["gender"].map(clean_multi)
df["sexuality"] = df["sexuality"].map(lambda v: np.nan if not isinstance(v, str) or not v.strip() else v.strip())
df["ethnicity"] = df["ethnicity"].map(clean_multi)
df["religion"] = df["religion"].map(lambda v: np.nan if not isinstance(v, str) or not v.strip() else v.strip())
df["elections_voted"] = df["elections_voted"].map(clean_multi)
df["extracurriculars"] = df["extracurriculars"].map(clean_multi)
df["enrichment_program"] = df["enrichment_program"].map(clean_multi)
df["universities_applied"] = df["universities_applied"].map(clean_multi)
df["other_fields_applied"] = df["other_fields_applied"].map(clean_multi)
df["academic_misconduct"] = df["academic_misconduct"].map(clean_multi)
df["fydp_space"] = df["fydp_space"].map(clean_multi)
df["mental_health"] = df["mental_health"].map(clean_multi)
df["mental_health_causes"] = df["mental_health_causes"].map(clean_multi)
df["where_met_partners"] = df["where_met_partners"].map(clean_multi)
df["drugs_tried"] = df["drugs_tried"].map(clean_multi)
df["countries_visited"] = df["countries_visited"].map(clean_multi)

for col in [c for c in df.columns if c.startswith("where_lived_")]:
    df[col] = df[col].map(normalize_where_lived)

df["balding"] = df["balding"].map(normalize_balding)

df["intramurals_list"] = df["intramurals_list"].map(clean_multi)
df["clubs_list"] = df["clubs_list"].map(clean_multi)

df[["exchange_university", "exchange_city", "exchange_country"]] = df[
    "exchange_location"
].apply(lambda v: pd.Series(parse_exchange_location(v)))

# --------------------------------------------------------------------------
# 3. Numeric coercion + outlier flags.
# --------------------------------------------------------------------------

flags = {rid: [] for rid in df["respondent_id"]}
index_of = dict(zip(df["respondent_id"], df.index))

# Birth year
df["birth_year"] = df["birth_year"].map(to_int)
df["birth_year_group"] = df["birth_year"].map(
    lambda by: np.nan
    if np.isnan(by)
    else ("2003" if by == 2003 else (">2003" if by > 2003 else "<2003"))
)
for rid in df["respondent_id"]:
    by = df.at[index_of[rid], "birth_year"]
    if not np.isnan(by) and (by < 2001 or by > 2004):
        flags[rid].append(f"birth_year={by:.0f} (outside 2001-2004 cohort)")

# Design + stress ratings (1-5)
for col in ["design_enjoyability", "design_usefulness"]:
    df[col] = df[col].map(to_int)
for term in TERMS:
    df[f"stress_{term}"] = df[f"stress_{term}"].map(to_int)

# High school admission average
df["hs_admission_avg"] = df["hs_admission_avg"].map(to_numeric)

# Per-term numeric fields
cgpa_flags = {rid: [] for rid in df["respondent_id"]}
for term in TERMS:
    df[f"cgpa_{term}"] = df[f"cgpa_{term}"].map(to_numeric)
    df[f"lectures_pct_{term}"] = df[f"lectures_pct_{term}"].map(to_numeric)
    df[f"rent_{term}"] = df[f"rent_{term}"].map(to_numeric)
    for rid in df["respondent_id"]:
        v = df.at[index_of[rid], f"cgpa_{term}"]
        if np.isnan(v):
            continue
        if v < 20:
            cgpa_flags[rid].append(
                f"{term}: cGPA {v:g} looks like a 4.0-scale GPA, not a percent"
            )
        elif v > 100:
            cgpa_flags[rid].append(
                f"{term}: cGPA {v:g} > 100 — likely a typo (e.g. 822 -> 82.2?)"
            )

# AI buckets per term (kept as ranges).
for term in TERMS:
    df[f"ai_bucket_{term}"] = df[f"ai_bucket_{term}"].map(parse_ai_bucket)

# FYDP AI % (kept as ranges)
df["fydp_ai_bucket"] = df["fydp_ai_pct"].map(parse_ai_bucket)
df = df.drop(columns=["fydp_ai_pct"])

# Cooking / fitness (0-5)
for col in ["cooking_before", "cooking_during", "fitness_before", "fitness_during"]:
    df[col] = df[col].map(to_int)

# Counts (int)
for col in [
    "closest_friends_syde",
    "social_terms_attended",
    "relationships_count",
    "situationships_count",
    "kissing_partners",
    "sexual_partners",
]:
    df[col] = df[col].map(to_int)

# Ages ('Never' / '35+' handled)
df["marry_age_label"] = df["marry_age"].map(
    lambda v: v.strip() if isinstance(v, str) and v.strip() else np.nan
)
df["marry_age"] = df["marry_age"].map(parse_age)
df["first_child_age_label"] = df["first_child_age"].map(
    lambda v: v.strip() if isinstance(v, str) and v.strip() else np.nan
)
df["first_child_age"] = df["first_child_age"].map(parse_age)

# --------------------------------------------------------------------------
# 4. Money fields: parse raw amounts + convert to CAD (flat rate).
# --------------------------------------------------------------------------

MONEY_COLS = {
    "exchange_spend": "exchange_spend_cad",
    "base_salary": "base_salary_cad",
    "bonus_year1": "bonus_cad",
    "savings": "savings_cad",
}

for raw_col, cad_col in MONEY_COLS.items():
    parsed = df[raw_col].map(parse_money)
    df[raw_col + "_raw"] = parsed.map(lambda p: p[1])
    cad_vals = []
    assumed = []
    for parts, _ in parsed:
        total, flag = money_to_cad(parts)
        cad_vals.append(total if parts else np.nan)
        assumed.append(flag)
    df[cad_col] = cad_vals
    df[raw_col + "_assumed_cad"] = assumed

for k in range(1, 7):
    col = f"coop{k}_hourly_pay"
    parsed = df[col].map(parse_money)
    df[col + "_raw"] = parsed.map(lambda p: p[1])
    cad_vals = []
    for parts, _ in parsed:
        total, _ = money_to_cad(parts)
        cad_vals.append(total if parts else np.nan)
    df[f"coop{k}_hourly_pay_cad"] = cad_vals

# Flag suspicious savings (extremely low non-zero amounts look like typos,
# e.g. '80 CAD' for 80,000 CAD).
for rid in df["respondent_id"]:
    raw = df.at[index_of[rid], "savings_raw"]
    cad = df.at[index_of[rid], "savings_cad"]
    if isinstance(raw, str) and raw.strip() and not np.isnan(cad) and 0 < cad < 1000:
        flags[rid].append(f"savings '{raw}' unusually low — possible typo")

# --------------------------------------------------------------------------
# 5. Assemble per-respondent flag / note columns.
# --------------------------------------------------------------------------

df["flags"] = df["respondent_id"].map(lambda rid: "; ".join(flags[rid]))
df["cgpa_flags"] = df["respondent_id"].map(lambda rid: "; ".join(cgpa_flags[rid]))

# Move identifier/flag columns to the front.
front = ["respondent_id", "timestamp", "flags", "cgpa_flags"]
rest = [c for c in df.columns if c not in front]
df = df[front + rest]

# --------------------------------------------------------------------------
# 6. Long/tidy pivots.
# --------------------------------------------------------------------------

id_cols = ["respondent_id", "timestamp"]

# Terms
term_rows = []
for term in TERMS:
    for rid in df["respondent_id"]:
        r = df.loc[index_of[rid]]
        term_rows.append(
            {
                "respondent_id": rid,
                "timestamp": r["timestamp"],
                "term": term,
                "cgpa": r[f"cgpa_{term}"],
                "lectures_pct": r[f"lectures_pct_{term}"],
                "where_lived": r[f"where_lived_{term}"],
                "rent_cad": r[f"rent_{term}"],
                "ai_bucket": r[f"ai_bucket_{term}"],
                "ai_tool": r.get(f"ai_tool_{term}", np.nan),
            }
        )
terms_long = pd.DataFrame(term_rows)
terms_long["ai_tool"] = terms_long["ai_tool"].map(
    lambda v: np.nan if not isinstance(v, str) or not v.strip() else v.strip()
)
terms_long["ai_tool"] = terms_long["ai_tool"].map(
    lambda v: np.nan if isinstance(v, str) and v.lower() in ("none", "n/a", "na") else v
)

# Co-ops
coop_rows = []
for k in range(1, 7):
    for rid in df["respondent_id"]:
        r = df.loc[index_of[rid]]
        coop_rows.append(
            {
                "respondent_id": rid,
                "timestamp": r["timestamp"],
                "coop": k,
                "how_found": r[f"coop{k}_how_found"],
                "work_location": r[f"coop{k}_work_location"],
                "industry": r[f"coop{k}_industry"],
                "company_size": r[f"coop{k}_company_size"],
                "perf_rating": r[f"coop{k}_perf_rating"],
                "company": r[f"coop{k}_company"],
                "hourly_pay_raw": r[f"coop{k}_hourly_pay_raw"],
                "hourly_pay_cad": r[f"coop{k}_hourly_pay_cad"],
            }
        )
coops_long = pd.DataFrame(coop_rows)

# --------------------------------------------------------------------------
# 7. Multi-select long table.
# --------------------------------------------------------------------------

MULTI_COLS = {
    "elections_voted": "elections_voted",
    "ethnicity": "ethnicity",
    "extracurriculars": "extracurriculars",
    "enrichment_program": "enrichment_program",
    "universities_applied": "universities_applied",
    "academic_misconduct": "academic_misconduct",
    "fydp_space": "fydp_space",
    "mental_health": "mental_health",
    "where_met_partners": "where_met_partners",
    "drugs_tried": "drugs_tried",
}

multi_rows = []
for field, col in MULTI_COLS.items():
    for rid in df["respondent_id"]:
        v = df.at[index_of[rid], col]
        if not isinstance(v, str) or not v.strip():
            continue
        for opt in [o.strip() for o in v.split(",") if o.strip()]:
            multi_rows.append(
                {"respondent_id": rid, "timestamp": df.at[index_of[rid], "timestamp"], "field": field, "option": opt}
            )
multi_long = pd.DataFrame(multi_rows)

# --------------------------------------------------------------------------
# 8. Methodology notes.
# --------------------------------------------------------------------------

methodology_rows = [
    ["SYDE 2026 Class Profile — data cleaning summary"],
    ["Generated", datetime.now().strftime("%Y-%m-%d %H:%M:%S")],
    ["Source file", RAW_PATH],
    ["Respondents", f"{len(df)} (all rows kept; none dropped)"],
    ["Columns in source", "222"],
    ["Columns in clean sheet", str(len(df.columns))],
    [""],
    ["FLAT FX CONVERSION RATES (to CAD)"],
    ["1 USD", f"{FX_RATES['USD']} CAD"],
    ["1 EUR", f"{FX_RATES['EUR']} CAD"],
    ["1 GBP", f"{FX_RATES['GBP']} CAD"],
    ["Applied to", "exchange spend, co-op hourly pay, savings, base salary, year-1 bonus"],
    ["Note", "Flat rates only — not market-accurate. Raw parsed amounts are kept alongside converted values."],
    [""],
    ["CLEANING DECISIONS"],
    ["- Converted CRLF to LF / normalised line endings."],
    ["- Trimmed leading/trailing whitespace in every cell."],
    ["- Header corruption repaired: co-op hourly-pay questions (cols 153-158) contained a stray "
     "pasted snippet 'National University of Singapore (NUS), Singapore, Singapore' "
     "inside the question text. The data itself was unaffected."],
    ["- Repeated per-term columns renamed with suffixes (1A-4B); repeated co-op columns with "
     "suffixes (1-6). See Terms and Coops sheets for tidy versions."],
    ["- Course codes normalised to 'SUBJECT ###' (uppercase)."],
    ["- Professor names de-duplicated: 'Reem Rouffail'/'Reem Roufaill' -> Reem Roufail, "
     "'Roydan Fraser' -> Roydon Fraser."],
    ["- Spelling fixes: Muncipal->Municipal, Ectasy->Ecstasy, Sucidial->Suicidal, "
     "Extracurricuals->Extracurricular, waterloo->Waterloo."],
    ["- 'None' removed from multi-select combos that also contain real options "
     "(e.g. 'None, Depression' -> 'Depression')."],
    ["- AI-assignment % stored as ranges (e.g. '1 - 25%'), kept as-is in the "
     "'ai_bucket' columns. No midpoints or fabricated numeric values were produced."],
    ["- Hometowns grouped in 'hometown_group': KW (Kitchener/Waterloo/Cambridge), Ottawa, "
     "Toronto, GTA, 'Ontario (other)' for the rest of Ontario, province label for every "
     "other Canadian province, and 'International' for non-Canada entries."],
    ["- 'birth_year_group' collapses birth year into '2003', '>2003', and '<2003'."],
    ["- cGPA stored as % per the question; values clearly on another scale are flagged "
     "(see 'cgpa_flags'), not silently changed."],
    ["- All 66 responses kept. Rows with impossible/outlier values are flagged in 'flags', never dropped."],
    [""],
    ["OUTLIER / FLAG NOTES"],
    ["- birth_year 1996 (one respondent) outside the 2001-2004 cohort."],
    ["- cGPA 2.8 (one respondent, 1A) looks like a 4.0-scale GPA."],
    ["- cGPA 822 (one respondent) is almost certainly a typo for ~82."],
    ["- Savings '80 CAD' flagged as a possible typo for 80,000 CAD."],
    ["- Money cells without an explicit currency were assumed CAD and flagged in '*_assumed_cad'."],
    [""],
    ["SHEETS"],
    ["Responses", "One row per respondent (wide). 'flags' and 'cgpa_flags' summarise data-quality notes."],
    ["Terms", "One row per respondent x term (1A-4B): cGPA, lectures %, housing, rent, AI use."],
    ["Coops", "One row per respondent x co-op (1-6): how found, location, industry, size, rating, company, pay."],
    ["MultiSelect", "One row per respondent x selected option for the multi-select questions."],
]

# --------------------------------------------------------------------------
# 9. Write the workbook.
# --------------------------------------------------------------------------

with pd.ExcelWriter(OUT_PATH, engine="openpyxl") as writer:
    pd.DataFrame(methodology_rows, columns=["Item", "Value"]).to_excel(
        writer, sheet_name="Methodology", index=False
    )
    df.to_excel(writer, sheet_name="Responses", index=False)
    terms_long.to_excel(writer, sheet_name="Terms", index=False)
    coops_long.to_excel(writer, sheet_name="Coops", index=False)
    multi_long.to_excel(writer, sheet_name="MultiSelect", index=False)

print(f"Wrote {OUT_PATH}")
print(f"  Responses : {len(df)} rows x {len(df.columns)} cols")
print(f"  Terms     : {len(terms_long)} rows")
print(f"  Coops     : {len(coops_long)} rows")
print(f"  MultiSelect: {len(multi_long)} rows")
print(f"  Respondents with flags: {df['flags'].str.len().gt(0).sum()}")
