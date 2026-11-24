#!/bin/bash
# Installs Claude Voice into Decky Loader. Run with sudo.
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
DST=/home/deck/homebrew/plugins/claude-voice
rm -rf "$DST"
mkdir -p "$DST/dist" "$DST/bin"
install -m 644 "$SRC/plugin.json" "$SRC/package.json" "$SRC/main.py" "$DST/"
install -m 644 "$SRC/dist/index.js" "$DST/dist/"
install -m 755 "$SRC/bin/approve-hook.py" "$DST/bin/"
chown -R deck:deck "$DST"
systemctl restart plugin_loader
echo "Claude Voice установлен в $DST, Decky перезапущен."
