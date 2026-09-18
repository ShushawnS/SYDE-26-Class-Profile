"""Populate yaml/<section>.yml chart data from the cleaned workbook.

Reads data/data_clean.xlsx (Responses, Terms, Coops, MultiSelect sheets) and
rewrites the `charts` lists in each yaml section file, replacing placeholder
data with real aggregate values. Chart titles not backed by a survey column are
left untouched and reported as skipped.

Usage:  python3 scripts/populate_yaml.py
"""

import os
import re
from collections import Counter

import numpy as np
import pandas as pd
import yaml

DATA_PATH = "data/data_clean.xlsx"
YAML_DIR = "yaml"

TERM_ORDER = ["1A", "1B", "2A", "2B", "3A", "3B", "4A", "4B"]
COOP_ORDER = ["Co-op #1", "Co-op #2", "Co-op #3", "Co-op #4", "Co-op #5", "Co-op #6"]

DEFAULT_COLORS = [
    "#2563eb", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899",
    "#06b6d4", "#84cc16", "#f97316", "#9ca3af",
]

# Stable colour + display order for co-op work locations (used by the Sankey).
COOP_LOCATION_COLORS = {
    "Toronto/GTA": "#2563eb",
    "KW": "#10b981",
    "Ottawa": "#f59e0b",
    "Other Ontario": "#84cc16",
    "Other Canada": "#06b6d4",
    "California": "#ef4444",
    "NYC": "#8b5cf6",
    "Other USA": "#ec4899",
    "Other International": "#f97316",
    "Remote/At-Home": "#14b8a6",
    "Unemployed": "#9ca3af",
}
COOP_LOCATION_ORDER = list(COOP_LOCATION_COLORS)

AI_MIDPOINT = {
    "0": 0.0, "1 - 25%": 12.5, "26 - 50%": 38.0, "51 - 75%": 63.0,
    "75 - 99%": 87.0, "100%": 100.0,
}

FREQ_SCALE = {
    "Never": 0, "1-2 times a term": 1, "Monthly": 2, "Biweekly": 3,
    "Weekly": 4, "2-3 times/week": 5, "4-7 times/week": 6,
}

responses = pd.read_excel(DATA_PATH, "Responses")
terms = pd.read_excel(DATA_PATH, "Terms")
coops = pd.read_excel(DATA_PATH, "Coops")
multi = pd.read_excel(DATA_PATH, "MultiSelect", keep_default_na=False, na_values=[""])


def clean(v):
    """Trim strings; map blanks/'nan'/'n/a' to NaN."""
    if isinstance(v, str):
        s = v.strip()
        if s.lower() in ("", "nan", "n/a", "na", "nil"):
            return np.nan
        return s
    return v


def _eq(v, o):
    try:
        return float(v) == float(o)
    except (ValueError, TypeError):
        return str(v) == str(o)


def count_series(series, order=None):
    """Value counts of a column, dropping blanks. Returns {label: count}."""
    s = series.map(clean).dropna()
    c = s.value_counts()
    if order is None:
        return c.to_dict()
    return {o: int(sum(1 for v in s if _eq(v, o))) for o in order}


def count_with_none(series):
    """Counts treating blank as the label 'None'."""
    s = series.map(clean)
    s = s.fillna("None")
    return s.value_counts().to_dict()


def split_count(series):
    """Count options in a comma-joined free-text column."""
    c = Counter()
    for v in series.map(clean).dropna():
        for part in re.split(r"\s*,\s*", v):
            part = part.strip()
            if part:
                c[part] += 1
    return dict(c)


def multi_count(field):
    """Counts from the MultiSelect sheet for a field."""
    sub = multi[multi["field"] == field]["option"].map(clean).dropna()
    return sub.value_counts().to_dict()


def multi_n(field):
    """Number of unique respondents who selected an option for a field."""
    return int(multi.loc[multi["field"] == field, "respondent_id"].nunique())


def _sort_key(lbl):
    """Natural sort: numeric-prefixed labels first (numerically), else text."""
    s = str(lbl)
    m = re.match(r"^\s*(\d+(?:\.\d+)?)", s)
    if m:
        return (0, float(m.group(1)), s.lower())
    return (1, s.lower(), s)


def sorted_items(d):
    """Sort by count descending (used for top-N category selection)."""
    return sorted(d.items(), key=lambda kv: -kv[1])


def fit_colors(colors, n):
    colors = list(colors or [])
    if len(colors) >= n:
        return colors[:n]
    i = 0
    while len(colors) < n:
        colors.append(DEFAULT_COLORS[i % len(DEFAULT_COLORS)])
        i += 1
    return colors


def set_bar(chart, d, order=None):
    """Fill labels/data/total/colors for a bar or pie chart."""
    if order:
        items = [(o, int(next((v for k, v in d.items() if _eq(k, o)), 0)))
                 for o in order]
    else:
        items = sorted(d.items(), key=lambda kv: _sort_key(kv[0]))
    chart["labels"] = [l for l, _ in items]
    chart["data"] = [v for _, v in items]
    chart["total"] = int(sum(v for _, v in items))
    chart["colors"] = fit_colors(chart.get("colors", []), len(items))


def word_cloud(chart, words, total):
    chart["words"] = words
    chart["total"] = int(total)


def coop_per_counts(field, drop=()):
    """Per-co-op option counts. Returns {coop_num: {option: count}}."""
    per = {}
    for i in range(1, 7):
        s = coops.loc[coops["coop"] == i, field].map(clean).dropna()
        s = s[~s.isin(drop)]
        per[i] = s.value_counts().to_dict()
    return per


