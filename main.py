import asyncio
import json
import os
import signal
import time

import decky

USER_HOME = "/home/deck"
DATA = os.path.join(USER_HOME, ".local/share/claude-voice")
MODEL = os.path.join(DATA, "models/ggml-small.bin")
APPROVALS = os.path.join(DATA, "approvals")
SESSION_FILE = os.path.join(DATA, "session.json")
SETTINGS_FILE = os.path.join(DATA, "claude-settings.json")
REC_FILE = os.path.join(DATA, "rec.wav")
CLAUDE = os.path.join(USER_HOME, ".local/bin/claude")
WHISPER = "/home/linuxbrew/.linuxbrew/bin/whisper-cli"
HOOK = os.path.join(decky.DECKY_PLUGIN_DIR, "bin/approve-hook.py")
MAX_REC_S = 90
MAX_EVENTS = 200

SYSTEM_HINT = (
    "Ты работаешь на Steam Deck (SteamOS, пользователь deck) и вызываешься голосом "
    "из плагина Decky. Запрос надиктован и распознан Whisper — в нём могут быть "
    "ошибки распознавания, восстанавливай смысл. Ответ показывается в узкой "
    "боковой панели: отвечай коротко и по-русски, без таблиц и длинного markdown. "
    "Каждое изменяющее действие пользователь подтверждает кнопкой на экране."
)


def user_env() -> dict:
    uid = 1000
    return {
        "HOME": USER_HOME,
        "USER": "deck",
        "LOGNAME": "deck",
        "LANG": "ru_RU.UTF-8",
        "PATH": f"{USER_HOME}/.local/bin:/home/linuxbrew/.linuxbrew/bin:/usr/local/bin:/usr/bin:/bin",
        "XDG_RUNTIME_DIR": f"/run/user/{uid}",
        "DBUS_SESSION_BUS_ADDRESS": f"unix:path=/run/user/{uid}/bus",
        "PIPEWIRE_RUNTIME_DIR": f"/run/user/{uid}",
    }


