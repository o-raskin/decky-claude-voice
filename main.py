import asyncio
import json
import os
import re
import signal
import struct
import time
import uuid

import decky

USER_HOME = "/home/deck"
DATA = os.path.join(USER_HOME, ".local/share/claude-voice")
MODEL = os.path.join(DATA, "models/ggml-small.bin")
APPROVALS = os.path.join(DATA, "approvals")
CHATS_FILE = os.path.join(DATA, "chats.json")
PREFS_FILE = os.path.join(DATA, "prefs.json")
RULES_FILE = os.path.join(DATA, "allow-rules.json")
OLD_SESSION_FILE = os.path.join(DATA, "session.json")
SETTINGS_FILE = os.path.join(DATA, "claude-settings.json")
REC_FILE = os.path.join(DATA, "rec.wav")
CLAUDE = os.path.join(USER_HOME, ".local/bin/claude")
WHISPER = "/home/linuxbrew/.linuxbrew/bin/whisper-cli"
HOOK = os.path.join(decky.DECKY_PLUGIN_DIR, "bin/approve-hook.py")
MAX_REC_S = 90
MAX_EVENTS = 300
MAX_CHATS = 40

MODELS_FILE = os.path.join(DATA, "models.json")
EFFORTS = ("default", "low", "medium", "high", "xhigh", "max")
DEFAULT_PREFS = {"approval": "manual", "model": "default", "effort": "default", "panel_target": "new"}
# voice/quick actions started from the Quick Access panel use these unless changed in the full screen
PANEL_CFG = {"approval": "auto", "model": "sonnet", "effort": "medium"}
ACTIVE_FILE = os.path.join(DATA, "active-approval.json")

SYSTEM_HINT = (
    "You run on a Steam Deck (SteamOS, user deck) and are called by voice from a Decky plugin. "
    "The request was dictated and transcribed by Whisper, so it may contain recognition errors: "
    "recover the meaning. Your answer is shown in a narrow side panel: keep it short, with no tables "
    "or long markdown, and answer in the language of the user's request. "
    "The user confirms every action that changes something with a button on screen "
    "(or has switched on auto-approve: then act carefully, risky actions still ask)."
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


def _read_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def _write_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, path)


def _new_chat_obj(cfg: dict | None = None) -> dict:
    now = time.time()
    return {"id": uuid.uuid4().hex[:10], "title": "", "session_id": None,
            "created": now, "updated": now, "events": [], "last": None, "cfg": dict(cfg) if cfg else None}