def stacked_chart(chart, field, order=None, top_n=6, drop=("Unemployed",)):
    """Fill a stacked-bar chart from per-co-op counts."""
    per = coop_per_counts(field, drop)
    total = Counter()
    for c in per.values():
        total.update(c)
    if order is None:
        cats = [o for o, _ in sorted_items(dict(total))][:top_n]
        if "Other" not in cats:
            rest = sum(v for k, v in total.items() if k not in cats)
            if rest > 0:
                cats.append("Other")
    else:
        cats = list(order)
    chart["xLabels"] = list(COOP_ORDER)
    main = [c for c in cats if c != "Other"]
    datasets = []
    for idx, cat in enumerate(cats):
        data = []
        for i in range(1, 7):
            if cat == "Other":
                v = sum(c for k, c in per[i].items() if k not in main)
            else:
                v = per[i].get(cat, 0)
            data.append(int(v))
        color = DEFAULT_COLORS[idx % len(DEFAULT_COLORS)]
        datasets.append({"label": cat, "data": data, "color": color})
    chart["datasets"] = datasets


def coop_wordcloud(chart, coop_num, n=None):
    idx = coops["coop"] == coop_num
    s = coops.loc[idx, "company"].map(clean).dropna()
    counts = fold_case(s.value_counts().to_dict())
    if n is None:
        n = len(counts)
    items = sorted(counts.items(), key=lambda kv: _sort_key(kv[0]))
    chart["words"] = [{"text": str(t), "weight": int(w)} for t, w in items[:n]]
    chart["total"] = int(s.notna().sum())


def line_means(chart, series_by_term, label, nd=1):
    def mean_for(t):
        s = series_by_term[t].dropna()
        return round(float(s.mean()), nd) if len(s) else 0.0

    chart["datasets"][0]["label"] = label
    chart["datasets"][0]["data"] = [mean_for(t) for t in TERM_ORDER]


def boxplot(chart, values, nd=1):
    q = values.quantile([0, 0.25, 0.5, 0.75, 1.0]).tolist()
    chart["data"] = [[round(float(x), nd) for x in q]]


def phrase_cloud(series):
    """Wordcloud words from whole responses (no comma splitting).

    Returns (words, total_respondents)."""
    s = series.map(clean).dropna()
    c = s.value_counts()
    items = sorted(c.items(), key=lambda kv: _sort_key(kv[0]))
    words = [{"text": str(t), "weight": int(w)} for t, w in items]
    return words, int(s.notna().sum())


def term_means(chart, series_by_term, nd=1):
    """Single-series bars of term means (used by type: metrics-bar)."""
    def mean_for(t):
        s = series_by_term[t].dropna()
        return round(float(s.mean()), nd) if len(s) else 0.0

    chart["labels"] = list(TERM_ORDER)
    chart["data"] = [mean_for(t) for t in TERM_ORDER]


def term_boxplot(chart, series_by_term, nd=1):
    """One box per academic term (labels + list of 5-number arrays)."""
    chart["labels"] = list(TERM_ORDER)
    boxes = []
    for t in TERM_ORDER:
        v = series_by_term[t].dropna()
        qs = v.quantile([0, 0.25, 0.5, 0.75, 1.0]).tolist() if len(v) else [0.0] * 5
        boxes.append([round(float(x), nd) for x in qs])
    chart["data"] = boxes


MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MONTH_NUM = {m.lower(): i + 1 for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July",
     "August", "September", "October", "November", "December"])}


def gender_age_bins(age_series, gender_series, bounds):
    """Cross-tab age buckets by gender group.

    Returns (labels, {group: [counts..., Never]})."""
    labels = [lbl for lbl, _, _ in bounds] + ["Never"]
    out = {g: [0] * len(labels) for g in ("Male", "Female", "Other")}
    for gv, av in zip(gender_series.map(clean), age_series.map(clean)):
        if gv is np.nan or av is np.nan:
            continue
        gk = "Male" if gv == "Male" else ("Female" if gv == "Female" else "Other")
        sv = str(av).strip()
        if sv.lower() == "never":
            out[gk][-1] += 1
            continue
        m = re.match(r"\d+", sv)
        if not m:
            continue
        age = int(m.group())
        placed = False
        for i, (lbl, lo, hi) in enumerate(bounds):
            if (hi is None and age >= lo) or (hi is not None and lo <= age <= hi):
                out[gk][i] += 1
                placed = True
                break
        if not placed:
            out[gk][len(bounds) - 1] += 1
    return labels, out


def age_bins(series, bounds):
    """bounds: list of (label, min_age, max_age or None). Never handled."""
    bins = {lbl: 0 for lbl, _, _ in bounds}
    never = 0
    for v in series.map(clean).dropna():
        sv = str(v).strip()
        if sv.lower() == "never":
            never += 1
            continue
        m = re.match(r"\d+", sv)
        if not m:
            continue
        age = int(m.group())
        placed = False
        for lbl, lo, hi in bounds:
            if hi is None or age <= hi:
                bins[lbl] += 1
                placed = True
                break
        if not placed:
            bins[bounds[-1][0]] += 1
    if never:
        bins["Never"] = never
    return bins


def _canon_case(variants):
    """Pick the display spelling for one answer's case-variants.

    A single all-caps token wins outright — that is how NVIDIA, AWS and
    WATOLINK are actually written, and the mixed-case version is someone
    typing quickly. Otherwise the most common spelling wins, and a tie falls
    to whichever carries more capitals.
    """
    for text in variants:
        if text.isupper() and " " not in text and len(text) <= 12:
            return text
    return max(
        variants.items(),
        key=lambda kv: (kv[1], sum(ch.isupper() for ch in kv[0])),
    )[0]


def fold_case(counts):
    """Merge answers that differ only in case.

    "NVIDIA" and "Nvidia" are one company; counted apart, one of the three
    people who went there vanished from the tally.
    """
    groups = {}
    for text, n in counts.items():
        t = str(text).strip()
        groups.setdefault(t.lower(), {})[t] = groups.setdefault(t.lower(), {}).get(t, 0) + int(n)
    out = Counter()
    for variants in groups.values():
        out[_canon_case(variants)] = sum(variants.values())
    return out


