import asyncio
import json
import os
import time
from unittest.mock import AsyncMock

import main
from conftest import wait_for


def jread(path):
    return json.load(open(path, encoding="utf-8"))


async def start(env, models_updated=9e12):
    (env.data / "models.json").write_text(json.dumps({"available": ["sonnet"], "current": "", "updated": models_updated}))
    p = main.Plugin()
    await p._main()
    return p


async def test_fresh_start_creates_one_chat_and_settings(env):
    p = await start(env)
    assert len(p.store["chats"]) == 1
    assert p.store["active"] == p.store["chats"][0]["id"]
    assert p.phase == "idle" and p.error == "" and p.live == {"text": "", "thinking": ""}
    assert p.prefs == main.DEFAULT_PREFS
    assert os.path.isdir(main.APPROVALS)
    settings = jread(main.SETTINGS_FILE)
    hook = settings["hooks"]["PreToolUse"][0]
    assert hook["matcher"] == "*" and "approve-hook.py" in hook["hooks"][0]["command"]
    assert jread(main.RULES_FILE) == {"tools": [], "commands": []}
    assert jread(main.CHATS_FILE)["active"] == p.store["active"]


async def test_prefs_file_overrides_defaults(env):
    (env.data / "prefs.json").write_text(json.dumps({"model": "opus", "approval": "auto"}))
    p = await start(env)
    assert p.prefs["model"] == "opus" and p.prefs["approval"] == "auto" and p.prefs["effort"] == "default"


async def test_old_session_is_migrated(env):
    events = [{"kind": "user", "text": str(i), "t": i} for i in range(main.MAX_EVENTS + 20)]
    (env.data / "session.json").write_text(json.dumps({"events": events, "session_id": "sid-1"}))
    p = await start(env)
    chat = p.store["chats"][0]
    assert chat["title"] == "Previous chat" and chat["session_id"] == "sid-1"
    assert len(chat["events"]) == main.MAX_EVENTS and chat["events"][-1]["text"] == str(main.MAX_EVENTS + 19)


async def test_old_session_without_events_is_ignored(env):
    (env.data / "session.json").write_text(json.dumps({"session_id": "sid-1"}))
    p = await start(env)
    chat = p.store["chats"][0]
    assert chat["title"] == "" and chat["session_id"] is None and chat["events"] == []


async def test_russian_title_is_renamed(env):
    now = time.time()
    chats = [{"id": "a", "title": "Прошлый разговор", "session_id": None, "created": now, "updated": now, "events": [], "last": None, "cfg": None},
             {"id": "b", "title": "Other", "session_id": None, "created": now, "updated": now - 1, "events": [], "last": None, "cfg": None}]
    (env.data / "chats.json").write_text(json.dumps({"active": "a", "chats": chats}))
    p = await start(env)
    titles = {c["id"]: c["title"] for c in p.store["chats"]}
    assert titles == {"a": "Previous chat", "b": "Other"}
    assert p.store["active"] == "a"


async def test_unknown_active_chat_falls_back_to_first(env):
    now = time.time()
    chats = [{"id": "a", "title": "A", "session_id": None, "created": now, "updated": now, "events": [], "last": None, "cfg": None}]
    (env.data / "chats.json").write_text(json.dumps({"active": "gone", "chats": chats}))
    p = await start(env)
    assert p.store["active"] == "a"


async def test_pending_requests_are_denied_on_start(env):
    os.makedirs(main.APPROVALS)
    open(os.path.join(main.APPROVALS, "r1.req"), "w").write("{}")
    open(os.path.join(main.APPROVALS, "note.txt"), "w").write("x")
    await start(env)
    assert open(os.path.join(main.APPROVALS, "r1.res")).read() == "deny"
    assert not os.path.exists(os.path.join(main.APPROVALS, "note.res"))


async def test_stale_models_trigger_refresh(env, monkeypatch):
    refresh = AsyncMock()
    monkeypatch.setattr(main.Plugin, "_refresh_models", refresh)
    await start(env, models_updated=0)
    await asyncio.sleep(0.05)
    refresh.assert_awaited_once()


async def test_fresh_models_do_not_trigger_refresh(env, monkeypatch):
    refresh = AsyncMock()
    monkeypatch.setattr(main.Plugin, "_refresh_models", refresh)
    await start(env, models_updated=time.time())
    await asyncio.sleep(0.05)
    refresh.assert_not_awaited()


async def test_missing_models_file_triggers_refresh(env, monkeypatch):
    refresh = AsyncMock()
    monkeypatch.setattr(main.Plugin, "_refresh_models", refresh)
    p = main.Plugin()
    await p._main()
    await asyncio.sleep(0.05)
    refresh.assert_awaited_once()


async def test_unload_cancels_running_work(plugin):
    plugin.phase = "recording"
    await plugin._unload()
    assert plugin.phase == "idle"


# ---------- models ----------

