import asyncio
import json
import signal
from unittest.mock import MagicMock

import main
from conftest import idle, wait_for


def assistant(*blocks):
    return {"type": "assistant", "session_id": "S1", "message": {"content": list(blocks)}}


def text(t):
    return {"type": "text", "text": t}


def thinking(t):
    return {"type": "thinking", "thinking": t}


def tool(name, inp):
    return {"type": "tool_use", "name": name, "input": inp}


def kinds(plugin):
    return [(e["kind"], e["text"]) for e in plugin._chat()["events"]]


async def test_hint_variants(plugin):
    assert plugin._hint(None) == main.SYSTEM_HINT
    assert plugin._hint("junk") == main.SYSTEM_HINT
    assert plugin._hint({"appid": 1}) == main.SYSTEM_HINT
    h = plugin._hint({"name": "Elden Ring", "appid": 1245620})
    assert h.startswith(main.SYSTEM_HINT) and '"Elden Ring" (Steam appid 1245620)' in h
    assert "appid None" in plugin._hint({"name": "X"})


async def test_send_text_guards(plugin):
    assert await plugin.send_text("   ") is False
    assert await plugin.send_text(None) is False
    plugin.phase = "thinking"
    assert await plugin.send_text("hi") is False
    assert plugin._chat()["events"] == []


async def test_send_text_runs_claude_and_stores_reply(plugin, env):
    env.scenario(steps=[assistant(text("  Hello there  "))])
    assert await plugin.send_text("  hi  ") is True
    await idle(plugin)
    assert kinds(plugin) == [("user", "hi"), ("assistant", "Hello there")]
    assert plugin._chat()["title"] == "hi" and plugin._chat()["session_id"] == "S1"
    assert plugin._chat()["last"]["model"] == "default" and plugin._chat()["last"]["secs"] >= 0
    assert plugin.live == {"text": "", "thinking": ""} and plugin.claude_proc is None


async def test_send_text_resolves_new_target(plugin, env):
    env.scenario(steps=[assistant(text("ok"))])
    first = plugin.store["active"]
    await plugin.send_text("hi", target="new")
    await idle(plugin)
    assert plugin.store["active"] != first and plugin._chat()["cfg"] == main.PANEL_CFG
    assert kinds(plugin)[0] == ("user", "hi")


async def test_command_line_defaults(plugin, env):
    env.scenario(steps=[assistant(text("ok"))])
    await plugin.send_text("hello")
    await idle(plugin)
    args = env.calls("claude")[-1]
    assert args[:2] == ["-p", "hello"] and "--model" not in args and "--effort" not in args and "--resume" not in args
    for flag in ("--output-format", "stream-json", "--verbose", "--include-partial-messages", "--dangerously-skip-permissions"):
        assert flag in args
    assert args[args.index("--settings") + 1] == main.SETTINGS_FILE
    assert args[args.index("--append-system-prompt") + 1] == main.SYSTEM_HINT


async def test_command_line_model_effort_and_game(plugin, env):
    await plugin.set_pref("model", "opus")
    await plugin.set_pref("effort", "high")
    env.scenario(steps=[assistant(text("ok"))])
    await plugin.send_text("hello", {"name": "Hades", "appid": 5})
    await idle(plugin)
    args = env.calls("claude")[-1]
    assert args[args.index("--model") + 1] == "opus" and args[args.index("--effort") + 1] == "high"
    assert '"Hades"' in args[args.index("--append-system-prompt") + 1]


async def test_resume_uses_stored_session_id(plugin, env):
    env.scenario(steps=[assistant(text("one"))])
    await plugin.send_text("first")
    await idle(plugin)
    env.scenario(steps=[assistant(text("two"))])
    await plugin.send_text("second")
    await idle(plugin)
    args = env.calls("claude")[-1]
    assert args[args.index("--resume") + 1] == "S1"
    assert [k for k, _ in kinds(plugin)] == ["user", "assistant", "user", "assistant"]
    assert plugin._chat()["title"] == "first"


async def test_title_is_cut_to_48_chars(plugin, env):
    env.scenario(steps=[assistant(text("ok"))])
    await plugin.send_text("x" * 100)
    await idle(plugin)
    assert plugin._chat()["title"] == "x" * 48


