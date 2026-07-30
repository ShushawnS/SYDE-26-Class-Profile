import os
import json
import yaml

YAML_DIR = "yaml"
OUTPUT_DIR = "data"
MAIN_FILE = os.path.join(YAML_DIR, "main.yml")

with open(MAIN_FILE, encoding="utf-8") as f:
    main_data = yaml.safe_load(f)

sections = []
for section in main_data["sections"]:
    filepath = os.path.join(YAML_DIR, section["file"])
    with open(filepath, encoding="utf-8") as f:
        data = yaml.safe_load(f)

    sections.append({
        "id": section["id"],
        "title": section["title"],
        "description": section["description"],
        "charts": data.get("charts", []),
        "images": data.get("images", []),
    })

os.makedirs(OUTPUT_DIR, exist_ok=True)
output_path = os.path.join(OUTPUT_DIR, "class-profile.json")
with open(output_path, "w", encoding="utf-8") as f:
    json.dump({"sections": sections}, f, indent=2)

print(f"Built {output_path} — {len(sections)} sections, {sum(len(s['charts']) for s in sections)} charts")