class Plugin:
    async def _main(self):
        os.makedirs(APPROVALS, exist_ok=True)
        self.rec_proc = None
        self.rec_started = 0.0
        self.claude_proc = None
        self.phase = "idle"  # idle | recording | transcribing | thinking
        self.events = []
        self.error = ""
        self.session_id = None
        try:
            with open(SESSION_FILE) as f:
                saved = json.load(f)
            self.session_id = saved.get("session_id")
            self.events = saved.get("events", [])[-MAX_EVENTS:]
        except Exception:
            pass
        settings = {"hooks": {"PreToolUse": [{"matcher": "*", "hooks": [
            {"type": "command", "command": f"python3 '{HOOK}'", "timeout": 600}]}]}}
        with open(SETTINGS_FILE, "w") as f:
            json.dump(settings, f)
        self._clear_approvals()
        decky.logger.info("Claude Voice loaded")

    async def _unload(self):
        await self.cancel()

    # ---------- state ----------
    def _save(self):
        try:
            with open(SESSION_FILE, "w") as f:
                json.dump({"session_id": self.session_id, "events": self.events[-MAX_EVENTS:]},
                          f, ensure_ascii=False)
        except Exception as e:
            decky.logger.error(f"save failed: {e}")

    def _push(self, kind: str, text: str):
        self.events.append({"kind": kind, "text": text, "t": time.time()})
        self.events = self.events[-MAX_EVENTS:]

    def _clear_approvals(self):
        for name in os.listdir(APPROVALS):
            if name.endswith(".req"):
                with open(os.path.join(APPROVALS, name[:-4] + ".res"), "w") as f:
                    f.write("deny")

    def _pending(self):
        out = []
        for name in sorted(os.listdir(APPROVALS)):
            if not name.endswith(".req"):
                continue
            rid = name[:-4]
            if os.path.exists(os.path.join(APPROVALS, rid + ".res")):
                continue
            try:
                with open(os.path.join(APPROVALS, name), encoding="utf-8") as f:
                    req = json.load(f)
            except Exception:
                continue
            out.append({"id": rid, "tool": req.get("tool", ""),
                        "detail": _describe(req.get("tool", ""), req.get("input", {}))})
        return out

    async def get_state(self):
        if self.phase == "recording" and time.time() - self.rec_started > MAX_REC_S:
            asyncio.create_task(self.stop_recording())
        return {
            "phase": self.phase,
            "events": self.events[-60:],
            "pending": self._pending(),
            "error": self.error,
            "rec_seconds": int(time.time() - self.rec_started) if self.phase == "recording" else 0,
            "model_ready": _model_ready(),
            "has_session": bool(self.session_id),
        }

    # ---------- voice ----------
    async def start_recording(self):
        if self.phase != "idle":
            return False
        self.error = ""
        try:
            os.remove(REC_FILE)
        except FileNotFoundError:
            pass
        self.rec_proc = await asyncio.create_subprocess_exec(
            "pw-record", "--rate", "16000", "--channels", "1", "--format", "s16", REC_FILE,
            env=user_env(), stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
        self.rec_started = time.time()
        self.phase = "recording"
        return True

    async def stop_recording(self):
        if self.phase != "recording" or not self.rec_proc:
            return False
        proc, self.rec_proc = self.rec_proc, None
        self.phase = "transcribing"
        try:
            proc.send_signal(signal.SIGINT)
            await asyncio.wait_for(proc.wait(), 5)
        except Exception:
            proc.kill()
        asyncio.create_task(self._transcribe_and_send())
        return True

    async def _transcribe_and_send(self):
        try:
            if not _model_ready():
                raise RuntimeError("модель Whisper ещё не скачана")
            if not os.path.exists(REC_FILE) or os.path.getsize(REC_FILE) < 16000:
                raise RuntimeError("запись слишком короткая или микрофон недоступен")
            p = await asyncio.create_subprocess_exec(
                WHISPER, "-m", MODEL, "-l", "ru", "-t", "4", "-nt", "-np", "-f", REC_FILE,
                env=user_env(), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
            out, err = await p.communicate()
            text = " ".join(out.decode("utf-8", "replace").split()).strip()
            if p.returncode != 0:
                raise RuntimeError("whisper: " + err.decode("utf-8", "replace")[-300:])
            if not text or text in ("[BLANK_AUDIO]", "[ Тишина ]"):
                raise RuntimeError("речь не распознана, попробуйте ещё раз")
        except Exception as e:
            self.error = str(e)
            self.phase = "idle"
            return
        await self._ask(text)

    # ---------- claude ----------
    async def send_text(self, text: str):
        text = (text or "").strip()
        if not text or self.phase != "idle":
            return False
        self.error = ""
        asyncio.create_task(self._ask(text))
        return True

    async def _ask(self, text: str):
        self.phase = "thinking"
        self._push("user", text)
        args = [CLAUDE, "-p", text, "--output-format", "stream-json", "--verbose",
                "--dangerously-skip-permissions", "--settings", SETTINGS_FILE,
                "--append-system-prompt", SYSTEM_HINT]
        if self.session_id:
            args += ["--resume", self.session_id]
        try:
            self.claude_proc = await asyncio.create_subprocess_exec(
                *args, cwd=USER_HOME, env=user_env(), limit=16 * 1024 * 1024,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
            got_text = False
            async for raw in self.claude_proc.stdout:
                try:
                    msg = json.loads(raw)
                except Exception:
                    continue
                t = msg.get("type")
                if msg.get("session_id"):
                    self.session_id = msg["session_id"]
                if t == "assistant":
                    for block in msg.get("message", {}).get("content", []):
                        if block.get("type") == "text" and block.get("text", "").strip():
                            self._push("assistant", block["text"].strip())
                            got_text = True
                        elif block.get("type") == "tool_use":
                            self._push("tool", _describe(block.get("name", ""), block.get("input", {})))
                elif t == "result":
                    if msg.get("is_error"):
                        self._push("error", str(msg.get("result") or msg.get("subtype")))
                    elif not got_text and msg.get("result"):
                        self._push("assistant", str(msg["result"]).strip())
            err = (await self.claude_proc.stderr.read()).decode("utf-8", "replace").strip()
            rc = await self.claude_proc.wait()
            if rc not in (0, -2, -15) and err:
                self._push("error", err[-500:])
        except Exception as e:
            self._push("error", str(e))
        finally:
            self.claude_proc = None
            self.phase = "idle"
            self._save()

    async def respond(self, rid: str, allow: bool):
        rid = "".join(c for c in rid if c.isalnum())
        if not os.path.exists(os.path.join(APPROVALS, rid + ".req")):
            return False
        with open(os.path.join(APPROVALS, rid + ".res"), "w") as f:
            f.write("allow" if allow else "deny")
        return True

    async def cancel(self):
        if self.rec_proc:
            self.rec_proc.kill()
            self.rec_proc = None
        if self.claude_proc:
            self._clear_approvals()
            try:
                self.claude_proc.send_signal(signal.SIGINT)
            except ProcessLookupError:
                pass
        if self.phase in ("recording", "transcribing"):
            self.phase = "idle"
        return True

    async def new_chat(self):
        if self.phase != "idle":
            return False
        self.session_id = None
        self.events = []
        self.error = ""
        self._save()
        return True


def _model_ready() -> bool:
    # ggml-small.bin is ~488 MB; a smaller file means the download is unfinished.
    try:
        return os.path.getsize(MODEL) > 480_000_000
    except OSError:
        return False


def _describe(tool: str, inp: dict) -> str:
    if not isinstance(inp, dict):
        return tool
    if tool == "Bash":
        return f"Команда: {inp.get('command', '')}"
    if tool in ("Edit", "MultiEdit"):
        return f"Правка файла: {inp.get('file_path', '')}"
    if tool == "Write":
        return f"Запись файла: {inp.get('file_path', '')}"
    if tool == "Read":
        return f"Чтение: {inp.get('file_path', '')}"
    if tool in ("Glob", "Grep"):
        return f"Поиск: {inp.get('pattern', '')}"
    if tool == "WebSearch":
        return f"Поиск в сети: {inp.get('query', '')}"
    if tool == "WebFetch":
        return f"Открывает: {inp.get('url', '')}"
    short = json.dumps(inp, ensure_ascii=False)
    return f"{tool}: {short[:300]}"