def split_freq_words(series, n=None):
    """Wordcloud words from a comma-separated list column.
    Returns (words, total_respondents)."""
    c = Counter()
    for v in series.map(clean).dropna():
        for part in re.split(r"\s*,\s*", v):
            part = part.strip()
            if part:
                c[part] += 1
    items = sorted(fold_case(c).items(), key=lambda kv: _sort_key(kv[0]))
    words = [{"text": t, "weight": int(w)} for t, w in items[:n]]
    return words, int(series.map(clean).notna().sum())


# ---------------------------------------------------------------------------
# Handlers: (filename, chart title) -> function(responses, chart)
# ---------------------------------------------------------------------------

HANDLERS = {}


def handler(file, title):
    def deco(fn):
        HANDLERS[(file, title)] = fn
        return fn
    return deco


# ----------------------------- demographics.yml -----------------------------

@handler("demographics.yml", "Hometown")
def _(r, c):
    set_bar(c, count_series(r["hometown_group"]),
            order=["KW", "Toronto", "Ottawa", "GTA", "Ontario (other)",
                   "British Columbia", "Quebec", "International"])


@handler("demographics.yml", "Birth Year")
def _(r, c):
    set_bar(c, count_series(r["birth_year_group"]), order=["2003", ">2003", "<2003"])


@handler("demographics.yml", "Family Status")
def _(r, c):
    set_bar(c, count_series(r["parents"]))


@handler("demographics.yml", "Parents with STEM Background")
def _(r, c):
    set_bar(c, count_series(r["parents_stem"]), order=["Yes", "No"])


@handler("demographics.yml", "Highest Level of Education — Parents")
def _(r, c):
    set_bar(c, count_series(r["parents_education"]))


@handler("demographics.yml", "Average Household Income")
def _(r, c):
    set_bar(c, count_series(r["household_income"]),
            order=["$0 - 50K", "$50 - 100K", "$100 - 150K", "$150 - 200K",
                   "$200 - 250K", "$250 - 300K", "$300K+"])


@handler("demographics.yml", "Tuition Covered by Parents")
def _(r, c):
    set_bar(c, count_series(r["tuition_covered_pct"]),
            order=["0%", "1 - 25%", "26 - 50%", "51-75%", "76-99%", "100%"])


@handler("demographics.yml", "Living Expenses Covered by Parents")
def _(r, c):
    set_bar(c, count_series(r["living_expenses_covered_pct"]),
            order=["0%", "1 - 25%", "25 - 50%", "50-75%", "75-99%", "100%"])


@handler("demographics.yml", "Political Alignment")
def _(r, c):
    set_bar(c, count_series(r["political_alignment"]))


@handler("demographics.yml", "Voted in a Political Election")
def _(r, c):
    set_bar(c, count_series(r["voted_in_university"]))


@handler("demographics.yml", "Elections Voted In")
def _(r, c):
    set_bar(c, multi_count("elections_voted"),
            order=["Federal", "Provincial", "Municipal"])
    c["total"] = multi_n("elections_voted")


@handler("demographics.yml", "Political Viewpoint Change During University")
def _(r, c):
    set_bar(c, count_series(r["political_view_changed"]), order=["Yes", "No"])


@handler("demographics.yml", "Ethnicities")
def _(r, c):
    set_bar(c, multi_count("ethnicity"))
    c["total"] = multi_n("ethnicity")


@handler("demographics.yml", "Religion")
def _(r, c):
    set_bar(c, count_series(r["religion"]))


@handler("demographics.yml", "Became More Religious")
def _(r, c):
    set_bar(c, count_series(r["more_religious"]), order=["Yes", "No"])


@handler("demographics.yml", "Religion Changed During University")
def _(r, c):
    set_bar(c, count_series(r["religion_changed"]), order=["Yes", "No"])


@handler("demographics.yml", "Sexual Identity")
def _(r, c):
    set_bar(c, count_series(r["gender"]))


@handler("demographics.yml", "Sexuality")
def _(r, c):
    set_bar(c, count_series(r["sexuality"]))


# ---------------------------- pre-university.yml ----------------------------

@handler("pre-university.yml", "Admission Average")
def _(r, c):
    s = r["hs_admission_avg"].map(clean).dropna().astype(float)
    labels = [str(v) for v in range(int(s.min()), int(s.max()) + 1)]
    bins = {lbl: int((s == int(lbl)).sum()) for lbl in labels}
    set_bar(c, bins, order=labels)


@handler("pre-university.yml", "Extracurriculars in High School")
def _(r, c):
    set_bar(c, multi_count("extracurriculars"))
    c["total"] = multi_n("extracurriculars")


@handler("pre-university.yml", "Enrichment Programs")
def _(r, c):
    set_bar(c, multi_count("enrichment_program"))
    c["total"] = multi_n("enrichment_program")


@handler("pre-university.yml", "Other Universities Applied To")
def _(r, c):
    set_bar(c, multi_count("universities_applied"))
    c["total"] = multi_n("universities_applied")


@handler("pre-university.yml", "Expected Industry Before University")
def _(r, c):
    set_bar(c, split_count(r["industry_expected"]))


@handler("pre-university.yml", "Other Fields Applied To")
def _(r, c):
    set_bar(c, split_count(r["other_fields_applied"]))


# ------------------------------ academics.yml -------------------------------

@handler("academics.yml", "Most Interesting Course")
def _(r, c):
    word_cloud(c, *split_freq_words(r["most_interesting_course"]))


@handler("academics.yml", "Most Useful Course")
def _(r, c):
    word_cloud(c, *split_freq_words(r["most_useful_course"]))


@handler("academics.yml", "Most Difficult Course")
def _(r, c):
    word_cloud(c, *split_freq_words(r["most_difficult_course"]))


@handler("academics.yml", "Non-SYDE Courses Recommended")
def _(r, c):
    word_cloud(c, *split_freq_words(r["recommended_non_syde_course"]))


@handler("academics.yml", "Favourite Professor")
def _(r, c):
    word_cloud(c, *split_freq_words(r["favourite_professor"]))