async def test_quote_becomes_context_block(plugin, env):
    env.scenario(steps=[assistant(text("ok"))])
    await plugin.send_text("explain", quote="q" * 2000)
    await idle(plugin)
    prompt = env.calls("claude")[-1][1]
    assert prompt.startswith("Context: the user refers to this part of the conversation:") and prompt.endswith("\n\nexplain")
    assert "q" * 1500 in prompt and "q" * 1501 not in prompt
    assert plugin._chat()["events"][0]["quote"] == "q" * 1500


async def test_assistant_blocks_thinking_text_tool(plugin, env):
    env.scenario(steps=[assistant(thinking("  hmm  "), tool("Bash", {"command": "ls"}), text("done"),
                                  thinking("   "), text("   "), {"type": "image"})])
    await plugin.send_text("go")
    await idle(plugin)
    assert kinds(plugin) == [("user", "go"), ("thinking", "hmm"), ("tool", "Command: ls"), ("assistant", "done")]


async def test_stream_events_fill_live_text(plugin, env):
    seen = []
    env.scenario(steps=[
        {"type": "stream_event", "event": {"type": "message_start"}},
        {"type": "stream_event", "event": {"type": "content_block_start", "index": 0, "content_block": {"type": "thinking"}}},
        {"type": "stream_event", "event": {"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "think "}}},
        {"type": "stream_event", "event": {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Hel"}}},
        {"type": "stream_event", "event": {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "lo"}}},
        {"type": "stream_event", "event": {"type": "content_block_delta", "index": 0, "delta": {"type": "other"}}},
        {"type": "stream_event", "event": {"type": "something_else"}},
        {"sleep": 0.6},
        assistant(text("Hello")),
    ])
    await plugin.send_text("go")
    await wait_for(lambda: plugin.live["text"] == "Hello")
    seen.append(dict(plugin.live))
    assert seen[0] == {"text": "Hello", "thinking": "think "}
    assert (await plugin.get_state())["live"]["text"] == "Hello"
    await idle(plugin)
    assert plugin.live == {"text": "", "thinking": ""}


async def test_garbage_lines_and_blank_lines_are_skipped(plugin, env):
    env.scenario(steps=[{"raw": "not json"}, {"raw": ""}, {"raw": "[1]"}, assistant(text("fine"))])
    await plugin.send_text("go")
    await idle(plugin)
    assert kinds(plugin)[-1] == ("assistant", "fine") and plugin._chat()["session_id"] == "S1"


async def test_result_error_is_reported(plugin, env):
    env.scenario(steps=[{"type": "result", "is_error": True, "result": "API overloaded"}])
    await plugin.send_text("go")
    await idle(plugin)
    assert kinds(plugin)[-1] == ("error", "API overloaded")


async def test_result_error_falls_back_to_subtype(plugin, env):
    env.scenario(steps=[{"type": "result", "is_error": True, "subtype": "error_during_execution"}])
    await plugin.send_text("go")
    await idle(plugin)
    assert kinds(plugin)[-1] == ("error", "error_during_execution")


async def test_result_text_used_when_no_assistant_text(plugin, env):
    env.scenario(steps=[{"type": "result", "result": " final answer "}])
    await plugin.send_text("go")
    await idle(plugin)
    assert kinds(plugin)[-1] == ("assistant", "final answer")


async def test_result_ignored_when_text_was_streamed(plugin, env):
    env.scenario(steps=[assistant(text("streamed")), {"type": "result", "result": "streamed"}])
    await plugin.send_text("go")
    await idle(plugin)
    assert [k for k, _ in kinds(plugin)].count("assistant") == 1


async def test_empty_result_adds_nothing(plugin, env):
    env.scenario(steps=[{"type": "result", "result": ""}])
    await plugin.send_text("go")
    await idle(plugin)
    assert kinds(plugin) == [("user", "go")]


async def test_nonzero_exit_with_stderr_is_error(plugin, env):
    env.scenario(steps=[], rc=1, stderr="x" * 600)
    await plugin.send_text("go")
    await idle(plugin)
    kind, msg = kinds(plugin)[-1]
    assert kind == "error" and msg == "x" * 500


async def test_nonzero_exit_without_stderr_is_silent(plugin, env):
    env.scenario(steps=[], rc=1)
    await plugin.send_text("go")
    await idle(plugin)
    assert kinds(plugin) == [("user", "go")]


async def test_zero_exit_with_stderr_is_silent(plugin, env):
    env.scenario(steps=[assistant(text("ok"))], stderr="warning")
    await plugin.send_text("go")
    await idle(plugin)
    assert [k for k, _ in kinds(plugin)] == ["user", "assistant"]


async def test_missing_binary_is_reported_and_state_recovers(plugin, monkeypatch):
    monkeypatch.setattr(main, "CLAUDE", "/nonexistent/claude")
    await plugin.send_text("go")
    await idle(plugin)
    assert kinds(plugin)[-1][0] == "error" and plugin.claude_proc is None
    assert plugin._chat()["last"] is not None


async def test_active_file_records_approval_mode(plugin, env):
    await plugin.set_pref("approval", "auto")
    env.scenario(steps=[assistant(text("ok"))])
    await plugin.send_text("go")
    await idle(plugin)
    assert json.load(open(main.ACTIVE_FILE)) == {"approval": "auto"}


async def test_state_during_request_is_thinking_with_user_event(plugin, env):
    env.scenario(sleep=0.5, steps=[assistant(text("late"))])
    await plugin.send_text("go")
    await wait_for(lambda: plugin.claude_proc is not None)
    s = await plugin.get_state()
    assert s["phase"] == "thinking" and s["events"][-1]["text"] == "go"
    await idle(plugin)


async def test_results_are_persisted_to_disk(plugin, env):
    env.scenario(steps=[assistant(text("saved"))])
    await plugin.send_text("go")
    await idle(plugin)
    stored = json.load(open(main.CHATS_FILE))
    assert [e["text"] for e in stored["chats"][0]["events"]] == ["go", "saved"]


# ---------- cancel ----------

async def test_cancel_idle_is_harmless(plugin):
    assert await plugin.cancel() is True and plugin.phase == "idle"


async def test_cancel_kills_recorder(plugin):
    await plugin.start_recording()
    proc = plugin.rec_proc
    assert await plugin.cancel() is True
    assert plugin.phase == "idle" and plugin.rec_proc is None
    await asyncio.wait_for(proc.wait(), 5)


async def test_cancel_transcribing_resets_phase(plugin):
    plugin.phase = "transcribing"
    await plugin.cancel()
    assert plugin.phase == "idle"


async def test_cancel_thinking_keeps_phase_until_process_ends(plugin):
    plugin.phase = "thinking"
    await plugin.cancel()
    assert plugin.phase == "thinking"


async def test_cancel_interrupts_running_claude_and_denies_approvals(plugin, env):
    env.scenario(sleep=30, steps=[assistant(text("never"))])
    await plugin.send_text("go")
    await wait_for(lambda: plugin.claude_proc is not None)
    open(f"{main.APPROVALS}/r1.req", "w").write("{}")
    await asyncio.sleep(0.4)  # the fake installs its default SIGINT action
    await plugin.cancel()
    await idle(plugin)
    assert open(f"{main.APPROVALS}/r1.res").read() == "deny"
    assert kinds(plugin) == [("user", "go")]  # killed by SIGINT: no error event


async def test_cancel_ignores_vanished_claude_process(plugin):
    proc = MagicMock()
    proc.send_signal.side_effect = ProcessLookupError()
    plugin.claude_proc = proc
    assert await plugin.cancel() is True
    proc.send_signal.assert_called_once_with(signal.SIGINT)


async def test_send_text_claims_the_slot_immediately(plugin, env):
    env.scenario(sleep=0.3, steps=[assistant(text("ok"))])
    assert await plugin.send_text("one") is True
    assert plugin.phase == "thinking"
    assert await plugin.send_text("two") is False  # no double request
    await idle(plugin)
    assert [k for k, t in kinds(plugin) if k == "user"] == ["user"]


async def test_unknown_message_types_are_ignored(plugin, env):
    env.scenario(steps=[{"type": "system", "session_id": "S9"}, assistant(text("ok"))])
    await plugin.send_text("go")
    await idle(plugin)
    assert [k for k, _ in kinds(plugin)] == ["user", "assistant"]
