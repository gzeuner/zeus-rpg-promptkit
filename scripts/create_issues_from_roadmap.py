#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import re
import json
import urllib.request
import urllib.error
from datetime import datetime

ROADMAP_PATH = "V2_ROADMAP.md"
CREATED_PATH = "CREATED_ISSUES.md"

TOKEN = os.environ.get("GITHUB_TOKEN", "").strip()
REPO_SLUG = os.environ.get("GITHUB_REPOSITORY", "").strip()  # owner/repo
API_BASE = os.environ.get("GITHUB_API_URL", "https://api.github.com").strip()
ALLOW_DUPLICATES = os.environ.get("ALLOW_DUPLICATES", "false").lower() == "true"
STEP_SUMMARY_PATH = os.environ.get("GITHUB_STEP_SUMMARY", "").strip()
OWNER = ""
REPO = ""

def api_request(method: str, path: str, data=None):
    url = f"{API_BASE}{path}"
    headers = {
        "Authorization": f"token {TOKEN}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "zeus-easy-upload-issue-workflow",
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

def ensure_label(name: str, color: str, description: str):
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

def _extract_backtick_labels(text: str):
    return [m.group(1).strip() for m in re.finditer(r"`([^`]+)`", text or "") if m.group(1).strip()]

def _read_text_with_fallback(path: str) -> str:
    for enc in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            with open(path, "r", encoding=enc) as f:
                return f.read()
        except UnicodeDecodeError:
            continue
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return f.read()

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
            "ERROR: No issue blocks parsed from V2_ROADMAP.md. Supported formats:\n"
            "1) Markdown style with '## Epic' + '## Issue Backlog'\n"
            "2) Legacy TITLE/LABELS/BODY blocks."
        )
    return issues

def create_issue(title: str, body: str, labels):
    payload = {"title": title, "body": body}
    if labels:
        payload["labels"] = labels
    status, resp = api_request("POST", f"/repos/{OWNER}/{REPO}/issues", payload)
    if status not in (200, 201):
        raise SystemExit(f"ERROR: issue create failed ({status}): {resp}")
    return resp

def find_existing_epic_by_title(epic_title: str):
    status, resp = api_request(
        "GET",
        f"/repos/{OWNER}/{REPO}/issues?state=all&labels=epic&per_page=100",
    )
    if status != 200:
        raise SystemExit(f"ERROR: failed to query existing epic issues ({status}): {resp}")
    for issue in (resp or []):
        if issue.get("pull_request"):
            continue
        if issue.get("title", "").strip() == epic_title.strip():
            return issue
    return None