@handler("academics.yml", "Options Completed")
def _(r, c):
    set_bar(c, count_with_none(r["option_completed"]))


@handler("academics.yml", "Minor Completed")
def _(r, c):
    set_bar(c, count_with_none(r["minor"]))


@handler("academics.yml", "Design Course Enjoyability vs Usefulness")
def _(r, c):
    def by_rating(col):
        return [int((r[col].map(clean) == float(v)).sum()) for v in ("1", "2", "3", "4", "5")]
    c["xLabels"] = ["1", "2", "3", "4", "5"]
    c["datasets"] = [
        {"label": "Enjoyability", "data": by_rating("design_enjoyability"), "color": "#f59e0b"},
        {"label": "Usefulness", "data": by_rating("design_usefulness"), "color": "#2563eb"},
    ]


@handler("academics.yml", "Average Stress Level Over Semesters")
def _(r, c):
    series = {t: r[f"stress_{t}"] for t in TERM_ORDER}
    term_means(c, series, nd=2)
    cols = [f"stress_{t}" for t in TERM_ORDER]
    c["total"] = int(r[cols].notna().any(axis=1).sum())


@handler("academics.yml", "Hardest Academic Term")
def _(r, c):
    set_bar(c, count_series(r["hardest_term"]), order=TERM_ORDER)


@handler("academics.yml", "Would You Pick SYDE Again")
def _(r, c):
    set_bar(c, count_series(r["pick_syde_again"]), order=["Yes", "No"])


@handler("academics.yml", "Program If Not SYDE")
def _(r, c):
    words, total = split_freq_words(r["alternate_program"])
    c["words"] = words
    c["total"] = int(total)


@handler("academics.yml", "Failed a Course")
def _(r, c):
    set_bar(c, count_series(r["failed_course"]), order=["Yes", "No"])


@handler("academics.yml", "Engaged in Cheating Methods")
def _(r, c):
    set_bar(c, multi_count("academic_misconduct"))
    c["total"] = multi_n("academic_misconduct")


@handler("academics.yml", "Average cGPA Over the Semesters")
def _(r, c):
    series = {t: terms.loc[terms["term"] == t, "cgpa"] for t in TERM_ORDER}
    term_boxplot(c, series, nd=1)


@handler("academics.yml", "% of Lectures Attended Over the Semesters")
def _(r, c):
    series = {t: terms.loc[terms["term"] == t, "lectures_pct"] for t in TERM_ORDER}
    term_boxplot(c, series, nd=1)


@handler("academics.yml", "Average Rent Over the Semesters")
def _(r, c):
    series = {t: terms.loc[terms["term"] == t, "rent_cad"] for t in TERM_ORDER}
    term_boxplot(c, series, nd=0)


@handler("academics.yml", "% of Assignments Completed with AI Over the Semesters")
def _(r, c):
    mids = {t: [] for t in TERM_ORDER}
    for t in TERM_ORDER:
        for v in terms.loc[terms["term"] == t, "ai_bucket"].map(clean).dropna():
            mid = AI_MIDPOINT.get(str(v).strip())
            if mid is not None:
                mids[t].append(mid)
    data = [round(float(np.mean(mids[t])) if mids[t] else 0.0, 1) for t in TERM_ORDER]
    c["datasets"][0]["label"] = "Average % with AI"
    c["datasets"][0]["data"] = data


@handler("academics.yml", "Favorite AI Tool Over the Semesters")
def _(r, c):
    per = {}
    for t in TERM_ORDER:
        col = f"ai_tool_{t}"
        if col in r.columns:
            s = r[col].map(clean).dropna()
            per[t] = s[s != "none"].value_counts().to_dict()
        else:
            per[t] = {}
    total = Counter()
    for d in per.values():
        total.update(d)
    cats = [o for o, _ in sorted_items(dict(total)) if o not in ("Other",)][:6]
    cats.append("Other")
    datasets = []
    for idx, cat in enumerate(cats):
        data = [int(per[t].get(cat, 0)) for t in TERM_ORDER]
        color = DEFAULT_COLORS[idx % len(DEFAULT_COLORS)]
        datasets.append({"label": cat, "data": data, "color": color})
    c["xLabels"] = list(TERM_ORDER)
    c["datasets"] = datasets


# -------------------------------- co-op.yml --------------------------------

@handler("co-op.yml", "How You Found a Job Over the Semesters")
def _(r, c):
    stacked_chart(c, "how_found", top_n=6, drop=("Unemployed",))


@handler("co-op.yml", "Location of Work Over the Semesters")
def _(r, c):
    stacked_chart(c, "work_location", top_n=6)


@handler("co-op.yml", "Co-op Location Journey")
def _(r, c):
    """Sankey of location moves between consecutive co-op terms.

    One column per co-op term; a flow from column k to k+1 counts the students
    who worked in location A during co-op k and location B during co-op k+1.
    """
    cols = [f"coop{k}_work_location" for k in range(1, 7)]
    edge_counts = Counter()
    nodes_seen = {}  # node id -> (stage, location)
    for _, row in r.iterrows():
        seq = [clean(row[col]) for col in cols]
        for k in range(5):
            a, b = seq[k], seq[k + 1]
            if not isinstance(a, str) or not isinstance(b, str):
                continue
            sid, tid = f"c{k + 1}:{a}", f"c{k + 2}:{b}"
            nodes_seen[sid] = (k + 1, a)
            nodes_seen[tid] = (k + 2, b)
            edge_counts[(sid, tid)] += 1

    def loc_rank(loc):
        return COOP_LOCATION_ORDER.index(loc) if loc in COOP_LOCATION_ORDER \
            else len(COOP_LOCATION_ORDER)

    ordered = sorted(nodes_seen,
                     key=lambda nid: (nodes_seen[nid][0], loc_rank(nodes_seen[nid][1])))
    c["nodes"] = [
        {"id": nid,
         "title": nodes_seen[nid][1],
         "color": COOP_LOCATION_COLORS.get(nodes_seen[nid][1], "#9ca3af")}
        for nid in ordered
    ]
    c["edges"] = [
        {"source": s, "target": t, "value": int(v)}
        for (s, t), v in edge_counts.items()
    ]
    c["total"] = int(len(r))


