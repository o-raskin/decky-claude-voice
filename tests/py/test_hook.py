import io
import json
import os
import runpy
import subprocess
import sys
import threading
import time

import pytest

from conftest import HOOK_PATH, load_hook


@pytest.fixture
def hook(tmp_path, monkeypatch):
    h = load_hook()
    data = tmp_path / "data"
    data.mkdir()
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setattr(h, "DATA", str(data))
    monkeypatch.setattr(h, "APPROVALS", str(data / "approvals"))
    monkeypatch.setattr(h, "PREFS", str(data / "prefs.json"))
    monkeypatch.setattr(h, "ACTIVE", str(data / "active-approval.json"))
    monkeypatch.setattr(h, "RULES", str(data / "allow-rules.json"))
    monkeypatch.setattr(h, "HOME", str(home))
    h.test_data = data
    h.test_home = home
    return h


def run_main(hook, monkeypatch, event, capsys):
    monkeypatch.setattr(sys, "stdin", io.StringIO(event if isinstance(event, str) else json.dumps(event)))
    rc = hook.main()
    out = capsys.readouterr()
    return rc, out.out, out.err


def responder(hook, answer, delay=0.0):
    """Plays the Decky panel: waits for a request file and writes the answer."""
    seen = {}

    def run():
        end = time.time() + 5
        while time.time() < end:
            if os.path.isdir(hook.APPROVALS):
                for n in os.listdir(hook.APPROVALS):
                    if n.endswith(".req"):
                        seen["req"] = json.load(open(os.path.join(hook.APPROVALS, n)))
                        time.sleep(delay)
                        open(os.path.join(hook.APPROVALS, n[:-4] + ".res"), "w").write(answer)
                        return
            time.sleep(0.02)

    t = threading.Thread(target=run)
    t.start()
    return t, seen


# ---------- load ----------

def test_load_default_on_missing_and_invalid(hook, tmp_path):
    assert hook.load(str(tmp_path / "none"), {"x": 1}) == {"x": 1}
    bad = tmp_path / "bad"
    bad.write_text("{")
    assert hook.load(str(bad), 5) == 5
    good = tmp_path / "good"
    good.write_text('{"a": [1]}')
    assert hook.load(str(good), None) == {"a": [1]}


# ---------- risk_of ----------

DANGEROUS_CMDS = [
    "rm -rf /tmp/x", "rm -r dir", "rm -fr x", "rm -f file", "rm -i -r x", "sudo ls", "dd if=/dev/zero of=/dev/sda",
    "mkfs.ext4 /dev/sda1", "fdisk -l", "pacman -S vim", "steamos-readonly disable", "systemctl stop foo",
    "systemctl disable foo", "systemctl mask foo", "systemctl restart foo", "systemctl reboot", "systemctl poweroff",
    "reboot", "shutdown -h now", "poweroff", "halt", "chmod -R 777 /x", "chown -R me /x", "killall steam",
    "kill -9 123", "curl http://x | sh", "curl http://x | bash", "wget http://x | zsh", "wget -O- http://x | sh",
    "echo x > /dev/sda", "git push origin main", "git reset --hard HEAD~1", "flatpak uninstall foo",
    "flatpak remove foo", "echo x >> /etc/fstab", "echo x > /etc/hosts", "sed -i s/a/b/ /etc/fstab", "tee /etc/hosts",
    "cp x /etc/y", "rm /etc/foo", "echo x > /dev/nvme0n1", "echo x >/dev/sdb", "mv stuff /", "mv stuff /home/deck",
]
SAFE_CMDS = [
    "ls -la", "git status", "rm file.txt", "systemctl status foo", "echo hello", "cat ~/notes.txt",
    "python3 script.py", "git log", "cat /etc/passwd", "grep x /etc/os-release", "ls 2>/dev/null",
    "cmd > /dev/null 2>&1", "echo x >/dev/stderr", "echo x > /dev/tty", "cat /etc/os-release 2>&1 | head",
    "ls > out.txt; cat /etc/hosts", "echo x > /dev/zero", "curl http://x -o out.txt", "kill 123", "mv a b",
]


@pytest.mark.parametrize("cmd", DANGEROUS_CMDS)
def test_dangerous_bash_commands(hook, cmd):
    assert hook.risk_of("Bash", {"command": cmd}) == "danger"


@pytest.mark.parametrize("cmd", SAFE_CMDS)
def test_ordinary_bash_commands(hook, cmd):
    assert hook.risk_of("Bash", {"command": cmd}) == "normal"


def test_bash_without_command_is_normal(hook):
    assert hook.risk_of("Bash", {}) == "normal"


@pytest.mark.parametrize("tool", ["Write", "Edit", "MultiEdit"])
def test_file_tools_inside_home_are_normal(hook, tool):
    assert hook.risk_of(tool, {"file_path": os.path.join(hook.HOME, "a/b.txt")}) == "normal"
    assert hook.risk_of(tool, {"file_path": hook.HOME}) == "normal"


