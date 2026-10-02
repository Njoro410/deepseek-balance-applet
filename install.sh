#!/usr/bin/env bash
# Installs (or updates) the DeepSeek Balance applet for the current user.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)/deepseek-balance@njoro410"
DEST="$HOME/.local/share/cinnamon/applets/deepseek-balance@njoro410"

if [ "${1:-}" = "--uninstall" ]; then
    rm -rf "$DEST"
    echo "Removed $DEST"
    exit 0
fi

mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
cp -r "$SRC" "$DEST"

echo "Installed to $DEST"
echo
echo "Next: open the Applets dialog (right-click the panel → Applets, or Menu → Applets),"
echo "find 'DeepSeek Balance' and add it to the panel."
echo "If it doesn't appear, restart Cinnamon with Ctrl+Alt+Esc (or: cinnamon --replace &)."
