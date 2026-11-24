# Claude Voice for Decky

Talk to [Claude Code](https://claude.com/claude-code) from the Steam Deck Quick Access Menu.
Speech is transcribed locally with whisper.cpp, the request runs through the `claude` CLI
under your own login, and every tool call that can change something (shell commands, file
writes and edits) waits for you to press **Allow** or **Deny** on screen.

> Unofficial community plugin. Not affiliated with or endorsed by Anthropic.

## Features

- 🎤 Push-to-talk dictation (Russian by default), fully offline speech recognition
- Conversation memory across requests, "New chat" to reset
- Read-only tools (Read, Grep, Glob, web search/fetch) run without prompts
- Any other tool call shows an approval card; no answer in 5 minutes means deny
- Text input fallback

## Requirements

The plugin does not bundle these; install them once in Desktop Mode:

| Component | How |
|---|---|
| Claude Code CLI, logged in | `curl -fsSL https://claude.ai/install.sh \| bash`, then run `claude` once and log in |
| whisper.cpp (`whisper-cli`) | `brew install whisper-cpp` ([Homebrew on Linux](https://brew.sh)) |
| Whisper model | download `ggml-small.bin` from [ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp) to `~/.local/share/claude-voice/models/` |

Paths currently expected: `~/.local/bin/claude`, `/home/linuxbrew/.linuxbrew/bin/whisper-cli`.

## How approvals work

The plugin starts `claude -p` with a `PreToolUse` hook (`bin/approve-hook.py`). Safe
read-only tools pass through. For everything else the hook writes a request to
`~/.local/share/claude-voice/approvals/` and blocks until the panel writes the answer.
A denied or timed-out call is blocked before it runs.

## Build

```sh
pnpm install
pnpm run build
```

Then copy `plugin.json`, `package.json`, `main.py`, `dist/` and `bin/` to
`~/homebrew/plugins/claude-voice/` (or use `sudo ./install.sh`) and restart Decky.

## Status

Early version (0.1.0). Tested pieces: approval hook, headless Claude run, microphone
recording. Full in-Decky flow still needs testing on device.

## License

MIT