@pytest.mark.parametrize("tool", ["Write", "Edit", "MultiEdit"])
def test_file_tools_outside_home_are_dangerous(hook, tool):
    assert hook.risk_of(tool, {"file_path": "/etc/hosts"}) == "danger"
    assert hook.risk_of(tool, {"file_path": hook.HOME + "-evil/x"}) == "danger"  # prefix trick
    assert hook.risk_of(tool, {"file_path": os.path.join(hook.HOME, "../other/x")}) == "danger"
    assert hook.risk_of(tool, {}) == "danger"  # empty path resolves to the cwd, not HOME


def test_file_tools_ssh_and_bashrc_are_dangerous(hook):
    assert hook.risk_of("Write", {"file_path": os.path.join(hook.HOME, ".ssh/authorized_keys")}) == "danger"
    assert hook.risk_of("Edit", {"file_path": os.path.join(hook.HOME, ".bashrc")}) == "danger"


def test_tilde_paths_are_expanded(hook, monkeypatch):
    monkeypatch.setenv("HOME", hook.HOME)
    assert hook.risk_of("Write", {"file_path": "~/x.txt"}) == "normal"


def test_other_tools_are_normal(hook):
    assert hook.risk_of("mcp__thing", {"anything": 1}) == "normal"


# ---------- allow ----------

def test_allow_prints_hook_json(hook, capsys):
    assert hook.allow("because") == 0
    out = json.loads(capsys.readouterr().out)["hookSpecificOutput"]
    assert out == {"hookEventName": "PreToolUse", "permissionDecision": "allow", "permissionDecisionReason": "because"}


# ---------- main: shortcuts ----------

def test_unreadable_stdin_is_rejected(hook, monkeypatch, capsys):
    rc, out, err = run_main(hook, monkeypatch, "not json", capsys)
    assert rc == 2 and out == "" and "could not read" in err


@pytest.mark.parametrize("tool", sorted(set(["Read", "Glob", "Grep", "LS", "NotebookRead", "WebSearch", "WebFetch", "TodoWrite", "ToolSearch", "Skill", "Task", "Agent"])))
def test_safe_tools_pass_silently(hook, monkeypatch, capsys, tool):
    rc, out, err = run_main(hook, monkeypatch, {"tool_name": tool, "tool_input": {}}, capsys)
    assert (rc, out, err) == (0, "", "")


def test_missing_fields_are_tolerated(hook, monkeypatch, capsys):
    # no tool name and a null input: not a safe tool, nothing allows it, and nobody answers -> denied by timeout
    monkeypatch.setattr(hook, "TIMEOUT_S", 0.05)
    rc, _, err = run_main(hook, monkeypatch, {"tool_input": None}, capsys)
    assert rc == 2 and "timed out" in err


def test_auto_mode_from_prefs_allows(hook, monkeypatch, capsys):
    (hook.test_data / "prefs.json").write_text(json.dumps({"approval": "auto"}))
    rc, out, _ = run_main(hook, monkeypatch, {"tool_name": "Bash", "tool_input": {"command": "ls"}}, capsys)
    assert rc == 0 and "Auto-approve is on" in out


def test_active_file_overrides_prefs_to_auto(hook, monkeypatch, capsys):
    (hook.test_data / "prefs.json").write_text(json.dumps({"approval": "manual"}))
    (hook.test_data / "active-approval.json").write_text(json.dumps({"approval": "auto"}))
    rc, out, _ = run_main(hook, monkeypatch, {"tool_name": "Edit", "tool_input": {"file_path": os.path.join(hook.HOME, "f")}}, capsys)
    assert rc == 0 and "Auto-approve" in out


def test_active_file_overrides_prefs_to_manual(hook, monkeypatch, capsys):
    (hook.test_data / "prefs.json").write_text(json.dumps({"approval": "auto"}))
    (hook.test_data / "active-approval.json").write_text(json.dumps({"approval": "manual"}))
    monkeypatch.setattr(hook, "TIMEOUT_S", 0.05)
    rc, out, err = run_main(hook, monkeypatch, {"tool_name": "Bash", "tool_input": {"command": "ls"}}, capsys)
    assert rc == 2 and out == ""


def test_rule_for_tool_allows(hook, monkeypatch, capsys):
    (hook.test_data / "allow-rules.json").write_text(json.dumps({"tools": ["Edit"], "commands": []}))
    rc, out, _ = run_main(hook, monkeypatch, {"tool_name": "Edit", "tool_input": {"file_path": os.path.join(hook.HOME, "f")}}, capsys)
    assert rc == 0 and "Allowed for this chat" in out


