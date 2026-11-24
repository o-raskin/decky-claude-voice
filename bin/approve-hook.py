#!/usr/bin/env python3
"""PreToolUse hook for Claude Voice.

Read-only tools pass straight through. Every other tool call is written to the
approvals directory as a request; the Decky panel shows it with Allow / Deny
buttons and writes the answer back. No answer within the timeout means deny.
"""
import json
import os
import sys
import time
import uuid

APPROVALS = os.path.expanduser("~/.local/share/claude-voice/approvals")
TIMEOUT_S = 300
SAFE = {
    "Read", "Glob", "Grep", "LS", "NotebookRead", "WebSearch", "WebFetch",
    "TodoWrite", "ToolSearch", "Skill", "Task", "Agent",
}


def main() -> int:
    try:
        event = json.load(sys.stdin)
    except Exception:
        print("Claude Voice: не удалось прочитать запрос инструмента", file=sys.stderr)
        return 2

    tool = event.get("tool_name", "")
    if tool in SAFE:
        return 0

    os.makedirs(APPROVALS, exist_ok=True)
    rid = uuid.uuid4().hex[:12]
    req = os.path.join(APPROVALS, rid + ".req")
    res = os.path.join(APPROVALS, rid + ".res")
    tmp = req + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"id": rid, "tool": tool, "input": event.get("tool_input", {}),
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
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "permissionDecisionReason": "Разрешено в панели Claude Voice",
        }}))
        return 0

    reason = "истекло время ожидания" if answer is None else "пользователь отклонил"
    print(f"Действие не выполнено: {reason} в панели Claude Voice.", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
