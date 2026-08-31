import os
import yaml
import re
import json
from wordcloud import WordCloud

COLORS = ["#2563eb", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4"]
OUTPUT_DIR = "images/wordclouds"


def slugify(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def color_func(word, font_size, position, orientation, random_state=None, **kwargs):
    return COLORS[hash(word) % len(COLORS)]


os.makedirs(OUTPUT_DIR, exist_ok=True)
manifest = {}

yaml_dir = "yaml"
for fname in sorted(os.listdir(yaml_dir)):
    if not fname.endswith((".yml", ".yaml")):
        continue

    filepath = os.path.join(yaml_dir, fname)
    with open(filepath, encoding="utf-8") as f:
        data = yaml.safe_load(f)

    section_key = fname.replace(".yml", "").replace(".yaml", "")

    for chart in data.get("charts", []):
        if chart.get("type") != "wordcloud":
            continue

        title = chart["title"]
        words = chart.get("words", [])

        if not words:
            continue

        freq = {w["text"]: w["weight"] for w in words}
        slug = slugify(f"{section_key}-{title}")
        img_path = os.path.join(OUTPUT_DIR, f"{slug}.png")

        wc = WordCloud(
            width=2000,
            height=1150,
            background_color=None,
            mode="RGBA",
            color_func=color_func,
            prefer_horizontal=0.7,
            relative_scaling=1.0,
            collocations=False,
            min_font_size=10,
            max_font_size=220,
            max_words=len(freq),
            random_state=42,
        ).generate_from_frequencies(freq)

        wc.to_file(img_path)
        manifest[f"{section_key}/{title}"] = f"images/wordclouds/{slug}.png"
        print(f"  {img_path}")

with open(os.path.join(OUTPUT_DIR, "manifest.json"), "w") as f:
    json.dump(manifest, f, indent=2)

known = {os.path.basename(p) for p in manifest.values()}
for f in sorted(os.listdir(OUTPUT_DIR)):
    if f.endswith(".png") and f not in known:
        os.remove(os.path.join(OUTPUT_DIR, f))
        print(f"  removed orphan {f}")

print(f"\nDone — {len(manifest)} word clouds generated")
