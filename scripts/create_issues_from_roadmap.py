#!/usr/bin/env python3
# -*- coding: utf-8 -*-

# Copyright 2026 Guido Zeuner
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

import os
import re
import json
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime

ROADMAP_PATH = os.environ.get("ROADMAP_PATH", "V2_ROADMAP.md").strip()
CREATED_PATH = os.environ.get("CREATED_PATH", "CREATED_ISSUES.md").strip()

TOKEN = os.environ.get("GITHUB_TOKEN", "").strip()
REPO_SLUG = os.environ.get("GITHUB_REPOSITORY", "").strip()  # owner/repo
API_BASE = os.environ.get("GITHUB_API_URL", "https://api.github.com").strip()

ALLOW_DUPLICATES = os.environ.get("ALLOW_DUPLICATES", "false").lower() == "true"
UPDATE_EXISTING = os.environ.get("UPDATE_EXISTING", "false").lower() == "true"
DRY_RUN = os.environ.get("DRY_RUN", "false").lower() == "true"

STEP_SUMMARY_PATH = os.environ.get("GITHUB_STEP_SUMMARY", "").strip()
OWNER = ""
REPO = ""


# -----------------------------
# HTTP / GitHub API helpers
# -----------------------------
def api_request(method: str, path: str, data=None, accept="application/vnd.github+json"):
    url = f"{API_BASE}{path}"
    headers = {
        "Authorization": f"token {TOKEN}",
        "Accept": accept,
        "User-Agent": "zeus-rpg-promptkit-issue-workflow",
    }
    payload = None
    if data is not None:
        payload = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=payload, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            body = resp.read().decode("utf-8")
            return resp.status, json.loads(body) if body else None
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body) if body else None
        except Exception:
            parsed = body
        return e.code, parsed


def write_step_summary(markdown: str):
    if not STEP_SUMMARY_PATH:
        return
    with open(STEP_SUMMARY_PATH, "a", encoding="utf-8") as f:
        f.write(markdown.rstrip() + "\n")


def _read_text_with_fallback(path: str) -> str:
    for enc in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            with open(path, "r", encoding=enc) as f:
                return f.read()
        except UnicodeDecodeError:
            continue
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def _extract_backtick_labels(text: str):
    return [m.group(1).strip() for m in re.finditer(r"`([^`]+)`", text or "") if m.group(1).strip()]


def _normalize_title(t: str) -> str:
    return re.sub(r"\s+", " ", (t or "").strip())


def _labels_sorted(labels):
    return sorted({(l or "").strip() for l in (labels or []) if (l or "").strip()}, key=lambda x: x.lower())


def _stable_color_from_name(name: str) -> str:
    # deterministic hex-ish color derived from label name, but not too dark
    import hashlib
    h = hashlib.sha1(name.encode("utf-8")).hexdigest()
    base = int(h[:6], 16)
    r = (base >> 16) & 0xFF
    g = (base >> 8) & 0xFF
    b = base & 0xFF
    r = (r + 0x88) // 2
    g = (g + 0x88) // 2
    b = (b + 0x88) // 2
    return f"{r:02x}{g:02x}{b:02x}"


def ensure_label(name: str, color: str = None, description: str = ""):
    if not name:
        return
    if color is None:
        color = _stable_color_from_name(name)

    if DRY_RUN:
        print(f"[DRY_RUN] ensure_label: {name}")
        return

    status, resp = api_request(
        "POST",
        f"/repos/{OWNER}/{REPO}/labels",
        {"name": name, "color": color, "description": description},
    )
    if status in (200, 201):
        print(f"Label created: {name}")
    elif status == 422:
        print(f"Label exists: {name}")
    else:
        raise SystemExit(f"ERROR: label create failed ({status}) {name}: {resp}")


# -----------------------------
# Roadmap parsing
# -----------------------------
def parse_roadmap_title_labels_body_format(text: str):
    pattern = re.compile(
        r"TITLE:\s*\n(?P<title>.+?)\n\s*\n"
        r"LABELS:\s*\n(?P<labels>.+?)\n\s*\n"
        r"BODY:\s*\n(?P<body>.*?)(?=\nTITLE:\s*\n|\Z)",
        re.DOTALL,
    )
    issues = []
    for m in pattern.finditer(text):
        title = m.group("title").strip()
        labels = [x.strip() for x in m.group("labels").split(",") if x.strip()]
        body = m.group("body").strip()
        issues.append({"title": title, "labels": labels, "body": body})
    return issues


def parse_roadmap_markdown_format(text: str):
    issues = []

    epic_match = re.search(
        r"^##\s+Epic.*?$.*?^###\s+Title\s*$\n(?P<title>.+?)\n+^###\s+Labels\s*$\n(?P<labels>.+?)\n+^###\s+Description\s*$\n(?P<body>.*?)(?=^##\s+Issue Backlog\s*$|\Z)",
        text,
        re.DOTALL | re.MULTILINE,
    )
    if epic_match:
        issues.append(
            {
                "title": epic_match.group("title").strip(),
                "labels": _extract_backtick_labels(epic_match.group("labels")),
                "body": epic_match.group("body").strip(),
            }
        )

    backlog_match = re.search(r"^##\s+Issue Backlog\s*$\n(?P<body>.*)$", text, re.DOTALL | re.MULTILINE)
    if not backlog_match:
        return issues

    item_pattern = re.compile(
        r"^###\s+\d+\)\s+(?P<title>.+?)\n(?P<body>.*?)(?=^###\s+\d+\)\s+|\Z)",
        re.DOTALL | re.MULTILINE,
    )
    for item in item_pattern.finditer(backlog_match.group("body")):
        block = item.group("body").strip()
        labels_line = re.search(r"^Labels:\s*(?P<labels>.+?)\s*$", block, re.MULTILINE)
        labels = _extract_backtick_labels(labels_line.group("labels")) if labels_line else []
        issues.append({"title": item.group("title").strip(), "labels": labels, "body": block})

    return issues


def parse_roadmap():
    if not os.path.exists(ROADMAP_PATH):
        raise SystemExit(f"ERROR: {ROADMAP_PATH} not found")

    text = _read_text_with_fallback(ROADMAP_PATH)
    text = text.replace("\r\n", "\n").replace("\r", "\n")

    issues = parse_roadmap_markdown_format(text)
    if not issues:
        issues = parse_roadmap_title_labels_body_format(text)

    if not issues:
        raise SystemExit(
            f"ERROR: No issue blocks parsed from {ROADMAP_PATH}. Supported formats:\n"
            "1) Markdown style with '## Epic' + '## Issue Backlog'\n"
            "2) Legacy TITLE/LABELS/BODY blocks."
        )
    return issues


# -----------------------------
# GitHub issue operations
# -----------------------------
def create_issue(title: str, body: str, labels):
    payload = {"title": title, "body": body}
    if labels:
        payload["labels"] = labels

    if DRY_RUN:
        print(f"[DRY_RUN] create_issue: {title}")
        return {"number": -1, "html_url": "DRY_RUN", "title": title}

    status, resp = api_request("POST", f"/repos/{OWNER}/{REPO}/issues", payload)
    if status not in (200, 201):
        raise SystemExit(f"ERROR: issue create failed ({status}): {resp}")
    return resp


def update_issue(issue_number: int, title: str, body: str, labels):
    payload = {}
    if title:
        payload["title"] = title
    if body is not None:
        payload["body"] = body
    if labels is not None:
        payload["labels"] = labels

    if DRY_RUN:
        print(f"[DRY_RUN] update_issue #{issue_number}: {title}")
        return {"number": issue_number, "html_url": "DRY_RUN", "title": title}

    status, resp = api_request("PATCH", f"/repos/{OWNER}/{REPO}/issues/{issue_number}", payload)
    if status != 200:
        raise SystemExit(f"ERROR: issue update failed ({status}): {resp}")
    return resp