@handler("co-op.yml", "Industry Over the Semesters")
def _(r, c):
    stacked_chart(c, "industry", top_n=6)


@handler("co-op.yml", "Company Size Over the Semesters")
def _(r, c):
    stacked_chart(c, "company_size",
                  order=["Micro (<10 employees)", "Small (10-49)",
                         "Medium (50-250)", "Large (251-1000)",
                         "Extra Large (1000+)"], top_n=5)


@handler("co-op.yml", "Performance Rating Over the Semesters")
def _(r, c):
    stacked_chart(c, "perf_rating",
                  order=["Outstanding", "Excellent", "Very good", "Good",
                         "Satisfactory"], top_n=5,
                  drop=("Co-op not on WaterlooWorks", "Unemployed"))


@handler("co-op.yml", "Reneged a Co-op")
def _(r, c):
    set_bar(c, count_series(r["reneged_coop"]), order=["Yes", "No"])


@handler("co-op.yml", "Company Rescinded an Offer")
def _(r, c):
    set_bar(c, count_series(r["rescinded_offer"]), order=["Yes", "No"])


for _n in range(1, 7):
    @handler("co-op.yml", f"Co-op #{_n} Places")
    def _(r, c, _n=_n):
        coop_wordcloud(c, _n)


@handler("co-op.yml", "Coolest Company Perk")
def _(r, c):
    word_cloud(c, *split_freq_words(r["coolest_perk"]))


@handler("co-op.yml", "Co-op Earnings Over the Semesters")
def _(r, c):
    boxes = []
    for i in range(1, 7):
        s = coops.loc[coops["coop"] == i, "hourly_pay_cad"].dropna()
        q = s.quantile([0, 0.25, 0.5, 0.75, 1.0]).tolist()
        boxes.append([round(float(x), 1) for x in q])
    c["labels"] = list(COOP_ORDER)
    c["data"] = boxes


# ------------------------------- exchange.yml -------------------------------

@handler("exchange.yml", "Went on Exchange")
def _(r, c):
    set_bar(c, count_series(r["went_on_exchange"]), order=["Yes", "No"])


@handler("exchange.yml", "Reasons for Not Going on Exchange")
def _(r, c):
    word_cloud(c, *phrase_cloud(r["no_exchange_reason"]))


@handler("exchange.yml", "Reasons for Going on Exchange")
def _(r, c):
    word_cloud(c, *phrase_cloud(r["exchange_reason"]))


@handler("exchange.yml", "Places Went on Exchange")
def _(r, c):
    set_bar(c, count_series(r["exchange_city"]))


@handler("exchange.yml", "Exchange Term")
def _(r, c):
    set_bar(c, count_series(r["exchange_term"]), order=["Fall", "Winter"])


@handler("exchange.yml", "Recommend Exchange for Future Students")
def _(r, c):
    set_bar(c, count_series(r["recommend_exchange"]), order=["Yes", "No", "Maybe"])


@handler("exchange.yml", "Same or Different Uni in Hindsight")
def _(r, c):
    set_bar(c, count_series(r["same_university_choice"]),
            order=["Same", "Different", "No Preference"])


@handler("exchange.yml", "Reasons for Different Uni")
def _(r, c):
    word_cloud(c, *phrase_cloud(r["different_university_why"]))


@handler("exchange.yml", "Did Exchange Impact Co-op Search")
def _(r, c):
    set_bar(c, count_series(r["exchange_coop_impact"]), order=["Yes", "No"])


@handler("exchange.yml", "Ability to Finish Courses for Graduation")
def _(r, c):
    set_bar(c, count_series(r["exchange_grad_impact"]), order=["Yes", "No"])


@handler("exchange.yml", "Total Spend on Exchange")
def _(r, c):
    s = r["exchange_spend_cad"].dropna()
    bins = Counter()
    for v in s:
        if v < 5000:
            bins["<$5k"] += 1
        elif v < 10000:
            bins["$5k-10k"] += 1
        elif v < 15000:
            bins["$10k-15k"] += 1
        elif v < 20000:
            bins["$15k-20k"] += 1
        else:
            bins["$20k+"] += 1
    set_bar(c, dict(bins), order=["<$5k", "$5k-10k", "$10k-15k", "$15k-20k", "$20k+"])


# ------------------------------- capstone.yml -------------------------------

@handler("capstone.yml", "SYDE or Multidisciplinary")
def _(r, c):
    set_bar(c, count_series(r["fydp_type"]), order=["SYDE", "Multi-Disciplinary"])


@handler("capstone.yml", "Problem Space Tackled")
def _(r, c):
    set_bar(c, multi_count("fydp_space"))
    c["total"] = multi_n("fydp_space")


@handler("capstone.yml", "Proud of Completed FYDP")
def _(r, c):
    set_bar(c, count_series(r["proud_fydp"]), order=["Yes", "No", "Maybe"])


@handler("capstone.yml", "Continue Working on FYDP")
def _(r, c):
    set_bar(c, count_series(r["continue_fydp"]), order=["Yes", "No", "Maybe"])


@handler("capstone.yml", "FYDP Group Got Along")
def _(r, c):
    set_bar(c, count_series(r["fydp_group_get_along"]), order=["Yes", "No"])


@handler("capstone.yml", "FYDP Software Component Completed with AI")
def _(r, c):
    set_bar(c, count_series(r["fydp_ai_bucket"]),
            order=["0 - 25%", "26 - 50%", "51 - 75%", "76 - 100%"])


# ---------------------------------- ai.yml ----------------------------------

@handler("ai.yml", "Is AI Taking Your Job?")
def _(r, c):
    set_bar(c, count_series(r["ai_job_worry"]), order=["Yes", "No", "Maybe"])


