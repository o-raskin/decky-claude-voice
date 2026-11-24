"""End to end: real subprocesses (fake claude / pw-record / whisper-cli) and the real approval hook."""
import asyncio
import json
import os

import main
from conftest import idle, wait_for


def reply(t, sid="S1"):
    return {"type": "assistant", "session_id": sid, "message": {"content": [{"type": "text", "text": t}]}}


def hook_step(tool, inp):
    return {"hook": {"tool_name": tool, "tool_input": inp}}


async def pending(plugin):
    await wait_for(lambda: plugin._pending())
    return plugin._pending()


def decision(result):
    return json.loads(result["out"])["hookSpecificOutput"]["permissionDecision"] if result["out"] else None


# ---------- voice ----------

async def test_voice_round_trip(plugin, env):
    env.make_model()
    env.scenario(whisper_text="what is my battery", steps=[reply("80 percent")])
    assert await plugin.toggle_recording("current", {"name": "Hades", "appid": 5}) == "started"
    await wait_for(lambda: os.path.exists(main.REC_FILE) and os.path.getsize(main.REC_FILE) > 16000)
    s = await plugin.get_state()
    assert s["phase"] == "recording" and s["rec_level"] > 0 and s["model_ready"]
    await asyncio.sleep(0.3)
    assert await plugin.toggle_recording("current", {"name": "Hades", "appid": 5}) == "stopped"
    assert plugin.phase in ("transcribing", "thinking")
    await wait_for(lambda: plugin.phase == "idle" and len(plugin._chat()["events"]) == 2)
    assert [(e["kind"], e["text"]) for e in plugin._chat()["events"]] == [("user", "what is my battery"), ("assistant", "80 percent")]
    assert '"Hades"' in env.calls("claude")[-1][env.calls("claude")[-1].index("--append-system-prompt") + 1]
    assert plugin.error == ""


async def test_voice_with_quote_sends_context(plugin, env):
    env.make_model()
    env.scenario(whisper_text="explain", steps=[reply("ok")])
    await plugin.start_recording()
    await wait_for(lambda: os.path.exists(main.REC_FILE) and os.path.getsize(main.REC_FILE) > 16000)
    await asyncio.sleep(0.3)
    await plugin.toggle_recording("current", None, "the quoted bit")
    await wait_for(lambda: len(plugin._chat()["events"]) == 2)
    assert "the quoted bit" in env.calls("claude")[-1][1]
    assert plugin._chat()["events"][0]["quote"] == "the quoted bit"


async def test_voice_without_model_reports_error(plugin, env):
    await plugin.start_recording()
    await wait_for(lambda: os.path.exists(main.REC_FILE) and os.path.getsize(main.REC_FILE) > 16000)
    await asyncio.sleep(0.3)
    await plugin.toggle_recording()
    await idle(plugin)
    assert "not downloaded" in plugin.error and plugin._chat()["events"] == []
    assert (await plugin.get_state())["error"] == plugin.error


async def test_new_recording_clears_previous_error(plugin, env):
    plugin.error = "old"
    await plugin.start_recording()
    assert plugin.error == ""
    await plugin.cancel()


async def test_silence_is_reported(plugin, env):
    env.make_model()
    env.scenario(whisper_text="[BLANK_AUDIO]")
    await plugin.start_recording()
    await wait_for(lambda: os.path.exists(main.REC_FILE) and os.path.getsize(main.REC_FILE) > 16000)
    await asyncio.sleep(0.3)
    await plugin.stop_recording()
    await idle(plugin)
    assert "not recognized" in plugin.error and env.calls("claude") == []


async def test_panel_voice_into_new_chat_uses_panel_defaults(plugin, env):
    env.make_model()
    env.scenario(whisper_text="hello", steps=[reply("hi")])
    first = plugin.store["active"]
    await plugin.toggle_recording("new")
    await wait_for(lambda: os.path.exists(main.REC_FILE) and os.path.getsize(main.REC_FILE) > 16000)
    await asyncio.sleep(0.3)
    await plugin.toggle_recording("new")
    await wait_for(lambda: plugin.phase == "idle" and plugin.store["active"] != first and len(plugin._chat()["events"]) == 2)
    args = env.calls("claude")[-1]
    assert args[args.index("--model") + 1] == "sonnet" and args[args.index("--effort") + 1] == "medium"
    assert json.load(open(main.ACTIVE_FILE)) == {"approval": "auto"}
    assert len(plugin.store["chats"]) == 2
    # the old chat is untouched
    old = next(c for c in plugin.store["chats"] if c["id"] == first)
    assert old["events"] == []