def find_existing_epic_by_title(epic_title: str):
    status, resp = api_request("GET", f"/repos/{OWNER}/{REPO}/issues?state=all&labels=epic&per_page=100")
    if status != 200:
        raise SystemExit(f"ERROR: failed to query existing epic issues ({status}): {resp}")
    wanted = _normalize_title(epic_title)
    for issue in (resp or []):
        if issue.get("pull_request"):
            continue
        if _normalize_title(issue.get("title", "")) == wanted:
            return issue
    return None


def find_issue_by_exact_title(title: str):
    q = f'repo:{OWNER}/{REPO} in:title "{title}" type:issue'
    q_enc = urllib.parse.quote(q, safe="")
    status, resp = api_request("GET", f"/search/issues?q={q_enc}&per_page=20")
    if status != 200:
        raise SystemExit(f"ERROR: failed to search issues ({status}): {resp}")

    wanted = _normalize_title(title)
    items = (resp or {}).get("items", [])
    for it in items:
        if it.get("pull_request"):
            continue
        if _normalize_title(it.get("title", "")) == wanted:
            return it
    return None


# -----------------------------
# Output / summaries
# -----------------------------
def write_created_issues_file(repo_slug: str, epic, created, updated, skipped):
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%SZ")
    lines = []
    lines.append("# Created Issues (V2)\n")
    lines.append(f"- Repository: `{repo_slug}`")
    lines.append(f"- Run at (UTC): {now}")
    lines.append(f"- Roadmap: `{ROADMAP_PATH}`")
    lines.append(
        f"- Mode: allow_duplicates={str(ALLOW_DUPLICATES).lower()}, "
        f"update_existing={str(UPDATE_EXISTING).lower()}, dry_run={str(DRY_RUN).lower()}\n"
    )

    lines.append("## Epic")
    lines.append(f"- #{epic['number']} {epic['url']} - {epic['title']}\n")

    def _section(title, arr):
        lines.append(f"## {title}")
        if not arr:
            lines.append("- (none)\n")
            return
        for c in arr:
            lines.append(f"- #{c['number']} {c['url']} - {c['title']}")
        lines.append("")

    _section("Created", created)
    _section("Updated", updated)
    _section("Skipped", skipped)

    with open(CREATED_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(lines).rstrip() + "\n")


def write_step_summary_report(epic, created, updated, skipped):
    lines = []
    lines.append("## Created Issues (V2)")
    lines.append(f"Epic: [#{epic['number']}]({epic['url']}) - {epic['title']}")
    if created:
        lines.append("\n### Created")
        for c in created:
            lines.append(f"- [#{c['number']}]({c['url']}) - {c['title']}")
    if updated:
        lines.append("\n### Updated")
        for c in updated:
            lines.append(f"- [#{c['number']}]({c['url']}) - {c['title']}")
    if skipped:
        lines.append("\n### Skipped")
        for c in skipped:
            lines.append(f"- [#{c['number']}]({c['url']}) - {c['title']}")
    write_step_summary("\n".join(lines))


# -----------------------------
# Main
# -----------------------------
def main():
    global OWNER, REPO
    if not TOKEN and not DRY_RUN:
        raise SystemExit("ERROR: GITHUB_TOKEN missing")
    if not REPO_SLUG or "/" not in REPO_SLUG:
        raise SystemExit("ERROR: GITHUB_REPOSITORY missing or invalid (expected owner/repo)")
    OWNER, REPO = REPO_SLUG.split("/", 1)

    print("== Parsing roadmap ==")
    issues = parse_roadmap()
    print(f"Parsed {len(issues)} blocks from {ROADMAP_PATH}")

    epic = None
    rest = []
    for it in issues:
        if any(l.lower() == "epic" for l in it["labels"]) and epic is None:
            epic = it
        else:
            rest.append(it)
    if epic is None:
        raise SystemExit("ERROR: No epic found (needs label 'epic' in epic LABELS).")

    print("== Ensuring labels (from roadmap) ==")
    all_labels = set()
    for it in issues:
        for l in it.get("labels") or []:
            all_labels.add(l.strip())

    known_desc = {
        "epic": "Epic",
        "enhancement": "Enhancement",
        "tech-debt": "Tech debt / internal improvement",
        "bug": "Bug",
        "api": "API",
        "ui": "UI",
        "db2": "DB2/400 / IBM i",
        "import": "Import pipeline",
        "priority:P1": "High priority",
        "priority:P2": "Medium priority",
        "priority:P3": "Lower priority",
    }
    for name in _labels_sorted(all_labels):
        ensure_label(name, description=known_desc.get(name, ""))

    print("== Epic handling ==")
    existing_epic = find_existing_epic_by_title(epic["title"])
    epic_issue = None

    if existing_epic and not ALLOW_DUPLICATES:
        epic_issue = {
            "number": existing_epic["number"],
            "title": existing_epic["title"],
            "url": existing_epic["html_url"],
            "labels": [l["name"] for l in existing_epic.get("labels", [])],
            "body": existing_epic.get("body") or "",
        }
        print(f"Using existing epic: #{epic_issue['number']} {epic_issue['url']}")

        if UPDATE_EXISTING:
            desired_labels = _labels_sorted(epic["labels"])
            desired_body = epic["body"].strip()
            current_labels = _labels_sorted(epic_issue["labels"])
            current_body = (epic_issue["body"] or "").strip()

            if desired_labels != current_labels or desired_body != current_body:
                print("Updating epic (labels/body) to match roadmap...")
                update_issue(epic_issue["number"], epic["title"].strip(), desired_body, desired_labels)

        epic_issue["labels"] = _labels_sorted(epic_issue["labels"])  # normalize for output
    else:
        print("Creating new epic...")
        epic_resp = create_issue(epic["title"], epic["body"], epic["labels"])
        epic_issue = {
            "number": epic_resp["number"],
            "title": epic["title"],
            "url": epic_resp.get("html_url") or epic_resp.get("url"),
            "labels": epic["labels"],
            "body": epic["body"],
        }
        print(f"Epic created: #{epic_issue['number']} {epic_issue['url']}")

    epic_number = epic_issue["number"]

    created = []
    updated = []
    skipped = []

    print("== Creating/updating backlog issues ==")
    for it in rest:
        title = it["title"].strip()
        body = it["body"].replace("#<EPIC>", f"#{epic_number}")
        if "Part of:" in body:
            body = body.replace("Part of: #<EPIC>", f"Part of: #{epic_number}")

        desired_labels = _labels_sorted(it["labels"])
        desired_body = body.strip()

        existing = find_issue_by_exact_title(title)
        if existing:
            number = existing["number"]
            url = existing["html_url"]
            current_labels = _labels_sorted([l["name"] for l in existing.get("labels", [])])
            current_body = (existing.get("body") or "").strip()

            if UPDATE_EXISTING and (current_labels != desired_labels or current_body != desired_body):
                print(f"Updating existing issue: #{number} {url}")
                update_issue(number, title, desired_body, desired_labels)
                updated.append({"number": number, "title": title, "url": url})
            else:
                print(f"Skipping (exists): #{number} {url}")
                skipped.append({"number": number, "title": title, "url": url})
        else:
            print(f"Creating new issue: {title}")
            resp = create_issue(title, desired_body, desired_labels)
            created.append(
                {
                    "number": resp["number"],
                    "title": title,
                    "url": resp.get("html_url") or resp.get("url"),
                }
            )
            print(f"Created: #{resp['number']} {resp.get('html_url')}")

    epic_out = {"number": epic_number, "title": epic_issue["title"], "url": epic_issue["url"]}
    write_created_issues_file(REPO_SLUG, epic_out, created, updated, skipped)
    write_step_summary_report(epic_out, created, updated, skipped)
    print("Done.")


if __name__ == "__main__":
    main()