@handler("ai.yml", "Pay for AI Subscription?")
def _(r, c):
    set_bar(c, count_series(r["ai_subscription"]), order=["Yes", "No"])


@handler("ai.yml", "Should AI Be Regulated?")
def _(r, c):
    d = count_series(r["ai_regulated"])
    d["Unsure"] = d.pop("Not Sure", 0) + d.get("Unsure", 0)
    set_bar(c, d, order=["Yes", "No", "Unsure"])


@handler("ai.yml", "Favourite Tech CEO")
def _(r, c):
    set_bar(c, count_series(r["fav_tech_ceo"]))


# --------------------------- social-lifestyle.yml ---------------------------

@handler("social-lifestyle.yml", "Favourite Restaurant")
def _(r, c):
    word_cloud(c, *split_freq_words(r["favourite_restaurant"]))


@handler("social-lifestyle.yml", "How Many of Your 5 Closest Uni Friends Are in SYDE")
def _(r, c):
    set_bar(c, count_series(r["closest_friends_syde"]),
            order=["0", "1", "2", "3", "4", "5"])


@handler("social-lifestyle.yml", "Number of Terms Attended a SYDE Social Event")
def _(r, c):
    set_bar(c, count_series(r["social_terms_attended"]),
            order=["1", "2", "3", "4", "5", "6", "7", "8"])


def _pre_after(chart, pre_col, after_col, pre_label, after_label):
    def rating_counts(col):
        s = responses[col].dropna()
        return Counter(str(int(round(float(v)))) for v in s)
    pre = rating_counts(pre_col)
    aft = rating_counts(after_col)
    # Two series of counts, so a column total is not a headcount; state how
    # many people rated themselves at all.
    chart["total"] = int(responses[[pre_col, after_col]].notna().any(axis=1).sum())
    # The scale runs 0-5, not 1-5. Slicing "1".."5" quietly dropped every
    # zero — 14 of 63 pre-university cooking answers, and precisely the
    # people who said they could not cook at all.
    levels = ["0", "1", "2", "3", "4", "5"]
    chart["xLabels"] = list(levels)
    chart["datasets"] = [
        {"label": pre_label, "data": [int(pre.get(l, 0)) for l in levels],
         "color": chart["datasets"][0].get("color", "#ef4444")},
        {"label": after_label, "data": [int(aft.get(l, 0)) for l in levels],
         "color": chart["datasets"][1].get("color", "#2563eb")},
    ]


@handler("social-lifestyle.yml", "Cooking Ability — Pre Uni vs After Uni")
def _(r, c):
    _pre_after(c, "cooking_before", "cooking_during", "Pre Uni", "After Uni")


@handler("social-lifestyle.yml", "Fitness Level — Pre Uni vs After Uni")
def _(r, c):
    _pre_after(c, "fitness_before", "fitness_during", "Pre Uni", "After Uni")


@handler("social-lifestyle.yml", "Balding")
def _(r, c):
    set_bar(c, count_series(r["balding"]))


@handler("social-lifestyle.yml", "Done Intramurals?")
def _(r, c):
    set_bar(c, count_series(r["intramurals"]), order=["Yes", "No"])


@handler("social-lifestyle.yml", "Joined Clubs?")
def _(r, c):
    set_bar(c, count_series(r["clubs_member"]), order=["Yes", "No"])


@handler("social-lifestyle.yml", "Intramurals Participated In")
def _(r, c):
    word_cloud(c, *split_freq_words(r["intramurals_list"]))


@handler("social-lifestyle.yml", "Clubs Participated In")
def _(r, c):
    word_cloud(c, *split_freq_words(r["clubs_list"]))


# ---------------------- mental-health-relationships.yml ----------------------

@handler("mental-health-relationships.yml", "Mental Health Concerns")
def _(r, c):
    set_bar(c, multi_count("mental_health"))
    c["total"] = multi_n("mental_health")


@handler("mental-health-relationships.yml", "Causes for Mental Health")
def _(r, c):
    s = r["mental_health_causes"].map(clean).dropna()
    d = Counter()
    for v in s:
        for part in re.split(r"\s*,\s*", v):
            part = part.strip()
            if part:
                d[part] += 1
    set_bar(c, dict(d))
    c["total"] = int(s.notna().sum())


@handler("mental-health-relationships.yml", "Duration of Uni in Relationships (Months)")
def _(r, c):
    s = r["relationship_months"].map(clean).dropna().astype(str)
    s = s.str.replace(" ", "")
    d = count_series(s)
    order = sorted(d, key=lambda k: (int(re.match(r"\d+", k).group()) if re.match(r"\d+", k) else 10**9, k))
    set_bar(c, d, order=order)


@handler("mental-health-relationships.yml", "Where You Met Your Significant Other")
def _(r, c):
    set_bar(c, multi_count("where_met_partners"))
    c["total"] = multi_n("where_met_partners")


@handler("mental-health-relationships.yml", "Committed Sydecest?")
def _(r, c):
    set_bar(c, count_series(r["sydecest"]), order=["Yes", "No"])


@handler("mental-health-relationships.yml", "Relationships During Uni")
def _(r, c):
    s = r["relationships_count"].map(clean).dropna()
    bins = Counter()
    for x in s:
        x = int(x)
        if x >= 4:
            bins["Four+"] += 1
        else:
            bins[["None", "One", "Two", "Three"][x]] += 1
    set_bar(c, dict(bins),
            order=["None", "One", "Two", "Three", "Four+"])


@handler("mental-health-relationships.yml", "Situationships During Uni")
def _(r, c):
    s = r["situationships_count"].map(clean).dropna()
    bins = Counter()
    for x in s:
        x = int(x)
        if x >= 4:
            bins["Four+"] += 1
        else:
            bins[["None", "One", "Two", "Three"][x]] += 1
    set_bar(c, dict(bins),
            order=["None", "One", "Two", "Three", "Four+"])


