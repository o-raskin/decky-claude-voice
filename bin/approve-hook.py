#!/usr/bin/env python3
"""PreToolUse hook for Claude Voice.

Read-only tools pass straight through. Every other tool call is written to the
approvals directory as a request; the Decky panel shows it with Allow / Deny
buttons and writes the answer back. No answer within the timeout means deny.

Auto mode (prefs.json "approval": "auto") allows ordinary calls immediately, but
anything that looks risky (see DANGEROUS) is still sent to the panel. Rules
created with "allow for this chat" are read from allow-rules.json.
"""
import json
import os
import re
import sys
import time
import uuid

DATA = os.path.expanduser("~/.local/share/claude-voice")
APPROVALS = os.path.join(DATA, "approvals")
PREFS = os.path.join(DATA, "prefs.json")
ACTIVE = os.path.join(DATA, "active-approval.json")
RULES = os.path.join(DATA, "allow-rules.json")
HOME = os.path.expanduser("~")
TIMEOUT_S = 300
SAFE = {
    "Read", "Glob", "Grep", "LS", "NotebookRead", "WebSearch", "WebFetch",
    "TodoWrite", "ToolSearch", "Skill", "Task", "Agent",
}
DANGEROUS = [
    r"\brm\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*[rf]", r"\bsudo\b", r"\bdd\b\s", r"\bmkfs", r"\bfdisk\b",
    r"\bpacman\b", r"\bsteamos-readonly\b", r"\bsystemctl\s+(stop|disable|mask|restart|reboot|poweroff)",
    r"\b(reboot|shutdown|poweroff|halt)\b", r"\bchmod\s+-R", r"\bchown\s+-R", r"\bkillall\b",
    r"\bkill\s+-9\b", r"curl[^|]*\|\s*(ba|z)?sh", r"wget[^|]*\|\s*(ba|z)?sh", r">\s*/dev/(?!(?:null|zero|stdout|stderr|tty)\b|fd/)",
    r"\bgit\s+push\b", r"\bgit\s+reset\s+--hard\b", r"\bflatpak\s+(uninstall|remove)",
    r"(?:>>?|\btee\b|\bsed\s+-\w*i|\b(?:rm|mv|cp|ln|install|truncate|chmod|chown|touch|mkdir)\b)[^;&|\n]*?/etc/",
    r"\bmv\b[^|;&]*\s/(home/deck)?\s*$",
]


def load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def risk_of(tool: str, tool_input: dict) -> str:
    if tool == "Bash":
        cmd = str(tool_input.get("command", ""))
        if any(re.search(p, cmd) for p in DANGEROUS):
            return "danger"
    if tool in ("Write", "Edit", "MultiEdit"):
        path = os.path.abspath(os.path.expanduser(str(tool_input.get("file_path", ""))))
        if not (path == HOME or path.startswith(HOME + "/")) or "/.ssh/" in path or path.endswith("/.bashrc"):
            return "danger"
    return "normal"


def allow(reason: str) -> int:
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "allow",
        "permissionDecisionReason": reason,
    }}))
    return 0


def main() -> int:
    try:
        event = json.load(sys.stdin)
    except Exception:
        print("Claude Voice: could not read the tool request", file=sys.stderr)
        return 2

    tool = event.get("tool_name", "")
    tool_input = event.get("tool_input", {}) or {}
    if tool in SAFE:
        return 0

    risk = risk_of(tool, tool_input)
    prefs = load(PREFS, {})
    rules = load(RULES, {"tools": [], "commands": []})
    if risk != "danger":
        if (load(ACTIVE, {}).get("approval") or prefs.get("approval")) == "auto":
            return allow("Auto-approve is on in Claude Voice")
        if tool in rules.get("tools", []) or (
                tool == "Bash" and tool_input.get("command") in rules.get("commands", [])):
            return allow("Allowed for this chat in Claude Voice")

    os.makedirs(APPROVALS, exist_ok=True)
    rid = uuid.uuid4().hex[:12]
    req = os.path.join(APPROVALS, rid + ".req")
    res = os.path.join(APPROVALS, rid + ".res")
    tmp = req + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"id": rid, "tool": tool, "input": tool_input, "risk": risk,
                   "created": time.time()}, f, ensure_ascii=False)
    os.replace(tmp, req)

    answer = None
    deadline = time.time() + TIMEOUT_S
    while time.time() < deadline:
        if os.path.exists(res):
            with open(res, encoding="utf-8") as f:
                answer = f.read().strip()
            break
        time.sleep(0.3)

    for path in (req, res):
        try:
            os.remove(path)
        except FileNotFoundError:
            pass

    if answer == "allow":
        return allow("Allowed in the Claude Voice panel")

    reason = "timed out" if answer is None else "denied by the user"
    print(f"Action not performed: {reason} in the Claude Voice panel.", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