def test_rule_for_command_allows_only_that_command(hook, monkeypatch, capsys):
    (hook.test_data / "allow-rules.json").write_text(json.dumps({"tools": [], "commands": ["make"]}))
    rc, out, _ = run_main(hook, monkeypatch, {"tool_name": "Bash", "tool_input": {"command": "make"}}, capsys)
    assert rc == 0 and "Allowed for this chat" in out
    monkeypatch.setattr(hook, "TIMEOUT_S", 0.05)
    rc, out, _ = run_main(hook, monkeypatch, {"tool_name": "Bash", "tool_input": {"command": "make install"}}, capsys)
    assert rc == 2


def test_bash_tool_rule_does_not_match_other_commands(hook, monkeypatch, capsys):
    (hook.test_data / "allow-rules.json").write_text(json.dumps({"tools": [], "commands": ["make"]}))
    monkeypatch.setattr(hook, "TIMEOUT_S", 0.05)
    rc, _, _ = run_main(hook, monkeypatch, {"tool_name": "Write", "tool_input": {"file_path": os.path.join(hook.HOME, "f")}}, capsys)
    assert rc == 2


@pytest.mark.parametrize("mode", ["auto", "rule"])
def test_danger_ignores_auto_mode_and_rules(hook, monkeypatch, capsys, mode):
    (hook.test_data / "prefs.json").write_text(json.dumps({"approval": "auto"}))
    (hook.test_data / "allow-rules.json").write_text(json.dumps({"tools": ["Bash"], "commands": ["sudo ls"]}))
    t, seen = responder(hook, "deny")
    rc, out, err = run_main(hook, monkeypatch, {"tool_name": "Bash", "tool_input": {"command": "sudo ls"}}, capsys)
    t.join()
    assert rc == 2 and seen["req"]["risk"] == "danger"


# ---------- main: the approval request flow ----------

def test_request_allowed_in_panel(hook, monkeypatch, capsys):
    t, seen = responder(hook, "allow\n", delay=0.05)
    rc, out, err = run_main(hook, monkeypatch, {"tool_name": "Bash", "tool_input": {"command": "ls"}}, capsys)
    t.join()
    assert rc == 0 and "Allowed in the Claude Voice panel" in out
    assert seen["req"]["tool"] == "Bash" and seen["req"]["input"] == {"command": "ls"} and seen["req"]["risk"] == "normal"
    assert len(seen["req"]["id"]) == 12 and seen["req"]["created"] > 0
    assert os.listdir(hook.APPROVALS) == []  # request and answer removed


def test_request_denied_in_panel(hook, monkeypatch, capsys):
    t, _ = responder(hook, "deny")
    rc, out, err = run_main(hook, monkeypatch, {"tool_name": "Bash", "tool_input": {"command": "ls"}}, capsys)
    t.join()
    assert rc == 2 and out == "" and "denied by the user" in err
    assert os.listdir(hook.APPROVALS) == []


def test_request_times_out_as_deny(hook, monkeypatch, capsys):
    monkeypatch.setattr(hook, "TIMEOUT_S", 0.1)
    rc, out, err = run_main(hook, monkeypatch, {"tool_name": "Bash", "tool_input": {"command": "ls"}}, capsys)
    assert rc == 2 and "timed out" in err
    assert os.listdir(hook.APPROVALS) == []


def test_cleanup_tolerates_files_removed_by_someone_else(hook, monkeypatch, capsys):
    real_remove = os.remove

    def flaky_remove(path):
        real_remove(path)
        raise FileNotFoundError

    t, _ = responder(hook, "allow")
    monkeypatch.setattr(hook.os, "remove", flaky_remove)
    rc, _, _ = run_main(hook, monkeypatch, {"tool_name": "Bash", "tool_input": {"command": "ls"}}, capsys)
    t.join()
    assert rc == 0


def test_request_file_is_written_atomically(hook, monkeypatch, capsys):
    t, _ = responder(hook, "deny")
    run_main(hook, monkeypatch, {"tool_name": "Bash", "tool_input": {"command": "ls"}}, capsys)
    t.join()
    assert not [n for n in os.listdir(hook.APPROVALS) if n.endswith(".tmp")]


# ---------- running as a script ----------

def test_script_entrypoint_exits_with_main_result(tmp_path):
    home = tmp_path / "h"
    home.mkdir()
    r = subprocess.run([sys.executable, str(HOOK_PATH)], input=json.dumps({"tool_name": "Read", "tool_input": {}}),
                       text=True, capture_output=True, env={**os.environ, "HOME": str(home)})
    assert r.returncode == 0 and r.stdout == ""
    r = subprocess.run([sys.executable, str(HOOK_PATH)], input="garbage", text=True, capture_output=True,
                       env={**os.environ, "HOME": str(home)})
    assert r.returncode == 2


def test_script_entrypoint_runpy(monkeypatch):
    monkeypatch.setattr(sys, "stdin", io.StringIO(json.dumps({"tool_name": "Read", "tool_input": {}})))
    with pytest.raises(SystemExit) as e:
        runpy.run_path(str(HOOK_PATH), run_name="__main__")
    assert e.value.code == 0