@handler("mental-health-relationships.yml", "Currently in a Relationship")
def _(r, c):
    set_bar(c, count_series(r["currently_in_relationship"]), order=["Yes", "No"])


@handler("mental-health-relationships.yml", "First Kiss?")
def _(r, c):
    d = count_series(r["first_kiss"])
    mapping = {"First kiss before university": "Before Uni",
               "First kiss during university": "During Uni",
               "Never Kissed": "Has Not Happened"}
    d = {mapping.get(k, k): v for k, v in d.items()}
    set_bar(c, d, order=["Before Uni", "During Uni", "Has Not Happened"])


def _partner_bins(series, bounds):
    s = series.map(clean).dropna()
    bins = Counter()
    for x in s:
        x = int(x)
        placed = False
        for lbl, lo, hi in bounds:
            if hi is None and x >= lo:
                bins[lbl] += 1
                placed = True
                break
            elif hi is not None and lo <= x <= hi:
                bins[lbl] += 1
                placed = True
                break
        if not placed:
            bins[bounds[-1][0]] += 1
    return dict(bins)


@handler("mental-health-relationships.yml", "Unique Kissing Partners")
def _(r, c):
    d = _partner_bins(r["kissing_partners"],
                      [("0", 0, 0), ("1", 1, 1), ("2-3", 2, 3), ("4-5", 4, 5),
                       ("6-10", 6, 10), ("10+", 11, None)])
    set_bar(c, d, order=["0", "1", "2-3", "4-5", "6-10", "10+"])


@handler("mental-health-relationships.yml", "First Had Sex")
def _(r, c):
    d = count_series(r["first_sex"])
    mapping = {"Before university": "Before Uni",
               "During university": "During Uni",
               "Never had sex": "Has Not Happened"}
    d = {mapping.get(k, k): v for k, v in d.items()}
    set_bar(c, d, order=["Before Uni", "During Uni", "Has Not Happened"])


@handler("mental-health-relationships.yml", "Unique Sexual Partners")
def _(r, c):
    d = _partner_bins(r["sexual_partners"],
                      [("0", 0, 0), ("1", 1, 1), ("2-3", 2, 3), ("4-5", 4, 5),
                       ("6-10", 6, 10), ("10+", 11, None)])
    set_bar(c, d, order=["0", "1", "2-3", "4-5", "6-10", "10+"])


@handler("mental-health-relationships.yml", "Drugs People Have Tried")
def _(r, c):
    d = multi_count("drugs_tried")
    d["Shrooms"] = d.get("Shrooms", 0) + d.pop("Magic mushrooms", 0)
    set_bar(c, d)
    c["total"] = multi_n("drugs_tried")


@handler("mental-health-relationships.yml", "Substance Usage First Year vs 3rd/4th Year")
def _(r, c):
    def mean_of(col):
        s = r[col].map(clean).dropna()
        vals = [FREQ_SCALE.get(str(v)) for v in s if FREQ_SCALE.get(str(v)) is not None]
        return round(float(np.mean(vals)) if vals else 0.0, 1)

    first = [mean_of(f"{s}_firstyear") for s in ["drink", "vape", "weed", "cigs"]]
    upper = [mean_of(f"{s}_upper_years") for s in ["drink", "vape", "weed", "cigs"]]
    # These bars are averages, so the count cannot be inferred from them.
    cols = [f"{s}_{p}" for s in ["drink", "vape", "weed", "cigs"]
            for p in ["firstyear", "upper_years"]]
    have = [x for x in cols if x in r.columns]
    c["total"] = int(r[have].notna().any(axis=1).sum()) if have else 0
    c["datasets"] = [
        {"label": "1st Year", "data": first,
         "color": c["datasets"][0].get("color", "#60a5fa")},
        {"label": "3rd/4th Year", "data": upper,
         "color": c["datasets"][1].get("color", "#2563eb")},
    ]


# -------------------------------- future.yml --------------------------------

@handler("future.yml", "Plans After 1st Year")
def _(r, c):
    set_bar(c, count_series(r["plans_1yr"]))


@handler("future.yml", "Full-Time Job Secured?")
def _(r, c):
    set_bar(c, count_series(r["full_time_job"]), order=["Yes", "No"])


@handler("future.yml", "Returning to Previous Employer")
def _(r, c):
    set_bar(c, count_series(r["returning_employer"]), order=["Yes", "No"])


@handler("future.yml", "When Did You Get Your Offer")
def _(r, c):
    # Offers land across two calendar years. Binning by month alone dropped
    # the year and sorted Jan..Dec, which put every 2026 offer *before* the
    # 2025 ones — so bin by (year, month) and keep real chronological order.
    bins = Counter()
    for v in r["offer_date"].map(clean).dropna():
        m = re.match(r"(\w+)\s+(\d{4})", str(v))
        if not m:
            continue
        mnum = MONTH_NUM.get(m.group(1).lower())
        if mnum:
            bins[(int(m.group(2)), mnum)] += 1
    keys = sorted(bins)
    c["labels"] = [f"{MONTH_LABELS[mn - 1]} {yr}" for yr, mn in keys]
    c["data"] = [int(bins[k]) for k in keys]
    c["total"] = int(sum(c["data"]))
    c["colors"] = fit_colors(c.get("colors", []), len(keys))


@handler("future.yml", "Where Will You Be Working?")
def _(r, c):
    set_bar(c, count_series(r["working_location"]))


@handler("future.yml", "Leaving Canada? Plan to Come Back?")
def _(r, c):
    set_bar(c, count_series(r["returning_to_canada"]))


@handler("future.yml", "If Leaving, When Will You Return")
def _(r, c):
    set_bar(c, count_series(r["when_returning"]))


@handler("future.yml", "Company You'll Be Working At")
def _(r, c):
    word_cloud(c, *split_freq_words(r["company_school"]))