async def test_max_recording_time_stops_and_sends_automatically(plugin, env, monkeypatch):
    env.make_model()
    env.scenario(whisper_text="long", steps=[reply("ok")])
    await plugin.start_recording()
    await wait_for(lambda: os.path.exists(main.REC_FILE) and os.path.getsize(main.REC_FILE) > 16000)
    await asyncio.sleep(0.3)
    plugin.rec_started -= main.MAX_REC_S + 1
    await plugin.get_state()
    await wait_for(lambda: len(plugin._chat()["events"]) == 2)
    assert plugin._chat()["events"][0]["text"] == "long"


async def test_cancel_recording_sends_nothing(plugin, env):
    env.make_model()
    await plugin.start_recording()
    await asyncio.sleep(0.3)
    await plugin.cancel()
    assert plugin.phase == "idle" and plugin._chat()["events"] == [] and env.calls("claude") == []


# ---------- approvals through the real hook ----------

async def test_manual_mode_waits_for_allow(plugin, env):
    env.scenario(steps=[hook_step("Bash", {"command": "ls /"}), reply("listed")])
    await plugin.send_text("list")
    p = (await pending(plugin))[0]
    assert p["tool"] == "Bash" and p["detail"] == "Command: ls /" and p["risk"] == "normal"
    assert plugin.phase == "thinking"
    assert await plugin.respond(p["id"], True) is True
    await idle(plugin)
    [r] = env.hook_results()
    assert r["rc"] == 0 and decision(r) == "allow"
    assert plugin._chat()["events"][-1]["text"] == "listed" and plugin._pending() == []


async def test_manual_mode_deny_blocks_the_tool(plugin, env):
    env.scenario(steps=[hook_step("Bash", {"command": "ls /"}), reply("ok")])
    await plugin.send_text("list")
    p = (await pending(plugin))[0]
    await plugin.respond(p["id"], False)
    await idle(plugin)
    [r] = env.hook_results()
    assert r["rc"] == 2 and "denied by the user" in r["err"]


async def test_auto_mode_allows_without_asking(plugin, env):
    await plugin.set_pref("approval", "auto")
    env.scenario(steps=[hook_step("Bash", {"command": "ls /"}), hook_step("Edit", {"file_path": str(env.home / "f")}), reply("ok")])
    await plugin.send_text("go")
    await idle(plugin)
    assert [decision(r) for r in env.hook_results()] == ["allow", "allow"]
    assert plugin._pending() == []


async def test_auto_mode_still_asks_for_risky_commands(plugin, env):
    await plugin.set_pref("approval", "auto")
    env.scenario(steps=[hook_step("Bash", {"command": "sudo pacman -Syu"}), reply("ok")])
    await plugin.send_text("go")
    p = (await pending(plugin))[0]
    assert p["risk"] == "danger"
    await plugin.respond(p["id"], True, True)
    await idle(plugin)
    assert decision(env.hook_results()[0]) == "allow"


async def test_risky_command_asks_again_even_after_allow_in_this_chat(plugin, env):
    await plugin.set_pref("approval", "auto")
    env.scenario(steps=[hook_step("Bash", {"command": "sudo ls"}), hook_step("Bash", {"command": "sudo ls"}), reply("ok")])
    await plugin.send_text("go")
    p = (await pending(plugin))[0]
    await plugin.respond(p["id"], True, True)
    await wait_for(lambda: plugin._pending() and plugin._pending()[0]["id"] != p["id"])
    p2 = plugin._pending()[0]
    await plugin.respond(p2["id"], False)
    await idle(plugin)
    assert [decision(r) for r in env.hook_results()] == ["allow", None]


async def test_allow_in_this_chat_is_reused(plugin, env):
    env.scenario(steps=[hook_step("Edit", {"file_path": str(env.home / "a")}), hook_step("Edit", {"file_path": str(env.home / "b")}), reply("ok")])
    await plugin.send_text("go")
    p = (await pending(plugin))[0]
    await plugin.respond(p["id"], True, True)
    await idle(plugin)
    assert [decision(r) for r in env.hook_results()] == ["allow", "allow"]
    assert json.load(open(main.RULES_FILE))["tools"] == ["Edit"]


async def test_rules_reset_when_switching_chats(plugin, env):
    env.scenario(steps=[hook_step("Edit", {"file_path": str(env.home / "a")}), reply("ok")])
    await plugin.send_text("go")
    p = (await pending(plugin))[0]
    await plugin.respond(p["id"], True, True)
    await idle(plugin)
    await plugin.new_chat()
    assert json.load(open(main.RULES_FILE)) == {"tools": [], "commands": []}


async def test_read_only_tools_never_ask(plugin, env):
    env.scenario(steps=[hook_step("Read", {"file_path": "/etc/hosts"}), hook_step("Grep", {"pattern": "x"}), reply("ok")])
    await plugin.send_text("go")
    await idle(plugin)
    assert [(r["rc"], r["out"]) for r in env.hook_results()] == [(0, ""), (0, "")]


async def test_cancel_while_waiting_for_approval_denies_it(plugin, env):
    env.scenario(steps=[hook_step("Bash", {"command": "ls"}), reply("never shown")])
    await plugin.send_text("go")
    await pending(plugin)
    await plugin.cancel()
    await idle(plugin)
    # the orphaned hook process sees the "deny" answer and cleans its files up by itself
    await wait_for(lambda: not [n for n in os.listdir(main.APPROVALS) if n.endswith((".req", ".res"))])
    assert plugin._pending() == [] and plugin._chat()["events"][-1]["kind"] == "user"


async def test_restart_denies_orphaned_requests(env):
    os.makedirs(main.APPROVALS)
    open(os.path.join(main.APPROVALS, "stale.req"), "w").write(json.dumps({"tool": "Bash", "input": {}}))
    p = main.Plugin()
    (env.data / "models.json").write_text(json.dumps({"available": ["a"], "current": "", "updated": 9e12}))
    await p._main()
    assert p._pending() == []


# ---------- cancel / sessions / persistence ----------

async def test_cancel_while_thinking_ends_quietly(plugin, env):
    env.scenario(sleep=30, steps=[reply("never")])
    await plugin.send_text("go")
    await wait_for(lambda: plugin.claude_proc is not None)
    await asyncio.sleep(0.4)
    assert await plugin.toggle_recording() == "cancelled"
    await idle(plugin)
    assert [e["kind"] for e in plugin._chat()["events"]] == ["user"] and plugin.error == ""


async def test_conversation_continues_in_same_session(plugin, env):
    env.scenario(steps=[reply("first", "SID-A")])
    await plugin.send_text("one")
    await idle(plugin)
    env.scenario(steps=[reply("second", "SID-A")])
    await plugin.send_text("two")
    await idle(plugin)
    assert "--resume" not in env.calls("claude")[0]
    second = env.calls("claude")[1]
    assert second[second.index("--resume") + 1] == "SID-A"


async def test_sessions_are_per_chat(plugin, env):
    env.scenario(steps=[reply("a", "SID-A")])
    await plugin.send_text("one")
    await idle(plugin)
    await plugin.new_chat()
    env.scenario(steps=[reply("b", "SID-B")])
    await plugin.send_text("two")
    await idle(plugin)
    assert "--resume" not in env.calls("claude")[1]
    assert [c["session_id"] for c in sorted(plugin.store["chats"], key=lambda c: c["created"])] == ["SID-A", "SID-B"]


async def test_chats_survive_restart(plugin, env):
    env.scenario(steps=[reply("kept", "SID-K")])
    await plugin.set_pref("effort", "high")
    await plugin.send_text("remember me")
    await idle(plugin)
    again = main.Plugin()
    await again._main()
    chat = again._chat()
    assert [e["text"] for e in chat["events"]] == ["remember me", "kept"]
    assert chat["session_id"] == "SID-K" and chat["title"] == "remember me"
    assert again._cfg(chat)["effort"] == "high"
    assert again.phase == "idle"


async def test_model_list_round_trip(plugin, env):
    env.scenario(model_text="Current model: `sonnet`\nAvailable: sonnet, opus, haiku, fable, best, sonnet[1m], opusplan, default, or a full model ID.")
    out = await plugin.refresh_models()
    assert "sonnet[1m]" in out["available"] and out["current"] == "sonnet"
    s = await plugin.get_state()
    assert s["models"] == out
    assert await plugin.set_pref("model", "sonnet[1m]") is True


async def test_busy_state_blocks_chat_management(plugin, env):
    env.scenario(sleep=0.5, steps=[reply("ok")])
    await plugin.send_text("go")
    assert await plugin.new_chat() is False
    assert await plugin.switch_chat(plugin.store["active"]) is False
    assert await plugin.delete_chat(plugin.store["active"]) is False
    assert await plugin.start_recording() is False
    await idle(plugin)
    assert await plugin.new_chat() is True


async def test_failed_claude_run_recovers_for_next_message(plugin, env):
    env.scenario(steps=[], rc=1, stderr="boom")
    await plugin.send_text("one")
    await idle(plugin)
    env.scenario(steps=[reply("fine")])
    await plugin.send_text("two")
    await idle(plugin)
    assert [e["kind"] for e in plugin._chat()["events"]] == ["user", "error", "user", "assistant"]
