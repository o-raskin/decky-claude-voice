import asyncio
import os
import signal
from unittest.mock import AsyncMock, MagicMock

import main
from conftest import wait_for


async def test_start_recording_spawns_pw_record(plugin, env):
    open(main.REC_FILE, "wb").write(b"old")
    assert await plugin.start_recording("abc") is True
    assert plugin.phase == "recording" and plugin.rec_target == "abc" and plugin.rec_started > 0
    await wait_for(lambda: os.path.exists(main.REC_FILE) and os.path.getsize(main.REC_FILE) > 3)
    await wait_for(lambda: env.calls("pw"))
    assert env.calls("pw")[0] == ["--rate", "16000", "--channels", "1", "--format", "s16", main.REC_FILE]
    await plugin.cancel()


async def test_start_recording_defaults_target_and_handles_missing_old_file(plugin):
    assert not os.path.exists(main.REC_FILE)
    assert await plugin.start_recording("") is True
    assert plugin.rec_target == "current" and plugin.error == ""
    await plugin.cancel()


async def test_start_recording_refused_when_busy(plugin):
    for phase in ("recording", "transcribing", "thinking"):
        plugin.phase = phase
        assert await plugin.start_recording() is False


async def test_toggle_idle_starts(plugin):
    assert await plugin.toggle_recording("current") == "started"
    assert plugin.phase == "recording"
    await plugin.cancel()


async def test_toggle_idle_reports_failure(plugin, monkeypatch):
    monkeypatch.setattr(plugin, "start_recording", AsyncMock(return_value=False))
    assert await plugin.toggle_recording() == "failed"


async def test_toggle_recording_stops_and_passes_context(plugin, monkeypatch):
    stop = AsyncMock(return_value=True)
    monkeypatch.setattr(plugin, "stop_recording", stop)
    plugin.phase = "recording"
    assert await plugin.toggle_recording("current", {"name": "G"}, "quoted") == "stopped"
    stop.assert_awaited_once_with({"name": "G"}, "quoted")


async def test_toggle_other_phases_cancel(plugin, monkeypatch):
    cancel = AsyncMock()
    monkeypatch.setattr(plugin, "cancel", cancel)
    for phase in ("transcribing", "thinking"):
        plugin.phase = phase
        assert await plugin.toggle_recording() == "cancelled"
    assert cancel.await_count == 2


async def test_stop_recording_guards(plugin):
    assert await plugin.stop_recording() is False  # idle
    plugin.phase = "recording"
    plugin.rec_proc = None
    assert await plugin.stop_recording() is False  # no process


async def test_stop_recording_signals_and_transcribes(plugin, monkeypatch):
    transcribe = AsyncMock()
    monkeypatch.setattr(plugin, "_transcribe_and_send", transcribe)
    await plugin.start_recording("tgt")
    await wait_for(lambda: os.path.exists(main.REC_FILE) and os.path.getsize(main.REC_FILE) > 1000)
    await asyncio.sleep(0.3)  # let the fake install its SIGINT handler
    proc = plugin.rec_proc
    assert await plugin.stop_recording({"name": "G"}, "q") is True
    assert plugin.phase == "transcribing" and plugin.rec_proc is None
    await wait_for(lambda: transcribe.await_count == 1)
    transcribe.assert_awaited_once_with({"name": "G"}, "tgt", "q")
    assert proc.returncode == 0


async def test_stop_recording_kills_when_process_ignores_sigint(plugin, monkeypatch):
    monkeypatch.setattr(plugin, "_transcribe_and_send", AsyncMock())
    proc = MagicMock()
    proc.send_signal.side_effect = ProcessLookupError()
    plugin.phase = "recording"
    plugin.rec_proc = proc
    assert await plugin.stop_recording() is True
    proc.kill.assert_called_once()
    proc.send_signal.assert_called_once_with(signal.SIGINT)


async def test_stop_recording_without_rec_target_attribute(plugin, monkeypatch):
    transcribe = AsyncMock()
    monkeypatch.setattr(plugin, "_transcribe_and_send", transcribe)
    proc = MagicMock()
    proc.wait = AsyncMock(return_value=0)
    plugin.phase = "recording"
    plugin.rec_proc = proc
    await plugin.stop_recording()
    await asyncio.sleep(0.01)
    transcribe.assert_awaited_once_with(None, "current", "")


# ---------- transcription ----------

async def test_transcribe_requires_model(plugin):
    plugin.phase = "transcribing"
    await plugin._transcribe_and_send(None)
    assert plugin.phase == "idle" and "not downloaded" in plugin.error


async def test_transcribe_requires_recording(plugin, env):
    env.make_model()
    plugin.phase = "transcribing"
    await plugin._transcribe_and_send(None)
    assert plugin.phase == "idle" and "too short" in plugin.error


async def test_transcribe_rejects_tiny_recording(plugin, env):
    env.make_model()
    open(main.REC_FILE, "wb").write(b"x" * 100)
    plugin.phase = "transcribing"
    await plugin._transcribe_and_send(None)
    assert "too short" in plugin.error and plugin.phase == "idle"


async def test_transcribe_reports_whisper_failure(plugin, env):
    env.make_model()
    open(main.REC_FILE, "wb").write(b"x" * 20000)
    env.scenario(whisper_rc=3, whisper_err="e" * 500, whisper_text="")
    plugin.phase = "transcribing"
    await plugin._transcribe_and_send(None)
    assert plugin.error.startswith("whisper: ") and len(plugin.error) == len("whisper: ") + 300
    assert plugin.phase == "idle"


async def test_transcribe_blank_results_are_errors(plugin, env):
    env.make_model()
    open(main.REC_FILE, "wb").write(b"x" * 20000)
    for blank in ("", "[BLANK_AUDIO]", "[ Тишина ]", "[ Silence ]", "   "):
        env.scenario(whisper_text=blank)
        plugin.phase = "transcribing"
        plugin.error = ""
        await plugin._transcribe_and_send(None)
        assert "not recognized" in plugin.error and plugin.phase == "idle", blank


async def test_transcribe_success_normalises_text_and_asks(plugin, env, monkeypatch):
    env.make_model()
    open(main.REC_FILE, "wb").write(b"x" * 20000)
    env.scenario(whisper_text="  hello \n  deck  ")
    ask = AsyncMock()
    monkeypatch.setattr(plugin, "_ask", ask)
    first = plugin.store["active"]
    plugin.phase = "transcribing"
    await plugin._transcribe_and_send({"name": "G"}, "new", "quote")
    ask.assert_awaited_once_with("hello deck", {"name": "G"}, "quote")
    assert plugin.store["active"] != first  # target "new" was resolved before asking
    args = env.calls("whisper")[0]
    assert args[:4] == ["-m", main.MODEL, "-l", "ru"] and args[-2:] == ["-f", main.REC_FILE]