def write_created_issues_file(created, repo_slug: str):
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%SZ")
    epic = created[0]
    lines = []
    lines.append("# Created Issues (V2)\n")
    lines.append(f"- Repository: `{repo_slug}`")
    lines.append(f"- Created at (UTC): {now}\n")
    lines.append(f"## Epic\n- #{epic['number']} {epic['url']}\n")
    lines.append("## Issues\n")
    for c in created[1:]:
        lines.append(f"- #{c['number']} {c['url']} - {c['title']}")
    lines.append("")
    with open(CREATED_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

def write_skip_file(reason: str, repo_slug: str, epic_number: int = None, epic_url: str = None):
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%SZ")
    lines = []
    lines.append("# Created Issues (V2)\n")
    lines.append(f"- Repository: `{repo_slug}`")
    lines.append(f"- Created at (UTC): {now}")
    lines.append(f"- Status: Skipped ({reason})\n")
    if epic_number is not None and epic_url:
        lines.append("## Epic")
        lines.append(f"- #{epic_number} {epic_url}\n")
    with open(CREATED_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

def write_success_summary(created):
    epic = created[0]
    lines = []
    lines.append("## Created Issues (V2)")
    lines.append(f"Epic: [#{epic['number']}]({epic['url']})")
    for c in created[1:]:
        lines.append(f"- [#{c['number']}]({c['url']}) - {c['title']}")
    write_step_summary("\n".join(lines))

def write_skip_summary(epic_number: int, epic_url: str):
    lines = []
    lines.append("## Created Issues (V2)")
    lines.append(
        f"Skipped: Epic already exists ([#{epic_number}]({epic_url})). "
        "Set `allow_duplicates=true` to override."
    )
    write_step_summary("\n".join(lines))

def main():
    global OWNER, REPO
    if not TOKEN:
        raise SystemExit("ERROR: GITHUB_TOKEN missing")
    if not REPO_SLUG or "/" not in REPO_SLUG:
        raise SystemExit("ERROR: GITHUB_REPOSITORY missing or invalid (expected owner/repo)")
    OWNER, REPO = REPO_SLUG.split("/", 1)

    if os.path.exists(CREATED_PATH) and os.path.getsize(CREATED_PATH) > 50 and not ALLOW_DUPLICATES:
        print(f"SKIP: {CREATED_PATH} already exists and is non-empty (ALLOW_DUPLICATES=false).")
        write_step_summary("## Created Issues (V2)\nSkipped: Existing CREATED_ISSUES.md detected.")
        return

    print("== Parsing roadmap ==")
    issues = parse_roadmap()
    print(f"Parsed {len(issues)} blocks")

    # Epic first (label contains 'epic')
    epic = None
    rest = []
    for it in issues:
        if any(l.lower() == "epic" for l in it["labels"]) and epic is None:
            epic = it
        else:
            rest.append(it)
    if epic is None:
        raise SystemExit("ERROR: No epic found (needs label 'epic' in LABELS).")

    print("== Checking duplicate epic via API ==")
    existing_epic = find_existing_epic_by_title(epic["title"])
    if existing_epic and not ALLOW_DUPLICATES:
        existing_number = existing_epic["number"]
        existing_url = existing_epic["html_url"]
        print(f"SKIP: Epic already exists: #{existing_number} {existing_url}")
        write_skip_file("Epic already exists", REPO_SLUG, existing_number, existing_url)
        write_skip_summary(existing_number, existing_url)
        return

    labels_to_create = [
        ("epic", "6f42c1", "Epic"),
        ("enhancement", "84b6eb", "Enhancement"),
        ("tech-debt", "d4c5f9", "Tech debt / internal improvement"),
        ("bug", "d73a4a", "Bug"),
        ("api", "0052cc", "API"),
        ("ui", "1d76db", "UI"),
        ("db2", "5319e7", "DB2/400 / IBM i"),
        ("import", "0e8a16", "Import pipeline"),
        ("priority:P1", "ff0000", "High priority"),
        ("priority:P2", "ffa500", "Medium priority"),
        ("priority:P3", "00aa00", "Lower priority"),
    ]

    print("== Ensuring labels ==")
    for name, color, desc in labels_to_create:
        ensure_label(name, color, desc)

    print("== Creating epic ==")
    epic_resp = create_issue(epic["title"], epic["body"], epic["labels"])
    epic_number = epic_resp["number"]
    epic_url = epic_resp["html_url"]
    print(f"Epic created: #{epic_number} {epic_url}")

    created = [{"number": epic_number, "title": epic["title"], "url": epic_url, "labels": epic["labels"]}]

    print("== Creating remaining issues ==")
    for it in rest:
        body = it["body"].replace("#<EPIC>", f"#{epic_number}")
        if "Part of:" in body:
            body = body.replace("Part of: #<EPIC>", f"Part of: #{epic_number}")
        resp = create_issue(it["title"], body, it["labels"])
        created.append({"number": resp["number"], "title": it["title"], "url": resp["html_url"], "labels": it["labels"]})
        print(f"Created: #{resp['number']} {resp['html_url']}")

    print("== Writing CREATED_ISSUES.md ==")
    write_created_issues_file(created, f"{OWNER}/{REPO}")
    write_success_summary(created)

    print("Done.")

if __name__ == "__main__":
    main()