async def test_refresh_models_parses_list_and_current(plugin, env):
    env.scenario(model_text="Current model: `opus`\nAvailable: sonnet, opus, haiku, or a full model ID.\n")
    out = await plugin.refresh_models()
    assert out == {"available": ["sonnet", "opus", "haiku"], "current": "opus"}
    saved = jread(main.MODELS_FILE)
    assert saved["available"] == ["sonnet", "opus", "haiku"] and saved["updated"] > 0
    assert env.calls("claude")[-1] == ["-p", "/model", "--output-format", "text"]


async def test_refresh_models_filters_alternative_ending(plugin, env):
    env.scenario(model_text="Available: a, b, or a full model name\n")
    out = await plugin.refresh_models()
    assert out["available"] == ["a", "b"] and out["current"] == ""


async def test_refresh_models_without_match_keeps_old_list(plugin, env):
    env.scenario(model_text="Something else entirely")
    before = jread(main.MODELS_FILE)
    out = await plugin.refresh_models()
    assert jread(main.MODELS_FILE) == before
    assert out["available"] == ["sonnet", "opus"]


async def test_refresh_models_survives_missing_binary(plugin, monkeypatch):
    monkeypatch.setattr(main, "CLAUDE", "/nonexistent/claude")
    out = await plugin.refresh_models()
    assert out["available"] == ["sonnet", "opus"]


def test_models_fallback_when_file_missing_empty_or_invalid(env):
    p = main.Plugin()
    fallback = {"available": ["default", "sonnet", "opus", "haiku", "fable"], "current": ""}
    assert p._models() == fallback
    open(main.MODELS_FILE, "w").write("[]")
    assert p._models() == fallback
    open(main.MODELS_FILE, "w").write(json.dumps({"available": []}))
    assert p._models() == fallback
    open(main.MODELS_FILE, "w").write(json.dumps({"available": ["x"]}))
    assert p._models() == {"available": ["x"], "current": ""}


# ---------- chats ----------

async def test_resolve_target_new_uses_panel_config(plugin):
    first = plugin.store["active"]
    plugin._resolve_target("new")
    assert plugin.store["active"] != first and len(plugin.store["chats"]) == 2
    assert plugin._chat()["cfg"] == main.PANEL_CFG


async def test_resolve_target_current_and_unknown_do_nothing(plugin):
    first = plugin.store["active"]
    for t in ("current", "", "no-such-chat"):
        plugin._resolve_target(t)
    assert plugin.store["active"] == first and len(plugin.store["chats"]) == 1


async def test_resolve_target_other_chat_switches_and_clears_rules(plugin):
    await plugin.new_chat()
    other, first = plugin.store["active"], [c["id"] for c in plugin.store["chats"] if c["id"] != plugin.store["active"]][0]
    main._write_json(main.RULES_FILE, {"tools": ["Edit"], "commands": []})
    plugin._resolve_target(first)
    assert plugin.store["active"] == first and other != first
    assert jread(main.RULES_FILE) == {"tools": [], "commands": []}


async def test_resolve_target_same_chat_keeps_rules(plugin):
    main._write_json(main.RULES_FILE, {"tools": ["Edit"], "commands": []})
    plugin._resolve_target(plugin.store["active"])
    assert jread(main.RULES_FILE)["tools"] == ["Edit"]


async def test_set_panel_target(plugin):
    assert await plugin.set_panel_target("bogus") is False
    assert await plugin.set_panel_target("new") is True
    assert jread(main.PREFS_FILE)["panel_target"] == "new"
    cid = plugin.store["active"]
    assert await plugin.set_panel_target(cid) is True
    assert plugin.prefs["panel_target"] == cid


async def test_cfg_merges_prefs_and_chat_cfg(plugin):
    plugin.prefs["model"] = "opus"
    assert plugin._cfg()["model"] == "opus"
    plugin._chat()["cfg"] = {"model": "haiku"}
    assert plugin._cfg()["model"] == "haiku" and plugin._cfg()["approval"] == "manual"
    other = main._new_chat_obj()
    assert plugin._cfg(other)["model"] == "opus"


async def test_chat_falls_back_to_first(plugin):
    plugin.store["active"] = "missing"
    assert plugin._chat() is plugin.store["chats"][0]


async def test_create_chat_activates_and_resets(plugin):
    plugin.error = "old"
    main._write_json(main.RULES_FILE, {"tools": ["X"], "commands": []})
    chat = plugin._create_chat({"model": "opus"})
    assert plugin.store["active"] == chat["id"] and chat["cfg"] == {"model": "opus"}
    assert plugin.error == "" and jread(main.RULES_FILE)["tools"] == []


async def test_save_store_keeps_newest_max_chats(plugin):
    now = time.time()
    plugin.store["chats"] = [{**main._new_chat_obj(), "id": str(i), "updated": now + i} for i in range(main.MAX_CHATS + 5)]
    plugin._save_store()
    ids = [c["id"] for c in plugin.store["chats"]]
    assert len(ids) == main.MAX_CHATS and ids[0] == str(main.MAX_CHATS + 4) and "0" not in ids
    assert len(jread(main.CHATS_FILE)["chats"]) == main.MAX_CHATS


