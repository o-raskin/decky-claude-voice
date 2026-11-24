import asyncio
import json
import os
import struct
import time

import main


def req(rid, tool="Bash", inp=None, risk="normal", raw=None):
    path = os.path.join(main.APPROVALS, rid + ".req")
    with open(path, "w") as f:
        f.write(raw if raw is not None else json.dumps({"id": rid, "tool": tool, "input": inp if inp is not None else {"command": "ls"}, "risk": risk}))


def rules():
    return json.load(open(main.RULES_FILE))


async def test_clear_approvals_denies_every_request(plugin):
    req("a")
    req("b")
    plugin._clear_approvals()
    assert open(os.path.join(main.APPROVALS, "a.res")).read() == "deny"
    assert open(os.path.join(main.APPROVALS, "b.res")).read() == "deny"


async def test_clear_rules_resets_file_and_ignores_errors(plugin, monkeypatch):
    main._write_json(main.RULES_FILE, {"tools": ["X"], "commands": ["y"]})
    plugin._clear_rules()
    assert rules() == {"tools": [], "commands": []}
    monkeypatch.setattr(main, "_write_json", lambda *a: (_ for _ in ()).throw(OSError()))
    plugin._clear_rules()


async def test_pending_lists_only_open_valid_requests(plugin):
    req("ok1", "Bash", {"command": "ls"})
    req("done", "Bash", {"command": "ls"})
    open(os.path.join(main.APPROVALS, "done.res"), "w").write("allow")
    req("broken", raw="{not json")
    req("list", raw="[1, 2]")
    req("weird", "Foo", raw=json.dumps({"tool": "Foo", "input": "str", "risk": "danger"}))
    open(os.path.join(main.APPROVALS, "readme.txt"), "w").write("x")
    out = plugin._pending()
    assert [p["id"] for p in out] == ["ok1", "weird"]
    assert out[0]["detail"] == "Command: ls" and out[0]["risk"] == "normal"
    assert out[0]["preview"] == {"kind": "command", "text": "ls"}
    assert out[1]["risk"] == "danger" and out[1]["detail"] == "Foo: {}" and out[1]["preview"]["kind"] == "other"


async def test_pending_defaults_risk_and_tool(plugin):
    req("x", raw=json.dumps({"input": {}}))
    assert plugin._pending()[0]["risk"] == "normal" and plugin._pending()[0]["tool"] == ""


async def test_respond_unknown_request(plugin):
    assert await plugin.respond("nothing", True) is False


async def test_respond_sanitises_request_id(plugin):
    req("abc123")
    assert await plugin.respond("../../abc123/", True) is True
    assert open(os.path.join(main.APPROVALS, "abc123.res")).read() == "allow"
    assert not os.path.exists(os.path.join(main.APPROVALS, "..", "abc123.res"))


async def test_respond_deny(plugin):
    req("d1")
    assert await plugin.respond("d1", False, True) is True
    assert open(os.path.join(main.APPROVALS, "d1.res")).read() == "deny"
    assert rules() == {"tools": [], "commands": []}  # "always" is ignored on deny


async def test_respond_allow_once_writes_no_rule(plugin):
    req("o1")
    await plugin.respond("o1", True)
    assert rules() == {"tools": [], "commands": []}


async def test_respond_always_bash_remembers_command_once(plugin):
    req("b1", "Bash", {"command": "make"})
    await plugin.respond("b1", True, True)
    req("b2", "Bash", {"command": "make"})
    await plugin.respond("b2", True, True)
    assert rules()["commands"] == ["make"] and rules()["tools"] == []


async def test_respond_always_bash_without_command_adds_nothing(plugin):
    req("b3", "Bash", {})
    await plugin.respond("b3", True, True)
    assert rules() == {"tools": [], "commands": []}


async def test_respond_always_other_tool_remembers_tool_once(plugin):
    req("e1", "Edit", {"file_path": "/x"})
    await plugin.respond("e1", True, True)
    req("e2", "Edit", {"file_path": "/y"})
    await plugin.respond("e2", True, True)
    assert rules()["tools"] == ["Edit"]


async def test_respond_always_without_tool_name(plugin):
    req("n1", raw=json.dumps({"input": {}}))
    await plugin.respond("n1", True, True)
    assert rules()["tools"] == []


async def test_respond_always_with_missing_rules_file(plugin):
    os.remove(main.RULES_FILE)
    req("m1", "Write", {})
    await plugin.respond("m1", True, True)
    assert rules()["tools"] == ["Write"]


# ---------- recording level ----------

def write_wav(samples, header=44):
    with open(main.REC_FILE, "wb") as f:
        f.write(b"\0" * header + struct.pack("<%dh" % len(samples), *samples))


async def test_rec_level_edge_cases(plugin):
    assert plugin._rec_level() == 0.0  # no file
    write_wav([1000] * 10)
    assert plugin._rec_level() == 0.0  # too short
    write_wav([0] * 4000)
    assert plugin._rec_level() == 0.0  # silence
    write_wav([2500, -2500] * 2000)
    assert plugin._rec_level() == 0.5
    write_wav([30000, -30000] * 2000)
    assert plugin._rec_level() == 1.0  # capped


async def test_rec_level_unreadable_file(plugin, monkeypatch):
    write_wav([1000] * 4000)
    monkeypatch.setattr(main.os.path, "getsize", lambda p: (_ for _ in ()).throw(OSError()))
    assert plugin._rec_level() == 0.0


# ---------- get_state ----------

async def test_state_idle_snapshot(plugin):
    plugin._push("user", "hello")
    plugin.error = "boom"
    s = await plugin.get_state()
    assert s["phase"] == "idle" and s["error"] == "boom" and s["rec_seconds"] == 0 and s["rec_level"] == 0.0
    assert s["events"][0]["text"] == "hello" and s["pending"] == [] and s["model_ready"] is False
    assert s["prefs"]["approval"] == "manual" and s["models"] == {"available": ["sonnet", "opus"], "current": ""}
    assert s["chat"]["title"] == "New chat" and s["chat"]["count"] == 1 and s["chat"]["has_session"] is False
    assert s["chat"]["last"] is None and len(s["chats"]) == 1 and s["panel_target"] == "new"


async def test_state_shows_last_80_events(plugin):
    for i in range(120):
        plugin._push("tool", str(i))
    s = await plugin.get_state()
    assert len(s["events"]) == 80 and s["events"][-1]["text"] == "119" and s["chat"]["count"] == 120


async def test_state_live_only_while_thinking(plugin):
    plugin.live = {"text": "partial", "thinking": "hmm"}
    assert (await plugin.get_state())["live"] == {"text": "", "thinking": ""}
    plugin.phase = "thinking"
    assert (await plugin.get_state())["live"] == {"text": "partial", "thinking": "hmm"}


async def test_state_recording_reports_seconds_and_level(plugin):
    plugin.phase = "recording"
    plugin.rec_started = time.time() - 5
    write_wav([2500, -2500] * 2000)
    s = await plugin.get_state()
    assert s["rec_seconds"] == 5 and s["rec_level"] == 0.5


async def test_state_stops_overlong_recording(plugin, monkeypatch):
    calls = []

    async def fake_stop(*a):
        calls.append(a)

    monkeypatch.setattr(plugin, "stop_recording", fake_stop)
    plugin.phase = "recording"
    plugin.rec_started = time.time() - main.MAX_REC_S - 1
    await plugin.get_state()
    await asyncio.sleep(0.01)
    assert calls == [()]


async def test_state_does_not_stop_short_recording(plugin, monkeypatch):
    calls = []

    async def fake_stop(*a):
        calls.append(a)

    monkeypatch.setattr(plugin, "stop_recording", fake_stop)
    plugin.phase = "recording"
    plugin.rec_started = time.time()
    await plugin.get_state()
    await asyncio.sleep(0.01)
    assert calls == []


async def test_state_panel_target_validation(plugin):
    cid = plugin.store["active"]
    plugin.prefs["panel_target"] = cid
    assert (await plugin.get_state())["panel_target"] == cid
    plugin.prefs["panel_target"] = "deleted-chat"
    assert (await plugin.get_state())["panel_target"] == "new"
    plugin.prefs["panel_target"] = "new"
    assert (await plugin.get_state())["panel_target"] == "new"
    del plugin.prefs["panel_target"]
    assert (await plugin.get_state())["panel_target"] == "new"


async def test_state_model_ready_and_pending(plugin, env):
    env.make_model()
    req("p1")
    s = await plugin.get_state()
    assert s["model_ready"] is True and s["pending"][0]["id"] == "p1"