@handler("future.yml", "Total Compensation by Region")
def _(r, c):
    # A five-number summary, not a mean. Pay is skewed — one 285k answer
    # pulls the rest-of-world average well above the median — so the median
    # and the spread say more than a single averaged bar.
    c["labels"] = ["USA", "Rest of World"]
    c["boxFormat"] = "%sk"
    c["unit"] = "CAD"

    base = r["base_salary_cad"].dropna()
    if len(base) == 0:
        c["data"] = [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]]
        c["total"] = 0
        return
    loc = r.loc[base.index, "working_location"].map(clean)
    bonus = r.loc[base.index, "bonus_cad"].fillna(0).astype(float)
    usa = {"California", "NYC", "Other USA"}
    rows = {"USA": [], "Rest of World": []}
    for idx in base.index:
        l = loc.get(idx)
        if not l:
            continue
        key = "USA" if l in usa else "Rest of World"
        rows[key].append((base[idx] + bonus[idx]) / 1000.0)

    def five(vals):
        if not vals:
            return [0, 0, 0, 0, 0]
        q = np.percentile(sorted(vals), [0, 25, 50, 75, 100])
        return [round(float(x), 1) for x in q]

    c["data"] = [five(rows["USA"]), five(rows["Rest of World"])]
    c["total"] = int(sum(len(v) for v in rows.values()))


@handler("future.yml", "Plan to Pursue Further Education")
def _(r, c):
    yes = {"Masters", "MBA", "Certifications", "PEng"}
    maybe = {"maybe", "TBD", "Life"}
    d = count_series(r["further_education"])
    d = {k: v for k, v in d.items()}
    yes_v = sum(v for k, v in d.items() if k in yes)
    maybe_v = sum(v for k, v in d.items() if k in maybe)
    no_v = int(r["further_education"].map(clean).isna().sum())
    set_bar(c, {"Yes": yes_v, "No": no_v, "Maybe": maybe_v},
            order=["Yes", "No", "Maybe"])


MARRY_BOUNDS = [("25", 0, 25), ("26-28", 26, 28), ("29-31", 29, 31), ("32+", 32, None)]
CHILD_BOUNDS = [("25-27", 0, 27), ("28-30", 28, 30), ("31-33", 31, 33), ("34+", 34, None)]
GENDER_COLORS = {"Male": "#2563eb", "Female": "#ec4899", "Other": "#10b981"}


def _gender_bar(chart, age_series, gender_series, bounds):
    labels, out = gender_age_bins(age_series, gender_series, bounds)
    chart["xLabels"] = labels
    female = [a + b for a, b in zip(out["Female"], out["Other"])]
    chart["datasets"] = [
        {"label": "Male", "data": out["Male"], "color": GENDER_COLORS["Male"]},
        {"label": "Female", "data": female, "color": GENDER_COLORS["Female"]},
    ]


@handler("future.yml", "Get Married By")
def _(r, c):
    _gender_bar(c, r["marry_age_label"], r["gender"], MARRY_BOUNDS)


@handler("future.yml", "Age to Have Children")
def _(r, c):
    _gender_bar(c, r["first_child_age_label"], r["gender"], CHILD_BOUNDS)


@handler("future.yml", "Grad Trip Locations")
def _(r, c):
    word_cloud(c, *split_freq_words(r["countries_visited"]))


@handler("future.yml", "Money Spent on Grad Trip")
def _(r, c):
    bins = Counter()
    for v in r["grad_trip_spend"].map(clean).dropna():
        m = re.search(r"(\d[\d,]*)", v)
        if not m:
            continue
        lo = int(m.group(1).replace(",", ""))
        if lo < 1000:
            bins["<$1k"] += 1
        elif lo < 2000:
            bins["$1-2k"] += 1
        elif lo < 3000:
            bins["$2-3k"] += 1
        elif lo < 5000:
            bins["$3-5k"] += 1
        else:
            bins["$5k+"] += 1
    set_bar(c, dict(bins), order=["<$1k", "$1-2k", "$2-3k", "$3-5k", "$5k+"])


# ----------------------------- miscellaneous.yml ----------------------------

@handler("miscellaneous.yml", "Advice for First Years")
def _(r, c):
    word_cloud(c, *split_freq_words(r["advice_first_years"]))


@handler("miscellaneous.yml", "Favourite Memory of Undergrad")
def _(r, c):
    word_cloud(c, *split_freq_words(r["favourite_memory"]))


@handler("miscellaneous.yml", "What Was Great About SYDE")
def _(r, c):
    word_cloud(c, *split_freq_words(r["great_about_syde"]))


@handler("miscellaneous.yml", "What Excites You About New Grad")
def _(r, c):
    word_cloud(c, *split_freq_words(r["new_grad_excitement"]))


@handler("miscellaneous.yml", "Dream Job")
def _(r, c):
    word_cloud(c, *split_freq_words(r["dream_job"]))


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def main():
    updated = []
    skipped = []
    for fname in sorted(os.listdir(YAML_DIR)):
        if not fname.endswith(".yml") or fname in ("main.yml", "gallery.yml"):
            continue
        path = os.path.join(YAML_DIR, fname)
        with open(path, encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        charts = data.get("charts", [])
        if not charts:
            continue
        file_updated = []
        file_skipped = []
        for chart in charts:
            key = (fname, chart.get("title", ""))
            fn = HANDLERS.get(key)
            if fn is None:
                file_skipped.append(chart.get("title", ""))
                continue
            fn(responses, chart)
            file_updated.append(chart.get("title", ""))
        if file_updated:
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                yaml.safe_dump(data, f, allow_unicode=True,
                               default_flow_style=False, sort_keys=False)
            os.replace(tmp, path)
            updated.append((fname, file_updated))
        skipped.append((fname, file_skipped))

    print("=== UPDATED ===")
    for fname, titles in updated:
        print(f"{fname}:")
        for t in titles:
            print(f"  + {t}")
    print("\n=== SKIPPED (no source column) ===")
    for fname, titles in skipped:
        if titles:
            print(f"{fname}:")
            for t in titles:
                print(f"  - {t}")


if __name__ == "__main__":
    main()
