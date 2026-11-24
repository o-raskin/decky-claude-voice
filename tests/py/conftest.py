"""Shared fixtures: a fake `decky` module, an isolated data dir and fake `claude`, `pw-record`, `whisper-cli`."""
import asyncio
import importlib.util
import json
import logging
import os
import pathlib
import stat
import sys
import types

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]

_decky = types.ModuleType("decky")
_decky.DECKY_PLUGIN_DIR = str(ROOT)
_decky.logger = logging.getLogger("decky-test")
sys.modules["decky"] = _decky
sys.path.insert(0, str(ROOT))

import main  # noqa: E402  (needs the fake decky module first)

HOOK_PATH = ROOT / "bin" / "approve-hook.py"

FAKE_CLAUDE = r'''#!{py}
import json, os, signal, subprocess, sys, time
here = os.path.dirname(os.path.abspath(__file__))
sc = json.load(open(os.path.join(here, "scenario.json")))
args = sys.argv[1:]
with open(os.path.join(here, "claude-calls.jsonl"), "a") as f:
    f.write(json.dumps(args) + "\n")
if args[:2] == ["-p", "/model"]:
    sys.stdout.write(sc.get("model_text", ""))
    sys.exit(sc.get("model_rc", 0))
if sc.get("die_on_sigint", True):
    signal.signal(signal.SIGINT, signal.SIG_DFL)
if sc.get("sleep"):
    time.sleep(sc["sleep"])
for step in sc.get("steps", []):
    if "hook" in step:
        h = step["hook"]
        env = dict(os.environ, HOME=sc["home"])
        r = subprocess.run([sys.executable, sc["hook_path"]], input=json.dumps(h), text=True,
                           capture_output=True, env=env)
        with open(os.path.join(here, "hook-results.jsonl"), "a") as f:
            f.write(json.dumps({{"rc": r.returncode, "out": r.stdout, "err": r.stderr}}) + "\n")
        continue
    if "raw" in step:
        sys.stdout.write(step["raw"] + "\n"); sys.stdout.flush(); continue
    if "sleep" in step:
        time.sleep(step["sleep"]); continue
    sys.stdout.write(json.dumps(step) + "\n"); sys.stdout.flush()
if sc.get("stderr"):
    sys.stderr.write(sc["stderr"])
sys.exit(sc.get("rc", 0))
'''

FAKE_PW_RECORD = r'''#!{py}
import json, os, signal, sys, time, struct
here = os.path.dirname(os.path.abspath(__file__))
sc = json.load(open(os.path.join(here, "scenario.json")))
out = sys.argv[-1]
with open(os.path.join(here, "pw-calls.jsonl"), "a") as f:
    f.write(json.dumps(sys.argv[1:]) + "\n")
if sc.get("pw_fail"):
    sys.stderr.write("no microphone"); sys.exit(1)
n = sc.get("rec_samples", 16000)
amp = sc.get("rec_amp", 3000)
with open(out, "wb") as f:
    f.write(b"RIFF" + b"\0" * 40)
    f.write(struct.pack("<%dh" % n, *([amp, -amp] * (n // 2) + [0] * (n % 2))))
signal.signal(signal.SIGINT, lambda *a: sys.exit(0))
time.sleep(60)
'''

FAKE_WHISPER = r'''#!{py}
import json, os, sys
here = os.path.dirname(os.path.abspath(__file__))
sc = json.load(open(os.path.join(here, "scenario.json")))
with open(os.path.join(here, "whisper-calls.jsonl"), "a") as f:
    f.write(json.dumps(sys.argv[1:]) + "\n")
sys.stdout.write(sc.get("whisper_text", "hello deck") + "\n")
sys.stderr.write(sc.get("whisper_err", ""))
sys.exit(sc.get("whisper_rc", 0))
'''


class Env:
    def __init__(self, tmp: pathlib.Path):
        self.tmp = tmp
        self.home = tmp / "home"
        self.data = self.home / ".local/share/claude-voice"
        self.bin = tmp / "fakebin"
        self.data.mkdir(parents=True)
        self.bin.mkdir()
        for name, src in (("claude", FAKE_CLAUDE), ("pw-record", FAKE_PW_RECORD), ("whisper-cli", FAKE_WHISPER)):
            p = self.bin / name
            p.write_text(src.replace("{py}", sys.executable).replace("{{", "{").replace("}}", "}"))
            p.chmod(p.stat().st_mode | stat.S_IEXEC)
        self.scenario({})

    def scenario(self, data: dict | None = None, **kw):
        data = {**(data or {}), **kw}
        data.setdefault("home", str(self.home))
        data.setdefault("hook_path", str(HOOK_PATH))
        (self.bin / "scenario.json").write_text(json.dumps(data))

    def calls(self, name: str) -> list:
        p = self.bin / f"{name}-calls.jsonl"
        return [json.loads(x) for x in p.read_text().splitlines()] if p.exists() else []

    def hook_results(self) -> list:
        p = self.bin / "hook-results.jsonl"
        return [json.loads(x) for x in p.read_text().splitlines()] if p.exists() else []

    def make_model(self):
        with open(main.MODEL, "wb") as f:
            f.truncate(480_000_001)


@pytest.fixture
def env(tmp_path, monkeypatch):
    e = Env(tmp_path)
    real_user_env = main.user_env
    monkeypatch.setattr(main, "USER_HOME", str(e.home))
    d = str(e.data)
    for const, rel in (("DATA", ""), ("MODEL", "models/ggml-small.bin"), ("APPROVALS", "approvals"),
                       ("CHATS_FILE", "chats.json"), ("PREFS_FILE", "prefs.json"), ("RULES_FILE", "allow-rules.json"),
                       ("OLD_SESSION_FILE", "session.json"), ("SETTINGS_FILE", "claude-settings.json"),
                       ("REC_FILE", "rec.wav"), ("MODELS_FILE", "models.json"), ("ACTIVE_FILE", "active-approval.json")):
        monkeypatch.setattr(main, const, os.path.join(d, rel) if rel else d)
    os.makedirs(os.path.dirname(main.MODEL))
    monkeypatch.setattr(main, "CLAUDE", str(e.bin / "claude"))
    monkeypatch.setattr(main, "WHISPER", str(e.bin / "whisper-cli"))

    def user_env():
        env = real_user_env()
        env["HOME"] = str(e.home)
        env["PATH"] = f"{e.bin}:{os.environ['PATH']}"
        return env

    monkeypatch.setattr(main, "user_env", user_env)
    return e


@pytest.fixture
async def plugin(env):
    """A started plugin (model list is fresh so no background refresh runs)."""
    (env.data / "models.json").write_text(json.dumps({"available": ["sonnet", "opus"], "current": "", "updated": 9e12}))
    p = main.Plugin()
    await p._main()
    yield p
    await p.cancel()
    await asyncio.sleep(0)


async def wait_for(cond, timeout=10.0, step=0.02):
    end = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < end:
        if cond():
            return True
        await asyncio.sleep(step)
    raise AssertionError("condition not met in time")


async def idle(p, timeout=15.0):
    await wait_for(lambda: p.phase == "idle", timeout)


def load_hook():
    spec = importlib.util.spec_from_file_location("approve_hook", HOOK_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod
