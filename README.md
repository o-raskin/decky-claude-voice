# Claude Voice for Decky

Talk to [Claude Code](https://claude.com/claude-code) on your Steam Deck: dictate a request with your voice,
let Claude look at the system, the game's logs or its configs, and approve every risky action on screen.

Speech is transcribed **locally** with whisper.cpp. The request itself runs through the official `claude` CLI under
your own login. Nothing is sent anywhere else.

> Unofficial community plugin. Not affiliated with or endorsed by Anthropic.

## What it does

- **Push-to-talk dictation.** One button starts and stops recording; whisper.cpp turns it into text offline
  (Russian by default, see [Limitations](#limitations)).
- **Full-screen chat** at `/claude-voice`: streamed answers, collapsible reasoning, tool calls, multiple saved
  chats, copy / quote / "ask Claude about this" on any message, controller-first navigation.
- **Quick Access panel** for the fast path: one mic button, a target chat, a preview of the last reply and
  one-tap quick actions.
- **Game-aware.** When a game is running, Claude is told which one, and the quick actions change to
  *Optimize game*, *FPS and load*, *Game crashes* and *Battery*.
- **Per-chat settings:** model (read from Claude itself, never hard-coded), reasoning effort and approval mode.
- **You stay in control.** Anything that can change the system waits for **Allow** or **Deny** on screen.

## Safety model

The plugin starts `claude -p` with a `PreToolUse` hook (`bin/approve-hook.py`). For every tool call the hook decides:

| Call | What happens |
|---|---|
| Read-only tools (Read, Glob, Grep, web search and fetch, ...) | run without a prompt |
| Everything else (shell commands, file writes and edits) | an approval card appears: **Allow**, **Allow in this chat**, **Deny** |
| Risky commands (`rm -rf`, `sudo`, `systemctl stop`, `git push`, anything writing to `/etc` or `/dev`, `curl \| sh`, ...) | always asked, even in auto-approve mode; no "Allow in this chat" shortcut |
| No answer within 5 minutes | denied |

Approval modes: **Ask me** (default) and **Auto-approve** (still asks for the risky commands above).
"Allow in this chat" remembers the tool (or the exact command) until you switch to another chat or start a new one.

## Requirements

The plugin does not bundle these. Install them once in Desktop Mode:

| Component | How |
|---|---|
| [Decky Loader](https://decky.xyz) | follow its install guide |
| Claude Code CLI, logged in | `curl -fsSL https://claude.ai/install.sh \| bash`, then run `claude` once and sign in |
| whisper.cpp (`whisper-cli`) | `brew install whisper-cpp` ([Homebrew on Linux](https://brew.sh)) |
| Whisper model | download `ggml-small.bin` from [ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp) to `~/.local/share/claude-voice/models/` |

Paths the plugin currently expects: `~/.local/bin/claude` and `/home/linuxbrew/.linuxbrew/bin/whisper-cli`.

## Install

```sh
git clone https://github.com/o-raskin/decky-claude-voice.git
cd decky-claude-voice
pnpm install
pnpm run build
sudo ./install.sh
```

`install.sh` copies `plugin.json`, `package.json`, `main.py`, `dist/` and `bin/` to
`~/homebrew/plugins/claude-voice/` and restarts Decky. Do not run it while a game is running: restarting
Decky closes the Quick Access menu and can interrupt the session.

## Using it

1. Open the Quick Access Menu and pick **Claude Voice**.
2. Press **Speak**, talk, press again (recording stops by itself after 90 seconds).
3. Read the answer in the panel, or choose **Open chat** for the full screen.
4. Approve or deny what Claude wants to run.

In the full-screen chat:

| Control | Action |
|---|---|
| D-pad up / down | move between messages; inside a long message, scroll its text |
| Right trackpad or stick | scroll the list |
| A on a message | copy it |
| Y or Start | per-chat settings (model, effort, approval) |
| X on a chat row | delete the chat |
| B | back (closes the on-screen keyboard first) |

## Data and privacy

Everything lives in `~/.local/share/claude-voice/`: chats, preferences, approval rules and the Whisper model.
Audio is recorded to one temporary file (`rec.wav`) that is overwritten by the next recording and transcribed
on the Deck. Only the transcribed text goes to Claude, through your own `claude` login.

## Development

```sh
pnpm install
pnpm run build       # bundle to dist/index.js
pnpm test            # frontend + backend
pnpm test:ts         # vitest + jsdom, with coverage thresholds
pnpm test:py         # pytest via uv (Python >= 3.10), fails below 100% line + branch coverage
```

The backend tests run the real plugin against fake `claude`, `pw-record` and `whisper-cli` executables
(`tests/py/conftest.py`) and drive the real approval hook end to end. The frontend tests replace `@decky/ui`
and `@decky/api` with small stand-ins (`tests/ts/mocks`) so gamepad handlers can be fired directly.

Layout:

```
main.py              Decky backend: recording, whisper, claude process, chats, approvals
bin/approve-hook.py  PreToolUse hook that asks the panel before risky tool calls
src/                 React UI: Panel.tsx (Quick Access), Fullscreen.tsx (chat), ui.tsx, api.ts, actions.ts
tests/py, tests/ts   pytest and vitest suites
```

Tip for UI work: the plugin code runs in Steam's shared JS context, not in the window that draws the UI.
Use `element.ownerDocument` for selection, clipboard and focus, and never `scrollIntoView` (it scrolls the
whole Steam page).

## Limitations

- Transcription language is fixed to Russian (`-l ru` in `main.py`); the Whisper model path and binary paths
  are hard-coded. Making them settings is the next obvious step.
- The frontend tests use mocked Steam components, so real gamepad and on-screen-keyboard behaviour is verified
  on a device, not in CI.
- Left-trackpad swipes are not delivered to plugins by Steam's default UI layout; only the right trackpad and
  stick can scroll smoothly.
- Early version (0.1.0), developed and tested on a Steam Deck OLED with SteamOS 3.9.

## License

[MIT](LICENSE)