class Plugin:
    async def _main(self):
        os.makedirs(APPROVALS, exist_ok=True)
        self.rec_proc = None
        self.rec_started = 0.0
        self.claude_proc = None
        self.phase = "idle"  # idle | recording | transcribing | thinking
        self.error = ""
        self.live = {"text": "", "thinking": ""}
        self.prefs = {**DEFAULT_PREFS, **_read_json(PREFS_FILE, {})}
        self.store = _read_json(CHATS_FILE, {})
        if not self.store.get("chats"):
            first = _new_chat_obj()
            old = _read_json(OLD_SESSION_FILE, {})
            if old.get("events"):
                first["events"] = old["events"][-MAX_EVENTS:]
                first["session_id"] = old.get("session_id")
                first["title"] = "Previous chat"
            self.store = {"active": first["id"], "chats": [first]}
        for c in self.store["chats"]:
            if c.get("title") == "Прошлый разговор":
                c["title"] = "Previous chat"
        if self.store.get("active") not in {c["id"] for c in self.store["chats"]}:
            self.store["active"] = self.store["chats"][0]["id"]
        self._save_store()
        settings = {"hooks": {"PreToolUse": [{"matcher": "*", "hooks": [
            {"type": "command", "command": f"python3 '{HOOK}'", "timeout": 600}]}]}}
        _write_json(SETTINGS_FILE, settings)
        self._clear_approvals()
        self._clear_rules()
        m = _read_json(MODELS_FILE, {})
        if time.time() - m.get("updated", 0) > 6 * 3600:
            asyncio.create_task(self._refresh_models())
        decky.logger.info("Claude Voice loaded")

    async def _unload(self):
        await self.cancel()

    # ---------- models: taken from Claude itself (`/model` in print mode) ----------
    async def _refresh_models(self):
        try:
            p = await asyncio.create_subprocess_exec(
                CLAUDE, "-p", "/model", "--output-format", "text", cwd=USER_HOME, env=user_env(),
                stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
            out, _ = await asyncio.wait_for(p.communicate(), 60)
            text = out.decode("utf-8", "replace")
            m = re.search(r"Available:\s*(.+?)(?:,\s*or a full model ID)?\.?\s*$", text, re.S | re.M)
            cur = re.search(r"Current model:\s*`([^`]+)`", text)
            if m:
                names = [x.strip() for x in m.group(1).split(",") if x.strip() and not x.strip().startswith("or a full")]
                _write_json(MODELS_FILE, {"available": names, "current": cur.group(1) if cur else "", "updated": time.time()})
        except Exception as e:
            decky.logger.error(f"model list refresh failed: {e}")

    def _models(self) -> dict:
        d = _read_json(MODELS_FILE, None)
        if not isinstance(d, dict) or not d.get("available"):
            d = {"available": ["default", "sonnet", "opus", "haiku", "fable"], "current": "", "updated": 0}
        return {"available": d["available"], "current": d.get("current", "")}

    async def refresh_models(self):
        await self._refresh_models()
        return self._models()

    def _resolve_target(self, target: str):
        if target == "new":
            self._create_chat(PANEL_CFG)
        elif target not in ("current", "") and target in {c["id"] for c in self.store["chats"]}:
            if target != self.store["active"]:
                self.store["active"] = target
                self._clear_rules()
                self._save_store()

    async def set_panel_target(self, target: str):
        if target != "new" and target not in {c["id"] for c in self.store["chats"]}:
            return False
        self.prefs["panel_target"] = target
        _write_json(PREFS_FILE, self.prefs)
        return True

    # ---------- chats ----------
    def _cfg(self, chat=None) -> dict:
        chat = chat or self._chat()
        return {**self.prefs, **(chat.get("cfg") or {})}

    def _create_chat(self, cfg: dict) -> dict:
        chat = _new_chat_obj(cfg)
        self.store["chats"].append(chat)
        self.store["active"] = chat["id"]
        self.error = ""
        self._clear_rules()
        self._save_store()
        return chat

    def _chat(self) -> dict:
        for c in self.store["chats"]:
            if c["id"] == self.store["active"]:
                return c
        return self.store["chats"][0]

    def _save_store(self):
        try:
            chats = sorted(self.store["chats"], key=lambda c: c["updated"], reverse=True)[:MAX_CHATS]
            self.store["chats"] = chats
            _write_json(CHATS_FILE, self.store)
        except Exception as e:
            decky.logger.error(f"save failed: {e}")

    def _push(self, kind: str, text: str, quote: str = ""):
        chat = self._chat()
        ev = {"kind": kind, "text": text, "t": time.time()}
        if quote:
            ev["quote"] = quote[:1500]
        chat["events"].append(ev)
        chat["events"] = chat["events"][-MAX_EVENTS:]
        chat["updated"] = time.time()

    async def list_chats(self):
        return self._chats_summary()

    def _chats_summary(self):
        out = []
        for c in sorted(self.store["chats"], key=lambda c: c["updated"], reverse=True):
            out.append({"id": c["id"], "title": c["title"] or "New chat",
                        "updated": c["updated"], "count": len(c["events"]),
                        "active": c["id"] == self.store["active"]})
        return out

    async def new_chat(self):
        if self.phase != "idle":
            return False
        self._create_chat(dict(self.prefs))
        return True

    async def switch_chat(self, chat_id: str):
        if self.phase != "idle":
            return False
        if chat_id not in {c["id"] for c in self.store["chats"]}:
            return False
        self.store["active"] = chat_id
        self.error = ""
        self._clear_rules()
        self._save_store()
        return True

    async def delete_chat(self, chat_id: str):
        if self.phase != "idle":
            return False
        self.store["chats"] = [c for c in self.store["chats"] if c["id"] != chat_id]
        if not self.store["chats"]:
            self.store["chats"] = [_new_chat_obj()]
        if self.store["active"] == chat_id:
            self.store["active"] = self.store["chats"][0]["id"]
            self._clear_rules()
        self._save_store()
        return True

    # ---------- prefs ----------
    async def set_pref(self, key: str, value: str):
        allowed = {"approval": ("manual", "auto"), "effort": EFFORTS}
        if key == "model":
            if value != "default" and not re.fullmatch(r"[A-Za-z0-9._\[\]-]{1,60}", value or ""):
                return False
        elif key not in allowed or value not in allowed[key]:
            return False
        self.prefs[key] = value  # default for new chats from the full screen
        _write_json(PREFS_FILE, self.prefs)
        chat = self._chat()
        chat["cfg"] = {**self._cfg(chat), key: value}
        self._save_store()
        if key == "approval" and value == "manual":
            self._clear_rules()
        return True

    # ---------- approvals ----------
    def _clear_approvals(self):
        for name in os.listdir(APPROVALS):
            if name.endswith(".req"):
                with open(os.path.join(APPROVALS, name[:-4] + ".res"), "w") as f:
                    f.write("deny")

    def _clear_rules(self):
        try:
            _write_json(RULES_FILE, {"tools": [], "commands": []})
        except Exception:
            pass

    def _pending(self):
        out = []
        for name in sorted(os.listdir(APPROVALS)):
            if not name.endswith(".req"):
                continue
            rid = name[:-4]
            if os.path.exists(os.path.join(APPROVALS, rid + ".res")):
                continue
            req = _read_json(os.path.join(APPROVALS, name), None)
            if not isinstance(req, dict):
                continue
            tool = req.get("tool", "")
            inp = req.get("input", {}) if isinstance(req.get("input"), dict) else {}
            out.append({"id": rid, "tool": tool, "detail": _describe(tool, inp),
                        "risk": req.get("risk", "normal"), "preview": _preview(tool, inp)})
        return out

    async def respond(self, rid: str, allow: bool, always: bool = False):
        rid = "".join(c for c in rid if c.isalnum())
        req_path = os.path.join(APPROVALS, rid + ".req")
        if not os.path.exists(req_path):
            return False
        if allow and always:
            req = _read_json(req_path, {})
            rules = _read_json(RULES_FILE, {"tools": [], "commands": []})
            tool = req.get("tool", "")
            if tool == "Bash":
                cmd = (req.get("input") or {}).get("command", "")
                if cmd and cmd not in rules["commands"]:
                    rules["commands"].append(cmd)
            elif tool and tool not in rules["tools"]:
                rules["tools"].append(tool)
            _write_json(RULES_FILE, rules)
        with open(os.path.join(APPROVALS, rid + ".res"), "w") as f:
            f.write("allow" if allow else "deny")
        return True

    # ---------- state ----------
    def _rec_level(self) -> float:
        try:
            size = os.path.getsize(REC_FILE)
            if size < 44 + 3200:
                return 0.0
            with open(REC_FILE, "rb") as f:
                f.seek(size - 3200)
                data = f.read(3200)
            n = len(data) // 2
            samples = struct.unpack("<%dh" % n, data[: n * 2])
            rms = (sum(s * s for s in samples) / n) ** 0.5
            return round(min(1.0, rms / 5000), 3)
        except Exception:
            return 0.0

    async def get_state(self):
        if self.phase == "recording" and time.time() - self.rec_started > MAX_REC_S:
            asyncio.create_task(self.stop_recording())
        chat = self._chat()
        return {
            "phase": self.phase,
            "events": chat["events"][-80:],
            "live": self.live if self.phase == "thinking" else {"text": "", "thinking": ""},
            "pending": self._pending(),
            "error": self.error,
            "rec_seconds": int(time.time() - self.rec_started) if self.phase == "recording" else 0,
            "rec_level": self._rec_level() if self.phase == "recording" else 0.0,
            "model_ready": _model_ready(),
            "prefs": self._cfg(chat),
            "models": self._models(),
            "panel_target": self.prefs.get("panel_target", "new") if (self.prefs.get("panel_target", "new") == "new" or self.prefs.get("panel_target") in {c["id"] for c in self.store["chats"]}) else "new",
            "chat": {"id": chat["id"], "title": chat["title"] or "New chat",
                     "count": len(chat["events"]), "has_session": bool(chat["session_id"]),
                     "last": chat.get("last")},
            "chats": self._chats_summary(),
        }

    # ---------- voice ----------
    async def start_recording(self, target: str = "current"):
        if self.phase != "idle":
            return False
        self.rec_target = target or "current"
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

    async def toggle_recording(self, target: str = "current", ctx: dict | None = None, quote: str = ""):
        # decided here from the real state, never from what the UI last displayed
        if self.phase == "recording":
            await self.stop_recording(ctx, quote)
            return "stopped"
        if self.phase == "idle":
            return "started" if await self.start_recording(target) else "failed"
        await self.cancel()
        return "cancelled"

    async def stop_recording(self, ctx: dict | None = None, quote: str = ""):
        if self.phase != "recording" or not self.rec_proc:
            return False
        proc, self.rec_proc = self.rec_proc, None
        self.phase = "transcribing"
        try:
            proc.send_signal(signal.SIGINT)
            await asyncio.wait_for(proc.wait(), 5)
        except Exception:
            proc.kill()
        asyncio.create_task(self._transcribe_and_send(ctx, getattr(self, "rec_target", "current"), quote))
        return True

    async def _transcribe_and_send(self, ctx, target="current", quote=""):
        try:
            if not _model_ready():
                raise RuntimeError("the Whisper model is not downloaded yet")
            if not os.path.exists(REC_FILE) or os.path.getsize(REC_FILE) < 16000:
                raise RuntimeError("recording too short or microphone unavailable")
            p = await asyncio.create_subprocess_exec(
                WHISPER, "-m", MODEL, "-l", "ru", "-t", "4", "-nt", "-np", "-f", REC_FILE,
                env=user_env(), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
            out, err = await p.communicate()
            text = " ".join(out.decode("utf-8", "replace").split()).strip()
            if p.returncode != 0:
                raise RuntimeError("whisper: " + err.decode("utf-8", "replace")[-300:])
            if not text or text in ("[BLANK_AUDIO]", "[ Тишина ]", "[ Silence ]"):
                raise RuntimeError("speech not recognized, try again")
        except Exception as e:
            self.error = str(e)
            self.phase = "idle"
            return
        self._resolve_target(target)
        await self._ask(text, ctx, quote)

    # ---------- claude ----------
    async def send_text(self, text: str, ctx: dict | None = None, target: str = "current", quote: str = ""):
        text = (text or "").strip()
        if not text or self.phase != "idle":
            return False
        self.error = ""
        self._resolve_target(target)
        self.phase = "thinking"  # claim the slot now: a second send must not slip in before the task starts
        asyncio.create_task(self._ask(text, ctx, quote))
        return True

    def _hint(self, ctx) -> str:
        hint = SYSTEM_HINT
        if isinstance(ctx, dict) and ctx.get("name"):
            hint += (f"\nThe game \"{ctx['name']}\" (Steam appid {ctx.get('appid')}) is running on the Deck right now. "
                     "Keep that in mind if the question is about the game, performance or settings.")
        return hint

    async def _ask(self, text: str, ctx=None, quote: str = ""):
        self.phase = "thinking"
        self.live = {"text": "", "thinking": ""}
        chat = self._chat()
        if not chat["title"]:
            chat["title"] = text[:48]
        self._push("user", text, quote)
        prompt = text if not quote else (
            "Context: the user refers to this part of the conversation:\n\"\"\"\n" + quote[:1500] + "\n\"\"\"\n\n" + text)
        started = time.time()
        cfg = self._cfg(chat)
        _write_json(ACTIVE_FILE, {"approval": cfg["approval"]})
        args = [CLAUDE, "-p", prompt, "--output-format", "stream-json", "--verbose",
                "--include-partial-messages",
                "--dangerously-skip-permissions", "--settings", SETTINGS_FILE,
                "--append-system-prompt", self._hint(ctx)]
        if cfg["model"] != "default":
            args += ["--model", cfg["model"]]
        if cfg["effort"] != "default":
            args += ["--effort", cfg["effort"]]
        if chat["session_id"]:
            args += ["--resume", chat["session_id"]]
        try:
            self.claude_proc = await asyncio.create_subprocess_exec(
                *args, cwd=USER_HOME, env=user_env(), limit=16 * 1024 * 1024,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
            got_text = False
            block_kind = {}
            async for raw in self.claude_proc.stdout:
                try:
                    msg = json.loads(raw)
                except Exception:
                    continue
                if not isinstance(msg, dict):
                    continue
                t = msg.get("type")
                if msg.get("session_id"):
                    chat["session_id"] = msg["session_id"]
                if t == "stream_event":
                    ev = msg.get("event", {})
                    et = ev.get("type")
                    idx = ev.get("index")
                    if et == "message_start":
                        self.live = {"text": "", "thinking": ""}
                    elif et == "content_block_start":
                        block_kind[idx] = (ev.get("content_block") or {}).get("type")
                    elif et == "content_block_delta":
                        d = ev.get("delta", {})
                        if d.get("type") == "text_delta":
                            self.live["text"] += d.get("text", "")
                        elif d.get("type") == "thinking_delta":
                            self.live["thinking"] += d.get("thinking", "")
                elif t == "assistant":
                    for block in msg.get("message", {}).get("content", []):
                        bt = block.get("type")
                        if bt == "thinking" and block.get("thinking", "").strip():
                            self._push("thinking", block["thinking"].strip())
                        elif bt == "text" and block.get("text", "").strip():
                            self._push("assistant", block["text"].strip())
                            got_text = True
                        elif bt == "tool_use":
                            self._push("tool", _describe(block.get("name", ""), block.get("input", {})))
                    self.live = {"text": "", "thinking": ""}
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
            self.live = {"text": "", "thinking": ""}
            chat["last"] = {"secs": round(time.time() - started, 1), "model": cfg["model"]}
            self._save_store()

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
        return f"Command: {inp.get('command', '')}"
    if tool in ("Edit", "MultiEdit"):
        return f"Edit file: {inp.get('file_path', '')}"
    if tool == "Write":
        return f"Write file: {inp.get('file_path', '')}"
    if tool == "Read":
        return f"Read: {inp.get('file_path', '')}"
    if tool in ("Glob", "Grep"):
        return f"Search: {inp.get('pattern', '')}"
    if tool == "WebSearch":
        return f"Web search: {inp.get('query', '')}"
    if tool == "WebFetch":
        return f"Opens: {inp.get('url', '')}"
    short = json.dumps(inp, ensure_ascii=False)
    return f"{tool}: {short[:300]}"


def _preview(tool: str, inp: dict) -> dict:
    if tool == "Bash":
        return {"kind": "command", "text": str(inp.get("command", ""))[:1200]}
    if tool in ("Edit", "MultiEdit"):
        return {"kind": "diff", "path": inp.get("file_path", ""),
                "old": str(inp.get("old_string", ""))[:500], "new": str(inp.get("new_string", ""))[:500]}
    if tool == "Write":
        return {"kind": "file", "path": inp.get("file_path", ""), "text": str(inp.get("content", ""))[:600]}
    return {"kind": "other", "text": json.dumps(inp, ensure_ascii=False)[:600]}