async def test_save_store_failure_is_swallowed(plugin, monkeypatch):
    def boom(*a):
        raise OSError("disk full")
    monkeypatch.setattr(main, "_write_json", boom)
    plugin._save_store()  # must not raise


async def test_push_caps_quote_and_events(plugin):
    plugin._push("user", "hi", "q" * 2000)
    plugin._push("assistant", "yo")
    evs = plugin._chat()["events"]
    assert len(evs[0]["quote"]) == 1500 and "quote" not in evs[1]
    for i in range(main.MAX_EVENTS + 10):
        plugin._push("tool", str(i))
    assert len(plugin._chat()["events"]) == main.MAX_EVENTS
    assert plugin._chat()["events"][-1]["text"] == str(main.MAX_EVENTS + 9)


async def test_list_chats_summary(plugin):
    plugin._push("user", "one")
    plugin._chat()["title"] = "T"
    await plugin.new_chat()
    out = await plugin.list_chats()
    assert [c["title"] for c in out] == ["New chat", "T"]
    assert out[0]["active"] is True and out[1]["active"] is False
    assert out[1]["count"] == 1 and set(out[0]) == {"id", "title", "updated", "count", "active"}


async def test_new_chat(plugin):
    plugin.prefs["model"] = "opus"
    plugin.phase = "thinking"
    assert await plugin.new_chat() is False and len(plugin.store["chats"]) == 1
    plugin.phase = "idle"
    assert await plugin.new_chat() is True
    assert len(plugin.store["chats"]) == 2 and plugin._chat()["cfg"]["model"] == "opus"


async def test_switch_chat(plugin):
    first = plugin.store["active"]
    await plugin.new_chat()
    plugin.error = "x"
    main._write_json(main.RULES_FILE, {"tools": ["X"], "commands": []})
    plugin.phase = "recording"
    assert await plugin.switch_chat(first) is False
    plugin.phase = "idle"
    assert await plugin.switch_chat("nope") is False
    assert await plugin.switch_chat(first) is True
    assert plugin.store["active"] == first and plugin.error == ""
    assert jread(main.RULES_FILE)["tools"] == []


async def test_delete_chat_branches(plugin):
    first = plugin.store["active"]
    await plugin.new_chat()
    second = plugin.store["active"]
    plugin.phase = "thinking"
    assert await plugin.delete_chat(second) is False
    plugin.phase = "idle"
    # unknown id: nothing changes
    assert await plugin.delete_chat("nope") is True and len(plugin.store["chats"]) == 2
    # deleting a non-active chat keeps the active one and the rules
    main._write_json(main.RULES_FILE, {"tools": ["X"], "commands": []})
    assert await plugin.delete_chat(first) is True
    assert plugin.store["active"] == second and jread(main.RULES_FILE)["tools"] == ["X"]
    # deleting the last chat creates an empty one
    assert await plugin.delete_chat(second) is True
    assert len(plugin.store["chats"]) == 1 and plugin.store["active"] != second
    assert jread(main.RULES_FILE)["tools"] == []


async def test_delete_active_chat_moves_to_another(plugin):
    first = plugin.store["active"]
    await plugin.new_chat()
    second = plugin.store["active"]
    await plugin.delete_chat(second)
    assert plugin.store["active"] == first


# ---------- prefs ----------

async def test_set_pref_valid_values(plugin):
    assert await plugin.set_pref("model", "opus") is True
    assert await plugin.set_pref("model", "sonnet[1m]") is True
    assert await plugin.set_pref("model", "default") is True
    assert await plugin.set_pref("effort", "xhigh") is True
    assert await plugin.set_pref("approval", "auto") is True
    cfg = plugin._cfg()
    assert (cfg["model"], cfg["effort"], cfg["approval"]) == ("default", "xhigh", "auto")
    assert plugin.prefs["effort"] == "xhigh" and jread(main.PREFS_FILE)["approval"] == "auto"
    assert plugin._chat()["cfg"]["effort"] == "xhigh"
    assert jread(main.CHATS_FILE)["chats"][0]["cfg"]["effort"] == "xhigh"


async def test_set_pref_rejects_bad_values(plugin):
    for key, val in (("model", "has space"), ("model", ""), ("model", None), ("model", "x" * 61), ("model", "a;b"),
                     ("effort", "ludicrous"), ("approval", "yolo"), ("unknown", "x")):
        assert await plugin.set_pref(key, val) is False
    assert plugin.prefs["model"] == "default"


async def test_set_pref_manual_clears_rules_auto_does_not(plugin):
    main._write_json(main.RULES_FILE, {"tools": ["X"], "commands": []})
    await plugin.set_pref("approval", "auto")
    assert jread(main.RULES_FILE)["tools"] == ["X"]
    await plugin.set_pref("approval", "manual")
    assert jread(main.RULES_FILE)["tools"] == []
